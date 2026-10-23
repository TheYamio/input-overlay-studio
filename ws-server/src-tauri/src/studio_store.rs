use std::path::PathBuf;
use tokio::sync::Mutex;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use sha2::{Digest, Sha256};
pub use crate::studio_validation::valid_document;
use crate::studio_validation::MAX_DOCUMENT_BYTES;

pub fn revision(document: &Value) -> String { format!("{:x}", Sha256::digest(serde_json::to_vec(document).expect("JSON value"))) }

/// A separate file prevents credentials from appearing in profile exports.
pub struct StudioStore {
    pub document: Mutex<Value>,
    pub distance_cm: Mutex<f64>,
    pub recovery_required: AtomicBool,
    path: PathBuf,
    writers: Mutex<()>,
    config_sequence: AtomicU64,
    distance_writer: Mutex<()>,
    unsupported_original: Option<(u64,String)>,
}
impl StudioStore {
    pub fn new(path: PathBuf) -> Self {
        let original=std::fs::read_to_string(&path).ok();
        let parsed=original.as_ref().and_then(|s|serde_json::from_str::<Value>(s).ok());
        let unsupported_original=parsed.as_ref().and_then(|d|d["version"].as_u64()).filter(|v|*v>4).map(|version|(version,original.unwrap()));
        let document=parsed.filter(valid_document).unwrap_or(Value::Null);
        let recovery_required = path.exists() && document.is_null() && unsupported_original.is_none();
        let persist = document["distance"]["persist"].as_bool().unwrap_or(false);
        let reset = document["distance"]["resetOnStart"].as_bool().unwrap_or(true);
        let distance = if persist && !reset {
            std::fs::read_to_string(path.with_file_name("distance.json")).ok()
                .and_then(|s| serde_json::from_str::<f64>(&s).ok())
                .filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0)
        } else { 0.0 };
        Self { document: Mutex::new(document), distance_cm: Mutex::new(distance), recovery_required: AtomicBool::new(recovery_required), path, writers: Mutex::new(()), config_sequence: AtomicU64::new(0), distance_writer: Mutex::new(()),unsupported_original }
    }
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
        let d = self.document.lock().await;
        let active = d["activeProfileId"].as_str();
        let game_id=d["profiles"].as_array().and_then(|profiles|profiles.iter().find(|p|p["id"].as_str()==active)).and_then(|p|p["gameProfileId"].as_str());
        let dpi=d["gameProfiles"].as_array().and_then(|games|games.iter().find(|g|g["id"].as_str()==game_id)).and_then(|g|g["dpi"].as_f64()).unwrap_or(800.0);
        let mut total=self.distance_cm.lock().await;
        *total += counts * 2.54 / dpi;
        *total
    }
    pub async fn persist_distance(&self) {
        let _writer = self.distance_writer.lock().await;
        if !self.document.lock().await["distance"]["persist"].as_bool().unwrap_or(false) { return; }
        let total = *self.distance_cm.lock().await;
        let path = self.path.with_file_name("distance.json");
        let result = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let temporary = path.with_extension("tmp");
            std::fs::write(&temporary, total.to_string())?;
            std::fs::rename(temporary, path)
        }).await;
        if !matches!(result, Ok(Ok(()))) { tracing::warn!("studio: distance could not be saved"); }
    }
    pub async fn snapshot(&self) -> (Value, String, u64) {
        let current = self.document.lock().await;
        let document = current.clone();
        let sequence = self.config_sequence.load(Ordering::Relaxed);
        let token = revision(&document); (document, token, sequence)
    }
    pub async fn set(&self, document: Value, base_revision: &str) -> Result<(String, u64), String> {
        if self.unsupported_original.is_some() {return Err("unsupported configuration version; original preserved".into());}
        if !valid_document(&document) { return Err("invalid configuration".into()); }
        let json = serde_json::to_vec(&document).map_err(|_| "serialization failed")?;
        if json.len() > MAX_DOCUMENT_BYTES { return Err("configuration too large".into()); }
        let _writer = self.writers.lock().await;
        if revision(&*self.document.lock().await) != base_revision { return Err("conflict".into()); }
        if self.document.lock().await["version"].as_u64().unwrap_or(0)>document["version"].as_u64().unwrap_or(0){return Err("unsupported configuration downgrade".into());}
        let next_revision = revision(&document);
        let path = self.path.clone();
        let incoming_version=document["version"].as_u64().unwrap();
        // Serialize saves separately: capture reads the document without waiting on disk.
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let temp = path.with_extension("tmp");
            if path.exists() {
                // Preserve an invalid original rather than silently overwriting it.
                let old = std::fs::read(&path)?;
                if serde_json::from_slice::<Value>(&old).ok().and_then(|d|d["version"].as_u64()).is_some_and(|v|v>incoming_version) {
                    return Err(std::io::Error::other("newer configuration version; original preserved"));
                }
                if serde_json::from_slice::<Value>(&old).ok().as_ref().is_some_and(valid_document) {
                    verified_copy(&path.with_extension("backup.json"), &old)?;
                } else {
                    verified_copy(&path.with_extension("invalid.json"), &old)?;
                }
            }
            verified_copy(&temp, &json)?;
            std::fs::rename(temp, path)
        }).await.map_err(|_| "storage task failed")?.map_err(|_| "storage write failed")?;
        let mut current = self.document.lock().await;
        *current = document;
        let sequence = self.config_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.recovery_required.store(false, Ordering::Relaxed);
        Ok((next_revision, sequence))
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
    fn module_document()->Value{let cases:Value=serde_json::from_str(include_str!("../test-fixtures/modules-current.json")).unwrap();cases.as_array().unwrap().iter().find(|case|case["name"]=="inactive resource retention").unwrap()["document"].clone()}
    #[tokio::test]
    async fn preserves_opaque_data_across_restart_and_edits(){
        let path=std::env::temp_dir().join(format!("studio-opaque-{}.json",rand::random::<u64>()));let store=StudioStore::new(path.clone());let document=module_document();save(&store,document.clone()).await;
        let restarted=StudioStore::new(path.clone());assert_eq!(restarted.snapshot().await.0,document);
        let mut next=document.clone();next["profiles"][0]["name"]=serde_json::json!("Changed sibling");save(&restarted,next.clone()).await;assert_eq!(next["profiles"][0]["modules"][1],document["profiles"][0]["modules"][1]);assert_eq!(StudioStore::new(path.clone()).snapshot().await.0,next);
        for file in [path.clone(),path.with_extension("backup.json")]{std::fs::remove_file(file).unwrap();}
    }
    fn config()->Value{serde_json::from_str(include_str!("../schema/default-current.json")).unwrap()}
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
        let restored = StudioStore::new(path.clone()); assert_eq!(restored.document.lock().await["gameProfiles"][0]["dpi"], 1600);
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
