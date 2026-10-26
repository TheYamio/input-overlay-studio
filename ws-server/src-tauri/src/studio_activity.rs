//! Local, aggregate Studio eligibility. Never contains addresses, tokens or input events.
use std::{path::PathBuf, sync::{Mutex, atomic::{AtomicU32, Ordering}}, time::{SystemTime, UNIX_EPOCH}};
use serde::{Serialize, Deserialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Usage { version:u8, first_launched_at:u64, overlay_connections:u32, last_counted_at:u64 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ActivityContext { first_launched_at:u64, overlay_connections:u32, runtimes_active:u32, obs_running:Option<bool>, storage_available:bool }
pub struct StudioActivity { path:PathBuf, usage:Mutex<Option<Usage>>, active:AtomicU32 }
pub fn now()->u64 {SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64}
impl StudioActivity {
 pub fn new(path:PathBuf)->Self {
  let usage=match std::fs::read(&path) {
   Ok(bytes)=>serde_json::from_slice::<Usage>(&bytes).ok().filter(|v|v.version==1&&v.first_launched_at>0&&v.overlay_connections<=3),
   Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{let v=Usage{version:1,first_launched_at:now(),overlay_connections:0,last_counted_at:0};if persist(&path,&v).is_ok(){Some(v)}else{None}},
   Err(_)=>None,
  };
  Self{path,usage:Mutex::new(usage),active:AtomicU32::new(0)}
 }
 pub fn connected(&self){self.active.fetch_add(1,Ordering::Relaxed);}
 pub fn disconnected(&self){let previous=self.active.fetch_sub(1,Ordering::Relaxed);debug_assert!(previous>0);}
 pub fn ready(&self,at:u64){
  let mut guard=self.usage.lock().unwrap();let Some(current)=guard.as_ref() else{return;};
  // Reloads/reconnect storms are one use, not three. Keep only a bounded aggregate.
  if current.overlay_connections>=3||at<current.first_launched_at||current.last_counted_at>0&&at<current.last_counted_at.saturating_add(30*60*1000){return;}
  let mut next=current.clone();next.overlay_connections+=1;next.last_counted_at=at;
  if persist(&self.path,&next).is_ok(){*guard=Some(next);}
 }
 pub fn context(&self)->ActivityContext {
  let guard=self.usage.lock().unwrap();ActivityContext{first_launched_at:guard.as_ref().map_or(0,|v|v.first_launched_at),overlay_connections:guard.as_ref().map_or(0,|v|v.overlay_connections),runtimes_active:self.active.load(Ordering::Relaxed),obs_running:obs_running(),storage_available:guard.is_some()}
 }
}
fn persist(path:&std::path::Path,value:&Usage)->std::io::Result<()> {
 let temp=path.with_extension("tmp");std::fs::write(&temp,serde_json::to_vec(value)?)?;
 // The count is advisory, so preserve the previous record if replacement fails.
 #[cfg(windows)] {
  use std::os::windows::ffi::OsStrExt;
  use windows::Win32::Storage::FileSystem::{MoveFileExW,MOVEFILE_REPLACE_EXISTING,MOVEFILE_WRITE_THROUGH};
  let from:Vec<u16>=temp.as_os_str().encode_wide().chain(Some(0)).collect();let to:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
  unsafe{MoveFileExW(windows::core::PCWSTR(from.as_ptr()),windows::core::PCWSTR(to.as_ptr()),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH).map_err(std::io::Error::other)?;}
 }
 #[cfg(not(windows))] std::fs::rename(temp,path)?;
 Ok(())
}
fn obs_name(name:&str)->bool {matches!(name.to_ascii_lowercase().as_str(),"obs64.exe"|"obs32.exe"|"obs.exe"|"obs"|"obs-studio")}
#[cfg(windows)]
fn obs_running()->Option<bool>{
 use windows::Win32::{Foundation::CloseHandle,System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot,Process32FirstW,Process32NextW,PROCESSENTRY32W,TH32CS_SNAPPROCESS}};
 unsafe{let snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0).ok()?;let mut entry=PROCESSENTRY32W{dwSize:std::mem::size_of::<PROCESSENTRY32W>() as u32,..Default::default()};
  if Process32FirstW(snapshot,&mut entry).is_err(){let _=CloseHandle(snapshot);return None;}
  loop{let end=entry.szExeFile.iter().position(|v|*v==0).unwrap_or(entry.szExeFile.len());if obs_name(&String::from_utf16_lossy(&entry.szExeFile[..end])){let _=CloseHandle(snapshot);return Some(true);}if let Err(error)=Process32NextW(snapshot,&mut entry){let _=CloseHandle(snapshot);return if error.code()==windows::core::HRESULT::from_win32(18){Some(false)}else{None};}}
 }
}
#[cfg(target_os="linux")]
fn obs_running()->Option<bool>{
 let entries=std::fs::read_dir("/proc").ok()?;
 for entry in entries.flatten(){if !entry.file_name().to_string_lossy().chars().all(|c|c.is_ascii_digit()){continue;}match std::fs::read_to_string(entry.path().join("comm")){Ok(name) if obs_name(name.trim())=>return Some(true),Err(e) if e.kind()!=std::io::ErrorKind::NotFound=>return None,_=>{}}}
 Some(false)
}
#[cfg(not(any(windows,target_os="linux")))]fn obs_running()->Option<bool>{None}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn only_separate_successful_uses_count_and_survive_restart(){let dir=std::env::temp_dir().join(format!("ios-activity-{}-{}",std::process::id(),now()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("usage.json");let tracker=StudioActivity::new(path.clone());let at=tracker.context().first_launched_at;tracker.connected();assert_eq!(tracker.context().runtimes_active,1);tracker.ready(at);tracker.ready(at+1000);assert_eq!(tracker.context().overlay_connections,1);tracker.disconnected();assert_eq!(tracker.context().runtimes_active,0);tracker.ready(at+1800000);tracker.ready(at+3600000);tracker.ready(at+5400000);assert_eq!(StudioActivity::new(path).context().overlay_connections,3);std::fs::remove_dir_all(dir).unwrap();}
 #[test]fn unknown_or_invalid_records_are_retained_and_disable_prompt(){let dir=std::env::temp_dir().join(format!("ios-activity-invalid-{}-{}",std::process::id(),now()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("usage.json");let raw=b"{\"version\":99,\"future\":true}";std::fs::write(&path,raw).unwrap();let tracker=StudioActivity::new(path.clone());tracker.ready(now());assert!(!tracker.context().storage_available);assert_eq!(std::fs::read(path).unwrap(),raw);std::fs::remove_dir_all(dir).unwrap();}
 #[test]fn process_detection_matches_only_obs_names(){assert!(obs_name("OBS64.EXE"));assert!(!obs_name("obs-browser-page.exe"));assert!(!obs_name("not-obs.exe"));}
}
