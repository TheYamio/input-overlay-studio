export interface KeyBinding { code: number; label: string }
const named: Record<string, KeyBinding> = {
  Backspace: { code: 8, label: 'Backspace' }, Tab: { code: 9, label: 'Tab' }, Enter: { code: 13, label: 'Enter' }, NumpadEnter: { code: 13, label: 'Num Enter' },
  ShiftLeft: { code: 160, label: 'L Shift' }, ShiftRight: { code: 161, label: 'R Shift' }, ControlLeft: { code: 162, label: 'L Ctrl' }, ControlRight: { code: 163, label: 'R Ctrl' }, AltLeft: { code: 164, label: 'L Alt' }, AltRight: { code: 165, label: 'R Alt' },
  Pause: { code: 19, label: 'Pause' }, CapsLock: { code: 20, label: 'Caps Lock' }, Escape: { code: 27, label: 'Esc' }, Space: { code: 32, label: 'Space' },
  PageUp: { code: 33, label: 'Page Up' }, PageDown: { code: 34, label: 'Page Down' }, End: { code: 35, label: 'End' }, Home: { code: 36, label: 'Home' },
  ArrowLeft: { code: 37, label: '←' }, ArrowUp: { code: 38, label: '↑' }, ArrowRight: { code: 39, label: '→' }, ArrowDown: { code: 40, label: '↓' },
  PrintScreen: { code: 44, label: 'Print Screen' }, Insert: { code: 45, label: 'Insert' }, Delete: { code: 46, label: 'Delete' }, MetaLeft: { code: 91, label: 'L Win' }, MetaRight: { code: 92, label: 'R Win' }, ContextMenu: { code: 93, label: 'Menu' },
  NumpadMultiply: { code: 106, label: 'Num *' }, NumpadAdd: { code: 107, label: 'Num +' }, NumpadSubtract: { code: 109, label: 'Num −' }, NumpadDecimal: { code: 110, label: 'Num .' }, NumpadDivide: { code: 111, label: 'Num /' }, NumLock: { code: 144, label: 'Num Lock' }, ScrollLock: { code: 145, label: 'Scroll Lock' },
  Semicolon: { code: 186, label: ';' }, Equal: { code: 187, label: '=' }, Comma: { code: 188, label: ',' }, Minus: { code: 189, label: '−' }, Period: { code: 190, label: '.' }, Slash: { code: 191, label: '/' }, Backquote: { code: 192, label: '`' }, BracketLeft: { code: 219, label: '[' }, Backslash: { code: 220, label: '\\' }, BracketRight: { code: 221, label: ']' }, Quote: { code: 222, label: "'" }, IntlBackslash: { code: 226, label: '\\' },
};
export function bindingFromCode(code: string): KeyBinding | null {
  if (/^Key[A-Z]$/.test(code)) return { code: code.charCodeAt(3), label: code[3] };
  if (/^Digit\d$/.test(code)) return { code: code.charCodeAt(5), label: code[5] };
  if (/^Numpad\d$/.test(code)) return { code: 96 + Number(code[6]), label: `Num ${code[6]}` };
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return { code: 111 + Number(code.slice(1)), label: code };
  return named[code] || null;
}
export function bindingFromVK(code: number): KeyBinding | null {
  if (!Number.isInteger(code) || code < 1 || code > 255) return null;
  if (code >= 65 && code <= 90 || code >= 48 && code <= 57) return { code, label: String.fromCharCode(code) };
  if (code >= 96 && code <= 105) return { code, label: `Num ${code - 96}` };
  if (code >= 112 && code <= 135) return { code, label: `F${code - 111}` };
  return Object.values(named).find(v => v.code === code) || { code, label: `VK ${code}` };
}
