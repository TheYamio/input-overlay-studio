use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0},
        System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
    },
};

// The plugin creates its mutex before its IPC window. Serialize initialization
// through application setup so a simultaneous launch always finds that window.
// Tauri acquires and releases this guard on the main thread.
pub struct StartupLock(isize);

impl StartupLock {
    pub fn acquire(identifier: &str) -> Result<Self, String> {
        let name: Vec<u16> = format!("{identifier}-startup").encode_utf16().chain(Some(0)).collect();
        unsafe {
            let handle = CreateMutexW(None, false, PCWSTR(name.as_ptr())).map_err(|e| e.to_string())?;
            match WaitForSingleObject(handle, 15_000) {
                WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(Self(handle.0 as isize)),
                status => {
                    let _ = CloseHandle(handle);
                    Err(format!("startup lock unavailable: {status:?}"))
                }
            }
        }
    }
}

impl Drop for StartupLock {
    fn drop(&mut self) {
        unsafe {
            let handle = HANDLE(self.0 as *mut _);
            let _ = ReleaseMutex(handle);
            let _ = CloseHandle(handle);
        }
    }
}
