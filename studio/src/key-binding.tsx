import {tr,trText} from './core/localization/messages.ts';
import { registerSettingsView } from './settings-views';
import { useEffect, useRef, useState } from 'react';
import { suppressEditorShortcuts } from './core/shortcuts';
import { bindingFromCode, bindingFromVK, type KeyBinding } from './core/key-binding';
import type { InputEngine, InputEvent } from './core/input';

function LegacyKeyRecorder({ engine, assign }: { engine: InputEngine; assign: (key: { code: number; label?: string }) => void }) {
  const [waiting, setWaiting] = useState(false), [message, setMessage] = useState(''), [rename, setRename] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ assign, rename }); latest.current = { assign, rename };
  useEffect(() => {
    if (!waiting) return;
    let active = true;
    const finish = (key: KeyBinding | null, reason = 'Key assignment cancelled.') => {
      if (!active) return; active = false; suppressEditorShortcuts(); setWaiting(false);
      if (!key || key.code === 27) setMessage(reason);
      else { latest.current.assign({ code: key.code, ...(latest.current.rename ? { label: key.label } : {}) }); setMessage(tr('ui:key-assigned','Assigned {{p0}} · VK {{p1}}',{p0:key.label,p1:key.code})); }
    };
    const keyboard = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { finish(null); return; }
      if (e.repeat || e.isComposing || e.key==='Process' || e.key==='Dead') return;
      const key = bindingFromCode(e.code);
      if (key) finish(key); else setMessage('This key is not recognized. Try another key or enter its Windows VK code.');
    };
    const native = (e: InputEvent) => { if (document.visibilityState === 'visible' && e.event_type === 'key_pressed') finish(bindingFromVK(e.rawcode)); };
    const cancel = () => finish(null);
    const outside = (e: globalThis.PointerEvent) => { if (e.target instanceof Node && !root.current?.contains(e.target)) cancel(); };
    const timer = setTimeout(() => finish(null, 'No key received. Click Assign by pressing a key to try again.'), 15000);
    window.addEventListener('keydown', keyboard, true); window.addEventListener('blur', cancel); window.addEventListener('pointerdown', outside, true); engine.listeners.add(native);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('keydown', keyboard, true); window.removeEventListener('blur', cancel); window.removeEventListener('pointerdown', outside, true); engine.listeners.delete(native); };
  }, [waiting, engine]);
  return <div ref={root} className={`key-recorder ${waiting ? 'waiting' : ''}`}>
    <button className="secondary small" aria-pressed={waiting} onClick={() => { setMessage(''); setWaiting(v => !v); }}>{waiting ? tr('ui:s-9635b465a8ed',"Cancel key assignment") : tr('ui:s-37586f88f5b7',"Assign by pressing a key")}</button>
    <label className="visual-check"><input type="checkbox" checked={rename} onChange={e => setRename(e.target.checked)}/>{tr('ui:s-6152112a4cef',"Update label when assigning")}</label>
    <p className="hint" role="status">{waiting ? tr('ui:s-e993150a5318',"Press one key. Esc cancels. Left and right modifiers are separate.") : trText(message || 'Captures a physical key and updates its label. Esc can be assigned using advanced VK.')}</p>
  </div>;
}

export const KeyRecorder=registerSettingsView('editor.key-recorder',LegacyKeyRecorder);
