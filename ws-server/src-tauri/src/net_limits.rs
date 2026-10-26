use std::{sync::Arc,time::{Duration,Instant}};
use futures_util::{Sink,SinkExt};
use tokio::sync::{mpsc,oneshot,OwnedSemaphorePermit,Semaphore};
use tokio_tungstenite::tungstenite::Message;
use crate::runtime_status::Delivery;

pub const MAX_WS_CLIENTS:usize=32;
pub const MAX_MESSAGE_BYTES:usize=2_000_000;
const OUTBOUND_BYTES:usize=4_000_000;
// Enough small packets for a catch-up burst; large messages remain byte-bound.
const OUTBOUND_PACKETS:usize=1024;
pub const WRITE_TIMEOUT:Duration=Duration::from_secs(3);

pub struct Task(pub tokio::task::JoinHandle<()>);
impl Drop for Task{fn drop(&mut self){self.0.abort();}}
impl Task{pub async fn stop(mut self){self.0.abort();let _=(&mut self.0).await;}}
struct Packet {text:Arc<str>,delivery:Option<Delivery>,_bytes:OwnedSemaphorePermit}
#[derive(Clone)]
pub struct Outbox {sender:mpsc::Sender<Packet>,bytes:Arc<Semaphore>}
pub struct Writer {pub outbox:Outbox,pub closed:oneshot::Receiver<()>,_task:Task}
impl Outbox {
    // Never wait on a slow consumer from the input/control loop. Failure means
    // disconnect, followed by a fresh ordered snapshot on reconnect.
    pub fn send(&self,text:impl Into<Arc<str>>,delivery:Option<Delivery>)->bool{
        let text=text.into();if text.len()>MAX_MESSAGE_BYTES{tracing::warn!("outbound message limit exceeded");return false;}
        let Ok(bytes)=self.bytes.clone().try_acquire_many_owned(text.len() as u32)else{tracing::warn!("outbound byte budget exceeded");return false;};
        if self.sender.try_send(Packet{text,delivery,_bytes:bytes}).is_err(){tracing::warn!("outbound queue full or closed");return false;}true
    }
}
impl Writer {
    pub async fn stop(self){self._task.stop().await;}
    pub fn start<S>(sink:S)->Self where S:Sink<Message>+Unpin+Send+'static,S::Error:Send{Self::with_timeout(sink,WRITE_TIMEOUT)}
    fn with_timeout<S>(mut sink:S,timeout:Duration)->Self where S:Sink<Message>+Unpin+Send+'static,S::Error:Send{
        let (sender,mut receiver)=mpsc::channel::<Packet>(OUTBOUND_PACKETS);let bytes=Arc::new(Semaphore::new(OUTBOUND_BYTES));let (done,closed)=oneshot::channel();
        let task=tokio::spawn(async move{
            while let Some(packet)=receiver.recv().await{
                if !matches!(tokio::time::timeout(timeout,sink.send(Message::Text(packet.text.to_string()))).await,Ok(Ok(()))){tracing::warn!("socket writer stalled or failed");break;}
                if let Some(delivery)=packet.delivery{delivery.sent();}
            }
            drop(receiver);let _=done.send(());
        });
        Self{outbox:Outbox{sender,bytes},closed,_task:Task(task)}
    }
}
pub struct RateLimit {tokens:f64,capacity:f64,rate:f64,last:Instant}
impl RateLimit {
    pub fn new(capacity:u32,per_second:u32)->Self{Self{tokens:capacity as f64,capacity:capacity as f64,rate:per_second as f64,last:Instant::now()}}
    pub fn allow(&mut self)->bool{self.at(Instant::now())}
    fn at(&mut self,now:Instant)->bool{self.tokens=(self.tokens+now.saturating_duration_since(self.last).as_secs_f64()*self.rate).min(self.capacity);self.last=now;if self.tokens<1.0{return false;}self.tokens-=1.0;true}
}

#[cfg(test)]mod tests{
 use super::*;use std::{pin::Pin,task::{Context,Poll}};
 struct Stalled;
 impl Sink<Message> for Stalled {type Error=();fn poll_ready(self:Pin<&mut Self>,_:&mut Context<'_>)->Poll<Result<(),()>>{Poll::Pending}fn start_send(self:Pin<&mut Self>,_:Message)->Result<(),()>{Ok(())}fn poll_flush(self:Pin<&mut Self>,_:&mut Context<'_>)->Poll<Result<(),()>>{Poll::Pending}fn poll_close(self:Pin<&mut Self>,_:&mut Context<'_>)->Poll<Result<(),()>>{Poll::Pending}}
 #[tokio::test]async fn stalled_writes_have_a_deadline_and_release_all_bytes(){
  let mut writer=Writer::with_timeout(Stalled,Duration::from_millis(20));let bytes=writer.outbox.bytes.clone();assert!(writer.outbox.send("hello",None));
  tokio::time::timeout(Duration::from_millis(250),&mut writer.closed).await.unwrap().unwrap();assert_eq!(bytes.available_permits(),OUTBOUND_BYTES);assert!(!writer.outbox.send("after close",None));
 }
 #[tokio::test]async fn byte_and_packet_limits_include_the_in_flight_message(){
  let writer=Writer::with_timeout(Stalled,Duration::from_secs(3));let full:Arc<str>=Arc::from("x".repeat(MAX_MESSAGE_BYTES));assert!(writer.outbox.send(full.clone(),None));tokio::task::yield_now().await;assert!(writer.outbox.send(full,None));assert!(!writer.outbox.send("overflow",None));
  let writer=Writer::with_timeout(Stalled,Duration::from_secs(3));for _ in 0..OUTBOUND_PACKETS{assert!(writer.outbox.send("small",None));}assert!(!writer.outbox.send("overflow",None));
 }
 #[test]fn request_budgets_are_bounded_and_refill(){let mut rate=RateLimit::new(4,2);let now=Instant::now();for _ in 0..4{assert!(rate.at(now));}assert!(!rate.at(now));assert!(rate.at(now+Duration::from_millis(500)));assert!(!rate.at(now+Duration::from_millis(500)));}
}
