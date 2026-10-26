//! The complete authenticated command table. Unknown commands are denied.
use serde_json::Value;

#[derive(Clone,Copy,Debug,PartialEq)]
pub enum Command {InputSnapshot,StudioGet,StudioSet,DistanceReset,RuntimeReady}
#[derive(Clone,Copy)]
enum Permission {Read,Write,Runtime}
const COMMANDS:&[(&str,Command,Permission)]=&[
    ("input_snapshot",Command::InputSnapshot,Permission::Read),
    ("studio_get",Command::StudioGet,Permission::Read),
    ("studio_set",Command::StudioSet,Permission::Write),
    ("distance_reset",Command::DistanceReset,Permission::Write),
    ("runtime_ready",Command::RuntimeReady,Permission::Runtime),
];
#[derive(Default)]
pub struct ClientPermissions {write:bool,pub runtime:bool}
impl ClientPermissions {
    pub fn from_auth(auth:&Value)->Self{Self{write:crate::compatibility::client_can_write(auth),runtime:crate::compatibility::runtime_can_read(auth)}}
    pub fn command(&self,name:&str)->Result<Command,&'static str>{
        let Some((_,command,permission))=COMMANDS.iter().find(|(key,_,_)|*key==name)else{return Err("unknown-command");};
        if match permission{Permission::Read=>true,Permission::Write=>self.write,Permission::Runtime=>self.runtime}{Ok(*command)}else{Err("command-forbidden")}
    }
}
pub fn token_matches(server:&str,client:&str)->bool{!server.is_empty()&&!server.chars().any(|c|c.is_whitespace()||c=='\u{feff}')&&server==client}

#[cfg(test)]mod tests{
    use super::*;
    use serde_json::json;
    fn auth(role:&str)->Value{let mut contract=crate::compatibility::CONTRACT.clone();contract["role"]=json!(role);json!({"studio_client":contract})}
    #[test]fn empty_tokens_never_authenticate(){for (server,client) in [("",""),("","anything"),("token",""),(" "," "),("token","wrong")]{assert!(!token_matches(server,client));}assert!(token_matches("token","token"));}
    #[test]fn every_known_command_has_an_explicit_permission(){
        let studio=ClientPermissions::from_auth(&auth("studio"));let runtime=ClientPermissions::from_auth(&auth("runtime"));let legacy=ClientPermissions::default();
        for (name,_,permission) in COMMANDS{
            assert_eq!(studio.command(name).is_ok(),!matches!(permission,Permission::Runtime),"studio: {name}");
            assert_eq!(runtime.command(name).is_ok(),!matches!(permission,Permission::Write),"runtime: {name}");
            assert_eq!(legacy.command(name).is_ok(),matches!(permission,Permission::Read),"legacy: {name}");
        }
        assert_eq!(studio.command("future_write"),Err("unknown-command"));
    }
    #[test]fn incomplete_or_wrong_role_clients_cannot_mutate(){
        for mut value in [auth("studio"),auth("runtime"),auth("unknown"),json!({})]{value["studio_client"]["document"]["write"]=json!([]);let client=ClientPermissions::from_auth(&value);for command in ["studio_set","distance_reset"]{assert_eq!(client.command(command),Err("command-forbidden"));}}
    }
}
