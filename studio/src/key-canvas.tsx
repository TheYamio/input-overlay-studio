import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import type { Key, OverlayModule } from './core/config';
import { capsFor } from './core/skins';

interface Gesture { key: Key; module: OverlayModule; mode: 'move' | 'resize' | 'keyboard'; clientX: number; clientY: number; capScale: number; draft: Key }
export function KeyCanvas({ module: m, scale, selected, select, preview, commit, snap }: { module: OverlayModule; scale: number; selected: string | null; select: (id: string) => void; preview: (module: OverlayModule | null, capScale?: number) => void; commit: (id: string, key: Key) => void; snap: boolean }) {
  const gesture = useRef<Gesture | null>(null), callbacks = useRef({ preview, commit }); callbacks.current = { preview, commit };
  const [draft, setDraft] = useState<Key | null>(null);
  const cancel = () => { gesture.current = null; setDraft(null); callbacks.current.preview(null); };
  const finish = () => { const g = gesture.current; if (!g) return; gesture.current = null; setDraft(null); callbacks.current.preview(null); if ((['x', 'y', 'w', 'h'] as const).some(prop => g.key[prop] !== g.draft[prop])) callbacks.current.commit(g.key.id, g.draft); };
  useEffect(() => { if (gesture.current) cancel(); }, [m, scale]);
  useEffect(() => {
    const keydown = (e: globalThis.KeyboardEvent) => { if ((e.key === 'Escape' || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') && gesture.current) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const keyup = (e: globalThis.KeyboardEvent) => { if (e.key.startsWith('Arrow') && gesture.current?.mode === 'keyboard') finish(); };
    const blur = () => { if (gesture.current) cancel(); };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur); window.addEventListener('resize', blur);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); if (gesture.current) callbacks.current.preview(null); };
  }, []);
  const bounds = capsFor(m), fit = gesture.current?.capScale ?? Math.min(m.w / bounds.w, m.h / bounds.h);
  const show = (key: Key) => { const g = gesture.current!; g.draft = key; setDraft(key); callbacks.current.preview({ ...g.module, keys: g.module.keys.map(k => k.id === key.id ? key : k) }, g.capScale); };
  const begin = (e: PointerEvent, key: Key, resize = false) => {
    e.stopPropagation(); e.preventDefault(); select(key.id); if (m.locked || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { key, module: m, mode: resize ? 'resize' : 'move', clientX: e.clientX, clientY: e.clientY, capScale: fit, draft: key };
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
  };
  const move = (e: PointerEvent) => {
    e.stopPropagation(); const g = gesture.current; if (!g || g.mode === 'keyboard') return;
    const dx = (e.clientX - g.clientX) / (scale * g.capScale), dy = (e.clientY - g.clientY) / (scale * g.capScale);
    const position = (n: number, min = 0) => Math.max(min, Math.min(1000, snap && !e.altKey ? Math.round(n / 8) * 8 : Math.round(n)));
    show(g.mode === 'resize' ? { ...g.key, w: position(g.key.w + dx, 1), h: position(g.key.h + dy, 1) } : { ...g.key, x: position(g.key.x + dx), y: position(g.key.y + dy) });
  };
  const keyboard = (e: KeyboardEvent, key: Key) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(key.id); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); select(key.id); if (m.locked) return;
    if (!gesture.current) gesture.current = { key, module: m, mode: 'keyboard', clientX: 0, clientY: 0, capScale: fit, draft: key };
    const g = gesture.current, step = e.shiftKey ? 10 : 1;
    show({ ...g.draft, x: Math.max(0, Math.min(1000, g.draft.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0))), y: Math.max(0, Math.min(1000, g.draft.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0))) });
  };
  return <div className="key-canvas-handles" style={{ width: m.w, height: m.h }}>
    {m.keys.map(key => {
      const k = draft?.id === key.id ? draft : key, active = (selected || m.keys[0]?.id) === key.id;
      return <div key={k.id} className={`key-hitbox ${active ? 'selected' : ''}`} data-key-id={k.id} style={{ left: k.x * fit, top: k.y * fit, width: Math.max(10, k.w + 8 - m.gap) * fit, height: Math.max(10, k.h + 8 - m.gap) * fit }}>
        <button aria-label={`Edit key ${key.label}`} aria-pressed={active} className="key-select-handle" onPointerDown={e => begin(e, key)} onPointerMove={move} onPointerUp={e => { e.stopPropagation(); finish(); }} onPointerCancel={cancel} onKeyDown={e => keyboard(e, key)}/>
        {active && <button aria-label={`Resize key ${key.label}`} disabled={m.locked} className="key-resize-handle" onPointerDown={e => begin(e, key, true)} onPointerMove={move} onPointerUp={e => { e.stopPropagation(); finish(); }} onPointerCancel={cancel}/>}
      </div>;
    })}
  </div>;
}
