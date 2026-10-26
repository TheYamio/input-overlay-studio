use std::sync::{atomic::{AtomicBool,Ordering},Condvar,Mutex};
use std::time::Duration;

// An interruptible wait shared by device readers. Cancellation is permanent.
#[derive(Default)]
pub struct StopSignal {stopped:AtomicBool,waiter:Mutex<()>,changed:Condvar}
impl StopSignal {
    pub fn is_cancelled(&self)->bool{self.stopped.load(Ordering::Acquire)}
    pub fn cancel(&self){let _guard=self.waiter.lock().unwrap();self.stopped.store(true,Ordering::Release);self.changed.notify_all();}
    pub fn wait(&self,duration:Duration)->bool{
        let guard=self.waiter.lock().unwrap();
        let _result=self.changed.wait_timeout_while(guard,duration,|_|!self.is_cancelled()).unwrap();
        self.is_cancelled()
    }
}
#[cfg(test)]mod tests{
 use super::*;use std::sync::{Arc,mpsc};
 #[test]fn cancellation_interrupts_long_backoff_and_is_not_lost_before_wait(){
  let stop=Arc::new(StopSignal::default());let worker=stop.clone();let (started,ready)=mpsc::channel();let (done,finished)=mpsc::channel();
  let thread=std::thread::spawn(move||{started.send(()).unwrap();done.send(worker.wait(Duration::from_secs(16))).unwrap();});
  ready.recv().unwrap();stop.cancel();assert!(finished.recv_timeout(Duration::from_millis(250)).unwrap());thread.join().unwrap();assert!(stop.wait(Duration::from_secs(16)));
 }
 #[test]fn ordinary_wait_does_not_cancel(){let stop=StopSignal::default();assert!(!stop.wait(Duration::from_millis(1)));}
}
