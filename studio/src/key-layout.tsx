import { Plus } from 'lucide-react';
import { layoutKeys, uid, type OverlayModule } from './core/config';
import type { InputEngine } from './core/input';
import { copyName } from './core/editing';
import { resolvedStyle } from './core/skins';
import { StyleFields, VNumber, VSelect } from './visual-controls';
import { KeyRecorder } from './key-binding';
import { ElementStyleTools } from './style-tools';

export function KeyLayout({ module: m, change, engine, selected, select, editing, setEditing, assignKey }: { assignKey: (id: string, patch: { code: number; label?: string }) => void; module: OverlayModule; change: (patch: Partial<OverlayModule>) => void; engine: InputEngine; selected: string | null; select: (id: string) => void; editing: boolean; setEditing: (v: boolean) => void }) {
  const index = Math.max(0, m.keys.findIndex(k => k.id === selected)), k = m.keys[index];
  const keyChange = (patch: Partial<typeof k>) => change({ keys: m.keys.map(v => v.id === k.id ? { ...v, ...patch } : v), ...((['x', 'y', 'w', 'h', 'code'] as const).some(prop => patch[prop] !== undefined && patch[prop] !== k[prop]) ? { layout: 'Custom' as const } : {}) });
  return <details className="property-section key-layout-panel" open><summary>KEY LAYOUT</summary>
    <button className={`secondary key-edit-toggle ${editing ? 'active' : ''}`} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? 'Finish editing keys on canvas' : 'Edit keys on canvas'}</button>
    <p className="hint">Select and drag a key; pull its corner to resize. Arrow keys move by 1, Shift by 10. Esc cancels a drag. The layout fits the module after release.</p>
    <VSelect label="Layout" value={m.layout} options={['WASD', 'WASD + modifiers', 'FPS Extended', 'Custom']} change={layout => change({ layout, ...(layout === 'Custom' ? {} : { keys: layoutKeys(layout) }) })}/>
    <VNumber label="Key gap" value={m.gap} max={30} change={gap => change({ gap })}/>
    <label className="field"><span>Edit key</span><select aria-label="Edit key" value={index} onChange={e => select(m.keys[+e.target.value].id)}>{m.keys.map((v, i) => <option key={v.id} value={i}>{v.label} · VK {v.code}</option>)}</select></label>
    {k && <div key={k.id} className="selected-key-properties">
      <label className="field"><span>Key label</span><input aria-label="Key label" value={k.label} maxLength={100} onChange={e => keyChange({ label: e.target.value })}/></label>
      <KeyRecorder engine={engine} assign={key => assignKey(k.id, key)}/>
      <details className="visual-details"><summary>Advanced key code · VK {k.code}</summary><VNumber label="Virtual key code" value={k.code} min={1} max={255} change={code => keyChange({ code: Math.round(code) })}/></details>
      <div className="field-grid"><VNumber label="Key X" value={k.x} disabled={m.locked} change={x => keyChange({ x })}/><VNumber label="Key Y" value={k.y} disabled={m.locked} change={y => keyChange({ y })}/><VNumber label="Key width" value={k.w} min={1} disabled={m.locked} change={w => keyChange({ w })}/><VNumber label="Key height" value={k.h} min={1} disabled={m.locked} change={h => keyChange({ h })}/></div>
      <label className="visual-check"><input type="checkbox" checked={k.imageEnabled !== false} onChange={e => keyChange({ imageEnabled: e.target.checked })}/>Include this key in image</label>
      <ElementStyleTools module={m} override={k.style} change={style => keyChange({ style })} applyAll={style => change({ keys: m.keys.map(key => ({ ...key, style: structuredClone(style) })) })}/>
      <label className="visual-check"><input type="checkbox" checked={!!k.style} onChange={e => keyChange({ style: e.target.checked ? {} : undefined })}/>Customize this key</label>
      {k.style && <StyleFields prefix="Key " overrides={k.style} reset={field => { const style = { ...k.style }; delete style[field]; keyChange({ style }); }} value={resolvedStyle(m, k.style)} change={patch => keyChange({ style: { ...k.style, ...patch } })}/>}
      <div className="style-actions"><button className="secondary small" disabled={m.keys.length >= 100} onClick={() => { const copy = { ...structuredClone(k), id: uid(), label: copyName(k.label), x: Math.min(1000, k.x + k.w + 8) }; change({ keys: [...m.keys, copy], layout: 'Custom' }); select(copy.id); }}>Duplicate key</button><button className="text-button danger" onClick={() => change({ keys: m.keys.filter(v => v.id !== k.id), layout: 'Custom' })}>Remove this key</button></div>
    </div>}
    <button className="secondary small" onClick={() => { const key = { id: uid(), code: 70, label: 'F', x: 186, y: 124, w: 54, h: 54 }; change({ keys: [...m.keys, key], layout: 'Custom' }); select(key.id); }} disabled={m.keys.length >= 100}><Plus size={13}/> Add key</button>
    <p className="hint">Positions use local layout units. A locked module keeps key geometry fixed. Gap changes cap surfaces around their anchors.</p>
  </details>;
}
