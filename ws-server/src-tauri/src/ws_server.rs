use crate::command_policy::{ClientPermissions,Command,token_matches};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::studio_store::StudioStore;
use crate::studio_activity::StudioActivity;
struct RuntimeLease(Option<Arc<StudioActivity>>);
impl Drop for RuntimeLease{fn drop(&mut self){if let Some(activity)=&self.0{activity.disconnected();}}}
use crate::input_state::{HeldState, InputSnapshot};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, watch, RwLock,Semaphore};
use tokio::task::JoinSet;
use crate::net_limits::{Writer,Task,RateLimit,MAX_WS_CLIENTS,MAX_MESSAGE_BYTES,WRITE_TIMEOUT};
use crate::services::address;
use tokio_tungstenite::accept_async_with_config;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use crate::runtime_status::{RuntimeStatus, Outcome};
#[derive(Clone)]
struct Configuration {json:Arc<str>,revision:String,sequence:u64}
struct Broadcasts {input:broadcast::Sender<Arc<str>>,configuration:watch::Sender<Option<Arc<Configuration>>>}
impl Broadcasts {
 fn new()->Arc<Self>{let (input,_)=broadcast::channel(1024);let (configuration,_)=watch::channel(None);Arc::new(Self{input,configuration})}
 fn input(&self,json:impl Into<Arc<str>>){let json=json.into();if json.len()<=1024{let _=self.input.send(json);}}
 fn configuration(&self,json:String,revision:String,sequence:u64){if json.len()>MAX_MESSAGE_BYTES{return;}let packet=Arc::new(Configuration{json:Arc::from(json),revision,sequence});self.configuration.send_if_modified(|current|{if current.as_ref().is_some_and(|old|old.sequence>=sequence){return false;}*current=Some(packet);true});}
}
#[derive(Clone)]
pub struct ServerHooks {pub changed:Arc<dyn Fn(ServerStatus)+Send+Sync>,pub capture_running:Arc<dyn Fn()->Option<bool>+Send+Sync>}
impl Default for ServerHooks{fn default()->Self{Self{changed:Arc::new(|_|{}),capture_running:Arc::new(||None)}}}
struct ClientLease {status:Arc<Mutex<ServerStatus>>,addr:String,hooks:ServerHooks}
impl Drop for ClientLease{fn drop(&mut self){let snapshot={let mut state=self.status.lock().unwrap();state.clients.retain(|addr|addr!=&self.addr);state.client_count=state.clients.len();state.clone()};(self.hooks.changed)(snapshot);}}

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

#[derive(Clone)]
pub struct InputSender {queue:mpsc::Sender<InputEvent>,overflow:Arc<AtomicBool>}
pub struct InputReceiver {queue:mpsc::Receiver<InputEvent>,overflow:Arc<AtomicBool>}
impl InputReceiver{async fn recv(&mut self)->Option<InputEvent>{self.queue.recv().await}#[cfg(test)]fn len(&self)->usize{self.queue.len()}}
impl InputSender {
    pub async fn snapshot(&self) -> Option<InputSnapshot> {
        let (reply, mut receive) = mpsc::channel(1);
        tokio::time::timeout(Duration::from_secs(2), self.queue.send(InputEvent::SnapshotRequest { reply })).await.ok()?.ok()?;
        tokio::time::timeout(Duration::from_secs(2), receive.recv()).await.ok()?
    }
    pub fn send(&self, event: InputEvent) -> Result<(), mpsc::error::TrySendError<InputEvent>> {
        self.queue.try_send(event).map_err(|e| {
            self.overflow.store(true, Ordering::Relaxed);
            e
        })
    }
}
pub fn input_channel() -> (InputSender, InputReceiver) {
    let (tx, rx) = mpsc::channel(4096);
    let overflow=Arc::new(AtomicBool::new(false));
    (InputSender{queue:tx,overflow:overflow.clone()},InputReceiver{queue:rx,overflow})
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
    mut input_rx: InputReceiver,
    bcast_tx: Arc<Broadcasts>,
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
        if input_rx.overflow.swap(false, Ordering::Relaxed) {
            while input_rx.queue.try_recv().is_ok() {}
            held.apply(&InputEvent::Reset); sequence += 1;
            bcast_tx.input(format!(r#"{{"event_type":"input_reset","sequence":{sequence}}}"#));
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
            bcast_tx.input(json);
        }
    }
}

async fn connection_status_packet(config:&RwLock<Config>,hooks:&ServerHooks,runtimes:&crate::runtime_status::Snapshot)->String {
 let capture_enabled=config.read().await.capture_enabled;let capture_running=(hooks.capture_running)().map(|running|capture_enabled&&running);
 serde_json::json!({"type":"connection_status","sequence":runtimes.sequence,"capture_enabled":capture_enabled,"capture_running":capture_running,"runtimes":{"connected":runtimes.connected,"ready":runtimes.ready,"failed":runtimes.failed,"unresponsive":runtimes.unresponsive}}).to_string()
}

async fn handle_connection(
    stream:tokio::net::TcpStream,addr:SocketAddr,config:Arc<RwLock<Config>>,bcast_tx:Arc<Broadcasts>,
    hooks:ServerHooks,status:Arc<Mutex<ServerStatus>>,studio:Arc<StudioStore>,
    mut rebind_rx:watch::Receiver<()>,input_tx:InputSender,activity:Arc<StudioActivity>,runtimes:Arc<RuntimeStatus>,
) {
    let _=stream.set_nodelay(true);
    let limits=WebSocketConfig{max_message_size:Some(MAX_MESSAGE_BYTES),max_frame_size:Some(MAX_MESSAGE_BYTES),write_buffer_size:16384,max_write_buffer_size:2_100_000,..Default::default()};
    let handshake=tokio::time::timeout(Duration::from_secs(10),accept_async_with_config(stream,Some(limits)));
    let ws=tokio::select!{_ = rebind_rx.changed()=>return,result=handshake=>match result{Ok(Ok(ws))=>ws,_=>return}};
    let (mut sink,mut read)=ws.split();let auth_token=config.read().await.auth_token.clone();
    let mut permissions=ClientPermissions::default();let mut status_client=false;
    let auth=async {
        loop {
            match read.next().await {
                Some(Ok(Message::Text(text))) if text.len()<=8192=>{
                    let Ok(value)=serde_json::from_str::<serde_json::Value>(&text)else{return false;};
                    if value["type"]!="auth"{return false;}
                    let accepted=token_matches(&auth_token,value["token"].as_str().unwrap_or(""));
                    let reply=if accepted{crate::compatibility::auth_response()}else{r#"{"type":"auth_response","status":"failed"}"#.into()};
                    if !matches!(tokio::time::timeout(WRITE_TIMEOUT,sink.send(Message::Text(reply))).await,Ok(Ok(()))){return false;}
                    if !accepted{return false;}
                    permissions=ClientPermissions::from_auth(&value);
                    status_client=value["studio_client"]["role"]=="studio"&&value["studio_client"]["features"]["runtime.status"]==1;
                    return true;
                }
                Some(Ok(Message::Ping(_)|Message::Pong(_)))=>{},
                _=>return false,
            }
        }
    };
    let accepted=tokio::select!{_ = rebind_rx.changed()=>false,result=tokio::time::timeout(Duration::from_secs(10),auth)=>result.unwrap_or(false)};
    if !accepted{return;}
    tracing::info!("client authenticated: {addr}");
    {let snapshot={let mut state=status.lock().unwrap();state.clients.push(addr.to_string());state.client_count=state.clients.len();state.clone()};(hooks.changed)(snapshot);}
    let _client=ClientLease{status,addr:addr.to_string(),hooks:hooks.clone()};
    let runtime=permissions.runtime;
    let _activity=if runtime{activity.connected();RuntimeLease(Some(activity.clone()))}else{RuntimeLease(None)};
    let runtime_session=if runtime{Some(runtimes.connect())}else{None};
    let mut writer=Writer::start(sink);let outbox=writer.outbox.clone();
    let mut runtime_changes=runtimes.subscribe();let mut last_status=String::new();let mut counted=false;
    let mut input=bcast_tx.input.subscribe();let mut configurations=bcast_tx.configuration.subscribe();
    let mut heartbeat=tokio::time::interval(Duration::from_secs(3));heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut requests=RateLimit::new(256,128);let mut snapshots=RateLimit::new(4,2);let mut documents=RateLimit::new(32,8);
    macro_rules! reply {($text:expr)=>{if !outbox.send($text,None){break;}};}
    loop {
        tokio::select! {
            _ = rebind_rx.changed()=>break,
            _ = &mut writer.closed=>break,
            _ = runtime_changes.changed(),if status_client=>{
                let snapshot=runtime_changes.borrow_and_update().clone();let packet=connection_status_packet(&config,&hooks,&snapshot).await;
                if packet!=last_status{reply!(packet.clone());last_status=packet;}
            }
            _ = heartbeat.tick()=>{
                reply!(r#"{"type":"heartbeat"}"#);
                if status_client{let snapshot=runtime_changes.borrow_and_update().clone();let packet=connection_status_packet(&config,&hooks,&snapshot).await;if packet!=last_status{reply!(packet.clone());last_status=packet;}}
            }
            message=input.recv()=>match message{Ok(json)=>{reply!(json);},Err(_)=>break},
            changed=configurations.changed()=>{
                if changed.is_err(){break;}
                let packet=configurations.borrow_and_update().clone();
                if let Some(packet)=packet{let delivery=runtime_session.as_ref().map(|session|session.delivery(&packet.revision));if !outbox.send(packet.json.clone(),delivery){break;}}
            }
            message=read.next()=>{
                let text=match message{Some(Ok(Message::Text(text)))=>text,Some(Ok(Message::Ping(_)|Message::Pong(_)))=>{if !requests.allow(){break;}continue;},_=>break};
                if !requests.allow(){break;}
                let Ok(mut value)=serde_json::from_str::<serde_json::Value>(&text)else{break;};
                if value["type"]!="studio_set"&&text.len()>8192{break;}
                let request_id=value["request_id"].as_u64();
                let command=match permissions.command(value["type"].as_str().unwrap_or("")){
                    Ok(command)=>command,
                    Err(code)=>{let reason=if code=="command-forbidden"{"incompatible or read-only client"}else{"unknown command"};reply!(serde_json::json!({"type":"studio_error","code":code,"request_id":request_id,"reason":reason}).to_string());continue;}
                };
                match command {
                    Command::InputSnapshot=>{
                        if !snapshots.allow(){break;}
                        if let Some(snapshot)=input_tx.snapshot().await{if let Ok(json)=serde_json::to_string(&snapshot){reply!(json);}}else{break;}
                    }
                    Command::RuntimeReady=>{
                        if let (Some(session),Some(revision))=(&runtime_session,value["revision"].as_str()){
                            let outcome=match value["state"].as_str(){Some("ready")=>Some(Outcome::Ready),Some("error")=>Some(Outcome::Error),_=>None};
                            if let Some(outcome)=outcome{if revision.len()<=128{session.acknowledge(revision,outcome);}}
                        }
                    }
                    Command::StudioGet=>{
                        if !documents.allow(){break;}
                        if let Some(reply)=studio.unsupported_reply(){reply!(reply);continue;}
                        if studio.recovery_required.load(Ordering::Relaxed){let current=studio.current();let revision=&current.revision;let sequence=current.sequence;let store=studio.clone();let backup=tokio::task::spawn_blocking(move||store.backup()).await.unwrap_or(serde_json::Value::Null);reply!(serde_json::json!({"type":"studio_recovery","backup":backup,"revision":revision,"config_sequence":sequence}).to_string());continue;}
                        let current=studio.current();let revision=&current.revision;let sequence=current.sequence;runtimes.revision(sequence,revision);let real=!current.document.is_null();
                        let json=current.packet(serde_json::json!({"type":"studio_config","revision":revision,"config_sequence":sequence}));
                        let delivery=runtime_session.as_ref().filter(|_|real).map(|session|session.delivery(&revision));if !outbox.send(json,delivery){break;}
                        if runtime&&real&&!counted{counted=true;let tracker=activity.clone();let _=tokio::task::spawn_blocking(move||tracker.ready(crate::studio_activity::now())).await;}
                        reply!(serde_json::json!({"type":"distance_total","cm":*studio.distance_cm.lock().await}).to_string());
                    }
                    Command::DistanceReset=>{
                        *studio.distance_cm.lock().await=0.0;bcast_tx.input(r#"{"type":"distance_total","cm":0}"#);studio.persist_distance().await;
                    }
                    Command::StudioSet=>{
                        if value["document"]["version"]!=4{reply!(serde_json::json!({"type":"studio_error","request_id":request_id,"reason":"incompatible or read-only client"}).to_string());continue;}
                        let document=value["document"].take();let base=value["base_revision"].as_str().unwrap_or("");
                        match studio.set_snapshot(document,base).await{
                            Ok(current)=>{
                                let revision=&current.revision;let sequence=current.sequence;
                                runtimes.revision(sequence,&revision);let origin=value["origin"].as_str().filter(|origin|origin.len()<=128);
                                let json=current.packet(serde_json::json!({"type":"studio_config","revision":revision,"config_sequence":sequence,"origin":origin}));
                                bcast_tx.configuration(json,revision.clone(),sequence);
                                reply!(serde_json::json!({"type":"studio_saved","request_id":request_id,"revision":revision,"config_sequence":sequence}).to_string());
                            }
                            Err(error) if error=="conflict"=>{let current=studio.current();reply!(current.packet(serde_json::json!({"type":"studio_conflict","revision":current.revision,"config_sequence":current.sequence,"request_id":request_id})));}
                            Err(error)=>{reply!(serde_json::json!({"type":"studio_error","request_id":request_id,"reason":error}).to_string());}
                        }
                    }
                }
            }
        }
        // A ready broadcast backlog must leave the writer a chance to drain.
        tokio::task::yield_now().await;
    }
    writer.stop().await;
    tracing::info!("client disconnected: {addr}");
}

pub async fn run(
    config: Arc<RwLock<Config>>,
    input_rx: InputReceiver,
    status: Arc<Mutex<ServerStatus>>,
    mut rebind_rx: watch::Receiver<()>,
    hooks: ServerHooks,
    studio: Arc<StudioStore>,
    input_tx: InputSender,
    activity: Arc<StudioActivity>,
) {
    let current=studio.current();
    let runtimes=RuntimeStatus::new(current.sequence,current.revision.clone());drop(current);
    let _watchdog=runtimes.watchdog();let bcast_tx=Broadcasts::new();let permits=Arc::new(Semaphore::new(MAX_WS_CLIENTS));let mut clients=JoinSet::new();
    let cfg=config.clone();let broadcasts=bcast_tx.clone();let store=studio.clone();
    let _input_task=Task(tokio::spawn(async move{distributor(input_rx,broadcasts,cfg,store).await;}));
    let store=studio.clone();let _distance_task=Task(tokio::spawn(async move{let mut timer=tokio::time::interval(Duration::from_secs(3));loop{timer.tick().await;store.persist_distance().await;}}));

    loop {
        let (host, port) = {
            let cfg = config.read().await;
            (cfg.host.clone(), cfg.port)
        };
        let binding=tokio::select!{_ = rebind_rx.changed()=>continue,result=address::bind(&host,port)=>result};

        match binding {
            Ok(listener) => {
                {
                    let mut s = status.lock().unwrap();
                    s.running = true;
                    s.bind_error = None;
                    s.host = host.clone();
                    s.port = listener.local_addr().map(|address|address.port()).unwrap_or(port);
                }
                let snapshot=status.lock().unwrap().clone();
                tracing::info!("ws server listening on ws://{}",address::authority(address::client_host(&host),snapshot.port));
                (hooks.changed)(snapshot);

                loop {
                    while clients.try_join_next().is_some(){}
                    tokio::select! {
                        _ = clients.join_next(),if !clients.is_empty()=>{},
                        conn = listener.accept() => {
                            match conn {
                                Ok((stream, addr)) => {
                                    let Ok(permit)=permits.clone().try_acquire_owned()else{drop(stream);continue;};
                                    let cfg = Arc::clone(&config);
                                    let btx = Arc::clone(&bcast_tx);
                                    let ah  = hooks.clone();
                                    let st  = Arc::clone(&status);
                                    let studio = Arc::clone(&studio);
                                    let connection_rebind = rebind_rx.clone();
                                    let connection_input = input_tx.clone();
                                    let activity=Arc::clone(&activity);
                                    let runtimes=Arc::clone(&runtimes);
                                    clients.spawn(async move {
                                        let _permit=permit;handle_connection(stream, addr, cfg, btx, ah, st, studio, connection_rebind, connection_input, activity, runtimes).await;
                                    });
                                }
                                Err(e) => tracing::warn!("accept error: {e}"),
                            }
                        }
                        _ = rebind_rx.changed() => break,
                    }
                }
                // Existing sessions see the rebind signal. Do not abort an
                // atomic save halfway through its disk commit; its connection
                // closes as soon as the current command has completed.
                {let mut state=status.lock().unwrap();state.running=false;}
            }
            Err(e) => {
                let kind = bind_error_kind(&e).to_string();
                tracing::error!("failed to bind {host}:{port}: {e} ({kind})");
                {
                    let mut s = status.lock().unwrap();
                    s.running = false;
                    s.bind_error = Some(kind);
                    s.host = host;
                    s.port = port;
                }
                let snapshot=status.lock().unwrap().clone();
                (hooks.changed)(snapshot);
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
    #[tokio::test(flavor="multi_thread",worker_threads=4)]
    async fn healthy_runtime_keeps_input_while_nonreading_runtime_is_evicted(){
        let _=tracing_subscriber::fmt().with_max_level(tracing::Level::INFO).with_test_writer().try_init();
        use std::sync::atomic::AtomicUsize;
        use tokio_tungstenite::{connect_async,MaybeTlsStream,WebSocketStream};
        use serde_json::{json,Value};
        type Client=WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
        async fn next(client:&mut Client,kind:&str)->Value{tokio::time::timeout(Duration::from_secs(5),async{loop{let message=client.next().await.unwrap().unwrap();if let Message::Text(text)=message{let value:Value=serde_json::from_str(&text).unwrap();if value["type"]==kind{return value;}}}}).await.unwrap()}
        async fn client(port:u16,role:&str)->Client{let (mut client,_)=connect_async(format!("ws://127.0.0.1:{port}")).await.unwrap();let mut descriptor=crate::compatibility::CONTRACT.clone();descriptor["role"]=json!(role);if role=="runtime"{descriptor["document"]["write"]=json!([]);}client.send(Message::Text(json!({"type":"auth","token":"loopback-test","studio_client":descriptor}).to_string())).await.unwrap();assert_eq!(next(&mut client,"auth_response").await["status"],"success");client}
        let folder=std::env::temp_dir().join(format!("ws-lifecycle-{}",rand::random::<u64>()));std::fs::create_dir(&folder).unwrap();
        let store=Arc::new(StudioStore::new(folder.join("studio.json")));let document:Value=serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();let (_,base,_)=store.snapshot().await;let (revision,_)=store.set(document.clone(),&base).await.unwrap();
        let mut config=Config::default();config.port=0;config.auth_token="loopback-test".into();config.key_whitelist=vec!["key_w".into()];let config=Arc::new(RwLock::new(config));
        let status=Arc::new(Mutex::new(ServerStatus::default()));let (rebind,rx)=watch::channel(());let (input,input_rx)=input_channel();let activity=Arc::new(StudioActivity::new(folder.join("activity.json")));
        let server=Task(tokio::spawn(run(config,input_rx,status.clone(),rx,ServerHooks::default(),store.clone(),input.clone(),activity)));
        tokio::time::timeout(Duration::from_secs(3),async{while !status.lock().unwrap().running{tokio::time::sleep(Duration::from_millis(2)).await;}}).await.unwrap();let port=status.lock().unwrap().port;
        let mut observer=client(port,"studio").await;observer.send(Message::Text(r#"{"type":"studio_get"}"#.into())).await.unwrap();next(&mut observer,"studio_config").await;
        let (mut observer_send,mut observer_read)=observer.split();let latest=Arc::new(Mutex::new(Value::Null));let saved=Arc::new(Mutex::new(Value::Null));let monitor=latest.clone();let saved_monitor=saved.clone();
        let observer_task=Task(tokio::spawn(async move{while let Some(Ok(Message::Text(text)))=observer_read.next().await{let value:Value=serde_json::from_str(&text).unwrap();if value["type"]=="connection_status"{*monitor.lock().unwrap()=value;}else if value["type"]=="studio_saved"||value["type"]=="studio_error"{*saved_monitor.lock().unwrap()=value;}}}));
        let mut healthy=client(port,"runtime").await;healthy.send(Message::Text(r#"{"type":"studio_get"}"#.into())).await.unwrap();next(&mut healthy,"studio_config").await;healthy.send(Message::Text(json!({"type":"runtime_ready","revision":revision,"state":"ready"}).to_string())).await.unwrap();
        let received=Arc::new(AtomicUsize::new(0));let pressed=Arc::new(AtomicBool::new(false));let received_monitor=received.clone();let pressed_monitor=pressed.clone();let healthy_task=Task(tokio::spawn(async move{let mut current=revision;while let Some(Ok(message))=healthy.next().await{if let Message::Text(text)=message{let value:Value=serde_json::from_str(&text).unwrap();if value["type"]=="studio_config"{current=value["revision"].as_str().unwrap().into();}if value["type"]=="studio_config"||value["type"]=="heartbeat"{if healthy.send(Message::Text(json!({"type":"runtime_ready","revision":current,"state":"ready"}).to_string())).await.is_err(){break;}}if value["event_type"]=="key_pressed"||value["event_type"]=="key_released"{received_monitor.fetch_add(1,Ordering::Relaxed);pressed_monitor.store(value["event_type"]=="key_pressed",Ordering::Relaxed);}}}}));
        let mut slow=client(port,"runtime").await;slow.send(Message::Text(r#"{"type":"studio_get"}"#.into())).await.unwrap();let current=next(&mut slow,"studio_config").await;slow.send(Message::Text(json!({"type":"runtime_ready","revision":current["revision"],"state":"ready"}).to_string())).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2),async{while latest.lock().unwrap()["runtimes"]["ready"]!=2{tokio::time::sleep(Duration::from_millis(2)).await;}}).await.unwrap();
        // From here the second Runtime deliberately never polls its socket.
        let producer_input=input.clone();let producer=Task(tokio::spawn(async move{let mut timer=tokio::time::interval(Duration::from_millis(2));let mut down=false;loop{timer.tick().await;down=!down;let _=producer_input.send(if down{InputEvent::KeyPress{rawcode:87}}else{InputEvent::KeyRelease{rawcode:87}});}}));
        let mut large=document.clone();let common=large["profiles"][0]["modules"][0]["common"].clone();for index in 0..7{large["profiles"][0]["modules"].as_array_mut().unwrap().push(json!({"id":format!("opaque-{index}"),"type":"test.lifecycle","schemaVersion":1,"enabled":false,"common":common,"config":{"padding":vec!["x".repeat(16000);12]},"resources":{"assets":[],"shapes":[]}}));}
        assert!(crate::studio_store::valid_document(&large),"large fixture invalid: {} bytes",serde_json::to_vec(&large).unwrap().len());
        let mut base=current["revision"].as_str().unwrap().to_string();let before=received.load(Ordering::Relaxed);
        for id in 1..=32u64{large["profiles"][0]["name"]=json!(format!("update-{id}"));observer_send.send(Message::Text(json!({"type":"studio_set","document":large,"base_revision":base,"request_id":id}).to_string())).await.unwrap();tokio::time::timeout(Duration::from_secs(5),async{while saved.lock().unwrap()["request_id"]!=id{let state=saved.lock().unwrap().clone();assert_ne!(state["type"],"studio_error","save failed: {}",state["reason"]);tokio::time::sleep(Duration::from_millis(2)).await;}}).await.unwrap_or_else(|_|{let state=saved.lock().unwrap().clone();let clients=status.lock().unwrap().client_count;let stored=store.current().document["profiles"][0]["name"].to_string();panic!("missing ACK {id}; state={state}; clients={clients}; inputs={}; stored={stored}",received.load(Ordering::Relaxed));});base=saved.lock().unwrap()["revision"].as_str().unwrap().into();tokio::time::sleep(Duration::from_millis(30)).await;}
        tokio::time::timeout(Duration::from_secs(6),async{loop{let ready={let state=latest.lock().unwrap();state["runtimes"]["connected"]==1&&state["runtimes"]["ready"]==1};if ready{break;}tokio::time::sleep(Duration::from_millis(10)).await;}}).await.unwrap();
        assert!(received.load(Ordering::Relaxed)>before+100);let after=received.load(Ordering::Relaxed);tokio::time::sleep(Duration::from_millis(50)).await;assert!(received.load(Ordering::Relaxed)>after);
        producer.stop().await;let _=input.send(InputEvent::KeyRelease{rawcode:87});tokio::time::timeout(Duration::from_secs(1),async{while pressed.load(Ordering::Relaxed){tokio::time::sleep(Duration::from_millis(2)).await;}}).await.unwrap();
        // Rebind cancels every old connection, including writer tasks and leases.
        rebind.send(()).unwrap();tokio::time::timeout(Duration::from_secs(2),async{while status.lock().unwrap().client_count!=0{tokio::time::sleep(Duration::from_millis(2)).await;}}).await.unwrap();
        drop((slow,healthy_task,observer_task,observer_send,server));tokio::time::sleep(Duration::from_millis(20)).await;
        for name in ["studio.json","studio.backup.json","activity.json","activity.tmp"]{let _=std::fs::remove_file(folder.join(name));}let _=std::fs::remove_dir(folder);
    }
}
