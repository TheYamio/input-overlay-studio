pub fn validated_url(value:&str)->Result<tauri::Url,String>{
 let url=tauri::Url::parse(value).map_err(|_|"Invalid external URL")?;
 let host=url.host_str().unwrap_or("");
 if value.len()>2048||value.chars().any(|c|c.is_control()||c.is_whitespace())||url.scheme()!="https"||!url.username().is_empty()||url.password().is_some()||url.port().is_some()||!host.contains('.')||host.ends_with('.')||host=="localhost"||host.ends_with(".localhost")||host.ends_with(".local")||host.ends_with(".internal")||host.parse::<std::net::IpAddr>().is_ok(){return Err("Invalid external URL".into());}
 Ok(url)
}
#[tauri::command]
pub fn open_external_link(url:String)->Result<(),String>{
 let url=validated_url(&url)?.to_string();
 #[cfg(windows)]{
  use std::os::windows::ffi::OsStrExt;
  use windows::{core::PCWSTR,Win32::UI::{Shell::ShellExecuteW,WindowsAndMessaging::SW_SHOWNORMAL}};
  let wide:Vec<u16>=std::ffi::OsStr::new(&url).encode_wide().chain(Some(0)).collect();let verb:Vec<u16>="open".encode_utf16().chain(Some(0)).collect();
  let result=unsafe{ShellExecuteW(None,PCWSTR(verb.as_ptr()),PCWSTR(wide.as_ptr()),None,None,SW_SHOWNORMAL)};
  if result.0 as isize<=32{return Err("Could not open external browser".into());}
 }
 #[cfg(not(windows))]{let mut child=std::process::Command::new(if cfg!(target_os="macos"){ "open" }else{ "xdg-open" }).arg(url).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().map_err(|_|"Could not open external browser")?;std::thread::spawn(move||{let _=child.wait();});}
 Ok(())
}
#[cfg(test)]mod tests{use super::*;#[test]fn permits_public_https_links_only(){for url in ["https://github.com/TheYamio/input-overlay-studio","https://ko-fi.com/example"]{assert!(validated_url(url).is_ok());}for url in ["javascript:alert(1)","file:///C:/test","http://example.com","https://user:secret@example.com","https://127.0.0.1/pay","https://[::1]/","https://localhost/pay","https://thing.local/pay","https://example.com:444/pay","https://example.com/\n"]{assert!(validated_url(url).is_err(),"{url}");}}}
