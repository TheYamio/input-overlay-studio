//! The structural contract is generated from the frontend Zod schema.
//! Reject unsupported schema keywords rather than silently skipping constraints.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

pub const MAX_DOCUMENT_BYTES: usize = 1_800_000;
static SCHEMA: LazyLock<Value> = LazyLock::new(|| serde_json::from_str(include_str!("../schema/studio-v2.json")).expect("embedded studio schema"));
static PATTERNS: LazyLock<std::collections::HashMap<String, regex::Regex>> = LazyLock::new(|| {
    fn collect(s: &Value, out: &mut std::collections::HashMap<String, regex::Regex>) {
        if let Some(p) = s.get("pattern").and_then(Value::as_str) { out.entry(p.into()).or_insert_with(|| regex::Regex::new(p).expect("schema regex")); }
        match s { Value::Object(o) => for child in o.values() { collect(child, out); }, Value::Array(a) => for child in a { collect(child, out); }, _ => {} }
    }
    let mut out = std::collections::HashMap::new(); collect(&SCHEMA, &mut out); out
});
fn validate(v: &Value, s: &Value) -> bool {
    if let Some(b) = s.as_bool() { return b; }
    let Some(o) = s.as_object() else { return false; };
    for key in o.keys() {
        if !["$schema", "type", "properties", "required", "additionalProperties", "propertyNames", "items", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "enum", "const", "default"].contains(&key.as_str()) { return false; }
    }
    if let Some(c) = s.get("const") { if v != c { return false; } }
    if let Some(a) = s.get("enum").and_then(Value::as_array) { if !a.contains(v) { return false; } }
    match s["type"].as_str() {
        Some("object") => {
            let Some(obj) = v.as_object() else { return false; };
            if let Some(required) = s["required"].as_array() { if required.iter().any(|k| !obj.contains_key(k.as_str().unwrap_or(""))) { return false; } }
            for (key, value) in obj {
                if let Some(names) = s.get("propertyNames") { if !validate(&json!(key), names) { return false; } }
                if let Some(rule) = s["properties"].get(key) { if !validate(value, rule) { return false; } }
                else if let Some(rule) = s.get("additionalProperties") { if !validate(value, rule) { return false; } }
            }
        }
        Some("array") => {
            let Some(a) = v.as_array() else { return false; };
            if s["minItems"].as_u64().is_some_and(|n| a.len() < n as usize) || s["maxItems"].as_u64().is_some_and(|n| a.len() > n as usize) { return false; }
            if let Some(items) = s.get("items") { if !a.iter().all(|v| validate(v, items)) { return false; } }
        }
        Some("string") => {
            let Some(text) = v.as_str() else { return false; };
            // Match JS/Zod string length (UTF-16 code units).
            let len = text.encode_utf16().count();
            if s["minLength"].as_u64().is_some_and(|n| len < n as usize) || s["maxLength"].as_u64().is_some_and(|n| len > n as usize) { return false; }
            if let Some(p) = s["pattern"].as_str() { if !PATTERNS[p].is_match(text) { return false; } }
        }
        Some("number" | "integer") => {
            let Some(n) = v.as_f64().filter(|n| n.is_finite()) else { return false; };
            if s["type"] == "integer" && n.fract() != 0.0 { return false; }
            if s["minimum"].as_f64().is_some_and(|x| n < x) || s["maximum"].as_f64().is_some_and(|x| n > x)
                || s["exclusiveMinimum"].as_f64().is_some_and(|x| n <= x) || s["exclusiveMaximum"].as_f64().is_some_and(|x| n >= x) { return false; }
        }
        Some("boolean") => if !v.is_boolean() { return false; },
        None => {},
        _ => return false,
    }
    true
}
fn apply_defaults(v: &mut Value, s: &Value) {
    if let Some(obj) = v.as_object_mut() {
        if let Some(properties) = s["properties"].as_object() {
            for (key, rule) in properties {
                if !obj.contains_key(key) { if let Some(default) = rule.get("default") { obj.insert(key.clone(), default.clone()); } }
                if let Some(child) = obj.get_mut(key) { apply_defaults(child, rule); }
            }
        } else if let Some(rule) = s.get("additionalProperties").filter(|v| v.is_object()) {
            for child in obj.values_mut() { apply_defaults(child, rule); }
        }
    } else if let Some(items) = v.as_array_mut() {
        if let Some(rule) = s.get("items") { for child in items { apply_defaults(child, rule); } }
    }
}
pub fn valid_document(d: &Value) -> bool {
    if !matches!(d["version"].as_u64(), Some(1 | 2)) { return false; }
    let mut candidate = d.clone();
    if d["version"] == 1 { candidate["version"] = json!(2); candidate["assets"] = json!({}); }
    if !validate(&candidate, &SCHEMA) { return false; }
    apply_defaults(&mut candidate, &SCHEMA);
    let profiles = candidate["profiles"].as_array().unwrap();
    let presets = candidate["presets"].as_array().unwrap();
    let unique = |items: &[Value]| { let mut ids = HashSet::new(); items.iter().all(|p| ids.insert(p["id"].as_str().unwrap())) };
    if !unique(profiles) || !unique(presets) || !profiles.iter().any(|p| p["id"] == candidate["activeProfileId"]) { return false; }
    if candidate["assets"].as_object().is_some_and(|a| a.len() > 8 || a.values().any(|v| v["data"].as_str().unwrap().split_once(',').is_none_or(|(_, data)| data.len() % 4 != 0) || !crate::artwork::valid_asset(v))) { return false; }
    for p in profiles.iter().chain(presets) {
        let modules = p["modules"].as_array().unwrap();
        if !unique(modules) { return false; }
        for m in modules {
            if !unique(m["keys"].as_array().unwrap()) { return false; }
            if let Some(id) = m["image"]["assetId"].as_str().filter(|id| !id.is_empty()) { if candidate["assets"].get(id).is_none() { return false; } }
        }
    }
    serde_json::to_vec(&candidate).is_ok_and(|bytes| bytes.len() <= MAX_DOCUMENT_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_contract_rejects_broken_modules_and_settings() {
        let d: Value = serde_json::from_str(include_str!("../schema/default-v2.json")).unwrap(); assert!(valid_document(&d));
        for field in ["performance", "distance"] { let mut bad = d.clone(); bad[field] = json!({}); assert!(!valid_document(&bad)); }
        let mut bad = d.clone(); bad["profiles"][0]["modules"][0] = json!({}); assert!(!valid_document(&bad));
        let mut bad = d.clone(); bad["profiles"][0]["modules"][0]["accent"] = json!("red"); assert!(!valid_document(&bad));
        let mut bad = d.clone(); bad["profiles"][0]["modules"][0]["image"]["assetId"] = json!("missing"); assert!(!valid_document(&bad));
        let mut legacy = d; legacy["version"] = json!(1); legacy.as_object_mut().unwrap().remove("assets"); assert!(valid_document(&legacy));
    }
}
