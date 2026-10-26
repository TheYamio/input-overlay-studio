use serde::{Deserialize, Serialize};
use std::path::Path;
use serde_json::Value;
use std::{collections::BTreeMap, sync::LazyLock};

static SCHEMA:LazyLock<Value>=LazyLock::new(||serde_json::from_str(include_str!("../../schema/capture-config.json")).unwrap());
#[derive(Clone,Debug,Serialize)]
pub struct ConfigError {pub code:&'static str,#[serde(skip_serializing_if="Option::is_none")]pub field:Option<String>}
impl ConfigError {
    pub fn new(code:&'static str)->Self{Self{code,field:None}}
    fn field(field:&str)->Self{Self{code:"native-invalid-field",field:Some(field.into())}}
}
pub struct LoadedConfig {pub config:Config,pub warning:Option<ConfigError>}

fn valid_device(path:&str)->bool{path.is_empty()||!path.chars().any(char::is_control)&&path.strip_prefix("/dev/input/").is_some_and(|tail|tail.split('/').all(|part|!part.is_empty()&&part!="."&&part!=".."))}
fn validate_value(value:&Value)->Result<(),ConfigError>{
    if !crate::studio_validation::validate(value,&SCHEMA){
        if let Some(object)=value.as_object(){for (field,schema) in SCHEMA["properties"].as_object().unwrap(){if !object.get(field).is_some_and(|v|crate::studio_validation::validate(v,schema)){return Err(ConfigError::field(field));}}}
        return Err(ConfigError::new("native-invalid-config"));
    }
    if !crate::module_validation::bounded_json(value,0,&mut 0)||serde_json::to_vec(value).map_or(true,|bytes|bytes.len()>262144){return Err(ConfigError::new("native-invalid-config"));}
    if value["auth_token"].as_str().unwrap().chars().any(|c|c.is_whitespace()||c=='\u{feff}'){return Err(ConfigError::field("auth_token"));}
    if !super::address::valid_host(value["host"].as_str().unwrap()){return Err(ConfigError::new("native-host"));}
    if value["http_enabled"]==true&&value["port"]==value["http_port"]{return Err(ConfigError::new("native-ports"));}
    for field in ["key_whitelist","cpu_affinity"]{let values=value[field].as_array().unwrap();if values.iter().enumerate().any(|(i,v)|values[..i].contains(v)){return Err(ConfigError::field(field));}}
    for field in ["linux_evdev_keyboard_device","linux_raw_mouse_device"]{if !valid_device(value[field].as_str().unwrap()){return Err(ConfigError::field(field));}}
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Config {
    pub capture_enabled: bool,
    pub host: String,
    pub port: u16,
    pub auth_token: String,
    pub key_whitelist: Vec<String>,
    pub raw_mouse_min_delta: i32,
    pub send_mouse_move: bool,
    pub cpu_affinity: Vec<u32>,
    pub analog_keyboard: String,
    pub http_enabled: bool,
    pub http_port: u16,
    pub linux_evdev_keyboard_device: String,
    pub linux_raw_mouse_device: String,
    #[serde(flatten)]
    pub extra:BTreeMap<String,Value>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            capture_enabled: true,
            host: "127.0.0.1".to_string(),
            port: 4455,
            auth_token: generate_token(),
            key_whitelist: Vec::new(),
            raw_mouse_min_delta: 0,
            send_mouse_move: true,
            cpu_affinity: vec![0, 1],
            analog_keyboard: String::new(),
            http_enabled: true,
            http_port: 4456,
            linux_evdev_keyboard_device: String::new(),
            linux_raw_mouse_device: String::new(),
            extra:BTreeMap::new(),
        }
    }
}

impl Config {
    pub fn parse(value:Value)->Result<Self,ConfigError>{validate_value(&value)?;serde_json::from_value(value).map_err(|_|ConfigError::new("native-invalid-config"))}
    pub fn validate(&self)->Result<(),ConfigError>{validate_value(&serde_json::to_value(self).map_err(|_|ConfigError::new("native-invalid-config"))?)}
}
fn generate_token()->String{
    use rand::Rng;
    rand::thread_rng().sample_iter(rand::distributions::Alphanumeric).take(32).map(char::from).collect()
}
pub fn load(path: &Path) -> LoadedConfig {
    let loaded=(||->Result<(Config,bool),ConfigError>{
        if !path.exists(){return Ok((Config::default(),true));}
        let raw=std::fs::read_to_string(path).map_err(|_|ConfigError::new("native-startup-invalid"))?;
        let value:Value=serde_json::from_str(&raw).map_err(|_|ConfigError::new("native-startup-invalid"))?;
        let needs_token=value.get("auth_token").is_none_or(|v|v=="");
        let mut config:Config=serde_json::from_value(value).map_err(|_|ConfigError::new("native-startup-invalid"))?;
        if needs_token{config.auth_token=generate_token();}
        config.validate().map_err(|_|ConfigError::new("native-startup-invalid"))?;
        Ok((config,needs_token))
    })();
    match loaded{
        Ok((mut config,write))=>{let warning=if write&&save(path,&config).is_err(){config.capture_enabled=false;Some(ConfigError::new("native-startup-storage"))}else{None};LoadedConfig{config,warning}},
        Err(error)=>{let mut config=Config::default();config.capture_enabled=false;LoadedConfig{config,warning:Some(error)}}
    }
}

pub fn save(path: &Path, config: &Config) -> std::io::Result<()> {
    config.validate().map_err(|_|std::io::Error::new(std::io::ErrorKind::InvalidInput,"invalid capture configuration"))?;
    let json = serde_json::to_string_pretty(config).expect("config serialize failed");
    if path.exists() {
        let previous = std::fs::read_to_string(path)?;
        let backup = if serde_json::from_str::<Config>(&previous).is_ok_and(|cfg|cfg.validate().is_ok()) { "backup.json" } else { "invalid.json" };
        std::fs::write(path.with_extension(backup), previous)?;
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, json)?;
    std::fs::rename(temporary, path)
}

#[cfg(test)]mod tests{
    use super::*;
    fn path()->std::path::PathBuf{std::env::temp_dir().join(format!("capture-boundary-{}.json",rand::random::<u64>()))}
    fn clean(path:&Path){for file in [path.to_path_buf(),path.with_extension("backup.json"),path.with_extension("invalid.json"),path.with_extension("tmp")]{let _=std::fs::remove_file(file);}}
    #[test]fn shared_ts_rust_corpus_has_identical_acceptance(){
        let corpus:Value=serde_json::from_str(include_str!("../../test-fixtures/capture-config.json")).unwrap();
        for example in corpus.as_array().unwrap(){assert_eq!(Config::parse(example["config"].clone()).is_ok(),example["valid"].as_bool().unwrap(),"{}",example["name"]);}
    }
    #[test]fn invalid_save_does_not_touch_original_backup_or_temporary(){
        let path=path();let config=Config::default();save(&path,&config).unwrap();let before=std::fs::read(&path).unwrap();
        let mut invalid=config.clone();invalid.auth_token.clear();assert!(save(&path,&invalid).is_err());assert_eq!(std::fs::read(&path).unwrap(),before);assert!(!path.with_extension("backup.json").exists());assert!(!path.with_extension("tmp").exists());clean(&path);
    }
    #[test]fn invalid_startup_preserves_source_and_disables_capture(){
        for raw in ["{broken",r#"{"cpu_affinity":[999],"auth_token":"private-test"}"#,r#"{"auth_token":"  "}"#]{
            let path=path();std::fs::write(&path,raw).unwrap();let loaded=load(&path);assert_eq!(loaded.warning.unwrap().code,"native-startup-invalid");assert!(!loaded.config.capture_enabled);assert!(loaded.config.validate().is_ok());assert_eq!(std::fs::read_to_string(&path).unwrap(),raw);assert!(!path.with_extension("invalid.json").exists());clean(&path);
        }
    }
    #[test]fn first_launch_and_missing_tokens_are_generated_and_persisted_once(){
        for raw in [None,Some(r#"{"auth_token":"","capture_enabled":false}"#),Some(r#"{"capture_enabled":false}"#)]{
            let path=path();if let Some(raw)=raw{std::fs::write(&path,raw).unwrap();}let first=load(&path);assert!(first.warning.is_none());assert_eq!(first.config.auth_token.len(),32);let next=load(&path);assert!(next.warning.is_none());assert_eq!(next.config.auth_token,first.config.auth_token);clean(&path);
        }
    }
    #[test]fn failed_startup_storage_disables_capture_and_reports_a_safe_code(){
        let path=path().join("missing/config.json");let loaded=load(&path);assert!(!loaded.config.capture_enabled);assert_eq!(loaded.warning.unwrap().code,"native-startup-storage");assert!(!loaded.config.auth_token.is_empty());
    }
    #[test]fn safe_unknown_fields_survive_save_load_and_backup(){
        let path=path();let mut config=Config::default();config.extra.insert("future".into(),serde_json::json!({"data":["keep",1]}));save(&path,&config).unwrap();let restored=load(&path);assert!(restored.warning.is_none());assert_eq!(restored.config.extra,config.extra);save(&path,&restored.config).unwrap();assert!(std::fs::read_to_string(path.with_extension("backup.json")).unwrap().contains("future"));clean(&path);
    }
    #[test]fn storage_failure_preserves_existing_source(){
        let path=path();let mut config=Config::default();save(&path,&config).unwrap();let before=std::fs::read(&path).unwrap();std::fs::create_dir(path.with_extension("backup.json")).unwrap();config.port=4457;assert!(save(&path,&config).is_err());assert_eq!(std::fs::read(&path).unwrap(),before);std::fs::remove_dir(path.with_extension("backup.json")).unwrap();clean(&path);
    }
    #[test]fn validation_errors_only_contain_trusted_codes_and_field_names(){
        let mut value=serde_json::to_value(Config::default()).unwrap();value["auth_token"]=serde_json::json!("PRIVATE TOKEN");let error=Config::parse(value).unwrap_err();let text=serde_json::to_string(&error).unwrap();assert!(!text.contains("PRIVATE"));assert_eq!(error.field.as_deref(),Some("auth_token"));
    }
}
