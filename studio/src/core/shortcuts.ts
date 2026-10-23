export const commands = [
  { id: 'undo', label: 'Undo', group: 'Editor', description: 'Undo the last edit', defaults: ['Ctrl+KeyZ'] },
  { id: 'redo', label: 'Redo', group: 'Editor', description: 'Restore the last undone edit', defaults: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'] },
  { id: 'save', label: 'Save profile', group: 'Editor', description: 'Save locally and synchronize with the capture server', defaults: ['Ctrl+KeyS'] },
  { id: 'copy', label: 'Copy selection', group: 'Objects', description: 'Copy the selected module, key or mouse button', defaults: ['Ctrl+KeyC'] },
  { id: 'cut', label: 'Cut selection', group: 'Objects', description: 'Copy and remove the selection; locked objects are protected', defaults: ['Ctrl+KeyX'] },
  { id: 'paste', label: 'Paste selection', group: 'Objects', description: 'Paste a module or key; paste a mouse button onto the selected button', defaults: ['Ctrl+KeyV'] },
  { id: 'duplicate', label: 'Duplicate selection', group: 'Objects', description: 'Create an independent copy with a new identity', defaults: ['Ctrl+KeyD'] },
  { id: 'delete', label: 'Delete selection', group: 'Objects', description: 'Remove a module or key; hide a physical mouse button', defaults: ['Delete', 'Backspace'] },
  { id: 'editKeys', label: 'Edit keys or mouse buttons', group: 'Objects', description: 'Switch between a whole block and its individual keys or mouse buttons', defaults: ['Ctrl+KeyE'] },
  { id: 'grid', label: 'Toggle snapping', group: 'View', description: 'Enable or disable snapping to the canvas grid', defaults: ['Ctrl+Shift+KeyG'] },
  { id: 'inspector', label: 'Toggle properties', group: 'View', description: 'Show or hide the properties panel', defaults: ['Ctrl+Shift+KeyI'] },
  { id: 'layers', label: 'Toggle layers', group: 'View', description: 'Show or hide the layer list', defaults: ['Ctrl+Shift+KeyL'] },
  { id: 'fit', label: 'Fit canvas', group: 'View', description: 'Show the entire 1920 × 1080 scene', defaults: ['Shift+Digit1'] },
  { id: 'actual', label: 'Actual size', group: 'View', description: 'Show the scene at 100%', defaults: ['Shift+Digit0'] },
  { id: 'zoomIn', label: 'Zoom in', group: 'View', description: 'Increase the scene zoom', defaults: ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd'] },
  { id: 'zoomOut', label: 'Zoom out', group: 'View', description: 'Decrease the scene zoom', defaults: ['Ctrl+Minus', 'Ctrl+NumpadSubtract'] },
] as const;
export type Command = typeof commands[number]['id'];
export type ShortcutMap = Record<Command, string[]>;
export const defaultShortcuts = (): ShortcutMap => Object.fromEntries(commands.map(c => [c.id, [...c.defaults]])) as ShortcutMap;
export const shortcutStorageKey = 'studio.shortcuts.v1';
interface KeyEvent { code: string; key?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; getModifierState?: (key: string) => boolean }
export function eventShortcut(e: KeyEvent): string | null {
  if (e.isComposing || e.key==='Process' || e.key==='Dead' || e.getModifierState?.('AltGraph') || /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code)) return null;
  if (!e.code) return null;
  return `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;
}
export function shortcutProblem(value: string): string | null {
  const parts = value.split('+'), code = parts.pop() || '', mods = parts.join('+');
  if (!/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1\d|2[0-4])|Numpad\w+|Delete|Backspace|Equal|Minus|BracketLeft|BracketRight|Backquote|Backslash|Semicolon|Quote|Comma|Period|Slash|Insert|Home|End|PageUp|PageDown)$/.test(code) || !/^(Ctrl\+)?(Alt\+)?(Shift\+)?$/.test(mods ? mods + '+' : '')) return 'This key is reserved for text, focus navigation or canvas gestures. Choose another combination.';
  if (['F5','F6','F10','F11','F12'].includes(code) || parts.includes('Alt') && ['F4','Home','ArrowLeft','ArrowRight'].includes(code) || parts.includes('Ctrl') && !parts.includes('Alt') && ['KeyW','KeyT','KeyN','KeyL','KeyR','KeyO','KeyP','KeyQ','Tab'].includes(code)) return 'This combination is reserved by the browser or operating system. Choose another combination.';
  return null;
}
export function displayShortcut(value: string) { return value.replace(/Key([A-Z])$/, '$1').replace(/Digit([0-9])$/, '$1').replace('Equal', '=').replace('Minus', '−').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Backquote', '`').replace('Backslash', '\\').replace('Semicolon', ';').replace('Quote', "'").replace('Comma', ',').replace('Period', '.').replace('Slash', '/'); }
export function shortcutConflicts(bindings: ShortcutMap, command: Command, binding: string) { return commands.filter(c => c.id !== command && bindings[c.id].includes(binding)); }
export function parseShortcuts(raw: string | null): ShortcutMap {
  const result = defaultShortcuts(); if (!raw) return result;
  try {
    const saved: unknown = JSON.parse(raw); if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
    for (const c of commands) { const values = (saved as Record<string, unknown>)[c.id]; if (Array.isArray(values) && values.length <= 3 && values.every(v => typeof v === 'string' && !shortcutProblem(v))) result[c.id] = [...new Set(values)] as string[]; }
    const used = new Set<string>(); for (const c of commands) result[c.id] = result[c.id].filter(v => { if (used.has(v)) return false; used.add(v); return true; });
  } catch { /* Invalid optional preferences fall back to defaults. */ }
  return result;
}
export function shortcutCommand(e: KeyEvent, bindings: ShortcutMap): Command | undefined { const value = eventShortcut(e); return value ? commands.find(c => bindings[c.id].includes(value))?.id : undefined; }
export function shortcutTargetBlocked(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],[role=slider],[role=separator],dialog[open],[data-shortcut-capture=true],.key-recorder.waiting');
}

let captureUntil = 0;
export function suppressEditorShortcuts() { captureUntil = Date.now() + 250; }
export function editorShortcutsSuppressed() { return Date.now() < captureUntil; }
