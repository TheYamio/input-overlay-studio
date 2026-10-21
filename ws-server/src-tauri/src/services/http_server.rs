use std::net::SocketAddr;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use std::sync::{Arc, Mutex};

#[derive(rust_embed::Embed)]
#[folder = "$CARGO_MANIFEST_DIR/web-bundle"]
struct WebAssets;

pub struct HttpServer {
    stop_tx: Option<oneshot::Sender<()>>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    status: Arc<Mutex<HttpStatus>>,
}
#[derive(Clone, serde::Serialize)]
pub struct HttpStatus { pub running: bool, pub bind_error: Option<String>, pub host: String, pub port: u16, pub overlay_available: bool }

impl HttpServer {
    pub fn start(host: &str, port: u16) -> Option<Self> {
        let (stop_tx, stop_rx) = oneshot::channel();
        let bind_addr = format!("{host}:{port}");
        let status = Arc::new(Mutex::new(HttpStatus { running: false, bind_error: None, host: host.into(), port, overlay_available: WebAssets::get("studio/overlay.html").is_some() }));
        let task = tauri::async_runtime::spawn(run(bind_addr, stop_rx, status.clone()));
        Some(HttpServer { stop_tx: Some(stop_tx), task: Some(task), status })
    }
    pub fn status(&self) -> HttpStatus { self.status.lock().unwrap().clone() }
    pub async fn stop(mut self) {
        self.stop_tx.take();
        if let Some(task) = self.task.take() { let _ = task.await; }
    }
}

impl Drop for HttpServer {
    fn drop(&mut self) { self.stop_tx.take(); }
}

async fn run(bind_addr: String, mut stop_rx: oneshot::Receiver<()>, status: Arc<Mutex<HttpStatus>>) {
    let listener = match TcpListener::bind(&bind_addr).await {
        Ok(l) => {
            tracing::info!("http: listening on http://{bind_addr}");
            let mut current = status.lock().unwrap(); current.running = true; current.port = l.local_addr().map(|a| a.port()).unwrap_or(current.port); drop(current);
            l
        }
        Err(e) => {
            tracing::error!("http: failed to bind {bind_addr}: {e}");
            status.lock().unwrap().bind_error = Some(match e.kind() { std::io::ErrorKind::AddrInUse => "inuse", std::io::ErrorKind::PermissionDenied => "denied", _ => "oserror" }.into());
            return;
        }
    };
    loop {
        tokio::select! {
            _ = &mut stop_rx => break,
            res = listener.accept() => match res {
                Ok((stream, addr)) => { tokio::spawn(serve(stream, addr)); }
                Err(e) => tracing::warn!("http: accept error: {e}"),
            }
        }
    }
    tracing::info!("http: server stopped");
    status.lock().unwrap().running = false;
}

async fn serve(stream: tokio::net::TcpStream, _addr: SocketAddr) {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await.is_err() { return; }

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) if line == "\r\n" || line == "\n" => break,
            _ => {}
        }
    }

    let mut parts = request_line.split_whitespace();
    let method   = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");
    if method != "GET" { return; }

    let path = raw_path.split('?').next().unwrap_or("/");
    let rel  = path.trim_start_matches('/');
    let key  = if rel.is_empty() { "index.html".into() } else { rel.to_string() };

    let asset = WebAssets::get(&key)
        .or_else(|| WebAssets::get(&format!("{key}/index.html")));

    match asset {
        Some(file) => {
            let body = file.data.as_ref();
            let mime = mime_of(&key);
            tracing::debug!("http: 200 {path}");
            let header = format!(
                "HTTP/1.0 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = write_half.write_all(header.as_bytes()).await;
            let _ = write_half.write_all(body).await;
        }
        None => {
            tracing::debug!("http: 404 {path}");
            respond_err(&mut write_half, 404).await;
        }
    }
}

async fn respond_err(w: &mut tokio::net::tcp::OwnedWriteHalf, code: u16) {
    let (text, body): (&str, &[u8]) = match code {
        403 => ("Forbidden",             b"403 Forbidden"),
        404 => ("Not Found",             b"404 Not Found"),
        500 => ("Internal Server Error", b"500 Internal Server Error"),
        _   => ("Error",                 b"Error"),
    };
    let resp = format!(
        "HTTP/1.0 {code} {text}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = w.write_all(resp.as_bytes()).await;
    let _ = w.write_all(body).await;
}

fn mime_of(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "css"          => "text/css",
        "js"           => "application/javascript",
        "json"         => "application/json",
        "png"          => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif"          => "image/gif",
        "svg"          => "image/svg+xml",
        "ico"          => "image/x-icon",
        "woff"         => "font/woff",
        "woff2"        => "font/woff2",
        "ttf"          => "font/ttf",
        "txt"          => "text/plain; charset=utf-8",
        _              => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn reports_occupied_http_port() {
        let reserved = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let server = HttpServer::start("127.0.0.1", reserved.local_addr().unwrap().port()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while server.status().bind_error.is_none() { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
        }).await.unwrap();
        assert!(!server.status().running); assert_eq!(server.status().bind_error.as_deref(), Some("inuse")); server.stop().await;
    }
    #[tokio::test]
    async fn reports_listening_status_and_bundled_overlay() {
        let server = HttpServer::start("127.0.0.1", 0).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !server.status().running { tokio::time::sleep(std::time::Duration::from_millis(10)).await; }
        }).await.unwrap();
        assert!(server.status().port > 0); assert!(server.status().overlay_available); server.stop().await;
    }
}
