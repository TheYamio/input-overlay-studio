use std::{io, path::PathBuf,collections::{HashMap,HashSet,VecDeque},time::{Duration,Instant,SystemTime,UNIX_EPOCH}};
use tokio::sync::Mutex;
use serde_json::Value;
use std::sync::{Arc,RwLock};
use std::sync::atomic::{AtomicBool, Ordering};
use sha2::{Digest, Sha256};
pub use crate::studio_validation::valid_document;
use crate::studio_validation::MAX_DOCUMENT_BYTES;

#[cfg(test)]
fn revision(document: &Value) -> String { format!("{:x}", Sha256::digest(serde_json::to_vec(document).expect("JSON value"))) }

/// One committed generation: document, revision and hot-path projection move together.
pub struct DocumentSnapshot {
    pub document:Value,pub revision:String,pub sequence:u64,
    json:Arc<str>,original:Arc<str>,cm_per_count:f64,persist_distance:bool,
}
impl DocumentSnapshot {
    fn new(document:Value,sequence:u64,original:Option<String>)->Self {
        let json:Arc<str>=Arc::from(serde_json::to_string(&document).expect("JSON value"));
        let revision=format!("{:x}",Sha256::digest(json.as_bytes()));
        let active=document["activeProfileId"].as_str();
        let game=document["profiles"].as_array().and_then(|profiles|profiles.iter().find(|profile|profile["id"].as_str()==active)).and_then(|profile|profile["gameProfileId"].as_str());
        let dpi=document["gameProfiles"].as_array().and_then(|games|games.iter().find(|profile|profile["id"].as_str()==game)).and_then(|profile|profile["dpi"].as_f64()).filter(|dpi|dpi.is_finite()&&*dpi>0.).unwrap_or(800.);
        let persist_distance=document["distance"]["persist"].as_bool().unwrap_or(false);
        Self{document,revision,sequence,original:original.map(Arc::from).unwrap_or_else(||json.clone()),json,cm_per_count:2.54/dpi,persist_distance}
    }
    pub fn packet(&self,fields:Value)->String {
        let mut packet=fields.to_string();assert!(fields.is_object());packet.pop();
        if packet.len()>1{packet.push(',');}packet.push_str("\"document\":");packet.push_str(&self.json);packet.push('}');packet
    }
}

/// A separate file prevents credentials from appearing in profile exports.
pub struct StudioStore {
    state: RwLock<Arc<DocumentSnapshot>>,
    distance: Mutex<Distance>,
    counters:Mutex<HashMap<String,CounterRecord>>,
    flicks:Mutex<FlickSession>,
    pub recovery_required: AtomicBool,
    path: PathBuf,
    writers: Mutex<()>,
    distance_writer: Mutex<()>,
    counter_writer:Mutex<()>,
    unsupported_original: Option<(u64,String)>,
}

struct Distance {
    cm: f64,
    saved_cm: f64,
}
#[derive(Default)]
struct FlickSession{active:bool,tracks:HashMap<String,FlickTrack>}
#[derive(Default)]
struct FlickTrack{last_sample:Option<Instant>,velocity_samples:VecDeque<f64>,current:Option<FlickBurst>,events:VecDeque<FlickEvent>,best_mps:f64,last_flick_mps:f64,pulse:u64}
#[derive(Clone,Copy)]
struct FlickBurst{last:Instant,distance_cm:f64,peak_mps:f64,qualified:bool,dx:f64,dy:f64}
#[derive(Clone,Copy)]
struct FlickEvent{ended:Instant,distance_cm:f64,peak_mps:f64}
#[derive(Clone,serde::Serialize,serde::Deserialize,Default)]
struct CounterRecord{custom:u64,actions:u64,keys:u64,clicks:u64,recent_actions:VecDeque<u64>,recent_keys:VecDeque<u64>,recent_clicks:VecDeque<u64>}
fn counter_key(profile:&str,module:&str)->String{format!("{profile}\u{1f}{module}")}
fn flick_key(profile:&str,module:&str)->String{counter_key(profile,module)}
fn profile_dpi(document:&Value,profile:&Value)->f64{let game=profile["gameProfileId"].as_str();document["gameProfiles"].as_array().and_then(|games|games.iter().find(|item|item["id"].as_str()==game)).and_then(|item|item["dpi"].as_f64()).filter(|dpi|dpi.is_finite()&&*dpi>0.).unwrap_or(800.)}
fn flick_reversed(current:&FlickBurst,dx:f64,dy:f64)->bool{current.dx.hypot(current.dy)>0.&&dx.hypot(dy)>0.&&(current.dx*dx+current.dy*dy)<0.}
fn finish_flick(track:&mut FlickTrack,now:Instant,minimum_distance_cm:f64){if let Some(current)=track.current.take(){if current.qualified&&current.distance_cm>=minimum_distance_cm{track.events.push_back(FlickEvent{ended:now,distance_cm:current.distance_cm,peak_mps:current.peak_mps});track.best_mps=track.best_mps.max(current.peak_mps);track.last_flick_mps=current.peak_mps;track.pulse=track.pulse.saturating_add(1);}}}
fn counter_specs(document:&Value)->HashSet<String>{
 let mut out=HashSet::new();if let Some(profiles)=document["profiles"].as_array(){for profile in profiles{let pid=profile["id"].as_str().unwrap_or("");for module in profile["modules"].as_array().into_iter().flatten(){if module["type"]=="overlay.counter"&&module["config"]["counterPersist"].as_bool().unwrap_or(false){if let Some(mid)=module["id"].as_str(){out.insert(counter_key(pid,mid));}}}}}out
}
fn now_ms()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64}
fn prune(times:&mut VecDeque<u64>,cutoff:u64){while times.front().is_some_and(|time|*time<cutoff){times.pop_front();}while times.len()>100_000{times.pop_front();}}
impl StudioStore {
    pub fn new(path: PathBuf) -> Self {
        let original=std::fs::read_to_string(&path).ok();
        let parsed=original.as_ref().and_then(|s|serde_json::from_str::<Value>(s).ok());
        let unsupported_original=parsed.as_ref().and_then(|d|d["version"].as_u64()).filter(|v|*v>4).map(|version|(version,original.clone().unwrap()));
        let document=parsed.filter(valid_document).unwrap_or(Value::Null);
        let recovery_required = path.exists() && document.is_null() && unsupported_original.is_none();
        let snapshot=DocumentSnapshot::new(document,0,original);
        let reset=snapshot.document["distance"]["resetOnStart"].as_bool().unwrap_or(true);
        let saved_cm = std::fs::read_to_string(path.with_file_name("distance.json")).ok()
            .and_then(|text| serde_json::from_str::<f64>(&text).ok())
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(0.0);
        let cm = if snapshot.persist_distance && !reset { saved_cm } else { 0.0 };
        let persistent=counter_specs(&snapshot.document);let counters_path=path.with_file_name("counter-state.json");
        let counters=std::fs::read_to_string(counters_path).ok().and_then(|text|serde_json::from_str::<HashMap<String,CounterRecord>>(&text).ok()).unwrap_or_default().into_iter().filter(|(key,_)|persistent.contains(key)).collect();
        Self { state:RwLock::new(Arc::new(snapshot)), distance: Mutex::new(Distance { cm, saved_cm }), counters:Mutex::new(counters),flicks:Mutex::new(FlickSession::default()),recovery_required: AtomicBool::new(recovery_required), path, writers: Mutex::new(()), distance_writer: Mutex::new(()),counter_writer:Mutex::new(()),unsupported_original }
    }
    pub fn current(&self)->Arc<DocumentSnapshot>{self.state.read().unwrap().clone()}

    pub fn unsupported_reply(&self) -> Option<String> {
        self.unsupported_original.as_ref().map(|(version,text)|{
            let mut packet=serde_json::json!({"type":"studio_unsupported","version":version,"original_json":text});
            let full=packet.to_string();if full.len()<=2_000_000 {return full;}
            packet.as_object_mut().unwrap().remove("original_json");packet.to_string()
        })
    }
    pub fn backup(&self) -> Value {
        std::fs::read_to_string(self.path.with_extension("backup.json")).ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok()).filter(valid_document).unwrap_or(Value::Null)
    }
    pub async fn add_distance(&self, counts: f64) -> f64 {
        let coefficient=self.current().cm_per_count;
        let mut distance=self.distance.lock().await;
        distance.cm += counts * coefficient;
        distance.cm
    }
    pub async fn distance_cm(&self) -> f64 { self.distance.lock().await.cm }
    pub async fn reset_distance(&self) { self.distance.lock().await.cm = 0.0; }

    pub async fn set_flick_capture_active(&self,active:bool)->Option<String>{
        {let mut session=self.flicks.lock().await;if session.active!=active{if !active{session.tracks.clear();}session.active=active;}}
        self.flick_values().await
    }
    pub async fn update_flick_input(&self,event:&crate::ws_server::InputEvent,now:Instant)->Option<String>{
        let crate::ws_server::InputEvent::MouseMove{dx,dy,distance_counts}=event else{if matches!(event,crate::ws_server::InputEvent::Reset){let mut session=self.flicks.lock().await;for track in session.tracks.values_mut(){track.current=None;track.last_sample=None;track.velocity_samples.clear();}}return None;};
        let snapshot=self.current();let active=snapshot.document["activeProfileId"].as_str().unwrap_or("");let Some(profile)=snapshot.document["profiles"].as_array().and_then(|profiles|profiles.iter().find(|profile|profile["id"]==active))else{return None;};
        let dpi=profile_dpi(&snapshot.document,profile);let cm_per_count=2.54/dpi;let length=(*distance_counts).unwrap_or_else(||(*dx as f64).hypot(*dy as f64));if !length.is_finite()||length<=0.{return self.flick_values().await;}
        let mut session=self.flicks.lock().await;if !session.active{return None;}
        let now_for_values=now;
        if let Some(modules)=profile["modules"].as_array(){for module in modules.iter().filter(|module|module["type"]=="overlay.flicks"){
            let (Some(mid),Some(config))=(module["id"].as_str(),module["config"].as_object())else{continue;};let threshold=config.get("flickThresholdMps").and_then(Value::as_f64).unwrap_or(1.).clamp(0.001,5.);let pause_ms=config.get("flickPauseMs").and_then(Value::as_u64).unwrap_or(100).clamp(50,300);let pause=Duration::from_millis(pause_ms);let minimum_distance=config.get("flickMinimumDistanceCm").and_then(Value::as_f64).unwrap_or(0.5).clamp(0.,10.);let key=flick_key(active,mid);let track=session.tracks.entry(key).or_default();
            if track.current.is_some_and(|current|now.saturating_duration_since(current.last)>pause){finish_flick(track,now,minimum_distance);track.last_sample=None;track.velocity_samples.clear();}
            let elapsed=track.last_sample.map(|sample|now.saturating_duration_since(sample).as_secs_f64()).unwrap_or(0.);let raw_speed=if elapsed>0.&&elapsed<=pause.as_secs_f64(){length*0.0254/(dpi*elapsed)}else{0.};if raw_speed>0.{track.velocity_samples.push_back(raw_speed);while track.velocity_samples.len()>3{track.velocity_samples.pop_front();}}else{track.velocity_samples.clear();}let speed=if track.velocity_samples.is_empty(){0.}else{track.velocity_samples.iter().sum::<f64>()/track.velocity_samples.len() as f64};let distance_cm=length*cm_per_count;let reversed=track.current.is_some_and(|current|flick_reversed(&current,*dx as f64,*dy as f64));
            if reversed{finish_flick(track,now,minimum_distance);let qualified=speed>=threshold;track.current=Some(FlickBurst{last:now,distance_cm,peak_mps:speed,qualified,dx:*dx as f64,dy:*dy as f64});}
            else if let Some(current)=track.current.as_mut(){current.last=now;current.distance_cm+=distance_cm;current.peak_mps=current.peak_mps.max(speed);current.dx+=*dx as f64;current.dy+=*dy as f64;if !current.qualified&&current.peak_mps>=threshold{current.qualified=true;}}
            else{let qualified=speed>=threshold;track.current=Some(FlickBurst{last:now,distance_cm,peak_mps:speed,qualified,dx:*dx as f64,dy:*dy as f64});}
            track.last_sample=Some(now);
        }}
        drop(session);self.flick_values_at(now_for_values).await
    }
    pub async fn flick_values(&self)->Option<String>{self.flick_values_at(Instant::now()).await}
    async fn flick_values_at(&self,now:Instant)->Option<String>{
        let snapshot=self.current();let profile_id=snapshot.document["activeProfileId"].as_str().unwrap_or("");let mut values=serde_json::Map::new();let mut session=self.flicks.lock().await;let running=session.active;
        if let Some(profile)=snapshot.document["profiles"].as_array().and_then(|profiles|profiles.iter().find(|profile|profile["id"]==profile_id)){if let Some(modules)=profile["modules"].as_array(){for module in modules.iter().filter(|module|module["type"]=="overlay.flicks"){
            let (Some(id),Some(config))=(module["id"].as_str(),module["config"].as_object())else{continue;};let key=flick_key(profile_id,id);let track=session.tracks.entry(key).or_default();let pause_ms=config.get("flickPauseMs").and_then(Value::as_u64).unwrap_or(100).clamp(50,300);let minimum_distance=config.get("flickMinimumDistanceCm").and_then(Value::as_f64).unwrap_or(0.5).clamp(0.,10.);if track.current.is_some_and(|current|now.saturating_duration_since(current.last)>Duration::from_millis(pause_ms)){finish_flick(track,now,minimum_distance);}
            let window=config.get("flickWindowSeconds").and_then(Value::as_u64).unwrap_or(10).clamp(1,600);let cutoff=now.checked_sub(Duration::from_secs(window)).unwrap_or(now);let retention=now.checked_sub(Duration::from_secs(600)).unwrap_or(now);while track.events.front().is_some_and(|flick|flick.ended<retention){track.events.pop_front();}
            let mut count=0usize;let mut peak=0f64;let mut path=0f64;let mut history:Vec<f64>=Vec::new();for flick in track.events.iter().filter(|flick|flick.ended>=cutoff){count+=1;peak=peak.max(flick.peak_mps);path+=flick.distance_cm;history.push(flick.peak_mps);}if let Some(current)=track.current.filter(|current|current.qualified&&current.distance_cm>=minimum_distance&&now.saturating_duration_since(current.last)<=Duration::from_millis(pause_ms)){count+=1;peak=peak.max(current.peak_mps);path+=current.distance_cm;history.push(current.peak_mps);}
            let history_mps:Vec<f64>=history.into_iter().rev().take(16).collect::<Vec<_>>().into_iter().rev().collect();
            values.insert(id.into(),serde_json::json!({"session_best_mps":track.best_mps,"flick_count":count,"peak_mps":peak,"path_cm":path,"last_flick_mps":track.last_flick_mps,"pulse":track.pulse,"history_mps":history_mps}));
        }}}
        if values.is_empty(){return None;}
        Some(serde_json::json!({"type":"flick_values","profile_id":profile_id,"capture_running":running,"values":values}).to_string())
    }

    pub async fn update_counter_inputs(&self,event:&crate::ws_server::InputEvent,key_was_down:bool,button_was_down:bool)->Option<String>{
        let snapshot=self.current();let profile=snapshot.document["activeProfileId"].as_str().unwrap_or("");let now=now_ms();let cutoff=now.saturating_sub(600_000);let mut counters=self.counters.lock().await;
        if let Some(modules)=snapshot.document["profiles"].as_array().and_then(|profiles|profiles.iter().find(|item|item["id"]==profile)).and_then(|profile|profile["modules"].as_array()){
            for module in modules.iter().filter(|module|module["type"]=="overlay.counter"){
                let Some(mid)=module["id"].as_str() else{continue};let config=&module["config"];let key=counter_key(profile,mid);let record=counters.entry(key).or_default();
                let pressed_key=match event{crate::ws_server::InputEvent::KeyPress{rawcode}if !key_was_down=>Some(*rawcode),crate::ws_server::InputEvent::AnalogDepth{rawcode,depth}if !key_was_down&&*depth>0.0=>Some(*rawcode),_=>None};
                if let Some(rawcode)=pressed_key{
                    if config["counterMetric"]=="Custom"{if rawcode as u64==config["counterIncrementKey"].as_u64().unwrap_or(0){record.custom=record.custom.saturating_add(1);}else if rawcode as u64==config["counterDecrementKey"].as_u64().unwrap_or(0){record.custom=record.custom.saturating_sub(1);}}
                    else{record.actions=record.actions.saturating_add(1);record.keys=record.keys.saturating_add(1);record.recent_actions.push_back(now);record.recent_keys.push_back(now);}
                }
                match event{
                    crate::ws_server::InputEvent::MouseButton{button,pressed:true} if !button_was_down=>{record.actions=record.actions.saturating_add(1);record.clicks=record.clicks.saturating_add(1);record.recent_actions.push_back(now);record.recent_clicks.push_back(now);}
                    crate::ws_server::InputEvent::MouseScroll{rotation} if *rotation!=0=>{record.actions=record.actions.saturating_add(1);record.recent_actions.push_back(now);}
                    _=>{}
                }
                prune(&mut record.recent_actions,cutoff);prune(&mut record.recent_keys,cutoff);prune(&mut record.recent_clicks,cutoff);
            }
        }
        drop(counters);self.counter_values_locked(&snapshot.document,now).await
    }
    pub async fn counter_values(&self)->Option<String>{let snapshot=self.current();self.counter_values_locked(&snapshot.document,now_ms()).await}
    async fn counter_values_locked(&self,document:&Value,now:u64)->Option<String>{
        let profile=document["activeProfileId"].as_str().unwrap_or("");let cutoff=now.saturating_sub(600_000);let mut values=serde_json::Map::new();let counters=self.counters.lock().await;
        if let Some(modules)=document["profiles"].as_array().and_then(|profiles|profiles.iter().find(|item|item["id"]==profile)).and_then(|item|item["modules"].as_array()){
            for module in modules.iter().filter(|module|module["type"]=="overlay.counter"){
                let (Some(id),Some(config))=(module["id"].as_str(),module["config"].as_object())else{continue};let key=counter_key(profile,id);let record=counters.get(&key);let metric=config.get("counterMetric").and_then(Value::as_str).unwrap_or("APM");let value=if metric=="Custom"{record.map(|r|r.custom).unwrap_or(0) as f64}else{
                    let session=config.get("counterWindow").and_then(Value::as_str)==Some("Session");let (total,recent,scale)=match metric{"KPM"=>(record.map(|r|r.keys).unwrap_or(0),record.map(|r|&r.recent_keys),60.0),"CPS"=>(record.map(|r|r.clicks).unwrap_or(0),record.map(|r|&r.recent_clicks),1.0),_=>(record.map(|r|r.actions).unwrap_or(0),record.map(|r|&r.recent_actions),60.0)};
                    if session{total as f64}else{let seconds=if config.get("counterWindow").and_then(Value::as_str)==Some("Custom"){config.get("counterCustomSeconds").and_then(Value::as_u64).unwrap_or(60)}else{config.get("counterWindow").and_then(Value::as_str).and_then(|value|value.parse::<u64>().ok()).unwrap_or(60)}.clamp(1,600);let count=recent.map(|times|times.iter().filter(|time|**time>=now.saturating_sub(seconds*1000)&&**time>=cutoff).count()).unwrap_or(0);count as f64*scale/seconds as f64}
                };values.insert(id.into(),serde_json::json!(value));
            }
        }
        if values.is_empty(){None}else{Some(serde_json::json!({"type":"counter_values","profile_id":profile,"values":values}).to_string())}
    }
    pub async fn reset_counter(&self,profile_id:&str,module_id:&str)->Result<String,&'static str>{
        let snapshot=self.current();let Some(module)=snapshot.document["profiles"].as_array().and_then(|profiles|profiles.iter().find(|profile|profile["id"]==profile_id)).and_then(|profile|profile["modules"].as_array()).and_then(|modules|modules.iter().find(|module|module["id"]==module_id&&module["type"]=="overlay.counter"))else{return Err("unknown-counter");};
        let _=module;self.counters.lock().await.insert(counter_key(profile_id,module_id),CounterRecord::default());self.persist_counters().await.map_err(|_|"counter-storage-error")?;self.counter_values_locked(&snapshot.document,now_ms()).await.ok_or("unknown-counter")
    }
    pub async fn persist_counters(&self)->io::Result<bool>{
        let _writer=self.counter_writer.lock().await;let persistent=counter_specs(&self.current().document);let counters=self.counters.lock().await;let values:HashMap<_,_>=counters.iter().filter(|(key,_)|persistent.contains(*key)).map(|(key,value)|(key.clone(),value.clone())).collect();let path=self.path.with_file_name("counter-state.json");let text=serde_json::to_string(&values)?;
        tokio::task::spawn_blocking(move||{let temporary=path.with_extension("tmp");std::fs::write(&temporary,text)?;std::fs::rename(temporary,path)}).await.map_err(io::Error::other)??;Ok(true)
    }

    pub async fn persist_distance(&self) -> io::Result<bool> {
        let _writer = self.distance_writer.lock().await;
        if !self.current().persist_distance { return Ok(false); }
        let total = {
            let distance = self.distance.lock().await;
            if distance.cm == distance.saved_cm { return Ok(false); }
            distance.cm
        };
        let path = self.path.with_file_name("distance.json");
        tokio::task::spawn_blocking(move || {
            let temporary = path.with_extension("tmp");
            std::fs::write(&temporary, total.to_string())?;
            std::fs::rename(temporary, path)
        }).await.map_err(io::Error::other)??;
        // Movement can arrive while disk I/O is in flight. Record just the
        // value that reached disk, leaving any newer value due for another save.
        self.distance.lock().await.saved_cm = total;
        Ok(true)
    }
    #[cfg(test)]
    pub async fn snapshot(&self) -> (Value, String, u64) {
        let current=self.current();
        // The diagnostic clone benchmark is outside the short pointer lock.
        (current.document.clone(),current.revision.clone(),current.sequence)
    }
    #[cfg(test)]
    pub async fn set(&self, document: Value, base_revision: &str) -> Result<(String, u64), String> {
        let snapshot=self.set_snapshot(document,base_revision).await?;
        Ok((snapshot.revision.clone(),snapshot.sequence))
    }
    pub async fn set_snapshot(&self, document: Value, base_revision: &str) -> Result<Arc<DocumentSnapshot>, String> {
        if self.unsupported_original.is_some() {return Err("unsupported configuration version; original preserved".into());}
        let prepared=tokio::task::spawn_blocking(move||{
            let document=crate::module_validation::migrate(document)?;
            let snapshot=DocumentSnapshot::new(document,0,None);
            if snapshot.json.len()>MAX_DOCUMENT_BYTES{return Err("configuration too large");}
            Ok(snapshot)
        }).await.map_err(|_|"configuration task failed")?.map_err(str::to_string)?;
        let _writer = self.writers.lock().await;
        let current=self.current();
        if current.revision!=base_revision{return Err("conflict".into());}
        if current.document["version"].as_u64().unwrap_or(0)>prepared.document["version"].as_u64().unwrap_or(0){return Err("unsupported configuration downgrade".into());}
        let sequence=current.sequence+1;
        let next=Arc::new(DocumentSnapshot{sequence,..prepared});
        let json=next.json.clone();let expected=current.original.clone();let known=!current.document.is_null();
        let path = self.path.clone();
        let incoming_version=next.document["version"].as_u64().unwrap();
        // Serialize saves separately: capture reads the document without waiting on disk.
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let temp = path.with_extension("tmp");
            if path.exists() {
                // Preserve an invalid original rather than silently overwriting it.
                let old = std::fs::read(&path)?;
                let recognized=known&&old==expected.as_bytes();
                let external=if recognized{None}else{serde_json::from_slice::<Value>(&old).ok()};
                if external.as_ref().and_then(|d|d["version"].as_u64()).is_some_and(|v|v>incoming_version) {
                    return Err(std::io::Error::other("newer configuration version; original preserved"));
                }
                if recognized||external.as_ref().is_some_and(valid_document) {
                    verified_copy(&path.with_extension("backup.json"), &old)?;
                } else {
                    verified_copy(&path.with_extension("invalid.json"), &old)?;
                }
            }
            verified_copy(&temp, json.as_bytes())?;
            std::fs::rename(temp, path)
        }).await.map_err(|_| "storage task failed")?.map_err(|_| "storage write failed")?;
        let previous={let mut state=self.state.write().unwrap();std::mem::replace(&mut *state,next.clone())};
        // Potentially expensive destruction must also stay outside the pointer lock.
        drop(previous);
        self.recovery_required.store(false, Ordering::Relaxed);
        Ok(next)
    }
}
fn verified_copy(path:&std::path::Path,bytes:&[u8])->std::io::Result<()> {
    std::fs::write(path,bytes)?;
    if std::fs::read(path)?!=bytes {return Err(std::io::Error::other("configuration copy verification failed"));}
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn every_builtin_migration_keeps_an_exact_backup_and_survives_restart(){
        let cases:Value=serde_json::from_str(include_str!("../test-fixtures/module-migrations.json")).unwrap();
        for case in cases.as_array().unwrap(){
            let folder=std::env::temp_dir().join(format!("module-migration-{}",rand::random::<u64>()));std::fs::create_dir(&folder).unwrap();let path=folder.join("studio.json");let original=format!(" {}\n",case["legacy"]);std::fs::write(&path,&original).unwrap();
            let store=StudioStore::new(path.clone());assert_eq!(store.current().document,case["legacy"]);assert_eq!(std::fs::read_to_string(&path).unwrap(),original);
            let current=store.set_snapshot(case["legacy"].clone(),&store.current().revision).await.unwrap();assert_eq!(current.document,case["current"]);assert_eq!(std::fs::read_to_string(path.with_extension("backup.json")).unwrap(),original);
            let restart=StudioStore::new(path.clone());assert_eq!(restart.current().document,current.document);assert_eq!(restart.current().revision,current.revision);assert_eq!(restart.backup(),case["legacy"]);
            std::fs::remove_file(path.with_extension("backup.json")).unwrap();std::fs::remove_file(path).unwrap();std::fs::remove_dir(folder).unwrap();
        }
    }
    #[tokio::test]
    async fn a_failed_migration_backup_preserves_the_original_and_live_generation(){
        let cases:Value=serde_json::from_str(include_str!("../test-fixtures/module-migrations.json")).unwrap();
        for case in cases.as_array().unwrap(){
            let folder=std::env::temp_dir().join(format!("module-backup-{}",rand::random::<u64>()));std::fs::create_dir(&folder).unwrap();let path=folder.join("studio.json");let original=case["legacy"].to_string();std::fs::write(&path,&original).unwrap();std::fs::create_dir(path.with_extension("backup.json")).unwrap();
            let store=StudioStore::new(path.clone());let before=store.current();assert!(store.set_snapshot(case["legacy"].clone(),&before.revision).await.is_err());assert!(Arc::ptr_eq(&before,&store.current()));assert_eq!(std::fs::read_to_string(&path).unwrap(),original);
            std::fs::remove_dir(path.with_extension("backup.json")).unwrap();std::fs::remove_file(path).unwrap();std::fs::remove_dir(folder).unwrap();
        }
    }
    #[tokio::test]
    async fn immutable_generations_keep_revision_projection_and_packets_together() {
        let path=std::env::temp_dir().join(format!("studio-snapshot-{}.json",rand::random::<u64>()));let store=StudioStore::new(path.clone());save(&store,config()).await;
        let before=store.current();assert!(Arc::ptr_eq(&before,&store.current()));assert_eq!(before.revision,revision(&before.document));assert_eq!(store.add_distance(800.).await,2.54);
        let mut document=before.document.clone();document["gameProfiles"][0]["dpi"]=serde_json::json!(1600);
        let after=store.set_snapshot(document,&before.revision).await.unwrap();assert_eq!(after.sequence,before.sequence+1);assert_eq!(after.revision,revision(&after.document));assert!(Arc::ptr_eq(&after,&store.current()));
        assert_eq!(before.document["gameProfiles"][0]["dpi"],800);assert_eq!(store.add_distance(1600.).await,5.08);
        let packet:Value=serde_json::from_str(&after.packet(serde_json::json!({"type":"studio_config","revision":after.revision,"config_sequence":after.sequence}))).unwrap();assert_eq!(packet["document"],after.document);assert_eq!(packet["revision"],revision(&packet["document"]));
        for file in [path.clone(),path.with_extension("backup.json")]{std::fs::remove_file(file).unwrap();}
    }
    #[tokio::test]
    async fn cached_disk_bytes_never_hide_an_external_newer_configuration() {
        let path=std::env::temp_dir().join(format!("studio-external-{}.json",rand::random::<u64>()));let store=StudioStore::new(path.clone());save(&store,config()).await;let before=store.current();
        let future=" {\"version\":99,\"preserve\":true}\n";std::fs::write(&path,future).unwrap();let mut next=before.document.clone();next["gameProfiles"][0]["dpi"]=serde_json::json!(1600);
        assert!(store.set_snapshot(next,&before.revision).await.is_err());assert!(Arc::ptr_eq(&before,&store.current()));assert_eq!(store.add_distance(800.).await,2.54);assert_eq!(std::fs::read_to_string(&path).unwrap(),future);std::fs::remove_file(path).unwrap();
    }
    #[tokio::test(flavor="multi_thread",worker_threads=2)]
    #[ignore = "explicit private large-document benchmark"]
    async fn benchmark_hot_path() {
        use std::{sync::Arc,time::{Duration,Instant}};
        let folder=PathBuf::from(std::env::var("STUDIO_HOT_PATH_ARCHIVE").expect("private archive required"));
        let label=std::env::var("STUDIO_HOT_PATH_LABEL").unwrap_or("before".into());assert!(label=="before"||label=="after");
        let store=Arc::new(StudioStore::new(folder.join("large-document.json")));
        let barrier=Arc::new(tokio::sync::Barrier::new(2));let other=store.clone();let ready=barrier.clone();
        let snapshots=tokio::spawn(async move{ready.wait().await;let start=Instant::now();for _ in 0..80{let snapshot=other.snapshot().await;assert!(!snapshot.0.is_null());tokio::task::yield_now().await;}start.elapsed().as_secs_f64()*1000.});
        barrier.wait().await;let mut latencies=Vec::new();let mut timer=tokio::time::interval(Duration::from_millis(1));timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        for _ in 0..500{timer.tick().await;let start=Instant::now();store.add_distance(1.).await;latencies.push(start.elapsed().as_secs_f64()*1000.);}
        let snapshot_ms=snapshots.await.unwrap();latencies.sort_by(f64::total_cmp);
        let report=serde_json::json!({"label":label,"build":"debug","bytes":std::fs::metadata(folder.join("large-document.json")).unwrap().len(),"snapshots":80,"snapshotTotalMs":snapshot_ms,"movementSamples":latencies.len(),"movementP95Ms":latencies[475],"movementMaxMs":latencies.last()});
        std::fs::write(folder.join(format!("native-{label}.json")),serde_json::to_vec_pretty(&report).unwrap()).unwrap();println!("{report}");
    }
    fn module_document()->Value{let cases:Value=serde_json::from_str(include_str!("../test-fixtures/modules-current.json")).unwrap();crate::module_validation::migrate(cases.as_array().unwrap().iter().find(|case|case["name"]=="inactive resource retention").unwrap()["document"].clone()).unwrap()}
    #[tokio::test]
    async fn preserves_opaque_data_across_restart_and_edits(){
        let path=std::env::temp_dir().join(format!("studio-opaque-{}.json",rand::random::<u64>()));let store=StudioStore::new(path.clone());let document=module_document();save(&store,document.clone()).await;
        let restarted=StudioStore::new(path.clone());assert_eq!(restarted.snapshot().await.0,document);
        let mut next=document.clone();next["profiles"][0]["name"]=serde_json::json!("Changed sibling");save(&restarted,next.clone()).await;assert_eq!(next["profiles"][0]["modules"][1],document["profiles"][0]["modules"][1]);assert_eq!(StudioStore::new(path.clone()).snapshot().await.0,next);
        for file in [path.clone(),path.with_extension("backup.json")]{std::fs::remove_file(file).unwrap();}
    }
    fn config()->Value{crate::module_validation::migrate(serde_json::from_str(include_str!("../schema/default-current.json")).unwrap()).unwrap()}
    #[tokio::test]
    async fn distance_writes_only_on_change_and_retries_failed_writes() {
        let folder = std::env::temp_dir().join(format!("ios-distance-{}", rand::random::<u64>()));
        std::fs::create_dir(&folder).unwrap();
        let mut document = config();
        document["distance"] = serde_json::json!({"persist":true,"resetOnStart":false});
        let config_path = folder.join("studio.json");
        let distance_path = folder.join("distance.json");
        std::fs::write(&config_path, document.to_string()).unwrap();
        std::fs::write(&distance_path, "42.000").unwrap();
        let store = StudioStore::new(config_path);
        assert!(!store.persist_distance().await.unwrap());
        assert_eq!(std::fs::read_to_string(&distance_path).unwrap(), "42.000");

        let blocker = distance_path.with_extension("tmp");
        std::fs::create_dir(&blocker).unwrap();
        store.add_distance(800.0).await;
        assert!(store.persist_distance().await.is_err());
        assert_eq!(std::fs::read_to_string(&distance_path).unwrap(), "42.000");
        std::fs::remove_dir(blocker).unwrap();
        assert!(store.persist_distance().await.unwrap());
        assert!(!store.persist_distance().await.unwrap());
        store.reset_distance().await;
        assert!(store.persist_distance().await.unwrap());
        assert_eq!(std::fs::read_to_string(&distance_path).unwrap(), "0");
        assert!(!store.persist_distance().await.unwrap());
        std::fs::remove_file(distance_path).unwrap();
        std::fs::remove_file(folder.join("studio.json")).unwrap();
        std::fs::remove_dir(folder).unwrap();
    }
    async fn save(store: &StudioStore, d: Value) { let (_, token, _) = store.snapshot().await; store.set(d, &token).await.unwrap(); }
    #[test]
    fn invalid_configurations_are_rejected() {
        assert!(!valid_document(&Value::Null)); let mut d = config(); assert!(valid_document(&d));
        d["gameProfiles"][0]["dpi"] = serde_json::json!(0); assert!(!valid_document(&d));
        let mut d = config(); d["activeProfileId"] = serde_json::json!("absent"); assert!(!valid_document(&d));
    }
    #[test]
    fn version_two_requires_bounded_embedded_raster_assets() {
        let mut d = config(); d["version"] = serde_json::json!(4);
        assert!(valid_document(&d)); d["assets"] = serde_json::json!({}); assert!(valid_document(&d));
        d["assets"]["picture"] = serde_json::from_str(include_str!("../schema/test-artwork.json")).unwrap();
        assert!(valid_document(&d)); d["assets"]["picture"]["data"] = serde_json::json!("https://example.test/remote.png"); assert!(!valid_document(&d));
        d["version"] = serde_json::json!(99); assert!(!valid_document(&d));
    }
    #[tokio::test]
    async fn stores_profiles_and_preserves_existing_physical_distance_on_dpi_change() {
        let path = std::env::temp_dir().join(format!("studio-test-{}.json", rand::random::<u64>()));
        let store = StudioStore::new(path.clone());
        save(&store, config()).await;
        assert_eq!(store.add_distance(800.0).await, 2.54);
        let mut next = config(); next["gameProfiles"][0]["dpi"] = serde_json::json!(1600);
        save(&store, next).await; assert_eq!(store.add_distance(1600.0).await, 5.08);
        assert!(path.with_extension("backup.json").exists());
        let restored = StudioStore::new(path.clone()); assert_eq!(restored.current().document["gameProfiles"][0]["dpi"], 1600);
        std::fs::remove_file(&path).unwrap(); std::fs::remove_file(path.with_extension("backup.json")).unwrap();
    }

    #[tokio::test]
    async fn stale_writers_cannot_overwrite_and_revision_survives_restart() {
        let path = std::env::temp_dir().join(format!("studio-cas-{}.json", rand::random::<u64>()));
        let store = StudioStore::new(path.clone());
        let (_, base, _) = store.snapshot().await;
        let mut first = config(); first["profiles"][0]["name"] = serde_json::json!("first");
        let (saved, seq) = store.set(first.clone(), &base).await.unwrap();
        let mut stale = first.clone(); stale["profiles"][0]["name"] = serde_json::json!("stale");
        assert_eq!(store.set(stale, &base).await.unwrap_err(), "conflict");
        assert_eq!(store.snapshot().await, (first.clone(), saved.clone(), seq));
        let restarted = StudioStore::new(path.clone()); assert_eq!(restarted.snapshot().await, (first, saved, 0));
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn capture_does_not_wait_on_the_disk_writer_lock() {
        let path = std::env::temp_dir().join(format!("studio-lock-{}.json", rand::random::<u64>()));
        let store = StudioStore::new(path.clone()); save(&store, config()).await;
        let _disk = store.writers.lock().await;
        let cm = tokio::time::timeout(std::time::Duration::from_millis(100), store.add_distance(800.0)).await.unwrap();
        assert_eq!(cm, 2.54); std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn failed_disk_save_does_not_commit_memory_or_revision() {
        let folder = std::env::temp_dir().join(format!("studio-missing-{}", rand::random::<u64>()));
        let store = StudioStore::new(folder.join("studio.json")); let before = store.snapshot().await;
        assert!(store.set(config(), &before.1).await.is_err()); assert_eq!(store.snapshot().await, before);
    }
    #[tokio::test]
    async fn newer_original_is_read_only_for_new_and_legacy_writers() {
        let path=std::env::temp_dir().join(format!("studio-future-{}.json",rand::random::<u64>()));
        let raw=" { \"version\": 99, \"new-module\": { \"keep\": [1,2,3] } }\n";std::fs::write(&path,raw).unwrap();let store=StudioStore::new(path.clone());
        assert!(!store.recovery_required.load(Ordering::Relaxed));
        let reply:Value=serde_json::from_str(&store.unsupported_reply().unwrap()).unwrap();assert_eq!(reply["original_json"],raw);
        let (_,base,_)=store.snapshot().await;assert!(store.set(config(),&base).await.unwrap_err().contains("unsupported"));assert_eq!(std::fs::read_to_string(&path).unwrap(),raw);
        assert!(!path.with_extension("invalid.json").exists());assert!(!path.with_extension("backup.json").exists());
        assert!(tokio::time::timeout(std::time::Duration::from_millis(100),store.add_distance(800.)).await.is_ok());std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn externally_replaced_future_file_is_not_overwritten() {
        let path=std::env::temp_dir().join(format!("studio-external-{}.json",rand::random::<u64>()));let store=StudioStore::new(path.clone());save(&store,config()).await;let before=store.snapshot().await;
        let raw="{\"version\":5,\"external\":true}";std::fs::write(&path,raw).unwrap();assert!(store.set(config(),&before.1).await.is_err());assert_eq!(store.snapshot().await,before);assert_eq!(std::fs::read_to_string(&path).unwrap(),raw);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn very_large_future_sources_do_not_exceed_the_transport_limit() {
        let path=std::env::temp_dir().join(format!("studio-large-future-{}.json",rand::random::<u64>()));let raw=serde_json::json!({"version":5,"payload":"a".repeat(2_000_000)}).to_string();std::fs::write(&path,&raw).unwrap();
        let store=StudioStore::new(path.clone());let reply=store.unsupported_reply().unwrap();assert!(reply.len()<2_000_000);let packet:Value=serde_json::from_str(&reply).unwrap();assert_eq!(packet["version"],5);assert!(packet.get("original_json").is_none());assert_eq!(std::fs::read_to_string(&path).unwrap(),raw);std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn backup_io_failure_keeps_the_original_and_allows_a_retry() {
        let path=std::env::temp_dir().join(format!("studio-backup-io-{}.json",rand::random::<u64>()));let raw=serde_json::to_string(&config()).unwrap();std::fs::write(&path,&raw).unwrap();std::fs::create_dir(path.with_extension("backup.json")).unwrap();
        let store=StudioStore::new(path.clone());let before=store.snapshot().await;let mut upgraded=config();upgraded["profiles"][0]["name"]=serde_json::json!("Updated");upgraded["assets"]=serde_json::json!({});assert!(store.set(upgraded.clone(),&before.1).await.is_err());assert_eq!(store.snapshot().await,before);assert_eq!(std::fs::read_to_string(&path).unwrap(),raw);
        std::fs::remove_dir(path.with_extension("backup.json")).unwrap();store.set(upgraded,&before.1).await.unwrap();let restored=StudioStore::new(path.clone());assert_eq!(restored.snapshot().await.0["version"],4);
        for file in [path.clone(),path.with_extension("backup.json")] {std::fs::remove_file(file).unwrap();}
    }
    #[tokio::test]
    async fn linked_game_controls_live_distance_without_reinterpreting_totals(){
        let path=std::env::temp_dir().join(format!("studio-game-distance-{}.json",rand::random::<u64>()));let store=StudioStore::new(path.clone());let mut document=config();save(&store,document.clone()).await;
        assert!((store.add_distance(800.0).await-2.54).abs()<1e-10);
        let mut game=document["gameProfiles"][0].clone();game["id"]=serde_json::json!("secondary-game");game["dpi"]=serde_json::json!(1600);document["gameProfiles"].as_array_mut().unwrap().push(game);
        let mut overlay=document["profiles"][0].clone();overlay["id"]=serde_json::json!("secondary-overlay");overlay["gameProfileId"]=serde_json::json!("secondary-game");document["profiles"].as_array_mut().unwrap().push(overlay);save(&store,document.clone()).await;
        assert!((store.add_distance(800.0).await-5.08).abs()<1e-10);
        document["activeProfileId"]=serde_json::json!("secondary-overlay");save(&store,document.clone()).await;assert!((store.add_distance(1600.0).await-7.62).abs()<1e-10);
        document["gameProfiles"][0]["dpi"]=serde_json::json!(400);save(&store,document).await;assert!((store.add_distance(1600.0).await-10.16).abs()<1e-10);
        for file in [path.clone(),path.with_extension("backup.json")]{std::fs::remove_file(file).unwrap();}
    }

    #[tokio::test]
    async fn flick_capture_counts_fast_reverse_as_two_and_closes_after_configured_pause(){
        let path=std::env::temp_dir().join(format!("studio-flick-flow-{}.json",rand::random::<u64>()));let store=StudioStore::new(path.clone());let mut document=config();let definitions:Value=serde_json::from_str(include_str!("../schema/module-configurations.json")).unwrap();let definition=&definitions["overlay.flicks"];let mut flat=definition["projection"].clone();flat["flickThresholdMps"]=serde_json::json!(0.1);flat["flickMinimumDistanceCm"]=serde_json::json!(0.0);flat["flickPauseMs"]=serde_json::json!(100);let mut module_config=serde_json::Map::new();for key in definition["schema"]["properties"].as_object().unwrap().keys(){if let Some(value)=flat.get(key){module_config.insert(key.clone(),value.clone());}}let common=document["profiles"][0]["modules"][0]["common"].clone();let module=serde_json::json!({"id":"flick-test","type":"overlay.flicks","schemaVersion":1,"enabled":true,"config":module_config,"common":common,"resources":{"assets":[],"shapes":[]}});document["profiles"][0]["modules"].as_array_mut().unwrap().push(module);assert!(valid_document(&document),"{}",document);save(&store,document).await;store.set_flick_capture_active(true).await;
        let start=Instant::now();let movement=|dx,counts|crate::ws_server::InputEvent::MouseMove{dx,dy:0,distance_counts:Some(counts)};
        store.update_flick_input(&movement(1000,1000.),start).await;
        store.update_flick_input(&movement(100,100.),start+Duration::from_millis(10)).await;
        let reversed=store.update_flick_input(&movement(-100,100.),start+Duration::from_millis(20)).await.unwrap();let packet:Value=serde_json::from_str(&reversed).unwrap();assert_eq!(packet["values"]["flick-test"]["flick_count"],2);
        let ended=store.flick_values_at(start+Duration::from_millis(150)).await.unwrap();let packet:Value=serde_json::from_str(&ended).unwrap();assert_eq!(packet["values"]["flick-test"]["flick_count"],2);assert!(packet["values"]["flick-test"]["session_best_mps"].as_f64().unwrap()>0.1);
        store.set_flick_capture_active(false).await;for file in [path.clone(),path.with_extension("backup.json")]{if file.exists(){std::fs::remove_file(file).unwrap();}}
    }

    #[test]
    fn flick_filter_requires_speed_and_minimum_physical_path(){
        let now=Instant::now();let mut track=FlickTrack::default();
        track.current=Some(FlickBurst{last:now,distance_cm:0.4,peak_mps:2.0,qualified:true,dx:10.,dy:0.});finish_flick(&mut track,now,0.5);assert!(track.events.is_empty());assert_eq!(track.pulse,0);
        track.current=Some(FlickBurst{last:now,distance_cm:0.6,peak_mps:2.0,qualified:true,dx:10.,dy:0.});finish_flick(&mut track,now,0.5);assert_eq!(track.events.len(),1);assert_eq!(track.pulse,1);
        track.current=Some(FlickBurst{last:now,distance_cm:1.0,peak_mps:0.4,qualified:false,dx:10.,dy:0.});finish_flick(&mut track,now,0.5);assert_eq!(track.events.len(),1);
    }
    #[test]
    fn flick_reversal_detects_opposite_bursts_without_splitting_same_direction(){
        let burst=FlickBurst{last:Instant::now(),distance_cm:1.,peak_mps:2.,qualified:true,dx:10.,dy:2.};
        assert!(flick_reversed(&burst,-8.,-2.));assert!(!flick_reversed(&burst,8.,1.));assert!(!flick_reversed(&burst,0.,0.));
    }

}
