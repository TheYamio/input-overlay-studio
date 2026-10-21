#![cfg(windows)]

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::motion::Motion;
use std::thread;
use std::time::Duration;

use crate::ws_server::InputSender;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, SetThreadPriorityBoost, THREAD_PRIORITY_BELOW_NORMAL,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    LoadKeyboardLayoutW, MapVirtualKeyExW, MAPVK_VSC_TO_VK_EX,
};
use windows::Win32::UI::Input::{
    GetRawInputBuffer, RegisterRawInputDevices, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_DEVNOTIFY, RIDEV_REMOVE, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, PeekMessageW, HWND_MESSAGE, MSG, PM_REMOVE,
    WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT, WM_QUIT, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::ws_server::InputEvent;

const RI_KEY_BREAK: u16 = 0x01;
const RI_KEY_E0: u16 = 0x02;
const RI_KEY_E1: u16 = 0x04;

const RI_MOUSE_LEFT_BUTTON_DOWN: u16 = 0x0001;
const RI_MOUSE_LEFT_BUTTON_UP: u16 = 0x0002;
const RI_MOUSE_RIGHT_BUTTON_DOWN: u16 = 0x0004;
const RI_MOUSE_RIGHT_BUTTON_UP: u16 = 0x0008;
const RI_MOUSE_MIDDLE_BUTTON_DOWN: u16 = 0x0010;
const RI_MOUSE_MIDDLE_BUTTON_UP: u16 = 0x0020;
const RI_MOUSE_BUTTON_4_DOWN: u16 = 0x0040;
const RI_MOUSE_BUTTON_4_UP: u16 = 0x0080;
const RI_MOUSE_BUTTON_5_DOWN: u16 = 0x0100;
const RI_MOUSE_BUTTON_5_UP: u16 = 0x0200;
const RI_MOUSE_WHEEL: u16 = 0x0400;

const BTN_MAP: &[(u16, u16, u8)] = &[
    (RI_MOUSE_LEFT_BUTTON_DOWN, RI_MOUSE_LEFT_BUTTON_UP, 1),
    (RI_MOUSE_RIGHT_BUTTON_DOWN, RI_MOUSE_RIGHT_BUTTON_UP, 2),
    (RI_MOUSE_MIDDLE_BUTTON_DOWN, RI_MOUSE_MIDDLE_BUTTON_UP, 3),
    (RI_MOUSE_BUTTON_4_DOWN, RI_MOUSE_BUTTON_4_UP, 4),
    (RI_MOUSE_BUTTON_5_DOWN, RI_MOUSE_BUTTON_5_UP, 5),
];

pub struct RawInputThread {
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl RawInputThread {
    pub fn start(tx: InputSender, min_delta: i32) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop);
        let handle = thread::Builder::new()
            .name("RawInputBuffer".into())
            .spawn(move || run_raw_input(tx, min_delta, stop_clone))
            .expect("failed to spawn raw input thread");
        RawInputThread {
            stop,
            handle: Some(handle),
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }

    #[allow(dead_code)]
    pub fn is_alive(&self) -> bool {
        self.handle.as_ref().is_some_and(|h| !h.is_finished())
    }
}

impl Drop for RawInputThread {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run_raw_input(
    tx: InputSender,
    min_delta: i32,
    stop: Arc<AtomicBool>,
) {
    unsafe {
        set_background_priority();

        let hwnd = match create_message_window() {
            Some(h) => h,
            None => {
                tracing::error!("raw_input: failed to create message window");
                return;
            }
        };

        if !register_devices(hwnd) {
            tracing::error!("raw_input: RegisterRawInputDevices failed");
            let _ = DestroyWindow(hwnd);
            return;
        }

        tracing::info!("raw_input: started (min_delta={min_delta})");

        let us_layout = LoadKeyboardLayoutW(
            windows::core::w!("00000409"),
            windows::Win32::UI::Input::KeyboardAndMouse::ACTIVATE_KEYBOARD_LAYOUT_FLAGS(0),
        )
        .unwrap_or(windows::Win32::UI::Input::KeyboardAndMouse::HKL(std::ptr::null_mut()));

        let mut motion = Motion::default();
        // One reused, 8-byte-aligned 64 KiB buffer; no per-report allocation.
        let mut buffer = vec![0u64; 8192];

        let interval =
            Duration::from_micros(1_000_000 / crate::services::consts::RAW_MOUSE_FLUSH_HZ as u64);
        let mut msg = MSG::default();

        while !stop.load(Ordering::Relaxed) {
            thread::sleep(interval);
            drain_buffer(&tx, us_layout, min_delta, &mut motion, &mut buffer);
            let batch = motion.take();
            if batch.distance_counts > 0.0 {
                let _ = tx.send(InputEvent::MouseMove { dx: batch.dx, dy: batch.dy, distance_counts: Some(batch.distance_counts) });
            }

            while PeekMessageW(&mut msg, HWND::default(), 0, WM_INPUT - 1, PM_REMOVE).as_bool() {
                if msg.message == 0x00FE {
                    let _ = tx.send(InputEvent::Reset);
                }
                if msg.message == WM_QUIT {
                    unregister_devices();
                    let _ = DestroyWindow(hwnd);
                    tracing::info!("raw_input: stopped");
                    return;
                }
            }
        }
        unregister_devices();
        let _ = DestroyWindow(hwnd);
        let _ = tx.send(InputEvent::Reset);
        tracing::info!("raw_input: stopped");
    }
}

unsafe fn set_background_priority() {
    let h = GetCurrentThread();
    let _ = SetThreadPriority(h, THREAD_PRIORITY_BELOW_NORMAL);
    let _ = SetThreadPriorityBoost(h, BOOL(1));
}

unsafe fn create_message_window() -> Option<HWND> {
    let hinstance = GetModuleHandleW(PCWSTR::null()).ok()?;
    CreateWindowExW(
        WINDOW_EX_STYLE(WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0),
        windows::core::w!("STATIC"),
        PCWSTR::null(),
        WINDOW_STYLE(0),
        0,
        0,
        0,
        0,
        HWND_MESSAGE,
        None,
        hinstance,
        None,
    )
    .ok()
}

unsafe fn register_devices(hwnd: HWND) -> bool {
    let devices = [
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
            hwndTarget: hwnd,
        },
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
            hwndTarget: hwnd,
        },
    ];
    RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32).is_ok()
}

unsafe fn unregister_devices() {
    let devices = [
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        },
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        },
    ];
    let _ = RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32);
}

unsafe fn drain_buffer(
    tx: &InputSender,
    us_layout: windows::Win32::UI::Input::KeyboardAndMouse::HKL,
    min_delta: i32,
    motion: &mut Motion,
    buffer: &mut [u64],
) {
    for _ in 0..16 {
        let mut read_sz = std::mem::size_of_val(buffer) as u32;
        let count = GetRawInputBuffer(
            Some(buffer.as_mut_ptr() as *mut RAWINPUT),
            &mut read_sz,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        );
        if count == 0 || count == u32::MAX {
            break;
        }

        let ri_sz = std::mem::size_of::<RAWINPUT>();
        let mut offset = 0usize;
        for _ in 0..count {
            if offset + ri_sz > read_sz as usize {
                break;
            }
            let ri = &*((buffer.as_ptr() as *const u8).add(offset) as *const RAWINPUT);
            handle_rawinput(ri, tx, us_layout, min_delta, motion);
            let item_sz = ri.header.dwSize as usize;
            offset = (offset + item_sz + 7) & !7;
        }
    }
}

unsafe fn handle_rawinput(
    ri: &RAWINPUT,
    tx: &InputSender,
    us_layout: windows::Win32::UI::Input::KeyboardAndMouse::HKL,
    min_delta: i32,
    motion: &mut Motion,
) {
    if ri.header.dwType == RIM_TYPEKEYBOARD.0 {
        handle_keyboard(&ri.data.keyboard, tx, us_layout);
    } else if ri.header.dwType == RIM_TYPEMOUSE.0 {
        handle_mouse(&ri.data.mouse, tx, min_delta, motion);
    }
}

unsafe fn handle_keyboard(
    kb: &windows::Win32::UI::Input::RAWKEYBOARD,
    tx: &InputSender,
    us_layout: windows::Win32::UI::Input::KeyboardAndMouse::HKL,
) {
    if kb.VKey == 0xFF {
        return;
    }
    let is_release = (kb.Flags & RI_KEY_BREAK) != 0;
    let rawcode: u16 = if (kb.Flags & RI_KEY_E1) != 0 {
        kb.VKey
    } else {
        let ext_scan = kb.MakeCode
            | if (kb.Flags & RI_KEY_E0) != 0 {
                0xE000
            } else {
                0
            };
        let vk = MapVirtualKeyExW(ext_scan as u32, MAPVK_VSC_TO_VK_EX, us_layout);
        if vk != 0 {
            vk as u16
        } else {
            kb.VKey
        }
    };
    if rawcode == 0 {
        return;
    }
    let _ = tx.send(if is_release {
        InputEvent::KeyRelease { rawcode }
    } else {
        InputEvent::KeyPress { rawcode }
    });
}

unsafe fn handle_mouse(
    m: &windows::Win32::UI::Input::RAWMOUSE,
    tx: &InputSender,
    min_delta: i32,
    motion: &mut Motion,
) {
    if m.usFlags.0 & 0x0001 == 0 {
        motion.add(m.lLastX, m.lLastY, min_delta);
    }
    let flags = m.Anonymous.Anonymous.usButtonFlags;
    if flags != 0 {
        // Preserve cursor position ordering for click markers on the trail.
        let batch = motion.take();
        if batch.distance_counts > 0.0 {
            let _ = tx.send(InputEvent::MouseMove { dx: batch.dx, dy: batch.dy, distance_counts: Some(batch.distance_counts) });
        }
        for &(dn, up, btn) in BTN_MAP {
            if flags & dn != 0 {
                let _ = tx.send(InputEvent::MouseButton {
                    button: btn,
                    pressed: true,
                });
            }
            if flags & up != 0 {
                let _ = tx.send(InputEvent::MouseButton {
                    button: btn,
                    pressed: false,
                });
            }
        }
        if flags & RI_MOUSE_WHEEL != 0 {
            let raw = m.Anonymous.Anonymous.usButtonData as i16;
            let rot: i8 = if raw > 0 {
                -1
            } else if raw < 0 {
                1
            } else {
                0
            };
            if rot != 0 {
                let _ = tx.send(InputEvent::MouseScroll { rotation: rot });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extended_scan_codes_distinguish_left_and_right_modifiers() {
        unsafe {
            let layout = LoadKeyboardLayoutW(windows::core::w!("00000409"), windows::Win32::UI::Input::KeyboardAndMouse::ACTIVATE_KEYBOARD_LAYOUT_FLAGS(0)).unwrap();
            assert_eq!(MapVirtualKeyExW(0x1D, MAPVK_VSC_TO_VK_EX, layout), 162);
            assert_eq!(MapVirtualKeyExW(0xE01D, MAPVK_VSC_TO_VK_EX, layout), 163);
            assert_eq!(MapVirtualKeyExW(0x38, MAPVK_VSC_TO_VK_EX, layout), 164);
            assert_eq!(MapVirtualKeyExW(0xE038, MAPVK_VSC_TO_VK_EX, layout), 165);
        }
    }
}
