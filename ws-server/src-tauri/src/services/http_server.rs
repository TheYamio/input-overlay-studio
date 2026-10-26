use std::{io,sync::{Arc,Mutex},time::Duration};
use tokio::{io::{AsyncBufRead,AsyncBufReadExt,AsyncWriteExt,BufReader},net::TcpStream,sync::{oneshot,Semaphore},task::JoinSet};
use super::address;
#[derive(rust_embed::Embed)]
#[folder = "$CARGO_MANIFEST_DIR/web-bundle"]
struct WebAssets;
const MAX_CONNECTIONS:usize=64;
const REQUEST_LINE_BYTES:usize=4096;
const HEADER_LINE_BYTES:usize=4096;
const HEADER_BYTES:usize=16384;
const HEADER_COUNT:usize=64;
#[derive(Clone,Copy)]
struct Limits {read:Duration,write:Duration}
impl Default for Limits{fn default()->Self{Self{read:Duration::from_secs(5),write:Duration::from_secs(5)}}}

pub struct HttpServer {stop_tx:Option<oneshot::Sender<()>>,task:Option<tauri::async_runtime::JoinHandle<()>>,status:Arc<Mutex<HttpStatus>>}
#[derive(Clone,serde::Serialize)]
pub struct HttpStatus {pub running:bool,pub bind_error:Option<String>,pub host:String,pub port:u16,pub overlay_available:bool}
impl HttpServer {
 pub fn start(host:&str,port:u16)->Option<Self>{Some(Self::with_limits(host,port,Limits::default()))}
 fn with_limits(host:&str,port:u16,limits:Limits)->Self{
  let (stop_tx,stop_rx)=oneshot::channel();let status=Arc::new(Mutex::new(HttpStatus{running:false,bind_error:None,host:host.into(),port,overlay_available:WebAssets::get("studio/overlay.html").is_some()}));
  let task=tauri::async_runtime::spawn(run(host.to_string(),port,stop_rx,status.clone(),limits));Self{stop_tx:Some(stop_tx),task:Some(task),status}
 }
 pub fn status(&self)->HttpStatus{self.status.lock().unwrap().clone()}
 pub async fn stop(mut self){self.stop_tx.take();if let Some(task)=self.task.take(){let _=task.await;}}
}
impl Drop for HttpServer{fn drop(&mut self){self.stop_tx.take();}}
async fn run(host:String,port:u16,mut stop:oneshot::Receiver<()>,status:Arc<Mutex<HttpStatus>>,limits:Limits){
 let bound=tokio::select!{_ = &mut stop=>return,result=address::bind(&host,port)=>result};
 let listener=match bound{Ok(listener)=>{let mut state=status.lock().unwrap();state.running=true;state.port=listener.local_addr().map(|a|a.port()).unwrap_or(port);tracing::info!("http: listening on http://{}",address::authority(address::client_host(&host),state.port));listener},Err(error)=>{status.lock().unwrap().bind_error=Some(match error.kind(){io::ErrorKind::AddrInUse=>"inuse",io::ErrorKind::PermissionDenied=>"denied",_=>"oserror"}.into());return;}};
 let permits=Arc::new(Semaphore::new(MAX_CONNECTIONS));let mut clients=JoinSet::new();
 loop{while clients.try_join_next().is_some(){}tokio::select!{
  _ = &mut stop=>break,
  _ = clients.join_next(),if !clients.is_empty()=>{},
  accepted=listener.accept()=>match accepted{
   Ok((stream,_))=>{if let Ok(permit)=permits.clone().try_acquire_owned(){clients.spawn(async move{let _permit=permit;serve(stream,limits).await;});}else{let _=stream.try_write(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");}},
   Err(_)=>break,
  }
 }}
 // Drop the listener before waiting for any client cleanup, so rebind is safe.
 drop(listener);clients.abort_all();while clients.join_next().await.is_some(){}status.lock().unwrap().running=false;tracing::info!("http: server stopped");
}
async fn line<R:AsyncBufRead+Unpin>(reader:&mut R,limit:usize)->Result<Vec<u8>,u16>{
 let mut out=Vec::new();loop{
  let available=reader.fill_buf().await.map_err(|_|400u16)?;if available.is_empty(){return Err(400);}
  let count=available.iter().position(|byte|*byte==b'\n').map_or(available.len(),|index|index+1);
  if out.len()+count>limit{return Err(431);}
  let done=available[count-1]==b'\n';out.extend_from_slice(&available[..count]);reader.consume(count);if done{return Ok(out);}
 }
}
struct Request {path:String,head:bool}
async fn request<R:AsyncBufRead+Unpin>(reader:&mut R)->Result<Request,u16>{
 let first=line(reader,REQUEST_LINE_BYTES).await.map_err(|code|if code==431{414}else{code})?;let mut total=first.len();
 let first=std::str::from_utf8(&first).map_err(|_|400u16)?;let parts:Vec<_>=first.split_whitespace().collect();
 if parts.len()!=3||!matches!(parts[2],"HTTP/1.0"|"HTTP/1.1"){return Err(400);}
 if !matches!(parts[0],"GET"|"HEAD"){return Err(405);}
 if !parts[1].starts_with('/')||parts[1].chars().any(char::is_control){return Err(400);}
 let mut count=0;
 loop{let header=line(reader,HEADER_LINE_BYTES).await?;total+=header.len();if total>HEADER_BYTES{return Err(431);}if header==b"\r\n"||header==b"\n"{break;}count+=1;if count>HEADER_COUNT{return Err(431);}
  let Some(colon)=header.iter().position(|byte|*byte==b':')else{return Err(400);};if colon==0||!header[..colon].iter().all(|byte|byte.is_ascii_alphanumeric()||*byte==b'-'){return Err(400);}
  if header[..header.len()-1].iter().any(|byte|*byte<32&&!matches!(*byte,b'\t'|b'\r')){return Err(400);}
 }
 Ok(Request{path:parts[1].split('?').next().unwrap().to_string(),head:parts[0]=="HEAD"})
}
async fn response(stream:&mut TcpStream,status:&str,mime:&str,body:&[u8],head:bool,extra:&str)->io::Result<()>{
 let headers=format!("HTTP/1.0 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n{extra}\r\n",body.len());
 stream.write_all(headers.as_bytes()).await?;if !head{stream.write_all(body).await?;}Ok(())
}
async fn serve(mut stream:TcpStream,limits:Limits){
 let parsed={let mut reader=BufReader::new(&mut stream);tokio::time::timeout(limits.read,request(&mut reader)).await.unwrap_or(Err(408))};
 let write=async {
  let request=match parsed{Ok(request)=>request,Err(code)=>{let status=match code{405=>"405 Method Not Allowed",408=>"408 Request Timeout",414=>"414 URI Too Long",431=>"431 Request Header Fields Too Large",_=>"400 Bad Request"};return response(&mut stream,status,"text/plain; charset=utf-8",status.as_bytes(),false,if code==405{"Allow: GET, HEAD\r\n"}else{""}).await;}};
  if matches!(request.path.as_str(),"/"|"/index.html"|"/studio"){return response(&mut stream,"302 Found","text/plain",b"",request.head,"Location: /studio/index.html\r\n").await;}
  let relative=request.path.trim_start_matches('/');let key=if relative.ends_with('/'){format!("{relative}index.html")}else{relative.to_string()};
  match WebAssets::get(&key).or_else(||WebAssets::get(&format!("{key}/index.html"))){Some(file)=>response(&mut stream,"200 OK",mime_of(&key),file.data.as_ref(),request.head,"").await,None=>response(&mut stream,"404 Not Found","text/plain",b"404 Not Found",request.head,"").await}
 };
 let _=tokio::time::timeout(limits.write,write).await;
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

#[cfg(test)]mod tests{
 use super::*;use tokio::io::AsyncReadExt;
 async fn listening(limits:Limits)->HttpServer{let server=HttpServer::with_limits("127.0.0.1",0,limits);tokio::time::timeout(Duration::from_secs(2),async{while !server.status().running{tokio::time::sleep(Duration::from_millis(2)).await;}}).await.unwrap();server}
 async fn exchange(port:u16,request:&[u8])->Vec<u8>{let mut stream=TcpStream::connect(("127.0.0.1",port)).await.unwrap();stream.write_all(request).await.unwrap();let mut response=Vec::new();let result=tokio::time::timeout(Duration::from_secs(2),stream.read_to_end(&mut response)).await;assert!(result.is_ok());response}
 #[tokio::test]async fn reports_occupied_port(){let reserved=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let server=HttpServer::start("127.0.0.1",reserved.local_addr().unwrap().port()).unwrap();tokio::time::timeout(Duration::from_secs(2),async{while server.status().bind_error.is_none(){tokio::time::sleep(Duration::from_millis(2)).await;}}).await.unwrap();assert_eq!(server.status().bind_error.as_deref(),Some("inuse"));server.stop().await;}
 #[tokio::test]async fn serves_bundled_pages_redirects_and_head(){
  let server=listening(Limits::default()).await;let port=server.status().port;assert!(server.status().overlay_available);
  let redirect=exchange(port,b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n").await;assert!(redirect.starts_with(b"HTTP/1.0 302"));
  let body=exchange(port,b"GET /studio/overlay.html HTTP/1.1\r\n\r\n").await;assert!(body.starts_with(b"HTTP/1.0 200"));assert!(String::from_utf8_lossy(&body).contains("id=\"overlay\""));
  let head=exchange(port,b"HEAD /studio/overlay.html HTTP/1.1\r\n\r\n").await;assert!(head.starts_with(b"HTTP/1.0 200"));assert!(head.ends_with(b"\r\n\r\n"));server.stop().await;
 }
 #[tokio::test]async fn rejects_oversize_lines_total_headers_and_count_before_unbounded_allocation(){
  let cases=[(format!("GET /{} HTTP/1.1\r\n\r\n","x".repeat(REQUEST_LINE_BYTES)),414),(format!("GET / HTTP/1.1\r\nX: {}","x".repeat(HEADER_LINE_BYTES)),431),(format!("GET / HTTP/1.1\r\n{}\r\n",format!("X: {}\r\n","x".repeat(3000)).repeat(6)),431),(format!("GET / HTTP/1.1\r\n{}\r\n","X: a\r\n".repeat(HEADER_COUNT+1)),431),("GET / HTTP/1.1\r\ninvalid\r\n\r\n".into(),400)];
  for (raw,code) in cases{let mut reader=BufReader::new(raw.as_bytes());assert_eq!(request(&mut reader).await.err(),Some(code));}
 }
 #[tokio::test]async fn slow_header_does_not_block_another_request_and_is_timed_out(){
  let server=listening(Limits{read:Duration::from_millis(150),write:Duration::from_millis(150)}).await;let port=server.status().port;let mut slow=TcpStream::connect(("127.0.0.1",port)).await.unwrap();slow.write_all(b"GET / HTTP/1.1\r\nX: ").await.unwrap();
  assert!(exchange(port,b"GET /studio/index.html HTTP/1.1\r\n\r\n").await.starts_with(b"HTTP/1.0 200"));
  let mut response=Vec::new();tokio::time::timeout(Duration::from_secs(1),slow.read_to_end(&mut response)).await.unwrap().unwrap();assert!(response.starts_with(b"HTTP/1.0 408"));server.stop().await;
 }
 #[tokio::test]async fn stopping_aborts_idle_clients_and_allows_immediate_rebind(){
  let server=listening(Limits::default()).await;let status=server.status.clone();let port=server.status().port;let mut idle=TcpStream::connect(("127.0.0.1",port)).await.unwrap();idle.write_all(b"G").await.unwrap();
  tokio::time::timeout(Duration::from_secs(1),server.stop()).await.unwrap();assert!(!status.lock().unwrap().running);let mut byte=[0];let closed=tokio::time::timeout(Duration::from_secs(1),idle.read(&mut byte)).await.unwrap();assert!(matches!(closed,Ok(0)|Err(_)));let rebound=address::bind("127.0.0.1",port).await.unwrap();drop(rebound);
 }
 #[tokio::test]async fn concurrent_client_limit_rejects_excess_without_spawning_waiters(){
  let server=listening(Limits::default()).await;let port=server.status().port;let mut idle=Vec::new();for _ in 0..MAX_CONNECTIONS{let mut stream=TcpStream::connect(("127.0.0.1",port)).await.unwrap();stream.write_all(b"G").await.unwrap();idle.push(stream);}
  let response=exchange(port,b"GET / HTTP/1.1\r\n\r\n").await;assert!(response.is_empty()||response.starts_with(b"HTTP/1.0 503"),"{}",String::from_utf8_lossy(&response));server.stop().await;
 }
}
