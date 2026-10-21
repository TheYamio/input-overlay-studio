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
}
impl StudioStore {
    pub fn new(path: PathBuf) -> Self {
        let document = std::fs::read_to_string(&path).ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .filter(valid_document).unwrap_or(Value::Null);
        let recovery_required = path.exists() && document.is_null();
        let persist = document["distance"]["persist"].as_bool().unwrap_or(false);
        let reset = document["distance"]["resetOnStart"].as_bool().unwrap_or(true);
        let distance = if persist && !reset {
            std::fs::read_to_string(path.with_file_name("distance.json")).ok()
                .and_then(|s| serde_json::from_str::<f64>(&s).ok())
                .filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0)
        } else { 0.0 };
        Self { document: Mutex::new(document), distance_cm: Mutex::new(distance), recovery_required: AtomicBool::new(recovery_required), path, writers: Mutex::new(()), config_sequence: AtomicU64::new(0), distance_writer: Mutex::new(()) }
    }
    pub fn backup(&self) -> Value {
        std::fs::read_to_string(self.path.with_extension("backup.json")).ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok()).filter(valid_document).unwrap_or(Value::Null)
    }
    pub async fn add_distance(&self, counts: f64) -> f64 {
        let d = self.document.lock().await;
        let active = d["activeProfileId"].as_str();
        let dpi = d["profiles"].as_array().and_then(|profiles| profiles.iter().find(|p| p["id"].as_str() == active))
            .and_then(|p| p["dpi"].as_f64()).unwrap_or(800.0);
        let mut total = self.distance_cm.lock().await;
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
        if !valid_document(&document) { return Err("invalid configuration".into()); }
        let json = serde_json::to_vec(&document).map_err(|_| "serialization failed")?;
        if json.len() > MAX_DOCUMENT_BYTES { return Err("configuration too large".into()); }
        let _writer = self.writers.lock().await;
        if revision(&*self.document.lock().await) != base_revision { return Err("conflict".into()); }
        let next_revision = revision(&document);
        let path = self.path.clone();
        let migrating = document["version"] == 2;
        // Serialize saves separately: capture reads the document without waiting on disk.
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let temp = path.with_extension("tmp");
            if path.exists() {
                // Preserve an invalid original rather than silently overwriting it.
                let old = std::fs::read(&path)?;
                if serde_json::from_slice::<Value>(&old).ok().as_ref().is_some_and(valid_document) {
                    let legacy = serde_json::from_slice::<Value>(&old).ok().is_some_and(|d| d["version"] == 1);
                    if migrating && legacy && !path.with_extension("v1.json").exists() {
                        std::fs::write(path.with_extension("v1.json"), &old)?;
                    }
                    std::fs::write(path.with_extension("backup.json"), old)?;
                } else {
                    std::fs::write(path.with_extension("invalid.json"), old)?;
                }
            }
            std::fs::write(&temp, json)?;
            std::fs::rename(temp, path)
        }).await.map_err(|_| "storage task failed")?.map_err(|_| "storage write failed")?;
        let mut current = self.document.lock().await;
        *current = document;
        let sequence = self.config_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.recovery_required.store(false, Ordering::Relaxed);
        Ok((next_revision, sequence))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Value { let mut d: Value = serde_json::from_str(include_str!("../schema/default-v2.json")).unwrap(); d["version"] = serde_json::json!(1); d.as_object_mut().unwrap().remove("assets"); d }
    async fn save(store: &StudioStore, d: Value) { let (_, token, _) = store.snapshot().await; store.set(d, &token).await.unwrap(); }
    #[test]
    fn invalid_configurations_are_rejected() {
        assert!(!valid_document(&Value::Null)); let mut d = config(); assert!(valid_document(&d));
        d["profiles"][0]["dpi"] = serde_json::json!(0); assert!(!valid_document(&d));
        let mut d = config(); d["activeProfileId"] = serde_json::json!("absent"); assert!(!valid_document(&d));
    }
    #[test]
    fn version_two_requires_bounded_embedded_raster_assets() {
        let mut d = config(); d["version"] = serde_json::json!(2);
        assert!(valid_document(&d)); d["assets"] = serde_json::json!({}); assert!(valid_document(&d));
        d["assets"]["picture"] = serde_json::json!({"name":"picture","width":256,"height":256,"data":"data:image/webp;base64,aGVsbG8="});
        assert!(valid_document(&d)); d["assets"]["picture"]["data"] = serde_json::json!("https://example.test/remote.png"); assert!(!valid_document(&d));
        d["version"] = serde_json::json!(99); assert!(!valid_document(&d));
    }
    #[tokio::test]
    async fn stores_profiles_and_preserves_existing_physical_distance_on_dpi_change() {
        let path = std::env::temp_dir().join(format!("studio-test-{}.json", rand::random::<u64>()));
        let store = StudioStore::new(path.clone());
        save(&store, config()).await;
        assert_eq!(store.add_distance(800.0).await, 2.54);
        let mut next = config(); next["profiles"][0]["dpi"] = serde_json::json!(1600);
        save(&store, next).await; assert_eq!(store.add_distance(1600.0).await, 5.08);
        assert!(path.with_extension("backup.json").exists());
        let restored = StudioStore::new(path.clone()); assert_eq!(restored.document.lock().await["profiles"][0]["dpi"], 1600);
        std::fs::remove_file(&path).unwrap(); std::fs::remove_file(path.with_extension("backup.json")).unwrap();
    }
    #[tokio::test]
    async fn migration_keeps_the_original_v1_even_after_later_saves() {
        let path = std::env::temp_dir().join(format!("studio-migration-{}.json", rand::random::<u64>()));
        let store = StudioStore::new(path.clone()); save(&store, config()).await;
        let mut upgraded = config(); upgraded["version"] = serde_json::json!(2); upgraded["assets"] = serde_json::json!({});
        save(&store, upgraded.clone()).await; save(&store, upgraded).await;
        let original: Value = serde_json::from_slice(&std::fs::read(path.with_extension("v1.json")).unwrap()).unwrap();
        assert_eq!(original["version"], 1);
        for file in [path.clone(), path.with_extension("backup.json"), path.with_extension("v1.json")] { std::fs::remove_file(file).unwrap(); }
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
}
