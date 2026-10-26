use std::path::PathBuf;
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
    pub distance_cm: Mutex<f64>,
    pub recovery_required: AtomicBool,
    path: PathBuf,
    writers: Mutex<()>,
    distance_writer: Mutex<()>,
    unsupported_original: Option<(u64,String)>,
}
impl StudioStore {
    pub fn new(path: PathBuf) -> Self {
        let original=std::fs::read_to_string(&path).ok();
        let parsed=original.as_ref().and_then(|s|serde_json::from_str::<Value>(s).ok());
        let unsupported_original=parsed.as_ref().and_then(|d|d["version"].as_u64()).filter(|v|*v>4).map(|version|(version,original.clone().unwrap()));
        let document=parsed.filter(valid_document).unwrap_or(Value::Null);
        let recovery_required = path.exists() && document.is_null() && unsupported_original.is_none();
        let snapshot=DocumentSnapshot::new(document,0,original);
        let reset=snapshot.document["distance"]["resetOnStart"].as_bool().unwrap_or(true);
        let distance = if snapshot.persist_distance && !reset {
            std::fs::read_to_string(path.with_file_name("distance.json")).ok()
                .and_then(|s| serde_json::from_str::<f64>(&s).ok())
                .filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0)
        } else { 0.0 };
        Self { state:RwLock::new(Arc::new(snapshot)), distance_cm: Mutex::new(distance), recovery_required: AtomicBool::new(recovery_required), path, writers: Mutex::new(()), distance_writer: Mutex::new(()),unsupported_original }
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
        let mut total=self.distance_cm.lock().await;
        *total += counts * coefficient;
        *total
    }
    pub async fn persist_distance(&self) {
        let _writer = self.distance_writer.lock().await;
        if !self.current().persist_distance { return; }
        let total = *self.distance_cm.lock().await;
        let path = self.path.with_file_name("distance.json");
        let result = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let temporary = path.with_extension("tmp");
            std::fs::write(&temporary, total.to_string())?;
            std::fs::rename(temporary, path)
        }).await;
        if !matches!(result, Ok(Ok(()))) { tracing::warn!("studio: distance could not be saved"); }
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

}
