//! The complete authenticated command table. Unknown commands are denied.
use serde_json::Value;

#[derive(Clone,Copy,Debug,PartialEq)]
pub enum Command {InputSnapshot,StudioGet,StudioSet,DistanceReset,CounterReset,RuntimeReady}
#[derive(Clone,Copy)]
enum Permission {Read,Write,Runtime}
const COMMANDS:&[(&str,Command,Permission)]=&[
    ("input_snapshot",Command::InputSnapshot,Permission::Read),
    ("studio_get",Command::StudioGet,Permission::Read),
    ("studio_set",Command::StudioSet,Permission::Write),
    ("distance_reset",Command::DistanceReset,Permission::Write),
    ("counter_reset",Command::CounterReset,Permission::Write),
    ("runtime_ready",Command::RuntimeReady,Permission::Runtime),
];
#[derive(Default)]
pub struct ClientPermissions {write:bool,pub runtime:bool}
impl ClientPermissions {
    pub fn authenticate(auth: &Value, editor_token: &str, obs_token: &str) -> Option<Self> {
        let token = auth["token"].as_str()?;
        if obs_token != editor_token && token_matches(obs_token, token) {
            return Some(Self { write: false, runtime: crate::compatibility::runtime_can_read(auth) });
        }
        if !token_matches(editor_token, token) || auth["studio_client"]["role"] == "runtime" {
            return None;
        }
        Some(Self { write: crate::compatibility::client_can_write(auth), runtime: false })
    }

    pub fn can_write(&self) -> bool { self.write }
    pub fn command(&self,name:&str)->Result<Command,&'static str>{
        let Some((_,command,permission))=COMMANDS.iter().find(|(key,_,_)|*key==name)else{return Err("unknown-command");};
        if match permission{Permission::Read=>true,Permission::Write=>self.write,Permission::Runtime=>self.runtime}{Ok(*command)}else{Err("command-forbidden")}
    }
}
pub fn token_matches(server:&str,client:&str)->bool{!server.is_empty()&&!server.chars().any(|c|c.is_whitespace()||c=='\u{feff}')&&server==client}

#[cfg(test)]mod tests{
    use super::*;
    use serde_json::json;
    fn auth(role:&str)->Value{let mut contract=crate::compatibility::CONTRACT.clone();contract["role"]=json!(role);json!({"studio_client":contract,"token":if role=="runtime"{"obs"}else{"editor"}})}
    #[test]fn empty_tokens_never_authenticate(){for (server,client) in [("",""),("","anything"),("token",""),(" "," "),("token","wrong")]{assert!(!token_matches(server,client));}assert!(token_matches("token","token"));}
    #[test]fn every_known_command_has_an_explicit_permission(){
        let studio=ClientPermissions::authenticate(&auth("studio"), "editor", "obs").unwrap();let runtime=ClientPermissions::authenticate(&auth("runtime"), "editor", "obs").unwrap();let legacy=ClientPermissions::default();
        for (name,_,permission) in COMMANDS{
            assert_eq!(studio.command(name).is_ok(),!matches!(permission,Permission::Runtime),"studio: {name}");
            assert_eq!(runtime.command(name).is_ok(),!matches!(permission,Permission::Write),"runtime: {name}");
            assert_eq!(legacy.command(name).is_ok(),matches!(permission,Permission::Read),"legacy: {name}");
        }
        assert_eq!(studio.command("future_write"),Err("unknown-command"));
    }
    #[test]fn incomplete_or_wrong_role_clients_cannot_mutate(){
        for mut value in [auth("studio"),auth("runtime"),auth("unknown"),json!({})]{value["studio_client"]["document"]["write"]=json!([]);value["token"]=json!("obs");let client=ClientPermissions::authenticate(&value, "editor", "obs").unwrap();for command in ["studio_set","distance_reset","counter_reset"]{assert_eq!(client.command(command),Err("command-forbidden"));}}
    }
}
