import {tr,trText} from './core/localization/messages.ts';
import { registerSettingsView } from './settings-views';
import { useEffect, useRef, useState } from 'react';
import { commands, defaultShortcuts, displayShortcut, eventShortcut, shortcutProblem, type Command, type ShortcutMap } from './core/shortcuts';

type ShortcutMessage=string|{kind:'conflict';commands:Command[]}|{kind:'applied';id:Command;values:string[]};
function LegacyShortcutSettings({ bindings, change }: { bindings: ShortcutMap; change: (value: ShortcutMap) => void }) {
  const [search, setSearch] = useState(''), [recording, setRecording] = useState<{ id: Command; add: boolean } | null>(null), [message, setMessage] = useState<ShortcutMessage>('');
  const [pending, setPending] = useState<{ id: Command; values: string[] } | null>(null);
  const root = useRef<HTMLElement>(null), latest = useRef({bindings, change}); latest.current = { bindings, change };
  const apply = (id: Command, values: string[], replace = false) => {
    const current = latest.current.bindings;
    const conflicts = commands.filter(c => c.id !== id && current[c.id].some(b => values.includes(b)));
    if (conflicts.length && !replace) { setPending({id,values}); setRecording(null); setMessage({kind:'conflict',commands:conflicts.map(c=>c.id)}); return; }
    const next = { ...current, [id]: values }; if (replace) for (const c of conflicts) next[c.id] = next[c.id].filter(b => !values.includes(b));
    latest.current.change(next); setRecording(null); setPending(null); setMessage({kind:'applied',id,values});
  };
  useEffect(() => {
    if (!recording) return;
    const cancel = () => { setRecording(null); setMessage('Shortcut assignment cancelled.'); };
    const keydown = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation(); if (e.key === 'Escape') { cancel(); return; } if (e.repeat || e.isComposing) return;
      const value = eventShortcut(e); if (!value) return;
      const error = shortcutProblem(value); if (error) { setMessage(error); return; }
      const values = recording.add ? [...new Set([...latest.current.bindings[recording.id],value])] : [value];
      if (values.length > 3) { setMessage('Up to three shortcuts per command. Remove an existing binding first.'); return; }
      apply(recording.id, values);
    };
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !root.current?.contains(e.target)) cancel(); };
    const timer = setTimeout(cancel,20000);
    window.addEventListener('keydown',keydown,true); window.addEventListener('blur',cancel); window.addEventListener('pointerdown',outside,true);
    return () => { clearTimeout(timer); window.removeEventListener('keydown',keydown,true); window.removeEventListener('blur',cancel); window.removeEventListener('pointerdown',outside,true); };
  },[recording]);
  useEffect(() => {
    if (!pending) return;
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setPending(null); setMessage('Existing bindings kept.'); } };
    window.addEventListener('keydown',cancel,true); return () => window.removeEventListener('keydown',cancel,true);
  },[pending]);
  const messageText=typeof message==='string'?trText(message||'Click a combination to replace it, or Add to keep another binding. Escape cancels assignment.'):message.kind==='conflict'?tr('ui:shortcut-conflict','Already assigned to {{p0}}. Reassigning removes it from those commands.',{p0:message.commands.map(id=>trText(commands.find(c=>c.id===id)!.label)).join(', ')}):`${trText(commands.find(c=>c.id===message.id)!.label)}: ${message.values.map(displayShortcut).join(' / ')||trText('Off')}.`;
  return <section ref={root} id="keyboard-shortcuts" className="settings-section shortcut-settings" aria-label={tr('ui:s-e9bef0b0f3c2',"Keyboard shortcuts")} data-shortcut-capture={!!recording || !!pending}>
    <h3>{tr('ui:s-e9bef0b0f3c2',"Keyboard shortcuts")}</h3><p className="hint">{tr('ui:s-6d8f1381bf1b',"Commands affect the selection in Studio: a whole module, a key in key editing mode, or a mouse button in button editing mode. Text fields keep standard text shortcuts. Bindings use physical key positions and work with Russian and English layouts.")}</p>
    <label className="field"><span>{tr('ui:s-9752cb06c11b',"Find a command")}</span><input type="search" aria-label={tr('ui:s-a7cb2b4462d7',"Find a shortcut command")} value={search} onChange={e => setSearch(e.target.value)}/></label>
    {(['Editor','Objects','View'] as const).map(group => { const visible = commands.filter(c => c.group === group && `${trText(c.label)} ${trText(c.description)} ${c.label}`.toLowerCase().includes(search.toLowerCase())); return visible.length > 0 && <div key={group} className="shortcut-group"><h4>{trText(group)}</h4>{visible.map(c => <div className={`shortcut-row ${recording?.id === c.id ? 'recording' : ''}`} key={c.id}>
      <div><strong>{trText(c.label)}</strong><span>{trText(c.description)}</span></div><div className="shortcut-bindings"><button className="secondary" aria-label={tr('ui:s-5eb89a00d14a',"Change {{p0}} shortcut",{p0:trText(c.label)})} aria-pressed={recording?.id === c.id} onClick={() => { setPending(null); setMessage('Press a combination. Escape cancels.'); setRecording(v => v?.id === c.id ? null : {id:c.id,add:false}); }}>{recording?.id === c.id ? tr('ui:s-7f3420211df6',"Press keys…") : bindings[c.id].length ? bindings[c.id].map(displayShortcut).join(' / ') : tr('ui:s-13075c233611',"Not assigned")}</button>
      <button className="text-button" aria-label={tr('ui:s-1e8fb3ad60c4',"Add {{p0}} shortcut",{p0:trText(c.label)})} disabled={bindings[c.id].length >= 3} onClick={() => { setPending(null); setMessage('Press an additional combination. Escape cancels.'); setRecording({id:c.id,add:true}); }}>{tr('ui:s-9fd728c66c9a',"Add")}</button>
      <button className="text-button" aria-label={tr('ui:s-6360a8a5fa64',"Clear {{p0}} shortcuts",{p0:trText(c.label)})} disabled={!bindings[c.id].length} onClick={() => apply(c.id,[])}>{tr('ui:s-83b12c2216ef',"Clear")}</button><button className="text-button" aria-label={tr('ui:s-5c2934da0168',"Reset {{p0}} shortcuts",{p0:trText(c.label)})} onClick={() => apply(c.id,[...c.defaults])}>{tr('ui:s-daee7606b339',"Reset")}</button></div>
    </div>)}</div>; })}
    {pending && <div className="shortcut-conflict" role="alert"><p>{messageText}</p><button className="secondary" onClick={() => apply(pending.id,pending.values,true)}>{tr('ui:s-6e63b9a462b1',"Reassign shortcut")}</button><button className="text-button" onClick={() => { setPending(null); setMessage('Existing bindings kept.'); }}>{tr('ui:s-5d103b4f590a',"Keep existing bindings")}</button></div>}
    {!pending && <p className="hint shortcut-message" role="status">{messageText}</p>}
    <button className="secondary" onClick={() => { setRecording(null); setPending(null); change(defaultShortcuts()); setMessage('Default shortcuts restored.'); }}>{tr('ui:s-63b5f44c3eb7',"Restore default shortcuts")}</button>
    <p className="hint">{tr('ui:s-746ab5af1b28',"Canvas gestures: arrows move by 1 unit; Shift + arrows by 10. Escape cancels a gesture, leaves individual editing, then clears selection. Arrow keys, Escape, Enter and Tab are reserved for these controls. Preferences stay on this device; they do not change OBS input bindings.")}</p>
  </section>;
}

export const ShortcutSettings=registerSettingsView('editor.shortcuts',LegacyShortcutSettings);
