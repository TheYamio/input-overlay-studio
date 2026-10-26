//! Ephemeral runtime acknowledgements. No input events or user configuration are stored here.
use std::{collections::HashMap, sync::{Arc, Mutex,Weak}};
use std::time::{Instant,Duration};
use serde::Serialize;
use tokio::sync::watch;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Snapshot { pub sequence:u64, pub connected:usize, pub ready:usize, pub failed:usize, pub unresponsive:usize }
#[derive(Clone, Copy, PartialEq)]
pub enum Outcome { Ready, Error, Stale }
struct Peer { served:Option<String>,sending:Option<String>,pending:Option<Outcome>,outcome:Option<Outcome>,last_seen:Instant }
struct State { next:u64, sequence:u64, config_sequence:u64, revision:String, peers:HashMap<u64,Peer> }
pub struct RuntimeStatus { state:Mutex<State>, changes:watch::Sender<Snapshot> }
pub struct RuntimeSession { id:u64, registry:Arc<RuntimeStatus> }
pub struct Delivery {id:u64,registry:Weak<RuntimeStatus>,revision:String}
pub struct Watchdog(tokio::task::JoinHandle<()>);
impl Drop for Watchdog{fn drop(&mut self){self.0.abort();}}
impl Delivery{pub fn sent(self){if let Some(registry)=self.registry.upgrade(){let mut state=registry.state.lock().unwrap();if state.revision==self.revision{let mut changed=false;if let Some(peer)=state.peers.get_mut(&self.id){peer.served=Some(self.revision);peer.sending=None;if let Some(outcome)=peer.pending.take(){peer.last_seen=Instant::now();changed=peer.outcome!=Some(outcome);peer.outcome=Some(outcome);}}if changed{registry.publish(&mut state);}}}}}
impl RuntimeStatus {
 pub fn new(config_sequence:u64,revision:String)->Arc<Self>{
  let (changes,_)=watch::channel(Snapshot{sequence:0,connected:0,ready:0,failed:0,unresponsive:0});
  Arc::new(Self{state:Mutex::new(State{next:0,sequence:0,config_sequence,revision,peers:HashMap::new()}),changes})
 }
 fn publish(&self,state:&mut State){
  state.sequence+=1;
  self.changes.send_replace(Snapshot{sequence:state.sequence,connected:state.peers.len(),ready:state.peers.values().filter(|p|p.outcome==Some(Outcome::Ready)).count(),failed:state.peers.values().filter(|p|p.outcome==Some(Outcome::Error)).count(),unresponsive:state.peers.values().filter(|p|p.outcome==Some(Outcome::Stale)).count()});
 }
 pub fn subscribe(&self)->watch::Receiver<Snapshot>{self.changes.subscribe()}
 pub fn watchdog(self:&Arc<Self>)->Watchdog{
  let registry=Arc::downgrade(self);Watchdog(tokio::spawn(async move{let mut timer=tokio::time::interval(Duration::from_secs(1));timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);loop{timer.tick().await;let Some(registry)=registry.upgrade()else{break;};registry.expire_at(Instant::now());}}))
 }
 fn expire_at(&self,now:Instant){let mut state=self.state.lock().unwrap();let mut changed=false;for peer in state.peers.values_mut(){if now.saturating_duration_since(peer.last_seen)>Duration::from_secs(12)&&peer.outcome!=Some(Outcome::Stale){peer.outcome=Some(Outcome::Stale);changed=true;}}if changed{self.publish(&mut state);}}
 pub fn connect(self:&Arc<Self>)->RuntimeSession{
  let mut state=self.state.lock().unwrap();state.next+=1;let id=state.next;state.peers.insert(id,Peer{served:None,sending:None,pending:None,outcome:None,last_seen:Instant::now()});self.publish(&mut state);RuntimeSession{id,registry:Arc::clone(self)}
 }
 pub fn revision(&self,sequence:u64,revision:&str){
  let mut state=self.state.lock().unwrap();if sequence<=state.config_sequence{return;}
  state.config_sequence=sequence;state.revision=revision.to_string();for peer in state.peers.values_mut(){peer.outcome=None;peer.served=None;peer.sending=None;peer.pending=None;}self.publish(&mut state);
 }
}
impl RuntimeSession {
 pub fn delivery(&self,revision:&str)->Delivery{let mut state=self.registry.state.lock().unwrap();if state.revision==revision{if let Some(peer)=state.peers.get_mut(&self.id){peer.sending=Some(revision.into());}}Delivery{id:self.id,registry:Arc::downgrade(&self.registry),revision:revision.into()}}
 #[cfg(test)]fn served(&self){let revision=self.registry.state.lock().unwrap().revision.clone();self.delivery(&revision).sent();}
 pub fn acknowledge(&self,revision:&str,outcome:Outcome){
  let mut state=self.registry.state.lock().unwrap();if state.revision!=revision{return;}
  let Some(peer)=state.peers.get_mut(&self.id)else{return;};if peer.served.as_deref()!=Some(revision){if peer.sending.as_deref()==Some(revision){peer.pending=Some(outcome);}return;}peer.last_seen=Instant::now();if peer.outcome==Some(outcome){return;}peer.outcome=Some(outcome);self.registry.publish(&mut state);
 }
}
impl Drop for RuntimeSession{fn drop(&mut self){let mut state=self.registry.state.lock().unwrap();if state.peers.remove(&self.id).is_some(){self.registry.publish(&mut state);}}}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn racing_ack_waits_for_actual_delivery_and_old_deliveries_cannot_confirm_new_profiles(){
  let r=RuntimeStatus::new(0,"r0".into());let view=r.subscribe();let a=r.connect();let pending=a.delivery("r0");a.acknowledge("r0",Outcome::Ready);assert_eq!(view.borrow().ready,0);pending.sent();assert_eq!(view.borrow().ready,1);
  let old=a.delivery("r0");r.revision(1,"r1");old.sent();a.acknowledge("r1",Outcome::Ready);assert_eq!(view.borrow().ready,0);a.delivery("r1").sent();a.acknowledge("r1",Outcome::Ready);assert_eq!(view.borrow().ready,1);
 }
 #[test]fn queued_delivery_does_not_retain_disconnected_sources(){let r=RuntimeStatus::new(0,"r0".into());let view=r.subscribe();let a=r.connect();let delivery=a.delivery("r0");drop(a);delivery.sent();assert_eq!(view.borrow().connected,0);}
 #[tokio::test]async fn independent_watchdog_expires_silent_peer_and_preserves_healthy_peer(){
  let r=RuntimeStatus::new(0,"r0".into());let mut view=r.subscribe();let a=r.connect();let b=r.connect();a.served();b.served();a.acknowledge("r0",Outcome::Ready);b.acknowledge("r0",Outcome::Ready);r.state.lock().unwrap().peers.get_mut(&a.id).unwrap().last_seen=Instant::now()-Duration::from_secs(13);
  let _watchdog=r.watchdog();tokio::time::timeout(Duration::from_secs(1),async{while view.borrow_and_update().unresponsive!=1{view.changed().await.unwrap();}}).await.unwrap();assert_eq!(view.borrow().ready,1);
  let weak=Arc::downgrade(&r);drop(a);drop(b);drop(r);assert!(weak.upgrade().is_none());
 }
 #[test]fn requires_served_current_document_and_tracks_disconnect(){let r=RuntimeStatus::new(0,"r0".into());let view=r.subscribe();let a=r.connect();a.acknowledge("r0",Outcome::Ready);assert_eq!(view.borrow().ready,0);a.served();a.acknowledge("wrong",Outcome::Ready);assert_eq!(view.borrow().ready,0);a.acknowledge("r0",Outcome::Ready);assert_eq!(view.borrow().ready,1);let seq=view.borrow().sequence;a.acknowledge("r0",Outcome::Ready);assert_eq!(view.borrow().sequence,seq);drop(a);assert_eq!(view.borrow().connected,0);assert_eq!(view.borrow().ready,0);}
 #[test]fn newer_profiles_invalidate_readiness_and_ignore_reordered_changes(){let r=RuntimeStatus::new(1,"r1".into());let view=r.subscribe();let a=r.connect();a.served();a.acknowledge("r1",Outcome::Ready);r.revision(3,"r3");r.revision(2,"r2");assert_eq!(view.borrow().ready,0);a.acknowledge("r1",Outcome::Ready);assert_eq!(view.borrow().ready,0);a.acknowledge("r3",Outcome::Ready);assert_eq!(view.borrow().ready,0);a.served();a.acknowledge("r3",Outcome::Ready);assert_eq!(view.borrow().ready,1);}
 #[test]fn silent_sources_lose_readiness_and_can_recover(){let r=RuntimeStatus::new(0,"r0".into());let view=r.subscribe();let a=r.connect();a.served();a.acknowledge("r0",Outcome::Ready);r.expire_at(Instant::now()+Duration::from_secs(13));assert_eq!((view.borrow().ready,view.borrow().unresponsive),(0,1));a.acknowledge("r0",Outcome::Ready);assert_eq!((view.borrow().ready,view.borrow().unresponsive),(1,0));}
 #[test]fn counts_multiple_sources_and_render_failures_independently(){let r=RuntimeStatus::new(0,"r0".into());let view=r.subscribe();let a=r.connect();let b=r.connect();a.served();b.served();a.acknowledge("r0",Outcome::Ready);b.acknowledge("r0",Outcome::Error);assert_eq!((view.borrow().connected,view.borrow().ready,view.borrow().failed),(2,1,1));drop(b);assert_eq!(view.borrow().failed,0);}
}
