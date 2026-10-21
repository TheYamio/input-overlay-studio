use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::studio_store::StudioStore;
use crate::input_state::{HeldState, InputSnapshot};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, watch, RwLock};
use tokio_tungstenite::accept_async_with_config;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use tauri::Emitter;

use crate::services::config::Config;
use crate::services::consts::{
    mouse_button_name, mouse_scroll_name, vk_to_key_name,
};

#[derive(Debug, Clone)]
pub enum InputEvent {
    KeyPress { rawcode: u16 },
    KeyRelease { rawcode: u16 },
    MouseButton { button: u8, pressed: bool },
    MouseScroll { rotation: i8 },
    MouseMove { dx: i32, dy: i32, distance_counts: Option<f64> },
    Reset,
    SnapshotRequest { reply: mpsc::Sender<InputSnapshot> },
    AnalogDepth { rawcode: u16, depth: f32 },
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ServerStatus {
    pub running: bool,
    pub bind_error: Option<String>,
    pub client_count: usize,
    pub clients: Vec<String>,
    pub host: String,
    pub port: u16,
}

static INPUT_OVERFLOW: AtomicBool = AtomicBool::new(false);
#[derive(Clone)]
pub struct InputSender(mpsc::Sender<InputEvent>);
impl InputSender {
    pub async fn snapshot(&self) -> Option<InputSnapshot> {
        let (reply, mut receive) = mpsc::channel(1);
        tokio::time::timeout(Duration::from_secs(2), self.0.send(InputEvent::SnapshotRequest { reply })).await.ok()?.ok()?;
        tokio::time::timeout(Duration::from_secs(2), receive.recv()).await.ok()?
    }
    pub fn send(&self, event: InputEvent) -> Result<(), mpsc::error::TrySendError<InputEvent>> {
        self.0.try_send(event).map_err(|e| {
            INPUT_OVERFLOW.store(true, Ordering::Relaxed);
            e
        })
    }
}
pub fn input_channel() -> (InputSender, mpsc::Receiver<InputEvent>) {
    let (tx, rx) = mpsc::channel(4096);
    (InputSender(tx), rx)
}

pub struct WsState {
    pub rebind_tx: watch::Sender<()>,
    pub input_tx: InputSender,
}

fn is_allowed(event: &InputEvent, cfg: &Config) -> bool {
    if matches!(event, InputEvent::Reset) { return true; }
    if !cfg.capture_enabled { return false; }
    if matches!(event, InputEvent::MouseMove { .. }) && !cfg.send_mouse_move { return false; }
    if cfg.key_whitelist.is_empty() {
        return true;
    }
    match event {
        InputEvent::SnapshotRequest { .. } => false,
        InputEvent::Reset => true,
        InputEvent::MouseMove { .. } => cfg.send_mouse_move,
        InputEvent::MouseScroll { rotation } => {
            if cfg.key_whitelist.iter().any(|k| k == "mouse_wheel") {
                return true;
            }
            mouse_scroll_name(*rotation)
                .is_some_and(|n| cfg.key_whitelist.contains(&n.to_string()))
        }
        InputEvent::MouseButton { button, .. } => mouse_button_name(*button)
            .is_some_and(|n| cfg.key_whitelist.contains(&n.to_string())),
        InputEvent::KeyPress { rawcode } | InputEvent::KeyRelease { rawcode } => {
            vk_to_key_name(*rawcode)
                .is_some_and(|n| cfg.key_whitelist.contains(&n.to_string()))
        }
        InputEvent::AnalogDepth { rawcode, .. } => {
            vk_to_key_name(*rawcode)
                .is_some_and(|n| cfg.key_whitelist.contains(&n.to_string()))
        }
    }
}

fn event_to_json(event: &InputEvent) -> Option<String> {
    match event {
        InputEvent::SnapshotRequest { .. } => None,
        InputEvent::Reset => Some(r#"{"event_type":"input_reset"}"#.to_string()),
        InputEvent::KeyPress { rawcode } => Some(format!(
            r#"{{"event_type":"key_pressed","rawcode":{rawcode}}}"#
        )),
        InputEvent::KeyRelease { rawcode } => Some(format!(
            r#"{{"event_type":"key_released","rawcode":{rawcode}}}"#
        )),
        InputEvent::MouseButton { button, pressed } => {
            let event_type = if *pressed { "mouse_pressed" } else { "mouse_released" };
            Some(format!(r#"{{"event_type":"{event_type}","button":{button}}}"#))
        }
        InputEvent::MouseScroll { rotation } => Some(format!(
            r#"{{"event_type":"mouse_wheel","rotation":{rotation}}}"#
        )),
        InputEvent::MouseMove { dx, dy, distance_counts } => Some(match distance_counts {
            Some(distance) => format!(r#"{{"event_type":"mouse_moved","dx":{dx},"dy":{dy},"distance_counts":{distance}}}"#),
            None => format!(r#"{{"event_type":"mouse_moved","dx":{dx},"dy":{dy}}}"#),
        }),
        InputEvent::AnalogDepth { rawcode, depth } => Some(format!(
            r#"{{"event_type":"analog_depth","rawcode":{rawcode},"depth":{depth:.4}}}"#
        )),
    }
}

async fn distributor(
    mut input_rx: mpsc::Receiver<InputEvent>,
    bcast_tx: Arc<broadcast::Sender<Arc<str>>>,
    config: Arc<RwLock<Config>>,
    studio: Arc<StudioStore>,
) {
    // Capture already coalesces movement at 125 Hz. Digital events are sent immediately.
    // Waiting on recv avoids the original 1 ms idle polling and second mouse aggregation.
    let mut held = HeldState::default();
    let mut sequence: u64 = 0;
    while let Some(event) = input_rx.recv().await {
        if let InputEvent::SnapshotRequest { reply } = event {
            let cfg = config.read().await;
            if cfg.capture_enabled {
                #[cfg(windows)]
                crate::input_state::reconcile_windows(&mut held);
            } else { held.apply(&InputEvent::Reset); }
            sequence += 1;
            let snapshot = held.snapshot(sequence, |e| is_allowed(e, &cfg));
            let _ = reply.try_send(snapshot);
            continue;
        }
        if INPUT_OVERFLOW.swap(false, Ordering::Relaxed) {
            while input_rx.try_recv().is_ok() {}
            held.apply(&InputEvent::Reset); sequence += 1;
            let _ = bcast_tx.send(Arc::from(format!(r#"{{"event_type":"input_reset","sequence":{sequence}}}"#)));
            continue;
        }
        let cfg = config.read().await;
        if !is_allowed(&event, &cfg) { continue; }
        drop(cfg);
        held.apply(&event); sequence += 1;
        if let Some(mut json) = event_to_json(&event) {
            if let InputEvent::MouseMove { dx, dy, distance_counts } = event {
                let counts = distance_counts.unwrap_or_else(|| (dx as f64).hypot(dy as f64));
                let total = studio.add_distance(counts).await;
                json.pop(); json.push_str(&format!(",\"distance_cm\":{total}}}"));
            }
            json.pop(); json.push_str(&format!(",\"sequence\":{sequence}}}"));
            let _ = bcast_tx.send(Arc::from(json));
        }
    }
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    addr: SocketAddr,
    config: Arc<RwLock<Config>>,
    bcast_tx: Arc<broadcast::Sender<Arc<str>>>,
    app_handle: tauri::AppHandle,
    status: Arc<Mutex<ServerStatus>>,
    studio: Arc<StudioStore>,
    mut rebind_rx: watch::Receiver<()>,
    input_tx: InputSender,
) {
    let _ = stream.set_nodelay(true);
    let limits = WebSocketConfig { max_message_size: Some(2_000_000), max_frame_size: Some(2_000_000), ..Default::default() };
    let ws = match tokio::time::timeout(Duration::from_secs(10), accept_async_with_config(stream, Some(limits))).await {
        Ok(Ok(w)) => w,
        Ok(Err(e)) => { tracing::warn!("ws handshake failed from {addr}: {e}"); return; }
        Err(_) => return,
    };
    let (mut write, mut read) = ws.split();

    //handshake first message needs to be {"type":"auth","token":"..."}
    let auth_token = config.read().await.auth_token.clone();

    let authed = tokio::time::timeout(Duration::from_secs(10), async { loop {
        match read.next().await {
            Some(Ok(Message::Text(msg))) => {
                #[derive(Deserialize)]
                struct AuthMsg {
                    #[serde(rename = "type")]
                    msg_type: String,
                    token: Option<String>,
                }
                match serde_json::from_str::<AuthMsg>(&msg) {
                    Ok(m) if m.msg_type == "auth" => {
                        let token = m.token.unwrap_or_default();
                        if token.is_empty() {
                            let _ = write
                                .send(Message::Text(r#"{"type":"auth_response","status":"failed"}"#.into()))
                                .await;
                            tracing::warn!("auth rejected from {addr}: no token");
                            break false;
                        } else if auth_token.is_empty() || token == auth_token {
                            let _ = write
                                .send(Message::Text(r#"{"type":"auth_response","status":"success","protocol":4,"state_snapshot":true,"studio_revisions":true}"#.into()))
                                .await;
                            tracing::info!("client authenticated from {addr}");
                            break true;
                        } else {
                            let _ = write
                                .send(Message::Text(r#"{"type":"auth_response","status":"failed"}"#.into()))
                                .await;
                            tracing::warn!("auth rejected from {addr}: bad token");
                            break false;
                        }
                    }
                    _ => {
                        tracing::debug!("unexpected message from {addr}, ignoring");
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => break false,
            Some(Err(e)) => {
                tracing::warn!("ws error from {addr}: {e}");
                break false;
            }
            _ => {}
        }
    }}).await.unwrap_or(false);

    if !authed {
        return;
    }

    {
        let mut s = status.lock().unwrap();
        s.clients.push(addr.to_string());
        s.client_count = s.clients.len();
        app_handle.emit("status-update", s.clone()).ok();
    }

    let mut rx = bcast_tx.subscribe();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(3));

    loop {
        tokio::select! {
            _ = rebind_rx.changed() => break,
            _ = heartbeat.tick() => {
                if write.send(Message::Text(r#"{"type":"heartbeat"}"#.into())).await.is_err() { break; }
            }
            msg = rx.recv() => {
                match msg {
                    Ok(json) => {
                        if write.send(Message::Text(json.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("client {addr} lagged by {n} messages");
                        // Missing a release cannot leave a held visual indefinitely.
                        break;
                    }
                }
            }
            msg = read.next() => {
                match msg {
                    None | Some(Ok(Message::Close(_))) => break,
                    Some(Err(_)) => break,
                    Some(Ok(Message::Text(text))) if text.len() <= 2_000_000 => {
                        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { continue; };
                        match value["type"].as_str() {
                            Some("input_snapshot") => {
                                if let Some(snapshot) = input_tx.snapshot().await {
                                    if let Ok(json) = serde_json::to_string(&snapshot) {
                                        if write.send(Message::Text(json)).await.is_err() { break; }
                                    }
                                } else { break; }
                            }
                            Some("studio_get") => {
                                if studio.recovery_required.load(Ordering::Relaxed) {
                                    let (_, revision, config_sequence) = studio.snapshot().await;
                                    let reply = serde_json::json!({"type":"studio_recovery", "backup":studio.backup(), "revision":revision, "config_sequence":config_sequence}).to_string();
                                    let _ = write.send(Message::Text(reply)).await;
                                    continue;
                                }
                                let (document, revision, config_sequence) = studio.snapshot().await;
                                let reply = serde_json::json!({"type":"studio_config", "document":document, "revision":revision, "config_sequence":config_sequence}).to_string();
                                if write.send(Message::Text(reply)).await.is_err() { break; }
                                let total = *studio.distance_cm.lock().await;
                                let _ = write.send(Message::Text(serde_json::json!({"type":"distance_total","cm":total}).to_string())).await;
                            }
                            Some("distance_reset") => {
                                *studio.distance_cm.lock().await = 0.0;
                                let _ = bcast_tx.send(Arc::from(r#"{"type":"distance_total","cm":0}"#));
                                studio.persist_distance().await;
                            }
                            Some("studio_set") => {
                                let document = value["document"].clone();
                                let base = value["base_revision"].as_str().unwrap_or("");
                                match studio.set(document.clone(), base).await {
                                    Ok((revision, config_sequence)) => {
                                        let reply = serde_json::json!({"type":"studio_config", "document":document, "revision":revision, "config_sequence":config_sequence, "origin":value["origin"]}).to_string();
                                        let _ = bcast_tx.send(Arc::from(reply));
                                        let _ = write.send(Message::Text(serde_json::json!({"type":"studio_saved","request_id":value["request_id"],"revision":revision, "config_sequence":config_sequence}).to_string())).await;
                                    }
                                    Err(error) if error == "conflict" => {
                                        let (document, revision, config_sequence) = studio.snapshot().await;
                                        let _ = write.send(Message::Text(serde_json::json!({"type":"studio_conflict", "document":document, "revision":revision, "config_sequence":config_sequence, "request_id":value["request_id"]}).to_string())).await;
                                    }
                                    Err(error) => {
                                        let _ = write.send(Message::Text(serde_json::json!({"type":"studio_error", "request_id":value["request_id"], "reason":error}).to_string())).await;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    {
        let mut s = status.lock().unwrap();
        s.clients.retain(|a| a != &addr.to_string());
        s.client_count = s.clients.len();
        app_handle.emit("status-update", s.clone()).ok();
    }
    tracing::info!("client disconnected: {addr}");
}

pub async fn run(
    config: Arc<RwLock<Config>>,
    input_rx: mpsc::Receiver<InputEvent>,
    status: Arc<Mutex<ServerStatus>>,
    mut rebind_rx: watch::Receiver<()>,
    app_handle: tauri::AppHandle,
    studio: Arc<StudioStore>,
    input_tx: InputSender,
) {
    let (bcast_tx, _) = broadcast::channel::<Arc<str>>(1024);
    let bcast_tx = Arc::new(bcast_tx);

    {
        let cfg = Arc::clone(&config);
        let btx = Arc::clone(&bcast_tx);
        let store = Arc::clone(&studio);
        tokio::spawn(async move { distributor(input_rx, btx, cfg, store).await });
        let store = Arc::clone(&studio);
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_secs(3));
            loop { timer.tick().await; store.persist_distance().await; }
        });
    }

    loop {
        let (host, port) = {
            let cfg = config.read().await;
            (cfg.host.clone(), cfg.port)
        };
        let bind_addr = format!("{host}:{port}");

        match TcpListener::bind(&bind_addr).await {
            Ok(listener) => {
                {
                    let mut s = status.lock().unwrap();
                    s.running = true;
                    s.bind_error = None;
                    s.host = host.clone();
                    s.port = port;
                }
                app_handle.emit("status-update", status.lock().unwrap().clone()).ok();
                tracing::info!("ws server listening on ws://{bind_addr}");

                loop {
                    tokio::select! {
                        conn = listener.accept() => {
                            match conn {
                                Ok((stream, addr)) => {
                                    let cfg = Arc::clone(&config);
                                    let btx = Arc::clone(&bcast_tx);
                                    let ah  = app_handle.clone();
                                    let st  = Arc::clone(&status);
                                    let studio = Arc::clone(&studio);
                                    let connection_rebind = rebind_rx.clone();
                                    let connection_input = input_tx.clone();
                                    tokio::spawn(async move {
                                        handle_connection(stream, addr, cfg, btx, ah, st, studio, connection_rebind, connection_input).await;
                                    });
                                }
                                Err(e) => tracing::warn!("accept error: {e}"),
                            }
                        }
                        _ = rebind_rx.changed() => break,
                    }
                }
            }
            Err(e) => {
                let kind = bind_error_kind(&e).to_string();
                tracing::error!("failed to bind {bind_addr}: {e} ({kind})");
                {
                    let mut s = status.lock().unwrap();
                    s.running = false;
                    s.bind_error = Some(kind);
                    s.host = host;
                    s.port = port;
                }
                app_handle.emit("status-update", status.lock().unwrap().clone()).ok();
                //wait for rebind
                let _ = rebind_rx.changed().await;
            }
        }
    }
}

fn bind_error_kind(e: &std::io::Error) -> &'static str {
    match e.kind() {
        std::io::ErrorKind::AddrInUse => "inuse",
        std::io::ErrorKind::PermissionDenied => "denied",
        _ => "oserror",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn movement_off_is_respected_even_without_a_whitelist() {
        let mut cfg = Config::default(); cfg.send_mouse_move = false;
        assert!(!is_allowed(&InputEvent::MouseMove { dx: 1, dy: 1, distance_counts: Some(2.0) }, &cfg));
    }
    #[test]
    fn privacy_mode_blocks_input_but_allows_release_reset() {
        let mut cfg = Config::default(); cfg.capture_enabled = false;
        assert!(!is_allowed(&InputEvent::KeyPress { rawcode: 87 }, &cfg));
        assert!(is_allowed(&InputEvent::Reset, &cfg));
    }
    #[test]
    fn whitelist_filters_keys_and_extra_buttons() {
        let mut cfg = Config::default(); cfg.key_whitelist = vec!["key_w".into(), "mouse_4".into()];
        assert!(is_allowed(&InputEvent::KeyPress { rawcode: 87 }, &cfg));
        assert!(!is_allowed(&InputEvent::KeyPress { rawcode: 65 }, &cfg));
        assert!(is_allowed(&InputEvent::MouseButton { button: 4, pressed: true }, &cfg));
    }
    #[test]
    fn extended_packets_retain_legacy_fields() {
        let json = event_to_json(&InputEvent::MouseMove { dx: 0, dy: 0, distance_counts: Some(10.0) }).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["event_type"], "mouse_moved"); assert_eq!(v["distance_counts"], 10.0);
        assert_eq!(v["dx"], 0);
    }
    #[tokio::test]
    async fn capture_queue_has_a_fixed_upper_bound() {
        let (tx, mut rx) = input_channel();
        for _ in 0..4096 { assert!(tx.send(InputEvent::Reset).is_ok()); }
        assert!(tx.send(InputEvent::Reset).is_err());
        assert_eq!(rx.len(), 4096); assert!(rx.recv().await.is_some());
    }
}
