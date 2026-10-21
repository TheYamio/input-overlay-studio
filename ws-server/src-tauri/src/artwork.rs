use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Cursor, sync::{LazyLock, Mutex}};

static VERIFIED: LazyLock<Mutex<HashSet<[u8; 32]>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn valid_asset(asset: &Value) -> bool {
    let (Some(data), Some(width), Some(height)) = (asset["data"].as_str(), asset["width"].as_u64(), asset["height"].as_u64()) else { return false; };
    let mut hash = Sha256::new(); hash.update(data); hash.update(width.to_le_bytes()); hash.update(height.to_le_bytes());
    let key: [u8; 32] = hash.finalize().into();
    if VERIFIED.lock().unwrap().contains(&key) { return true; }
    let Some((header, encoded)) = data.split_once(',') else { return false; };
    let format = match header { "data:image/png;base64" => image::ImageFormat::Png, "data:image/jpeg;base64" => image::ImageFormat::Jpeg, "data:image/webp;base64" => image::ImageFormat::WebP, _ => return false };
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else { return false; };
    let Ok(size) = image::ImageReader::with_format(Cursor::new(&bytes), format).into_dimensions() else { return false; };
    if size != (width as u32, height as u32) || width == 0 || height == 0 || width > 2048 || height > 2048 { return false; }
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), format);
    let mut limits = image::Limits::default(); limits.max_image_width = Some(2048); limits.max_image_height = Some(2048); limits.max_alloc = Some(32 * 1024 * 1024); reader.limits(limits);
    if reader.decode().is_err() { return false; }
    let mut cache = VERIFIED.lock().unwrap(); if cache.len() >= 16 { cache.clear(); } cache.insert(key); true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_images_wrong_dimensions_and_truncated_payloads() {
        let good: Value = serde_json::from_str(include_str!("../schema/test-artwork.json")).unwrap(); assert!(valid_asset(&good));
        let mut bad = good.clone(); bad["width"] = serde_json::json!(1); assert!(!valid_asset(&bad));
        bad = good.clone(); bad["data"] = serde_json::json!("data:image/png;base64,aGVsbG8="); assert!(!valid_asset(&bad));
        let mut truncated = good["data"].as_str().unwrap().to_string(); truncated.truncate(90); bad["data"] = serde_json::json!(truncated); assert!(!valid_asset(&bad));
    }
}
