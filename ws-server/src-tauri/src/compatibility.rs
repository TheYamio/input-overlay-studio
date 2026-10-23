//! One declaration is embedded by Capture and bundled by Studio/Runtime.
use serde_json::{json, Value};
use std::sync::LazyLock;
pub static CONTRACT: LazyLock<Value> = LazyLock::new(|| serde_json::from_str(include_str!("../../../studio/src/core/compatibility/contract.json")).expect("capability contract"));

pub fn auth_response() -> String {
    let mut capabilities=CONTRACT.clone();capabilities["role"]=json!("capture");
    json!({"type":"auth_response","status":"success","protocol":CONTRACT["protocolVersion"],"state_snapshot":true,
        "studio_capabilities":capabilities}).to_string()
}
pub fn client_can_write(auth:&Value)->bool {
 let client=&auth["studio_client"];
 client["role"]=="studio"&&client["contractVersion"]==CONTRACT["contractVersion"]&&client["protocolVersion"]==CONTRACT["protocolVersion"]&&["config.revisions","config.module-envelope","profiles.game-links","visual.localization"].iter().all(|feature|client["features"][*feature]==1)&&client["document"]["write"].as_array().is_some_and(|versions|versions.contains(&json!(4)))
}
pub fn client_write_versions(auth:&Value)->Vec<u64>{if client_can_write(auth){vec![4]}else{Vec::new()}}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn only_current_studio_can_write(){let mut client=CONTRACT.clone();client["role"]=json!("studio");assert_eq!(client_write_versions(&json!({"studio_client":client})),vec![4]);assert!(!client_can_write(&json!({})));client["role"]=json!("runtime");assert!(!client_can_write(&json!({"studio_client":client})));client["role"]=json!("studio");client["document"]["write"]=json!([1,2,3]);assert!(!client_can_write(&json!({"studio_client":client})));}
 #[test]fn future_module_schemas_are_declarative(){let mut client=CONTRACT.clone();client["role"]=json!("studio");client["moduleSchemas"]["overlay.keyboard"]=json!(99);assert!(client_can_write(&json!({"studio_client":client})));}
}
