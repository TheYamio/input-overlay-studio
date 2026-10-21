import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Check, ChevronDown, ChevronRight, Copy, Download, Eye, EyeOff, FolderOpen, Grid2X2, Keyboard, Layers, LockKeyhole, Maximize, Monitor, Mouse, MoveUpRight, Plus, Radio, Redo2, RotateCcw, Save, Settings2, SlidersHorizontal, Sparkles, Square, Target, Trash2, Undo2, UnlockKeyhole, Upload, X, Zap } from 'lucide-react';
import { documentSchema, activeProfile, applyTheme, cm360, factoryModules, games, initialDocument, makeModule, parseDocument, themeColors, themeNames, uid, yaws, type OverlayModule, type Profile, type StudioDocument } from './core/config';
import { InputConnection, obsUrl, type ConnectionOptions, type ConnectionState } from './core/connection';
import { demo, InputEngine } from './core/input';
import { loadDocument, restoreBackup, saveDocument } from './core/storage';
import { Scene } from './renderer/scene';
import { alignModule, resetModulePosition, snapPosition, type Guide, type Alignment } from './core/layout';
import './style.css';
import { KeycapImagePanel, ModuleAppearance, MouseCustomization, TrailAppearance, VSelect } from './visual-controls';
import { capsFor, pruneAssets } from './core/skins';
import type { ImageAsset } from './core/visual';
import { importError, validateArtwork } from './core/artwork';
import { nativeOverlayBase, type HttpStatus } from './core/obs';
import { copyName, patchModule } from './core/editing';
import { exportPreset, importPreset } from './core/presets';
import { setModuleImage, linkArtwork } from './core/artwork-groups';
import { inputPreview, type PreviewState } from './core/preview';
import { PreviewControls } from './preview-controls';
import { SceneThumbnail } from './scene-thumbnail';
import { KeyLayout } from './key-layout';
import { NativeAdvanced, type NativeConfig } from './native-settings';
import { KeyCanvas } from './key-canvas';
import { StyleClipboard } from './style-tools';

declare global { interface Window { __TAURI__?: { core: { invoke<T>(name: string, args?: Record<string, unknown>): Promise<T> } } } }
const icons = { keyboard: Keyboard, mouse: Mouse, trail: Activity, distance: MoveUpRight, sensitivity: Target };
const names = { keyboard: 'Keyboard', mouse: 'Mouse Buttons', trail: 'Mouse Trail', distance: 'Distance', sensitivity: 'Sensitivity' };
const factoryPreviews = Object.fromEntries(themeNames.map(name => [name, factoryModules(name)]));
const subtitles = { keyboard: 'Every press, perfectly clear', mouse: 'Clicks, scroll & side buttons', trail: 'Make your movement visible', distance: 'Physical movement, in cm or m', sensitivity: 'Your setup at a glance' };

function NumberField({ label, value, onChange, min = 0, max = 1e9, step = 1, disabled = false }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text.replace(',', '.'));
  const valid = /^-?\d+(?:[.,]\d+)?$/.test(text) && Number.isFinite(n) && n >= min && n <= max;
  return <label className="number-field"><span>{label}</span><input aria-label={label} inputMode="decimal" disabled={disabled} value={text} aria-invalid={!valid} step={step} onChange={e => { const raw = e.target.value; setText(raw); const v = Number(raw.replace(',', '.')); if (/^-?\d+(?:[.,]\d+)?$/.test(raw) && Number.isFinite(v) && v >= min && v <= max) onChange(v); }} onBlur={() => { if (!valid) setText(String(value)); }}/></label>;
}
function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return <label className="field"><span>{label}</span><div className="select-wrap"><select aria-label={label} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o}>{o}</option>)}</select><ChevronDown size={13}/></div></label>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)}/><span className="toggle-track"/></label>; }
function IconButton({ title, children, onClick, disabled = false }: { title: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) { return <button className="icon-button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>; }

function Preview({ document: d, engine, selected, select, update, demoMode, snap, safe, background, zoom, setZoom, editingKeys, selectedKey, selectKey, previewState }: { previewState: PreviewState; editingKeys: boolean; selectedKey: string | null; selectKey: (id: string) => void; document: StudioDocument; engine: InputEngine; selected: string | null; select: (id: string | null) => void; update: (fn: (draft: StudioDocument) => void) => void; demoMode: boolean; snap: boolean; safe: boolean; background: boolean; zoom: number; setZoom: (n: number) => void }) {
  const root = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null);
  const [width, setWidth] = useState(800);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; x: number; y: number; w: number; h: number; resize: boolean } | null>(null);
  const p = activeProfile(d);
  const focused = editingKeys ? p.modules.find(m => m.id === selected && m.type === 'keyboard' && m.visible) : undefined;
  const renderedProfile = focused ? { ...p, modules: [focused] } : p;
  const painted = focused ? capsFor(focused) : null;
  const capScale = focused && painted ? Math.min(focused.w / painted.w, focused.h / painted.h) : 1;
  const frame = focused && painted ? { x: focused.x - 32, y: focused.y - 48, w: painted.w * capScale + 64, h: painted.h * capScale + 96 } : { x: 0, y: 0, w: 1920, h: 1080 };
  useEffect(() => {
    scene.current = new Scene(root.current!, engine);
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [engine]);
  useEffect(() => { scene.current?.update(d, renderedProfile, p.modules); }, [d, p, engine, focused]);
  useEffect(() => { const interactive = p.modules.some(m => m.id === selected && (m.type === 'keyboard' || m.type === 'mouse')); scene.current?.setPreview(interactive ? previewState : inputPreview(), selected || undefined); }, [previewState, selected, engine, p]);
  useEffect(() => { const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(viewport.current!); return () => observer.disconnect(); }, []);
  const scale = Math.max(.1, Math.min((width - 64) / frame.w, focused ? 320 / frame.h : Infinity)) * zoom;
  const begin = (e: React.PointerEvent, m: OverlayModule, resize = false) => {
    e.stopPropagation(); select(m.id);
    if (m.locked || !resize && editingKeys && m.type === 'keyboard' && selected === m.id) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: m.id, startX: e.clientX, startY: e.clientY, x: m.x, y: m.y, w: m.w, h: m.h, resize };
  };
  const move = (e: React.PointerEvent) => {
    const a = dragRef.current; if (!a || p.modules.find(m => m.id === a.id)?.locked) return;
    const dx = (e.clientX - a.startX) / scale, dy = (e.clientY - a.startY) / scale;
    const grid = (v: number) => snap ? Math.round(v / 8) * 8 : Math.round(v);
    const next = { id: a.id, x: a.resize ? a.x : Math.max(0, Math.min(1920 - a.w, grid(a.x + dx))), y: a.resize ? a.y : Math.max(0, Math.min(1080 - a.h, grid(a.y + dy))), w: a.resize ? Math.max(40, Math.min(1920 - a.x, grid(a.w + dx))) : a.w, h: a.resize ? Math.max(30, Math.min(1080 - a.y, grid(a.h + dy))) : a.h };
    if (snap && !a.resize) {
      const snapped = snapPosition(next, p.modules, 6 / scale);
      next.x = snapped.x; next.y = snapped.y; setGuides(snapped.guides);
    } else setGuides([]);
    setDrag(next);
    const node = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-module-id]') || []).find(node => node.dataset.moduleId === a.id);
    if (node) Object.assign(node.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.w}px`, height: `${next.h}px` });
  };
  const end = () => { if (drag) update(doc => { const m = activeProfile(doc).modules.find(v => v.id === drag.id); if (m) patchModule(m, { x: drag.x, y: drag.y, w: drag.w, h: drag.h }); }); dragRef.current = null; setDrag(null); setGuides([]); };
  return <div className="preview-viewport" ref={viewport}>
    <div className="canvas-info"><span className="canvas-live"><span className={demoMode ? 'dot amber' : 'dot'}/>{previewState.mode !== 'Input' && p.modules.some(m => m.id === selected && (m.type === 'keyboard' || m.type === 'mouse')) ? `${previewState.mode.toUpperCase()} · EDITOR PREVIEW` : demoMode ? 'DEMO PREVIEW' : 'LIVE PREVIEW'}</span><span>{focused ? `KEY LAYOUT · ${focused.name}` : <>1920 × 1080 <span className="dim">/</span> 16:9</>}</span></div>
    <div className="canvas-scroll" onWheel={e => { if (e.ctrlKey) { e.preventDefault(); setZoom(Math.max(.5, Math.min(2, zoom + (e.deltaY > 0 ? -.1 : .1)))); } }}>
      <div className={`canvas-shell ${background ? 'game-background' : 'checker'}`} style={{ width: frame.w * scale, height: frame.h * scale }} onPointerDown={() => select(null)}>
        {background && <div className="game-scene"><div className="map-lines"/><div className="crosshair">+</div><span>BACKGROUND PREVIEW</span></div>}
        <div className="scene-scale" style={{ transform: `scale(${scale})` }}><div className="canvas-origin" style={{ position: 'absolute', left: -frame.x, top: -frame.y, width: 1920, height: 1080 }}><div ref={root}/>
          {safe && <div className="safe-area"><span>OBS SAFE AREA · 90%</span></div>}
          {renderedProfile.modules.filter(m => m.visible).map(m => { const r = drag?.id === m.id ? drag : m; return <div key={m.id} role="button" tabIndex={0} aria-label={`Select ${m.name}`} className={`module-hitbox ${selected === m.id ? 'selected' : ''} ${m.locked ? 'locked' : ''} ${focused?.id === m.id ? 'key-editing' : ''}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: m.z + 1001 }} onKeyDown={e => { if (e.key === 'Enter') select(m.id); }} onPointerDown={e => begin(e, m)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { dragRef.current = null; setDrag(null); setGuides([]); scene.current?.update(d, renderedProfile, p.modules); }}>
            {selected === m.id && m.type === 'keyboard' && editingKeys && <KeyCanvas module={m} scale={scale} selected={m.keys.find(k => k.id === selectedKey)?.id || m.keys[0]?.id || null} select={selectKey} snap={snap} preview={(module, capScale) => {
              const bounds = module ? capsFor(module) : null;
              const draft = module && bounds && capScale ? { ...module, w: bounds.w * capScale, h: bounds.h * capScale } : module;
              scene.current?.update(d, draft ? { ...renderedProfile, modules: renderedProfile.modules.map(v => v.id === draft.id ? draft : v) } : renderedProfile, draft ? p.modules.map(v => v.id === draft.id ? draft : v) : p.modules);
            }} commit={(id, key) => update(doc => { const current = activeProfile(doc).modules.find(v => v.id === m.id); if (!current || current.locked || activeProfile(doc).id !== p.id) return; current.keys = current.keys.map(k => k.id === id ? { ...k, x: key.x, y: key.y, w: key.w, h: key.h } : k); current.layout = 'Custom'; })}/>}
            {selected === m.id && <><span className="selection-label">{m.name} <span>{Math.round(r.w)} × {Math.round(r.h)}</span></span><i className="corner tl"/><i className="corner tr"/><i className="corner bl"/><button aria-label={`Resize ${m.name}`} disabled={m.locked} className="resize-handle" onPointerDown={e => begin(e, m, true)} onPointerMove={move} onPointerUp={end}/></>}
          </div>; })}
          {guides.map((guide, i) => <div key={i} className={guide.axis === 'x' ? 'guide-x' : 'guide-y'} style={guide.axis === 'x' ? { left: guide.value } : { top: guide.value }}/>) }
        </div></div>
      </div>
    </div>
    <div className="canvas-bottom"><span><Mouse size={13}/>{focused ? <>Drag keys <i/> Arrows: 1 · Shift: 10</> : <>Drag to position <i/> Pull corner to resize</>}</span><div><button onClick={() => setZoom(Math.max(.5, zoom - .1))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(Math.min(2, zoom + .1))} aria-label="Zoom in">+</button><IconButton title="Fit canvas" onClick={() => setZoom(1)}><Maximize size={14}/></IconButton></div></div>
  </div>;
}

function ModuleProperties({ module: m, document: doc, upload, change, remove, duplicate, engine, resetDistance, bindingEngine, editingKeys, setEditingKeys, selectedKey, selectKey, assignKey, linkImage, previewState, previewChange }: { linkImage: (targetId: string, join: boolean) => void; previewState: PreviewState; previewChange: (state: PreviewState) => void; assignKey: (id: string, patch: { code: number; label?: string }) => void; bindingEngine: InputEngine; editingKeys: boolean; setEditingKeys: (v: boolean) => void; selectedKey: string | null; selectKey: (id: string) => void; document: StudioDocument; upload: (asset: ImageAsset) => void; module: OverlayModule; change: (patch: Partial<OverlayModule>) => void; remove: () => void; duplicate: () => void; engine: InputEngine; resetDistance: () => void }) {
  const Icon = icons[m.type];
  return <>
    <div className="properties-title"><div className="module-icon"><Icon size={18}/></div><div><h3>{m.name}</h3><span>MODULE PROPERTIES</span></div><IconButton title="Duplicate module" onClick={duplicate}><Copy size={15}/></IconButton></div>
    {m.type === 'keyboard' && <KeyLayout module={m} assignKey={assignKey} change={change} engine={bindingEngine} selected={selectedKey} select={selectKey} editing={editingKeys} setEditing={setEditingKeys}/>}
    <section className="property-section"><h4>TRANSFORM <Square size={12}/></h4><div className="field-grid"><NumberField disabled={m.locked} label="X" value={m.x} max={1920 - m.w} onChange={x => change({ x })}/><NumberField disabled={m.locked} label="Y" value={m.y} max={1080 - m.h} onChange={y => change({ y })}/><NumberField disabled={m.locked} label="Width" value={m.w} min={40} max={1920 - m.x} onChange={w => change({ w })}/><NumberField disabled={m.locked} label="Height" value={m.h} min={30} max={1080 - m.y} onChange={h => change({ h })}/></div><div className="field-grid"><NumberField label="Layer" value={m.z} max={1000} onChange={z => change({ z: Math.round(z) })}/><NumberField label="Radius" value={m.radius} max={100} onChange={radius => change({ radius })}/></div><div className="alignment-controls" role="group" aria-label="Align module to canvas">{([['left', 'Left'], ['center', 'Center X'], ['right', 'Right'], ['top', 'Top'], ['middle', 'Center Y'], ['bottom', 'Bottom']] as [Alignment, string][]).map(([value, label]) => <button key={value} className="secondary small" disabled={m.locked} onClick={() => change(alignModule(m, value))} aria-label={`Align ${label}`}>{label}</button>)}</div><button className="text-button" disabled={m.locked} onClick={() => change(resetModulePosition(m))}><RotateCcw size={12}/> Reset position</button><Toggle label="Lock position" value={m.locked} onChange={locked => change({ locked })}/><Toggle label="Visible in OBS" value={m.visible} onChange={visible => change({ visible })}/></section>
    <section className="property-section"><h4>APPEARANCE</h4><label className="field"><span>Module name</span><input value={m.name} maxLength={100} onChange={e => change({ name: e.target.value })}/></label><ModuleAppearance module={m} change={change}/><label className="range-field"><span>Module opacity <b>{Math.round(m.opacity * 100)}%</b></span><input aria-label="Opacity" type="range" min="0" max="1" step="0.01" value={m.opacity} onChange={e => change({ opacity: +e.target.value })}/></label></section>
    {(m.type === 'keyboard' || m.type === 'mouse') && <section className="property-section"><h4>KEY/BUTTON PREVIEW</h4><PreviewControls value={previewState} change={previewChange}/></section>}
    {(m.type === 'keyboard' || m.type === 'mouse') && <KeycapImagePanel document={doc} module={m} change={change} upload={upload} link={linkImage}/>}
    {m.type === 'trail' && <>
      <section className="property-section"><h4>TRAIL STYLE <Activity size={13}/></h4><Select label="Style" value={m.trailStyle} options={['Clean Line', 'Fade Trail', 'Neon Trail', 'Speed Gradient', 'Segmented Trail']} onChange={trailStyle => change({ trailStyle })}/><Select label="Positioning" value={m.position} options={['Fixed Field', 'Follow / Recenter']} onChange={position => change({ position })}/><div className="field-grid"><NumberField label="Thickness" value={m.thickness} min={.5} max={15} step={.5} onChange={thickness => change({ thickness })}/><NumberField label="Duration (ms)" value={m.duration} min={100} max={10000} onChange={duration => change({ duration })}/><NumberField label="Glow" value={m.glow} max={30} onChange={glow => change({ glow })}/><NumberField label="Motion scale" value={m.scale} min={.01} max={10} onChange={scale => change({ scale })}/></div><Select label="Scaling" value={m.scaleMode} options={['Manual Scale', 'DPI Normalized Scale']} onChange={scaleMode => change({ scaleMode })}/><p className="hint">Normalized scale uses your profile DPI. Game sensitivity does not affect the trail.</p></section>
      <section className="property-section"><h4>FIELD & MARKERS</h4><Toggle label="Show grid" value={m.grid} onChange={grid => change({ grid })}/><Toggle label="Center point" value={m.center} onChange={center => change({ center })}/><Select label="Cursor marker" value={m.marker} options={['Dot', 'Crosshair', 'None']} onChange={marker => change({ marker })}/><Select label="Click effects" value={m.clickEffects} options={['Off', 'Marker', 'Ripple']} onChange={clickEffects => change({ clickEffects })}/><div className="field-grid"><NumberField label="Origin X (0–1)" value={m.originX} max={1} onChange={originX => change({ originX })}/><NumberField label="Origin Y (0–1)" value={m.originY} max={1} onChange={originY => change({ originY })}/></div></section>
    </>}
    {m.type === 'trail' && <TrailAppearance module={m} change={change}/>}
    {m.type === 'mouse' && <section className="property-section"><h4>MOUSE BUTTONS</h4><Select label="Display" value={m.mouseMode} options={['Compact Buttons', 'Mouse Diagram']} onChange={mouseMode => { const h = mouseMode === 'Mouse Diagram' ? 300 : 110, w = mouseMode === 'Mouse Diagram' ? 220 : 300; change({ mouseMode, w, h, x: Math.min(m.x, 1920 - w), y: Math.min(m.y, 1080 - h) }); }}/>{m.buttonLabels.map((v, i) => <div className="button-config" key={i}><input type="checkbox" aria-label={`Show button ${i + 1}`} checked={m.buttons.includes(i + 1)} onChange={e => change({ buttons: e.target.checked ? [...m.buttons, i + 1].sort() : m.buttons.filter(b => b !== i + 1) })}/><input aria-label={`Button ${i + 1} label`} value={v} maxLength={100} onChange={e => change({ buttonLabels: m.buttonLabels.map((label, j) => i === j ? e.target.value : label) })}/><span>{i < 5 ? `M${i + 1}` : i === 5 ? 'UP' : 'DOWN'}</span></div>)}</section>}
    {m.type === 'mouse' && <MouseCustomization module={m} change={change}/>}
    {m.type === 'distance' && <section className="property-section"><h4>DISTANCE</h4><label className="field"><span>Caption</span><input value={m.caption} maxLength={100} onChange={e => change({ caption: e.target.value })}/></label><Select label="Units" value={m.unit} options={['Auto', 'cm', 'm']} onChange={unit => change({ unit })}/><NumberField label="Decimal places" value={m.decimals} max={3} onChange={decimals => change({ decimals: Math.round(decimals) })}/><button className="secondary" onClick={() => { engine.distanceCm = 0; resetDistance(); }}><RotateCcw size={14}/> Reset distance</button><p className="hint">Approximate physical distance calculated from raw counts and profile DPI.</p></section>}
    {m.type === 'sensitivity' && <section className="property-section"><h4>PROFILE DISPLAY</h4><VSelect label="Text layout" value={m.textLayout} options={['Horizontal', 'Vertical']} change={textLayout => change({ textLayout })}/><Select label="Format" value={m.sensitivityStyle} options={['Minimal', 'Standard', 'Detailed']} onChange={sensitivityStyle => change({ sensitivityStyle })}/>{(['showGame', 'showDpi', 'showSens', 'showEdpi', 'showCm'] as const).map((key, i) => (key === 'showCm' || m.sensitivityStyle === 'Detailed' || m.sensitivityStyle === 'Standard' && (key === 'showDpi' || key === 'showSens')) && <Toggle key={key} label={['Game', 'DPI', 'Sensitivity', 'eDPI', 'cm/360'][i]} value={m[key]} onChange={v => change({ [key]: v })}/>)}</section>}
    <section className="property-section"><button className="text-button danger" onClick={remove}><Trash2 size={14}/> Delete module</button></section>
  </>;
}

function ProfileEditor({ profile: p, change }: { profile: Profile; change: (patch: Partial<Profile>) => void }) {
  const cm = cm360(p);
  return <div className="profile-editor"><div className="section-heading"><span className="eyebrow">MOUSE & SENSITIVITY</span><h2>A setup that feels like you.</h2><p>Keep your game, mouse and overlay together in one profile.</p></div><div className="profile-form"><section><label className="field"><span>Profile name</span><input value={p.name} maxLength={100} onChange={e => { if (e.target.value.trim()) change({ name: e.target.value }); }}/></label><Select label="Game" value={p.game} options={games} onChange={game => change({ game, yaw: yaws[game] || p.yaw, scale: game === 'KovaaK’s' ? 'Unknown' : p.scale })}/><div className="field-grid"><NumberField label="Mouse DPI" value={p.dpi} min={.01} onChange={dpi => change({ dpi })}/><NumberField label="In-game sensitivity" value={p.sensitivity} min={.000001} onChange={sensitivity => change({ sensitivity })}/></div>{p.game === 'KovaaK’s' && <Select label="Sensitivity scale" value={p.scale} options={['Unknown', 'Source', 'Valorant', 'Overwatch', 'Custom yaw', 'Manual cm/360']} onChange={scale => change({ scale })}/>}<NumberField label="Yaw factor / m_yaw" value={p.yaw} min={.000001} onChange={yaw => change({ yaw, ...(p.game === 'KovaaK’s' ? { scale: 'Custom yaw' as const } : {}) })}/>{p.game === 'KovaaK’s' && p.scale === 'Manual cm/360' && <NumberField label="Manual cm/360" value={p.manualCm} min={.001} onChange={manualCm => change({ manualCm })}/>}<label className="field"><span>Profile caption</span><input maxLength={100} value={p.caption} onChange={e => change({ caption: e.target.value })}/></label></section><section className="calculation"><Target size={26}/><span>YOUR SENSITIVITY</span><strong>{cm === null ? '—' : cm.toFixed(2)}<small>cm / 360°</small></strong>{cm === null ? <p className="warning">Choose the actual KovaaK’s scale, enter a custom yaw, or supply cm/360. No scale is assumed.</p> : <p>A full turn, in physical mouse movement.</p>}<div className="calc-details"><div><span>eDPI</span><b>{(p.dpi * p.sensitivity).toFixed(1)}</b></div><div><span>Mouse DPI</span><b>{p.dpi}</b></div><div><span>In-game</span><b>{p.sensitivity}</b></div></div><p className="hint">Linear, unscoped horizontal rotation. Acceleration, zoom sensitivity and FOV-dependent scales are not modeled. eDPI is specific to each game scale.</p></section></div></div>;
}

function App() {
  const [loadedValue] = useState(loadDocument);
  const loaded = useRef(loadedValue);
  const [d, setD] = useState(loaded.current.document);
  const current = useRef(d); current.current = d;
  const [warning, setWarning] = useState(loaded.current.warning), [toast, setToast] = useState('');
  const [page, setPage] = useState('Studio'), [selected, setSelected] = useState<string | null>(() => activeProfile(d).modules.find(m => m.type === 'trail')?.id || null);
  const [previewState, setPreviewState] = useState(inputPreview);
  const [editingKeys, setEditingKeys] = useState(false), [selectedKey, selectKey] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false), [snap, setSnap] = useState(true), [safe, setSafe] = useState(false), [background, setBackground] = useState(false), [zoom, setZoom] = useState(1);
  const [options, setOptions] = useState<ConnectionOptions>(() => { try { const raw = JSON.parse(localStorage.getItem('studio.connection') || '{}'); return { url: typeof raw.url === 'string' ? raw.url : 'ws://127.0.0.1:4455', token: typeof raw.token === 'string' ? raw.token : '' }; } catch { return { url: 'ws://127.0.0.1:4455', token: '' }; } });
  const [connectionDraft, setConnectionDraft] = useState(options);
  useEffect(() => setConnectionDraft(options), [options]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('Offline');
  const [devices, setDevices] = useState<{ keyboard_count: number; mouse_count: number; capture_running: boolean } | null>(null);
  const [httpStatus, setHttpStatus] = useState<HttpStatus | null>(null);
  const [native, setNative] = useState<NativeConfig | null>(null), [saveStatus, setSaveStatus] = useState('Saved locally');
  const [liveEngine] = useState(() => new InputEngine()), [demoEngine] = useState(() => new InputEngine());
  const engine = demoMode ? demoEngine : liveEngine;
  const [connection] = useState(() => new InputConnection(liveEngine));
  const history = useRef<StudioDocument[]>([]), future = useRef<StudioDocument[]>([]);
  const gesture = useRef<{ target: HTMLInputElement | HTMLTextAreaElement; recorded: boolean } | null>(null);
  const editable = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement => target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button', 'submit'].includes(target.type);
  const beginGesture = (target: EventTarget | null, restart = false) => { if (editable(target) && (restart || gesture.current?.target !== target)) gesture.current = { target, recorded: false }; };
  const endGesture = () => { gesture.current = null; };
  useEffect(() => { const endRange = () => { if (gesture.current?.target.type === 'range') gesture.current = null; }; window.addEventListener('pointerup', endRange); window.addEventListener('blur', endGesture); return () => { window.removeEventListener('pointerup', endRange); window.removeEventListener('blur', endGesture); }; }, []);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [presetName, setPresetName] = useState('My custom layout');
  const file = useRef<HTMLInputElement>(null), presetFile = useRef<HTMLInputElement>(null);
  const p = activeProfile(d), selectedModule = p.modules.find(m => m.id === selected);
  const themedPreviews = useMemo(() => Object.fromEntries(themeNames.map(name => [name, applyTheme(p.modules, name)])), [p.modules]);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restoring = useRef(!!loaded.current.warning), initialized = useRef(false), pending = useRef((() => { if (loaded.current.warning) return false; try { return loaded.current.sync?.pending ?? (localStorage.getItem('studio.pending') === 'true'); } catch { return false; } })());
  const baseRevision = useRef<string | undefined>(loaded.current.sync?.endpoint === options.url ? loaded.current.sync.baseRevision : undefined);
  const [conflict, setConflict] = useState(false);
  const remote = useRef<{ document: StudioDocument | null; revision?: string } | null>(null);
  const endpoint = useRef(options.url); endpoint.current = options.url;
  const saveLocal = useCallback((doc: StudioDocument, dirty: boolean) => {
    saveDocument(doc, { pending: dirty, baseRevision: baseRevision.current, endpoint: endpoint.current });
    localStorage.removeItem('studio.pending');
  }, []);
  const sendPending = useCallback(() => {
    if (initialized.current && pending.current && !remote.current && connection.publish(current.current, baseRevision.current)) setSaveStatus('Saving…');
  }, [connection]);
  const serverBackup = useRef<StudioDocument | null>(null);
  const notify = useCallback((text: string) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4000); }, []);
  const persist = useCallback((doc: StudioDocument) => {
    if (restoring.current) return false;
    let savedLocally = true;
    pending.current = true;
    try { saveLocal(doc, true); setSaveStatus(remote.current ? 'Conflict · local draft kept' : 'Saved locally'); } catch { savedLocally = false; setSaveStatus('Local save failed'); setWarning('Storage is full or unavailable. Export your configuration to keep a copy.'); }
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(sendPending, 350);
    return savedLocally;
  }, [saveLocal, sendPending]);
  const update = useCallback((fn: (draft: StudioDocument) => void) => {
    const before = current.current, next = structuredClone(before); fn(next); pruneAssets(next);
    const validated = documentSchema.safeParse(next);
    if (!validated.success) { setWarning('This change exceeds configuration limits or contains invalid settings. Remove an unused image or export a separate preset.'); return; }
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    if (!gesture.current?.recorded) {
      history.current.push(before); if (history.current.length > 60) history.current.shift(); future.current = [];
      if (gesture.current) gesture.current.recorded = true;
    }
    current.current = validated.data; setD(validated.data); setHistoryVersion(v => v + 1); persist(validated.data);
  }, [persist]);
  const changeProfile = (patch: Partial<Profile>) => update(doc => Object.assign(activeProfile(doc), patch));
  const changeModule = (patch: Partial<OverlayModule>) => update(doc => { const m = activeProfile(doc).modules.find(v => v.id === selected); if (m) { patchModule(m, patch); if (patch.image) setModuleImage(activeProfile(doc).modules, m.id, m.image); } });
  const undo = useCallback(() => { gesture.current = null; const prev = history.current.pop(); if (prev) { future.current.push(current.current); current.current = prev; setD(prev); setHistoryVersion(v => v + 1); persist(prev); } }, [persist]);
  const redo = useCallback(() => { gesture.current = null; const next = future.current.pop(); if (next) { history.current.push(current.current); current.current = next; setD(next); setHistoryVersion(v => v + 1); persist(next); } }, [persist]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('dialog[open]')) return; if ((e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) { if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); } if (e.key.toLowerCase() === 's') { e.preventDefault(); persist(current.current); } } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, persist]);
  useEffect(() => { if (demoMode) { demoEngine.distanceCm = 0; return demo(demoEngine); } }, [demoMode, demoEngine]);
  useEffect(() => {
    if (!window.__TAURI__) return;
    const refresh = () => { void window.__TAURI__!.core.invoke<HttpStatus | null>('get_http_status').then(setHttpStatus).catch(() => setHttpStatus(null)); void window.__TAURI__!.core.invoke<{ keyboard_count: number; mouse_count: number; capture_running: boolean }>('get_device_status').then(setDevices).catch(() => setDevices(null)); };
    refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!window.__TAURI__) return;
    void window.__TAURI__.core.invoke<string | null>('get_startup_warning').then(message => { if (message) setWarning(message); });
    window.__TAURI__.core.invoke<NativeConfig>('get_config').then(cfg => { setNative(cfg); setOptions({ url: `ws://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`, token: cfg.auth_token }); }).catch(() => setWarning('Native server settings could not be loaded. Check the local server.'));
  }, []);
  useEffect(() => {
    initialized.current = false;
    connection.onStatus = status => { setConnectionState(status); if (status !== 'Connected') initialized.current = false; };
    connection.onError = message => { setSaveStatus('Save failed · draft kept'); setWarning(message); };
    const showConflict = (doc: StudioDocument | null, revision?: string) => {
      clearTimeout(syncTimer.current); initialized.current = true; remote.current = { document: doc, revision }; setConflict(true); setSaveStatus('Conflict · local draft kept');
    };
    connection.onConflict = showConflict;
    connection.onRecovery = (backup, revision) => {
      baseRevision.current = revision;
      restoring.current = true; initialized.current = true; serverBackup.current = backup;
      setWarning('The server configuration is damaged. The original file is preserved. Restore a backup or explicitly save your current defaults.');
    };
    connection.onSaved = (json, revision) => {
      baseRevision.current = revision;
      const same = json === JSON.stringify(current.current);
      if (!remote.current) pending.current = !same;
      try { saveLocal(current.current, pending.current); } catch { setWarning('Server saved the profile, but local storage is unavailable. Export a copy.'); }
      if (remote.current) return;
      setSaveStatus(same ? 'Synced to OBS' : 'Saved locally');
      if (!same) sendPending();
    };
    connection.onDocument = (doc, revision) => {
      initialized.current = true;
      const same = doc !== null && JSON.stringify(doc) === JSON.stringify(current.current);
      if (pending.current && !same) {
        if (!remote.current && (baseRevision.current === revision || doc === null && !baseRevision.current)) {
          baseRevision.current = revision; sendPending();
        } else showConflict(doc, revision);
        return;
      }
      baseRevision.current = revision;
      if (doc) {
        clearTimeout(syncTimer.current);
        if (!same) {
          history.current.push(current.current); if (history.current.length > 60) history.current.shift(); future.current = [];
          gesture.current = null; current.current = doc; setD(doc); setHistoryVersion(v => v + 1);
        }
        pending.current = false; remote.current = null; setConflict(false);
        if (!restoring.current) { try { saveLocal(doc, false); } catch { setWarning('Local storage is unavailable. Server settings remain available.'); } }
        setSaveStatus('Synced to OBS');
        if (connection.migrationRequired && !restoring.current) persist(doc);
      } else if (!restoring.current) { pending.current = true; persist(current.current); }
    };
    connection.connect(options);
    return () => connection.stop();
  }, [connection, options, persist, saveLocal, sendPending]);
  useEffect(() => {
    const startup = loaded.current.document;
    void validateArtwork(startup.assets).catch(error => {
      if (current.current !== startup) return;
      restoring.current = true; setWarning((error as Error).message);
    });
  }, []);
  useEffect(() => { liveEngine.dpi = p.dpi; demoEngine.dpi = p.dpi; }, [p.dpi, liveEngine, demoEngine]);
  useEffect(() => { const flush = sendPending; window.addEventListener('pagehide', flush); return () => { window.removeEventListener('pagehide', flush); clearTimeout(syncTimer.current); clearTimeout(toastTimer.current); }; }, [connection, sendPending]);
  const save = () => { restoring.current = false; setWarning(''); if (persist(d)) notify(remote.current ? 'Local draft saved. Resolve the conflict to publish it.' : 'Saved locally. Synchronizing with the server.'); };
  const copyOBS = async () => {
    if (connectionState !== 'Connected') { setWarning('Connect to the capture server in Settings before copying an OBS source.'); setPage('Settings'); return; }
    let base: string;
    try {
      if (window.__TAURI__) {
        const status = await window.__TAURI__.core.invoke<HttpStatus | null>('get_http_status'); setHttpStatus(status);
        base = nativeOverlayBase(status);
      } else {
        base = new URL('overlay.html', location.href).toString().split('#')[0];
        const response = await fetch(base, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
        if (!response.ok || !(await response.text()).includes('id="overlay"')) throw Error('The overlay page is unavailable. Check the HTTP server and its port before copying an OBS URL.');
      }
    } catch (error) { setWarning(error instanceof Error ? error.message : 'The overlay page is unavailable. Check the HTTP server.'); setPage('Settings'); return; }
    sendPending();
    try { await navigator.clipboard.writeText(obsUrl(options, base)); notify('OBS URL copied · Browser Source: 1920 × 1080'); }
    catch { setWarning('Clipboard access failed. Open Settings to select and copy the OBS URL manually.'); setPage('Settings'); }
  };
  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(d)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'input-overlay-studio.json'; a.click(); URL.revokeObjectURL(url); notify('Configuration exported without connection credentials');
  };
  const downloadPreset = (id: string) => {
    const url = URL.createObjectURL(new Blob([exportPreset(current.current, id)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'input-overlay-preset.json'; a.click(); URL.revokeObjectURL(url); notify('Preset exported with embedded images');
  };
  const readPreset = async (file: File) => { try { if (file.size > 2_000_000) throw Error(); const bundle = importPreset(await file.text()); await validateArtwork(bundle.assets); if (current.current.presets.length >= 50) throw Error(); update(doc => { Object.assign(doc.assets, bundle.assets); doc.presets.push(bundle.preset); }); } catch (error) { setWarning(importError(error, 'Preset import rejected. Choose a valid Input Overlay Studio preset smaller than 2 MB.')); } };
  const importConfig = async (f: File) => { try { if (f.size > 2_000_000) throw Error('File exceeds 2 MB.'); const doc = parseDocument(await f.text()); await validateArtwork(doc.assets); restoring.current = false; update(draft => Object.assign(draft, doc)); setWarning(''); notify('Configuration imported'); } catch (error) { setWarning(importError(error, 'Import rejected: invalid or unsupported configuration. Current settings are unchanged.')); } };
  const theme = (name: Profile['theme']) => update(doc => { const p = activeProfile(doc); p.theme = name; p.modules = applyTheme(p.modules, name); });
  const addModule = (type: OverlayModule['type']) => { if (p.modules.length >= 32) return; const m = makeModule(type, p.modules.length); update(doc => activeProfile(doc).modules.push(m)); setSelected(m.id); };
  const restore = () => { try { const backup = serverBackup.current || restoreBackup(); serverBackup.current = null; restoring.current = false; update(doc => Object.assign(doc, backup)); persist(backup); setWarning(''); notify('Backup restored'); } catch (e) { notify((e as Error).message); } };
  const saveNative = async () => { if (!native || !window.__TAURI__) return; try { await window.__TAURI__.core.invoke('save_config', { newCfg: native }); setOptions({ url: `ws://${native.host === '0.0.0.0' ? '127.0.0.1' : native.host}:${native.port}`, token: native.auth_token }); notify('Capture server settings saved'); } catch { setWarning('Server settings could not be saved. Check the application data folder permissions.'); } };
  let obsBase = new URL('overlay.html', location.href).toString().split('#')[0], httpMessage = '';
  if (window.__TAURI__) { try { obsBase = nativeOverlayBase(httpStatus); httpMessage = `HTTP server running · port ${httpStatus!.port}`; } catch (error) { obsBase = ''; httpMessage = (error as Error).message; } }

  return <div className="app-shell" data-history={historyVersion}
    onFocusCapture={e => beginGesture(e.target)} onInputCapture={e => beginGesture(e.target)}
    onBlurCapture={endGesture} onPointerCancelCapture={endGesture}
    onPointerDownCapture={e => { if (editable(e.target)) { if (e.target.type === 'range' || e.target.type === 'color') beginGesture(e.target, true); } else endGesture(); }}
    onKeyUpCapture={e => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') endGesture(); }}>
    <aside className="navigation"><div className="brand"><div className="brand-mark"><img src="./logo.svg" width="36" height="36" alt=""/></div><div>input<span>OVERLAY STUDIO</span></div></div><div className="nav-caption">WORKSPACE</div><nav>{[{ name: 'Studio', icon: SlidersHorizontal }, { name: 'Profiles', icon: FolderOpen }, { name: 'Presets', icon: Layers }, { name: 'Settings', icon: Settings2 }].map(({ name, icon: Icon }) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><Icon size={18}/>{name}{page === name && <span/>}</button>)}</nav><div className="nav-bottom"><div className="local-badge"><Monitor size={15}/><div>Made for your stream<span>LOCAL · PRIVATE · OFFLINE</span></div></div><div className="version">STUDIO <span>0.4.0</span></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13}/><b>{page}</b></div><div className="topbar-right"><span className={`connection-badge ${connectionState === 'Connected' ? 'connected' : ''}`}><span className="dot"/>{connectionState === 'Connected' ? 'Capture connected' : connectionState}</span><span className="divider"/><span className="platform"><Monitor size={14}/> Windows</span></div></header>
    <div className="workspace-heading"><div><div className="eyebrow">{page === 'Studio' ? 'YOUR INPUT. IN FOCUS.' : 'INPUT OVERLAY STUDIO'}</div><h1>{page === 'Studio' ? 'Studio' : page}<span className="beta-tag">LOCAL</span></h1><p>{page === 'Studio' ? 'Build an overlay that moves with you.' : page === 'Profiles' ? 'Your games. Your sensitivity. Your setup.' : page === 'Presets' ? 'A strong starting point. Make it your own.' : 'Fine-tune your connection and performance.'}</p></div><div className="heading-actions"><button className="secondary" onClick={save}><Save size={15}/> Save profile</button><button className="primary" onClick={copyOBS}><Copy size={15}/> Copy OBS URL <MoveUpRight size={14}/></button></div></div>
    {conflict && <div role="alert" className="warning-banner"><span>Another editor changed the server profile. Your local draft is kept. Choose which version to use.</span><button onClick={exportConfig}>Export local draft</button><button onClick={() => {
      const latest = remote.current; if (!latest) return;
      baseRevision.current = latest.revision; remote.current = null; setConflict(false); persist(current.current);
    }}>Publish local version</button><button disabled={!remote.current?.document} onClick={() => {
      const latest = remote.current; if (!latest?.document) return;
      history.current.push(current.current); if (history.current.length > 60) history.current.shift(); future.current = [];
      gesture.current = null; baseRevision.current = latest.revision; current.current = latest.document; setD(latest.document); pending.current = false;
      remote.current = null; setConflict(false); setHistoryVersion(v => v + 1);
      try { saveLocal(latest.document, false); setSaveStatus('Synced to OBS'); } catch { setSaveStatus('Local save failed'); setWarning('Could not save locally. Export a copy.'); }
    }}>Use server version</button></div>}
    {warning && <div role="alert" className="warning-banner"><span>{warning}</span>{restoring.current && <><button onClick={restore}>Restore backup</button><button onClick={save}>Save defaults</button></>}<IconButton title="Dismiss warning" onClick={() => setWarning('')}><X size={15}/></IconButton></div>}
    {page === 'Studio' && <div className="studio-workspace"><aside className="modules-panel"><div className="panel-title"><span>MODULES</span><span className="count">{p.modules.length.toString().padStart(2, '0')}</span></div><p className="panel-hint">The building blocks of your overlay.</p><div className="module-library">{(Object.keys(icons) as OverlayModule['type'][]).map(type => { const Icon = icons[type]; return <button key={type} onClick={() => addModule(type)} disabled={p.modules.length >= 32}><Icon size={19}/><div>{names[type]}<span>{subtitles[type]}</span></div><Plus size={14}/></button>; })}</div><div className="layer-heading"><span>YOUR LAYERS</span><Layers size={13}/></div><div className="layer-list">{[...p.modules].sort((a, b) => b.z - a.z).map(m => { const Icon = icons[m.type]; return <div key={m.id} className={`layer-row ${selected === m.id ? 'active' : ''}`}><button onClick={() => setSelected(m.id)}><Icon size={14}/><span>{m.name}</span></button><IconButton title={m.visible ? `Hide ${m.name}` : `Show ${m.name}`} onClick={() => update(doc => { const v = activeProfile(doc).modules.find(v => v.id === m.id)!; v.visible = !v.visible; })}>{m.visible ? <Eye size={13}/> : <EyeOff size={13}/>}</IconButton><IconButton title={m.locked ? `Unlock ${m.name}` : `Lock ${m.name}`} onClick={() => update(doc => { const v = activeProfile(doc).modules.find(v => v.id === m.id)!; v.locked = !v.locked; })}>{m.locked ? <LockKeyhole size={12}/> : <UnlockKeyhole size={12}/>}</IconButton></div>; })}</div><div className="module-tip"><Radio size={16}/><b>Ready for OBS</b><p>Your overlay runs independently. Close Studio and keep playing.</p></div></aside>
      <main className="canvas-panel"><div className="editor-toolbar"><label className="profile-select"><span className="profile-initial">{p.game === 'Counter-Strike 2' ? 'CS' : 'IN'}</span><select aria-label="Active profile" value={d.activeProfileId} onChange={e => update(doc => { doc.activeProfileId = e.target.value; })}>{d.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={13}/></label><div className="editor-tools"><div className="mode-switch"><button className={!demoMode ? 'active' : ''} onClick={() => setDemoMode(false)}><Radio size={12}/> Live</button><button className={demoMode ? 'active demo' : ''} onClick={() => setDemoMode(true)}><Sparkles size={12}/> Demo</button></div><span className="divider"/><IconButton title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.current.length}><Undo2 size={16}/></IconButton><IconButton title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.current.length}><Redo2 size={16}/></IconButton></div></div>
      <Preview document={d} engine={engine} selected={selected} select={setSelected} update={update} demoMode={demoMode} snap={snap} safe={safe} background={background} zoom={zoom} setZoom={setZoom} editingKeys={editingKeys} selectedKey={selectedKey} selectKey={selectKey} previewState={previewState}/>
      <div className="workspace-tools"><div><button className={snap ? 'enabled' : ''} onClick={() => setSnap(!snap)}><Grid2X2 size={14}/> Snap to grid</button><button className={safe ? 'enabled' : ''} onClick={() => setSafe(!safe)}><Square size={14}/> Safe area</button></div><button className={background ? 'enabled' : ''} onClick={() => setBackground(!background)}><Monitor size={14}/>{background ? 'Scene background' : 'Transparent'}</button></div>
      <div className="presets-heading"><div><span className="eyebrow">FIND YOUR LOOK</span><h3>Style your current layout</h3></div><button className="text-button" onClick={() => setPage('Presets')}>View all presets <MoveUpRight size={14}/></button></div><div className="theme-strip">{themeNames.slice(0, 5).map((name, i) => <button className={`theme-card ${p.theme === name ? 'active' : ''}`} key={name} onClick={() => theme(name)}><div className={`theme-sample theme-${i}`} style={{ '--theme-accent': themeColors[name] } as React.CSSProperties}><SceneThumbnail document={d} profile={p} modules={themedPreviews[name]}/>{p.theme === name && <span className="theme-check"><Check size={11}/></span>}</div><span>{name}<small>{`${i + 1}`.padStart(2, '0')}</small></span></button>)}</div></main>
      <aside className="properties-panel"><div className="panel-title"><span>PROPERTIES</span><SlidersHorizontal size={14}/></div>{selectedModule ? <ModuleProperties key={`${p.id}:${selectedModule.id}`} document={d} previewState={previewState} previewChange={setPreviewState} linkImage={(targetId, join) => update(doc => { const profile = activeProfile(doc); if (profile.id === p.id) linkArtwork(profile, selectedModule.id, targetId, join); })} assignKey={(id, patch) => update(doc => { const profile = activeProfile(doc); if (profile.id !== p.id) return; const target = profile.modules.find(m => m.id === selectedModule.id), key = target?.keys.find(k => k.id === id); if (key && target) { if (key.code !== patch.code) target.layout = 'Custom'; Object.assign(key, patch); } })} bindingEngine={liveEngine} editingKeys={editingKeys} setEditingKeys={setEditingKeys} selectedKey={selectedKey} selectKey={selectKey} upload={asset => update(doc => { const profile = activeProfile(doc); if (profile.id !== p.id) return; const m = profile.modules.find(v => v.id === selectedModule.id); if (!m) return; const existing = Object.entries(doc.assets).find(([, a]) => a.data === asset.data)?.[0]; const id = existing || uid(); doc.assets[id] = asset; setModuleImage(profile.modules, m.id, { ...m.image, enabled: true, assetId: id }); })} module={selectedModule} change={changeModule} engine={engine} resetDistance={() => { engine.setDistance(0); if (!demoMode) connection.resetDistance(); }} duplicate={() => { if (p.modules.length >= 32) return; const copy = structuredClone(selectedModule); copy.id = uid(); copy.x = Math.min(1920 - copy.w, copy.x + 24); copy.y = Math.min(1080 - copy.h, copy.y + 24); copy.z = Math.min(1000, Math.max(...p.modules.map(m => m.z)) + 1); copy.name = copyName(copy.name); update(doc => activeProfile(doc).modules.push(copy)); setSelected(copy.id); }} remove={() => { update(doc => { activeProfile(doc).modules = activeProfile(doc).modules.filter(m => m.id !== selected); }); setSelected(null); }}/>: <div className="empty-selection"><SlidersHorizontal size={28}/><h3>Make it yours</h3><p>Select a module on the canvas or add one from the library.</p></div>}</aside>
    </div>}
    {page === 'Profiles' && <div className="content-page profiles-page"><aside className="profile-list"><div className="panel-title"><span>GAME PROFILES</span><IconButton title="New profile" onClick={() => { const next = structuredClone(p); next.id = uid(); next.name = 'New profile'; update(doc => { doc.profiles.push(next); doc.activeProfileId = next.id; }); }} disabled={d.profiles.length >= 50}><Plus size={16}/></IconButton></div>{d.profiles.map(profile => <button className={profile.id === p.id ? 'active' : ''} key={profile.id} onClick={() => update(doc => { doc.activeProfileId = profile.id; })}><Target size={18}/><div>{profile.name}<span>{profile.game}</span></div><ChevronRight size={14}/></button>)}<button className="secondary small" onClick={() => { const next = structuredClone(p); next.id = uid(); next.name = copyName(next.name); update(doc => { doc.profiles.push(next); doc.activeProfileId = next.id; }); }} disabled={d.profiles.length >= 50}><Copy size={14}/> Duplicate profile</button><button className="text-button danger" disabled={d.profiles.length <= 1} onClick={() => update(doc => { doc.profiles = doc.profiles.filter(v => v.id !== p.id); doc.activeProfileId = doc.profiles[0].id; })}><Trash2 size={14}/> Delete profile</button></aside><ProfileEditor profile={p} change={changeProfile}/></div>}
    {page === 'Presets' && <div className="content-page presets-page"><div className="section-heading"><span className="eyebrow">BUILT TO BE PERSONAL</span><h2>One system. Seven distinct looks.</h2><p>Apply a visual theme to your layout, or restore a complete factory composition.</p></div><div className="preset-grid">{themeNames.map((name, i) => <article className={`preset-large ${p.theme === name ? 'active' : ''}`} key={name}><div className="preset-art" style={{ '--theme-accent': themeColors[name] } as React.CSSProperties}><span>0{i + 1}</span><SceneThumbnail document={d} profile={p} modules={factoryPreviews[name]}/></div><h3>{name}{p.theme === name && <Check size={15}/>}</h3><div className="preset-actions"><button className="secondary small" onClick={() => theme(name)}>Apply theme</button><button className="text-button" onClick={() => update(doc => { const p = activeProfile(doc); p.theme = name; p.modules = factoryModules(name); })}>Reset layout</button></div></article>)}</div><div className="saved-presets"><div className="section-heading"><h2>Your saved layouts</h2><input ref={presetFile} type="file" accept="application/json,.json" aria-label="Import preset file" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readPreset(f); }}/><button className="secondary small" onClick={() => presetFile.current?.click()}>Import preset</button><p>Factory themes stay available when you customize a copy.</p></div><div className="inline-form"><input aria-label="Preset name" value={presetName} maxLength={100} onChange={e => setPresetName(e.target.value)}/><button className="primary" disabled={!presetName.trim() || d.presets.length >= 50} onClick={() => { update(doc => doc.presets.push({ id: uid(), name: presetName.trim(), theme: p.theme, modules: structuredClone(p.modules) })); notify('Layout preset saved'); }}><Plus size={14}/> Save current layout</button></div>{d.presets.map(preset => <div className="saved-preset" key={preset.id}><div className="saved-preset-thumbnail"><SceneThumbnail document={d} profile={p} modules={preset.modules}/></div><input aria-label="Rename saved preset" value={preset.name} maxLength={100} onChange={e => { if (e.target.value.trim()) update(doc => { doc.presets.find(v => v.id === preset.id)!.name = e.target.value; }); }}/><span>{preset.modules.length} modules</span><button className="secondary small" onClick={() => changeProfile({ theme: preset.theme, modules: structuredClone(preset.modules) })}>Apply</button><button className="secondary small" onClick={() => downloadPreset(preset.id)}>Export preset</button><IconButton title="Duplicate preset" onClick={() => update(doc => { doc.presets.push({ ...structuredClone(preset), id: uid(), name: copyName(preset.name) }); })} disabled={d.presets.length >= 50}><Copy size={15}/></IconButton><IconButton title="Delete preset" onClick={() => update(doc => { doc.presets = doc.presets.filter(v => v.id !== preset.id); })}><Trash2 size={15}/></IconButton></div>)}</div></div>}
    {page === 'Settings' && <div className="content-page settings-page"><section><div className="section-heading"><span className="eyebrow">INPUT & CONNECTION</span><h2>A direct line to your devices.</h2><p>Studio connects to the local Input Overlay Studio capture server.</p></div><div className="settings-section"><h3><Radio size={18}/> WebSocket connection</h3><label className="field"><span>Server address</span><input aria-label="Server address" value={connectionDraft.url} onChange={e => setConnectionDraft({ ...connectionDraft, url: e.target.value })}/></label><label className="field"><span>Authentication token</span><input type="password" autoComplete="off" value={connectionDraft.token} onChange={e => setConnectionDraft({ ...connectionDraft, token: e.target.value })}/></label><button className="secondary" onClick={() => { try { localStorage.setItem('studio.connection', JSON.stringify(connectionDraft)); } catch { notify('Connection storage is unavailable'); } setOptions(connectionDraft); if (JSON.stringify(connectionDraft) === JSON.stringify(options)) connection.connect(connectionDraft); notify('Reconnecting to capture server'); }}><RotateCcw size={14}/> Save & reconnect</button><div className="device-status"><Keyboard size={17}/><div>Keyboard input<span>{devices ? `${devices.keyboard_count} keyboard devices available · capture ${devices.capture_running ? 'running' : 'stopped'}` : connectionState === 'Connected' ? 'Capture stream available · device presence unverified' : 'Waiting for authenticated capture'}</span></div></div><div className="device-status"><Mouse size={17}/><div>Mouse input<span>{devices ? `${devices.mouse_count} mouse devices available · capture ${devices.capture_running ? 'running' : 'stopped'}` : connectionState === 'Connected' ? 'Relative motion + buttons · device presence unverified' : 'Waiting for authenticated capture'}</span></div></div><button className="text-button" onClick={() => { if (connectionState === 'Paused') connection.connect(options); else { connection.stop(); setConnectionState('Paused'); } }}>{connectionState === 'Paused' ? 'Resume preview input' : 'Pause preview input'}</button><p className="hint">Pausing this preview does not stop other OBS clients. Use the native capture switch below to stop broadcasting globally.</p></div>
      {native && <div className="settings-section"><h3><Keyboard size={18}/> Native capture server</h3><Toggle label="Broadcast device input" value={native.capture_enabled} onChange={capture_enabled => setNative({ ...native, capture_enabled })}/><Toggle label="Local HTTP server" value={native.http_enabled} onChange={http_enabled => setNative({ ...native, http_enabled })}/><label className="field"><span>Bind host (loopback by default)</span><input value={native.host} onChange={e => setNative({ ...native, host: e.target.value })}/></label><div className="field-grid"><NumberField label="WebSocket port" value={native.port} min={1} max={65535} onChange={port => setNative({ ...native, port: Math.round(port) })}/><NumberField label="HTTP port" value={native.http_port} min={1} max={65535} onChange={http_port => setNative({ ...native, http_port: Math.round(http_port) })}/></div><Select label="Analog keyboard" value={native.analog_keyboard} options={['', 'auto', 'wooting', 'razer', 'nuphy', 'drunkdeer', 'keychron', 'madlions', 'bytech']} onChange={analog_keyboard => setNative({ ...native, analog_keyboard })}/><button className="secondary" onClick={() => { setNative({ ...native, key_whitelist: ['key_w', 'key_a', 'key_s', 'key_d', 'key_leftshift', 'key_rightshift', 'key_leftctrl', 'key_rightctrl', 'key_space', 'mouse_left', 'mouse_right', 'mouse_middle', 'mouse_4', 'mouse_5', 'mouse_wheel'] }); notify('FPS privacy filter selected. Apply server settings to activate it.'); }}>Use FPS privacy filter</button><button className="text-button" onClick={() => setNative({ ...native, key_whitelist: [] })}>Clear key filter</button><p className="hint">No keystroke logging or telemetry. Analog selection changes restart the existing HID reader.</p><NativeAdvanced config={native} change={setNative}/><button className="primary" onClick={saveNative}>Apply server settings</button></div>}
      <div className="settings-section"><h3><Monitor size={18}/> OBS Browser Source</h3>{httpMessage && <p role="status" className="hint">{httpMessage}</p>}<p className="hint">Add a Browser Source, paste this URL, and set width to 1920 and height to 1080. Keep the capture app running in the tray. The source has a transparent background.</p><input aria-label="OBS URL" type="password" readOnly value={obsBase ? obsUrl(options, obsBase) : ''} onFocus={e => e.currentTarget.select()}/><button className="secondary" onClick={copyOBS}><Copy size={14}/> Copy OBS URL</button><p className="hint">The URL includes your access token. Profile exports exclude it. Demo mode is exclusive to the Studio preview.</p></div></section>
      <section><div className="settings-section"><h3><Zap size={18}/> Rendering performance</h3><Select label="Animation FPS" value={d.performance.fps} options={['Auto', '30', '60', '120']} onChange={fps => update(doc => { doc.performance.fps = fps; })}/><Select label="Trail quality" value={d.performance.quality} options={['Low', 'Medium', 'High']} onChange={quality => update(doc => { doc.performance.quality = quality; })}/><Select label="Glow quality" value={d.performance.glowQuality} options={['Off', 'Low', 'High']} onChange={glowQuality => update(doc => { doc.performance.glowQuality = glowQuality; })}/><Toggle label="Reduced motion" value={d.performance.reducedMotion} onChange={reducedMotion => update(doc => { doc.performance.reducedMotion = reducedMotion; })}/><p className="hint">Actual refresh rate depends on OBS and your display. Input processing is independent of rendering FPS.</p></div><div className="settings-section"><h3><MoveUpRight size={18}/> Distance</h3><Toggle label="Keep total between launches" value={d.distance.persist} onChange={persist => update(doc => { doc.distance.persist = persist; })}/><Toggle label="Reset when capture app starts" value={d.distance.resetOnStart} onChange={resetOnStart => update(doc => { doc.distance.resetOnStart = resetOnStart; })}/><button className="secondary" onClick={() => { liveEngine.setDistance(0); connection.resetDistance(); notify('Distance reset'); }}><RotateCcw size={14}/> Reset total distance</button><p className="hint">Already accumulated centimeters remain unchanged when DPI changes.</p></div><div className="settings-section"><h3><FolderOpen size={18}/> Your configuration</h3><button className="secondary" onClick={exportConfig}><Download size={14}/> Export JSON</button><button className="secondary" onClick={() => file.current?.click()}><Upload size={14}/> Import JSON</button><button className="text-button" onClick={restore}>Restore last local backup</button><p className="hint">Versioned profiles, layouts, themes and performance settings. Connection credentials are stored separately.</p><button className="text-button danger" onClick={() => { restoring.current = false; update(doc => Object.assign(doc, initialDocument())); notify('Factory defaults restored. Undo is available.'); }}>Restore factory defaults</button></div><div className="about-block"><Activity size={22}/><h3>Input Overlay Studio</h3><p>Local input overlay editor.<br/>Free software · GPL-3.0</p><a href="https://github.com/TheYamio/input-overlay-studio" target="_blank" rel="noreferrer">Project on GitHub <MoveUpRight size={12}/></a></div></section></div>}
    <footer className="statusbar"><div><span className="dot"/>{demoMode && page === 'Studio' ? 'Demo input · preview only' : connectionState === 'Connected' ? 'Listening for device input' : 'Capture server is not connected'}<span className="divider"/><span>{p.game}</span></div><div><Check size={12}/>{saveStatus}<span className="divider"/><span>{d.performance.fps === 'Auto' ? 'AUTO' : `${d.performance.fps} FPS`} TARGET</span></div></footer>
    </div><input ref={file} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importConfig(f); e.target.value = ''; }}/>{toast && <div role="status" className="toast"><Check size={16}/>{toast}</div>}
  </div>;
}

if (new URLSearchParams(location.search).get('diagnostics') === '1') {
  void import('./diagnostics').then(({ startDiagnostics }) => startDiagnostics());
} else createRoot(document.getElementById('root')!).render(<StyleClipboard><App/></StyleClipboard>);
