//! The structural contract is generated from the frontend Zod schema.
//! Reject unsupported schema keywords rather than silently skipping constraints.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

pub(crate) fn valid_text(s:&str)->bool{s.chars().all(|c|!c.is_control()||matches!(c,'\t'|'\n'|'\r'))}

pub const MAX_DOCUMENT_BYTES: usize = 1_800_000;
static SCHEMA: LazyLock<Value> = LazyLock::new(|| serde_json::from_str(include_str!("../schema/studio-model.json")).expect("embedded studio schema"));
static PATTERNS: LazyLock<std::collections::HashMap<String, regex::Regex>> = LazyLock::new(|| {
    fn collect(s: &Value, out: &mut std::collections::HashMap<String, regex::Regex>) {
        if let Some(p) = s.get("pattern").and_then(Value::as_str) { out.entry(p.into()).or_insert_with(|| regex::Regex::new(p).expect("schema regex")); }
        match s { Value::Object(o) => for child in o.values() { collect(child, out); }, Value::Array(a) => for child in a { collect(child, out); }, _ => {} }
    }
    let mut out = std::collections::HashMap::new(); collect(&SCHEMA, &mut out); collect(&serde_json::from_str::<Value>(include_str!("../schema/studio-current.json")).unwrap(),&mut out); collect(&serde_json::from_str::<Value>(include_str!("../schema/module-configurations.json")).unwrap(),&mut out); out
});
pub(crate) fn validate(v: &Value, s: &Value) -> bool {
    if let Some(b) = s.as_bool() { return b; }
    let Some(o) = s.as_object() else { return false; };
    for key in o.keys() {
        if !["$schema", "type", "properties", "required", "additionalProperties", "propertyNames", "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "enum", "const", "default"].contains(&key.as_str()) { return false; }
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
            let prefix = s["prefixItems"].as_array();
            if let Some(rules) = prefix { if !a.iter().zip(rules).all(|(v, rule)| validate(v, rule)) { return false; } }
            if let Some(items) = s.get("items") { if !a.iter().skip(prefix.map_or(0, Vec::len)).all(|v| validate(v, items)) { return false; } }
        }
        Some("string") => {
            let Some(text) = v.as_str() else { return false; };
            // Match JS/Zod string length (UTF-16 code units).
            if !valid_text(text) {return false;}
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
pub(crate) fn apply_defaults(v: &mut Value, s: &Value) {
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
pub fn valid_document(d:&Value)->bool {d["version"]==4&&crate::module_validation::valid(d)}
pub(crate) fn valid_projection(d:&Value)->bool {valid_model(d)}
fn valid_model(d:&Value)->bool {
    if d["version"]!=4{return false;}
    let mut candidate=d.clone();
    if !validate(&candidate, &SCHEMA) { return false; }
    apply_defaults(&mut candidate, &SCHEMA);
    if let Some(packs)=candidate["languagePacks"].as_array(){
        if serde_json::to_vec(packs).map_or(true,|v|v.len()>1_000_000){return false;}
        let mut locales=HashSet::new();
        for pack in packs {
            if !locales.insert(pack["locale"].as_str().unwrap().to_lowercase()){return false;}
            if pack["name"].as_str().is_some_and(|name|name.trim().is_empty()){return false;}
            let namespaces=pack["namespaces"].as_object().unwrap();if namespaces.len()>64{return false;}
            let (mut count,mut size)=(0,0);
            for (namespace,entries) in namespaces {
                if matches!(namespace.as_str(),"constructor"|"prototype"|"__proto__"){return false;}
                for (key,value) in entries.as_object().unwrap(){
                    if matches!(key.as_str(),"constructor"|"prototype"|"__proto__"){return false;}
                    let text=value.as_str().unwrap();if text.trim().is_empty()||!valid_text(text){return false;}
                    count+=1;size+=key.encode_utf16().count()+text.encode_utf16().count();if count>10000||size>500000{return false;}
                }
            }
        }
    }
    let shapes = candidate["shapes"].as_object().unwrap();
    if shapes.len() > 32 { return false; }
    static PATH_NUMBERS: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?").unwrap());
    for shape in shapes.values() {
        for path in shape["paths"].as_array().unwrap() {
            let d = path["d"].as_str().unwrap();
            if !d.chars().any(|c| c == 'M' || c == 'm') { return false; }
            let mut count = 0;
            for number in PATH_NUMBERS.find_iter(d) {
                count += 1;
                if count > 4096 || !number.as_str().parse::<f64>().is_ok_and(|n| n.is_finite() && n.abs() <= 1_000_000.0) { return false; }
            }
        }
    }
    let profiles = candidate["profiles"].as_array().unwrap();
    let presets = candidate["presets"].as_array().unwrap();
    let unique = |items: &[Value]| { let mut ids = HashSet::new(); items.iter().all(|p| ids.insert(p["id"].as_str().unwrap())) };
    let games=candidate["gameProfiles"].as_array().unwrap();
    if !unique(games)||profiles.iter().any(|p|!games.iter().any(|g|g["id"]==p["gameProfileId"])){return false;}
    if !unique(profiles) || !unique(presets) || !profiles.iter().any(|p| p["id"] == candidate["activeProfileId"]) { return false; }
    if candidate["assets"].as_object().is_some_and(|a| a.len() > 8 || a.values().any(|v| v["data"].as_str().unwrap().split_once(',').is_none_or(|(_, data)| data.len() % 4 != 0) || !crate::artwork::valid_asset(v))) { return false; }
    for p in profiles.iter().chain(presets) {
        let modules = p["modules"].as_array().unwrap();
        if !unique(modules) { return false; }
        let mut artwork_groups = std::collections::HashMap::new();
        for m in modules {
            if !unique(m["keys"].as_array().unwrap()) { return false; }
            if let Some(id) = m["mouseBodyShapeId"].as_str().filter(|id| !id.is_empty()) { if !shapes.contains_key(id) { return false; } }
            for style in std::iter::once(&m["appearance"])
                .chain(m["keys"].as_array().unwrap().iter().map(|key| &key["style"]))
                .chain(m["buttonStyles"].as_object().unwrap().values()) {
                if let Some(id) = style["shapeId"].as_str().filter(|id| !id.is_empty()) { if !shapes.contains_key(id) { return false; } }
            }
            if let Some(group) = m["image"]["groupId"].as_str() {
                if !matches!(m["type"].as_str(), Some("keyboard" | "mouse")) { return false; }
                if artwork_groups.insert(group, &m["image"]).is_some_and(|previous| previous != &m["image"]) { return false; }
            }
            if let Some(id) = m["image"]["assetId"].as_str().filter(|id| !id.is_empty()) { if candidate["assets"].get(id).is_none() { return false; } }
        }
    }
    // Canonical envelope size is checked by module_validation before projection.
    // A bounded inactive module can have a much larger private editing view.
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_and_language_packages_are_validated_before_saving(){
        let mut d:Value=serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
        d["profiles"][0]["caption"]=json!("العربية 日本語 हिन्दी 👩🏽‍💻 e\u{301}");
        d["profiles"][0]["locale"]=json!("ja");
        d["languagePacks"]=json!([{"version":1,"locale":"ja","name":"日本語","namespaces":{"overlay":{"sensitivity":"感度"}}}]);
        assert!(valid_document(&d));
        let mut bad=d.clone();bad["profiles"][0]["caption"]=json!("bad\0");assert!(!valid_document(&bad));
        let mut bad=d.clone();bad["languagePacks"][0]["namespaces"]["overlay"]=json!({"__proto__":"bad"});assert!(!valid_document(&bad));
        let mut bad=d.clone();let duplicate=bad["languagePacks"][0].clone();bad["languagePacks"].as_array_mut().unwrap().push(duplicate);assert!(!valid_document(&bad));
        let mut bad=d.clone();bad["languagePacks"][0]["namespaces"]["overlay"]["sensitivity"]=json!(" ");assert!(!valid_document(&bad));
        assert!(valid_document(&d));
    }
    #[test]
    fn vector_shapes_validate_geometry_references_and_optional_old_documents() {
        let mut d: Value = serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
        let shape = json!({"name":"Contour", "viewBox":[0,0,100,100], "paths":[{"d":"M0 0H100V100H0Z M25 25H75V75H25Z", "matrix":[1,0,0,1,0,0], "fill":true, "fillRule":"evenodd", "strokeWidth":0, "linecap":"round", "linejoin":"round", "opacity":1}]});
        d["shapes"] = json!({"custom":shape});
        d["profiles"][0]["modules"][0]["config"]["appearance"]["shapeId"] = json!("custom");
        d["profiles"][0]["modules"][0]["config"]["appearance"]["showLabels"] = json!(false);
        d["profiles"][0]["modules"][1]["config"]["mouseBodyShapeId"] = json!("custom");
        d["profiles"][0]["modules"][0]["resources"]["shapes"]=json!(["custom"]);d["profiles"][0]["modules"][1]["resources"]["shapes"]=json!(["custom"]);
        assert!(valid_document(&d));
        for path in ["M0 0L1e999 0Z", "M0 0L1000001 0Z", "M0 0<script/>", "Z"] {
            let mut bad = d.clone(); bad["shapes"]["custom"]["paths"][0]["d"] = json!(path); assert!(!valid_document(&bad));
        }
        for view_box in [json!([0,0,100]), json!([0,0,0,100]), json!([0,0,100,100,1])] {
            let mut bad = d.clone(); bad["shapes"]["custom"]["viewBox"] = view_box; assert!(!valid_document(&bad));
        }
        let mut bad = d.clone(); bad["shapes"]["custom"]["paths"][0]["matrix"] = json!([1,0,0]); assert!(!valid_document(&bad));
        let mut bad = d.clone(); bad["profiles"][0]["modules"][0]["config"]["keys"][0]["style"] = json!({"shapeId":"missing"}); assert!(!valid_document(&bad));
        let mut bad = d.clone(); bad["profiles"][0]["modules"][1]["config"]["buttonStyles"]["1"] = json!({"shapeId":"missing"}); assert!(!valid_document(&bad));
        d["shapes"] = json!({}); assert!(!valid_document(&d));
        let mut old: Value = serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
        old.as_object_mut().unwrap().remove("shapes"); assert!(valid_document(&old));
    }
    #[test]
    fn artwork_groups_require_identical_settings_and_interactive_members() {
        let mut d: Value = serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
        assert!(valid_document(&d)); // Old v2 files do not need group/flip fields.
        let mut image = d["profiles"][0]["modules"][0]["config"]["image"].clone(); image["groupId"] = json!("shared"); image["flipX"] = json!(true);
        d["profiles"][0]["modules"][0]["config"]["image"] = image.clone(); d["profiles"][0]["modules"][1]["config"]["image"] = image.clone(); assert!(valid_document(&d));
        d["profiles"][0]["modules"][1]["config"]["image"]["opacity"] = json!(0.25); assert!(!valid_document(&d));
        d["profiles"][0]["modules"][1]["config"]["image"] = image.clone(); d["profiles"][0]["modules"][2]["config"]["image"] = image; assert!(!valid_document(&d));
    }
    #[test]
    fn animation_fields_validate_bounds_and_individual_overrides() {
        let mut d: Value = serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
        d["profiles"][0]["modules"][0]["config"]["appearance"]["motion"] = json!("Bounce");
        d["profiles"][0]["modules"][0]["config"]["appearance"]["lighting"] = json!("Gradient");
        d["profiles"][0]["modules"][0]["config"]["keys"][0]["style"] = json!({"pressDelay":1000,"releaseDelay":2000,"motionScale":0.8,"lightingOpacity":0.4});
        assert!(valid_document(&d));
        for patch in [json!({"pressDelay":1001}), json!({"releaseDelay":-1}), json!({"motionScale":1.3}), json!({"lighting":"Unknown"}), json!({"easing":"Unknown"}), json!({"secondaryColor":"red"})] {
            let mut bad = d.clone(); bad["profiles"][0]["modules"][0]["config"]["keys"][0]["style"] = patch; assert!(!valid_document(&bad));
        }
    }
    #[test]
    fn preset_metadata_is_optional_bounded_and_preserved() {
        let mut d: Value = serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
        let modules = d["profiles"][0]["modules"].clone();
        d["presets"] = json!([{"id":"palette", "name":"My palette", "theme":"Neon", "modules":modules, "kind":"style", "description":"Violet and lime"}]);
        assert!(valid_document(&d));
        let mut bad = d.clone(); bad["presets"][0]["description"] = json!("x".repeat(501)); assert!(!valid_document(&bad));
        let mut bad = d.clone(); bad["presets"][0]["kind"] = json!("unknown"); assert!(!valid_document(&bad));
        let preset = d["presets"][0].as_object_mut().unwrap(); preset.remove("description"); preset.remove("kind"); assert!(valid_document(&d));
    }
    #[test]
    fn image_flip_fields_require_booleans() {
        let mut d: Value = serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
        d["profiles"][0]["modules"][0]["config"]["image"]["flipY"] = json!(1); assert!(!valid_document(&d));
        d["profiles"][0]["modules"][0]["config"]["image"]["flipY"] = json!(false); assert!(valid_document(&d));
    }
    #[test]
    fn full_contract_rejects_broken_modules_and_settings() {
        let d: Value = serde_json::from_str(include_str!("../schema/default-current.json")).unwrap(); assert!(valid_document(&d));
        for field in ["performance", "distance"] { let mut bad = d.clone(); bad[field] = json!({}); assert!(!valid_document(&bad)); }
        let mut bad = d.clone(); bad["profiles"][0]["modules"][0] = json!({}); assert!(!valid_document(&bad));
        let mut bad = d.clone(); bad["profiles"][0]["modules"][0]["config"]["accent"] = json!("red"); assert!(!valid_document(&bad));
        let mut bad = d.clone(); bad["profiles"][0]["modules"][0]["config"]["image"]["assetId"] = json!("missing"); assert!(!valid_document(&bad));
        let mut legacy = d; legacy["version"] = json!(1); legacy.as_object_mut().unwrap().remove("assets"); assert!(!valid_document(&legacy));
    }
}
