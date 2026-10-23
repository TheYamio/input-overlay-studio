import { describe, expect, it } from 'vitest';
import { defaultShortcuts, eventShortcut, parseShortcuts, shortcutCommand, shortcutConflicts, shortcutProblem } from './shortcuts';
const key = (code:string, extra = {}) => ({code,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...extra});
describe('editor shortcuts', () => {
  it('uses physical codes with Russian layout and accepts Command as Ctrl', () => {
    expect(shortcutCommand(key('KeyC',{ctrlKey:true,key:'с'}),defaultShortcuts())).toBe('copy');
    expect(shortcutCommand(key('KeyV',{metaKey:true,key:'м'}),defaultShortcuts())).toBe('paste');
    expect(eventShortcut(key('BracketLeft',{ctrlKey:true}))).toBe('Ctrl+BracketLeft');
  });
  it('matches modifiers exactly, including redo and plus key zoom', () => {
    expect(shortcutCommand(key('KeyZ',{ctrlKey:true,shiftKey:true}),defaultShortcuts())).toBe('redo');
    expect(shortcutCommand(key('KeyC',{ctrlKey:true,altKey:true}),defaultShortcuts())).toBeUndefined();
    expect(shortcutCommand(key('Equal',{ctrlKey:true,shiftKey:true}),defaultShortcuts())).toBe('zoomIn');
  });
  it('does not treat composition, AltGr and modifier-only presses as commands', () => {
    expect(eventShortcut(key('KeyC',{ctrlKey:true,isComposing:true}))).toBeNull();
    expect(eventShortcut(key('KeyC',{ctrlKey:true,altKey:true,getModifierState:()=>true}))).toBeNull();
    expect(eventShortcut(key('ControlLeft',{ctrlKey:true}))).toBeNull();
  });
  it('keeps Escape, arrows, focus and browser close/reload reserved', () => {
    for(const value of ['Escape','Enter','Tab','ArrowRight','Ctrl+ArrowRight','Ctrl+KeyW','Ctrl+KeyR','Alt+F4','F5']) expect(shortcutProblem(value)).toBeTruthy();
    for(const value of ['Ctrl+Alt+KeyC','F2','Delete','Ctrl+BracketLeft']) expect(shortcutProblem(value)).toBeNull();
  });
  it('loads explicit disabled bindings, drops conflicts and rejects malformed preferences', () => {
    const custom = defaultShortcuts(); custom.copy = ['Ctrl+Alt+KeyC']; custom.delete = []; custom.paste = [...custom.copy];
    const loaded = parseShortcuts(JSON.stringify(custom)); expect(loaded.copy).toEqual(custom.copy); expect(loaded.delete).toEqual([]); expect(loaded.paste).toEqual([]);
    expect(parseShortcuts('{bad')).toEqual(defaultShortcuts()); expect(parseShortcuts('{"copy":["Ctrl+KeyW"]}')).toEqual(defaultShortcuts());
  });
  it('identifies conflicts without changing either binding', () => {
    const bindings = defaultShortcuts(); expect(shortcutConflicts(bindings,'copy','Ctrl+KeyV').map(c=>c.id)).toEqual(['paste']); expect(bindings.paste).toEqual(['Ctrl+KeyV']);
  });
});
