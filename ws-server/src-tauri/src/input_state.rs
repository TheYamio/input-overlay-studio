use serde::Serialize;
use crate::ws_server::InputEvent;

#[derive(Clone, Debug, Serialize)]
pub struct HeldKey { pub rawcode: u16, pub depth: f32 }
#[derive(Clone, Debug, Serialize)]
pub struct InputSnapshot {
    #[serde(rename = "type")]
    pub message_type: &'static str,
    pub sequence: u64,
    pub keys: Vec<HeldKey>,
    pub buttons: Vec<u8>,
}
pub struct HeldState {
    keys: [f32; 256],
    analog: [bool; 256],
    buttons: [bool; 6],
}
impl Default for HeldState {
    fn default() -> Self { Self { keys: [0.0; 256], analog: [false; 256], buttons: [false; 6] } }
}
impl HeldState {
    pub fn apply(&mut self, event: &InputEvent) {
        match event {
            InputEvent::KeyPress { rawcode } if *rawcode < 256 => self.keys[*rawcode as usize] = 1.0,
            InputEvent::KeyRelease { rawcode } if *rawcode < 256 => self.keys[*rawcode as usize] = 0.0,
            InputEvent::AnalogDepth { rawcode, depth } if *rawcode < 256 => {
                self.keys[*rawcode as usize] = depth.clamp(0.0, 1.0); self.analog[*rawcode as usize] = true;
            }
            InputEvent::MouseButton { button, pressed } if *button < 6 => self.buttons[*button as usize] = *pressed,
            InputEvent::Reset => *self = Self::default(),
            _ => {}
        }
    }
    pub fn reconcile(&mut self, mut key_down: impl FnMut(u16) -> bool, mut button_down: impl FnMut(u8) -> bool) {
        for code in 1..256 {
            // Shallow analog presses may precede the OS digital actuation point.
            if !self.analog[code] || self.keys[code] <= 0.0 { self.keys[code] = if key_down(code as u16) { 1.0 } else { 0.0 }; }
        }
        for button in 1..6 { self.buttons[button] = button_down(button as u8); }
    }
    pub fn snapshot(&self, sequence: u64, mut allowed: impl FnMut(&InputEvent) -> bool) -> InputSnapshot {
        let keys = self.keys.iter().enumerate().filter(|(code, depth)| **depth > 0.0 && allowed(&InputEvent::KeyPress { rawcode: *code as u16 }))
            .map(|(code, depth)| HeldKey { rawcode: code as u16, depth: *depth }).collect();
        let buttons = (1u8..6).filter(|button| self.buttons[*button as usize] && allowed(&InputEvent::MouseButton { button: *button, pressed: true })).collect();
        InputSnapshot { message_type: "input_snapshot", sequence, keys, buttons }
    }
}

#[cfg(windows)]
pub fn reconcile_windows(state: &mut HeldState) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetKeyboardLayout, LoadKeyboardLayoutW, MapVirtualKeyExW, MAPVK_VK_TO_VSC_EX, MAPVK_VSC_TO_VK_EX, ACTIVATE_KEYBOARD_LAYOUT_FLAGS};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let us = LoadKeyboardLayoutW(windows::core::w!("00000409"), ACTIVATE_KEYBOARD_LAYOUT_FLAGS(0)).unwrap_or_default();
        let foreground = GetKeyboardLayout(GetWindowThreadProcessId(GetForegroundWindow(), None));
        state.reconcile(|code| {
            if crate::services::consts::vk_to_key_name(code).is_none() { return false; }
            let scan = MapVirtualKeyExW(code as u32, MAPVK_VK_TO_VSC_EX, us);
            let mapped = if scan == 0 || code == 19 { 0 } else { MapVirtualKeyExW(scan, MAPVK_VSC_TO_VK_EX, foreground) };
            let vk = if mapped == 0 { code as i32 } else { mapped as i32 };
            GetAsyncKeyState(vk) as u16 & 0x8000 != 0
        }, |button| {
            let vk = [0, 1, 2, 4, 5, 6][button as usize];
            GetAsyncKeyState(vk) as u16 & 0x8000 != 0
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_restores_digital_mouse_and_shallow_analog_without_replaying_clicks() {
        let mut state = HeldState::default();
        state.apply(&InputEvent::AnalogDepth { rawcode: 87, depth: 0.3 });
        state.reconcile(|code| code == 160, |button| button == 2);
        let snapshot = state.snapshot(12, |_| true);
        assert_eq!(snapshot.keys.len(), 2); assert_eq!(snapshot.buttons, vec![2]);
        assert_eq!(snapshot.keys.iter().find(|k| k.rawcode == 87).unwrap().depth, 0.3);
        assert_eq!(snapshot.sequence, 12);
    }
    #[test]
    fn reconciliation_releases_keys_that_changed_while_disconnected() {
        let mut state = HeldState::default(); state.apply(&InputEvent::KeyPress { rawcode: 87 });
        state.reconcile(|_| false, |_| false); assert!(state.snapshot(2, |_| true).keys.is_empty());
    }
    #[test]
    fn snapshots_obey_privacy_filters_and_reset() {
        let mut state = HeldState::default(); state.reconcile(|_| true, |_| true);
        let snapshot = state.snapshot(4, |e| matches!(e, InputEvent::KeyPress { rawcode: 87 }));
        assert_eq!(snapshot.keys.len(), 1); assert!(snapshot.buttons.is_empty());
        state.apply(&InputEvent::Reset); assert!(state.snapshot(5, |_| true).keys.is_empty());
    }
}
