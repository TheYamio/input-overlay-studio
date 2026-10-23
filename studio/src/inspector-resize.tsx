import {tr} from './core/localization/messages.ts';
import { registerSettingsView } from './settings-views';
import { useEffect, useRef } from 'react';

function LegacyInspectorResize({ value, change, max = 560 }: { value: number; change: (value: number) => void; max?: number }) {
  const drag = useRef<{ x: number; value: number } | null>(null), latest = useRef({change,max}); latest.current = {change,max};
  const set = (next: number) => latest.current.change(Math.max(320,Math.min(latest.current.max,next)));
  const cancel = () => { const original = drag.current; drag.current = null; if (original) set(original.value); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('keydown',key,true); window.addEventListener('blur',cancel); window.addEventListener('resize',cancel);
    return () => { window.removeEventListener('keydown',key,true); window.removeEventListener('blur',cancel); window.removeEventListener('resize',cancel); };
  },[]);
  return <div className="inspector-resize" role="separator" tabIndex={0} aria-label={tr('ui:s-68527c7c101e',"Properties panel width")} aria-orientation="vertical" aria-valuemin={320} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)} pixels wide`}
    title={tr('ui:s-17b7545c84ac',"Drag to resize properties. Left/Right: 16 px; Shift: 32 px. Home/End: minimum/maximum. Double-click: reset. Escape: cancel.")}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({preventScroll:true}); event.currentTarget.setPointerCapture(event.pointerId); drag.current={x:event.clientX,value}; }}
    onPointerMove={event => { if (drag.current) set(drag.current.value+drag.current.x-event.clientX); }}
    onPointerUp={() => { drag.current=null; }} onPointerCancel={cancel} onLostPointerCapture={cancel} onDoubleClick={() => set(360)}
    onKeyDown={event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const step=event.shiftKey ? 32 : 16; set(event.key==='Home' ? 320 : event.key==='End' ? max : value+(event.key==='ArrowLeft' ? step : -step)); } }}><span/></div>;
}

export const InspectorResize=registerSettingsView('editor.inspector-width',LegacyInspectorResize);
