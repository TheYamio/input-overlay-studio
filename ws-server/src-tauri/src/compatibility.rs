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
 client["role"]=="studio"&&client["contractVersion"]==CONTRACT["contractVersion"]&&client["protocolVersion"]==CONTRACT["protocolVersion"]&&["config.revisions","config.module-envelope","profiles.game-links","visual.localization"].iter().all(|feature|client["features"][*feature]==CONTRACT["features"][*feature])&&client["document"]["write"].as_array().is_some_and(|versions|versions.contains(&json!(4)))
}
pub fn runtime_can_read(auth:&Value)->bool {
 let client=&auth["studio_client"];
 client["role"]=="runtime"&&client["contractVersion"]==CONTRACT["contractVersion"]&&client["protocolVersion"]==CONTRACT["protocolVersion"]&&client["document"]["read"].as_array().is_some_and(|versions|versions.contains(&json!(4)))&&["config.module-envelope","profiles.game-links","visual.localization"].iter().all(|feature|client["features"][*feature]==CONTRACT["features"][*feature])
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn runtime_usage_requires_a_compatible_reader(){let mut client=CONTRACT.clone();client["role"]=json!("runtime");assert!(runtime_can_read(&json!({"studio_client":client})));client["features"]["visual.localization"]=json!(1);assert!(!runtime_can_read(&json!({"studio_client":client})));client=CONTRACT.clone();client["role"]=json!("studio");assert!(!runtime_can_read(&json!({"studio_client":client})));assert!(!runtime_can_read(&json!({})));}
 #[test]fn only_current_studio_can_write(){let mut client=CONTRACT.clone();client["role"]=json!("studio");assert!(client_can_write(&json!({"studio_client":client})));assert!(!client_can_write(&json!({})));client["role"]=json!("runtime");assert!(!client_can_write(&json!({"studio_client":client})));client["role"]=json!("studio");client["document"]["write"]=json!([1,2,3]);assert!(!client_can_write(&json!({"studio_client":client})));}
 #[test]fn future_module_schemas_are_declarative(){let mut client=CONTRACT.clone();client["role"]=json!("studio");client["moduleSchemas"]["overlay.keyboard"]=json!(99);assert!(client_can_write(&json!({"studio_client":client})));}
 #[test]fn locale_only_clients_cannot_overwrite_package_selections(){let mut client=CONTRACT.clone();client["role"]=json!("studio");client["features"]["visual.localization"]=json!(1);assert!(!client_can_write(&json!({"studio_client":client})));}
}
