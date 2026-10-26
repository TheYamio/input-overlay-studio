use std::{io,net::IpAddr,time::Duration};
use tokio::net::TcpListener;

pub fn bind_host(host:&str)->&str{host.strip_prefix('[').and_then(|s|s.strip_suffix(']')).unwrap_or(host)}
pub fn client_host(host:&str)->&str{match bind_host(host){"0.0.0.0"=>"127.0.0.1","::"=>"::1",host=>host}}
pub fn authority(host:&str,port:u16)->String{let host=bind_host(host);if host.contains(':'){format!("[{host}]:{port}")}else{format!("{host}:{port}")}}
pub fn valid_host(host:&str)->bool{
    let bare=bind_host(host);
    if host.len()>253||bare!=host&&!bare.contains(':'){return false;}
    if bare.parse::<IpAddr>().is_ok(){return true;}
    if bare!=host||host.is_empty()||host.bytes().all(|c|c.is_ascii_digit()||c==b'.'){return false;}
    host.strip_suffix('.').unwrap_or(host).split('.').all(|part|!part.is_empty()&&part.len()<=63&&part.as_bytes()[0].is_ascii_alphanumeric()&&part.as_bytes()[part.len()-1].is_ascii_alphanumeric()&&part.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'))
}
pub async fn bind(host:&str,port:u16)->io::Result<TcpListener>{
    if !valid_host(host){return Err(io::Error::new(io::ErrorKind::InvalidInput,"invalid bind host"));}
    tokio::time::timeout(Duration::from_secs(3),TcpListener::bind((bind_host(host),port))).await
        .unwrap_or_else(|_|Err(io::Error::new(io::ErrorKind::TimedOut,"bind resolution timed out")))
}
#[cfg(test)]mod tests{
 use super::*;use serde_json::Value;
 #[test]fn frontend_native_address_corpus_matches(){
  let corpus:Value=serde_json::from_str(include_str!("../../test-fixtures/addresses.json")).unwrap();
  for case in corpus.as_array().unwrap(){let host=case["host"].as_str().unwrap();assert_eq!(valid_host(host),case["valid"].as_bool().unwrap(),"{host}");if case["valid"]==true{assert_eq!(bind_host(host),case["bind"]);assert_eq!(client_host(host),case["client"]);assert_eq!(format!("ws://{}",authority(client_host(host),4455)),case["ws"]);}}
 }
 #[tokio::test]async fn loopback_bind_and_rebind_release_the_port(){let first=bind("127.0.0.1",0).await.unwrap();let port=first.local_addr().unwrap().port();drop(first);let second=bind("127.0.0.1",port).await.unwrap();assert_eq!(second.local_addr().unwrap().port(),port);}
}
