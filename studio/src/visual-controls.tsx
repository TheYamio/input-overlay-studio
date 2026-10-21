import { useEffect, useRef, useState } from 'react';
import { activeProfile, type OverlayModule, type StudioDocument } from './core/config';
import { capsFor, readImageAsset, resolvedStyle } from './core/skins';
import { defaultImageSettings, effects, fonts, type ElementStyle, type ImageAsset, type ImageSettings } from './core/visual';
import { Scene } from './renderer/scene';
import { InputEngine } from './core/input';

export function VNumber({ label, value, min = 0, max = 1000, step = 1, change }: { label: string; value: number; min?: number; max?: number; step?: number; change: (n: number) => void }) {
  const [text, setText] = useState(String(value)); useEffect(() => setText(String(value)), [value]);
  return <label className="field"><span>{label}</span><input aria-label={label} value={text} inputMode="decimal" onChange={e => { const s = e.target.value; setText(s); const n = Number(s.replace(',', '.')); if (/^-?\d+(?:[.,]\d+)?$/.test(s) && Number.isFinite(n) && n >= min && n <= max) change(n); }} onBlur={() => setText(String(value))} step={step}/></label>;
}
export function VSelect<T extends string>({ label, value, options, change }: { label: string; value: T; options: readonly T[]; change: (s: T) => void }) {
  return <label className="field"><span>{label}</span><select aria-label={label} value={value} onChange={e => change(e.target.value as T)}>{options.map(v => <option key={v}>{v}</option>)}</select></label>;
}
export function VRange({ label, value, min = 0, max = 1, step = .01, change }: { label: string; value: number; min?: number; max?: number; step?: number; change: (n: number) => void }) {
  return <label className="range-field"><span>{label}<b>{Number(value.toFixed(2))}</b></span><input type="range" aria-label={label} value={value} min={min} max={max} step={step} onChange={e => change(+e.target.value)}/></label>;
}
function Color({ label, value, change }: { label: string; value: string; change: (s: string) => void }) {
  return <label className="visual-color"><input type="color" aria-label={label} value={value} onChange={e => change(e.target.value)}/><span>{label}</span><code>{value}</code></label>;
}
export function StyleFields({ value: v, change, prefix = '', kind = 'keyboard' }: { value: ReturnType<typeof resolvedStyle>; change: (patch: ElementStyle) => void; prefix?: string; kind?: OverlayModule['type'] }) {
  const name = (label: string) => `${prefix}${label}`;
  const interactive = kind === 'keyboard' || kind === 'mouse', text = kind !== 'trail';
  return <div className="style-fields">
    <Color label={name(kind === 'trail' ? 'Line color' : 'Accent color')} value={v.accent} change={accent => change({ accent })}/><Color label={name('Surface color')} value={v.background} change={background => change({ background })}/>
    <VRange label={name('Background opacity')} value={v.backgroundOpacity} change={backgroundOpacity => change({ backgroundOpacity })}/>
    {text && <details className="visual-details"><summary>Text & typography</summary>
      <label className="visual-check"><input type="checkbox" checked={v.autoFitText} onChange={e => change({ autoFitText: e.target.checked })}/>{name(interactive ? 'Fit text inside key' : 'Fit text inside module')}</label><Color label={name('Text color')} value={v.textColor} change={textColor => change({ textColor })}/>{interactive && <Color label={name('Pressed text color')} value={v.activeTextColor} change={activeTextColor => change({ activeTextColor })}/>}
      <VSelect label={name('Font family')} value={v.fontFamily} options={fonts} change={fontFamily => change({ fontFamily })}/>
      <div className="field-grid"><VNumber label={name('Font size')} value={v.fontSize} min={6} max={96} change={fontSize => change({ fontSize })}/><VNumber label={name('Font weight')} value={v.fontWeight} min={100} max={900} change={fontWeight => change({ fontWeight: Math.round(fontWeight) })}/><VNumber label={name('Letter spacing')} value={v.letterSpacing} min={-2} max={12} change={letterSpacing => change({ letterSpacing })}/><VNumber label={name('Text outline')} value={v.textOutline} max={3} step={.1} change={textOutline => change({ textOutline })}/><VNumber label={name('Text shadow')} value={v.textShadow} max={12} change={textShadow => change({ textShadow })}/></div>
    </details>}
    <details className="visual-details"><summary>Borders & shape</summary>
      <Color label={name('Border color')} value={v.borderColor} change={borderColor => change({ borderColor })}/>{interactive && <Color label={name('Pressed border color')} value={v.activeBorderColor} change={activeBorderColor => change({ activeBorderColor })}/>}
      <VRange label={name('Border opacity')} value={v.borderOpacity} change={borderOpacity => change({ borderOpacity })}/><div className="field-grid"><VNumber label={name('Border width')} value={v.borderWidth} max={8} step={.5} change={borderWidth => change({ borderWidth })}/><VNumber label={name('Corner radius')} value={v.radius} max={100} change={radius => change({ radius })}/></div>
    </details>
    {interactive && <details className="visual-details"><summary>Press & release</summary>
      <VSelect label={name('Press effect')} value={v.effect} options={effects} change={effect => change({ effect })}/><div className="field-grid"><VNumber label={name('Press duration')} value={v.pressDuration} max={500} change={pressDuration => change({ pressDuration })}/><VNumber label={name('Release duration')} value={v.releaseDuration} max={1000} change={releaseDuration => change({ releaseDuration })}/><VNumber label={name('Press travel')} value={v.pressTravel} max={8} change={pressTravel => change({ pressTravel })}/><VNumber label={name('Glow strength')} value={v.glowStrength} max={40} change={glowStrength => change({ glowStrength })}/></div>
    </details>}
  </div>;
}
export function ModuleAppearance({ module: m, change }: { module: OverlayModule; change: (patch: Partial<OverlayModule>) => void }) {
  return <StyleFields kind={m.type} value={resolvedStyle(m)} change={patch => {
    const { accent, background, radius, effect, ...appearance } = patch;
    change({ ...(accent !== undefined ? { accent } : {}), ...(background !== undefined ? { background } : {}), ...(radius !== undefined ? { radius } : {}), ...(effect !== undefined ? { effect } : {}), appearance: { ...m.appearance, ...appearance } });
  }}/>;
}
export function MouseCustomization({ module: m, change }: { module: OverlayModule; change: (patch: Partial<OverlayModule>) => void }) {
  const [button, setButton] = useState('1'); const code = Number(button), cap = capsFor({ ...m, buttons: [code] }).caps[0];
  return <section className="property-section"><h4>INDIVIDUAL MOUSE BUTTON</h4><VSelect label="Edit mouse button" value={button} options={['1', '2', '3', '4', '5', '6', '7']} change={setButton}/>
    <p className="hint">1–5: mouse buttons · 6: scroll up · 7: scroll down. Positions use the local mouse layout.</p>
    <div className="field-grid">{(['x', 'y', 'w', 'h'] as const).map(key => <VNumber key={key} label={`Button ${key.toUpperCase()}`} value={cap[key]} min={key === 'w' || key === 'h' ? 10 : 0} max={1000} change={n => change({ buttonGeometry: { ...m.buttonGeometry, [button]: { ...m.buttonGeometry[button], [key]: n } } })}/>)}</div>
    <button className="text-button" onClick={() => { const next = { ...m.buttonGeometry }; delete next[button]; change({ buttonGeometry: next }); }}>Reset button position & size</button>
    <label className="visual-check"><input type="checkbox" checked={m.buttonImages[button] !== false} onChange={e => change({ buttonImages: { ...m.buttonImages, [button]: e.target.checked } })}/>Include in keycap image</label>
    <label className="visual-check"><input type="checkbox" checked={!!m.buttonStyles[button]} onChange={e => { const styles = { ...m.buttonStyles }; if (e.target.checked) styles[button] = {}; else delete styles[button]; change({ buttonStyles: styles }); }}/>Customize this button</label>
    {m.buttonStyles[button] && <StyleFields prefix="Button " value={resolvedStyle(m, m.buttonStyles[button])} change={patch => change({ buttonStyles: { ...m.buttonStyles, [button]: { ...m.buttonStyles[button], ...patch } } })}/>}
    <VNumber label="Scroll highlight (ms)" value={m.wheelDuration} min={50} max={500} change={wheelDuration => change({ wheelDuration })}/>
  </section>;
}
export function TrailAppearance({ module: m, change }: { module: OverlayModule; change: (patch: Partial<OverlayModule>) => void }) {
  const t = m.trailAppearance; const patch = (v: Partial<typeof t>) => change({ trailAppearance: { ...t, ...v } });
  return <section className="property-section"><h4>TRAIL APPEARANCE</h4>
    <details className="visual-details"><summary>Grid & markers</summary><Color label="Grid color" value={t.gridColor} change={gridColor => patch({ gridColor })}/><VRange label="Grid opacity" value={t.gridOpacity} change={gridOpacity => patch({ gridOpacity })}/><VNumber label="Grid spacing" value={t.gridSpacing} min={8} max={160} change={gridSpacing => patch({ gridSpacing })}/><Color label="Center color" value={t.centerColor} change={centerColor => patch({ centerColor })}/><VNumber label="Center size" value={t.centerSize} min={2} max={30} change={centerSize => patch({ centerSize })}/><Color label="Marker color" value={t.markerColor} change={markerColor => patch({ markerColor })}/><VNumber label="Marker size" value={t.markerSize} min={1} max={30} change={markerSize => patch({ markerSize })}/></details>
    <details className="visual-details"><summary>Speed gradient</summary><Color label="Slow color" value={t.slowColor} change={slowColor => patch({ slowColor })}/><Color label="Fast color" value={t.fastColor} change={fastColor => patch({ fastColor })}/><VNumber label="Speed color range" value={t.speedRange} min={.1} max={100} change={speedRange => patch({ speedRange })}/></details>
    <details className="visual-details"><summary>Clicks & camera</summary><Color label="M1 click color" value={t.leftClickColor} change={leftClickColor => patch({ leftClickColor })}/><Color label="M2 click color" value={t.rightClickColor} change={rightClickColor => patch({ rightClickColor })}/><VNumber label="Click duration (ms)" value={t.clickDuration} min={100} max={1500} change={clickDuration => patch({ clickDuration })}/><VNumber label="Click size" value={t.clickSize} min={2} max={60} change={clickSize => patch({ clickSize })}/><VNumber label="Camera follow (ms)" value={t.followMs} min={10} max={2000} change={followMs => patch({ followMs })}/></details>
  </section>;
}
function PlacementPreview({ document: d, module: m, image, change }: { document: StudioDocument; module: OverlayModule; image: ImageSettings; change: (p: Partial<ImageSettings>) => void }) {
  const host = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null);
  const [width, setWidth] = useState(700); const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  useEffect(() => { const engine = new InputEngine(); scene.current = new Scene(host.current!, engine); return () => { scene.current?.dispose(); }; }, []);
  useEffect(() => { const p = activeProfile(d); const bounds = capsFor(m), fit = Math.min(752 / bounds.w, 356 / bounds.h); const preview = { ...m, image, x: (800 - bounds.w * fit) / 2, y: (380 - bounds.h * fit) / 2, w: bounds.w * fit, h: bounds.h * fit, visible: true, opacity: 1 }; scene.current?.update(d, { ...p, modules: [preview] }); }, [d, m, image]);
  useEffect(() => { const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(wrapper.current!); return () => observer.disconnect(); }, []);
  const { w, h } = capsFor(m), scale = width / 800, capScale = Math.min(752 / w, 356 / h);
  useEffect(() => { const element = wrapper.current!; const wheel = (e: WheelEvent) => { e.preventDefault(); change({ scale: Math.max(.05, Math.min(8, image.scale * (e.deltaY > 0 ? .95 : 1.05))) }); }; element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel); }, [image.scale, change]);
  return <div ref={wrapper} className="image-placement checker" style={{ height: 380 * scale }} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: image.x, y: image.y, startX: e.clientX, startY: e.clientY }; }} onPointerMove={e => { const a = drag.current; if (a) change({ x: Math.max(-5000, Math.min(5000, a.x + (e.clientX - a.startX) / scale / capScale)), y: Math.max(-5000, Math.min(5000, a.y + (e.clientY - a.startY) / scale / capScale)) }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><div ref={host} style={{ width: 800, height: 380, transformOrigin: 'top left', transform: `scale(${scale})`, pointerEvents: 'none' }}/></div>;
}
function ImagePlacementEditor({ document: d, module: m, close, apply }: { document: StudioDocument; module: OverlayModule; close: () => void; apply: (image: ImageSettings) => void }) {
  const [draft, setDraft] = useState(m.image); const patch = (v: Partial<ImageSettings>) => setDraft(s => ({ ...s, ...v }));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={dialog} className="image-dialog" onCancel={e => { e.preventDefault(); close(); }} aria-label="Keycap image placement"><div className="image-dialog-head"><div><h2>Paint your keycaps</h2><p>Drag the picture across the keys. Scroll to scale. Gaps stay transparent.</p></div><button className="secondary" onClick={close}>Cancel</button></div>
    <PlacementPreview document={d} module={m} image={draft} change={patch}/>
    <div className="image-dialog-controls"><VSelect label="Image fit" value={draft.fit} options={['Cover', 'Contain', 'Original', 'Tile']} change={fit => patch({ fit })}/><VNumber label="Image scale" value={draft.scale} min={.05} max={8} step={.05} change={scale => patch({ scale })}/><VNumber label="Image X" value={draft.x} min={-5000} max={5000} change={x => patch({ x })}/><VNumber label="Image Y" value={draft.y} min={-5000} max={5000} change={y => patch({ y })}/><VNumber label="Image rotation" value={draft.rotation} min={-180} max={180} change={rotation => patch({ rotation })}/></div>
    <div className="image-dialog-actions"><button className="secondary" onClick={() => patch({ fit: 'Cover', scale: 1, x: 0, y: 0, rotation: 0 })}>Reset placement</button><button className="primary" onClick={() => { apply(draft); close(); }}>Apply image placement</button></div>
  </dialog>;
}
export function KeycapImagePanel({ document: d, module: m, change, upload }: { document: StudioDocument; module: OverlayModule; change: (patch: Partial<OverlayModule>) => void; upload: (asset: ImageAsset) => void }) {
  const [editing, setEditing] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const image = m.image, asset = d.assets[image.assetId]; const patch = (p: Partial<ImageSettings>) => change({ image: { ...image, ...p } });
  const current = useRef(m.id); current.current = m.id;
  return <section className="property-section keycap-panel"><h4>KEYCAP IMAGE <span className="new-tag">NEW</span></h4><p className="hint">One continuous picture, clipped to the key shapes. Labels and borders stay above it.</p>
    <label className="image-upload"><span>{busy ? 'Preparing image…' : asset ? 'Replace image' : 'Upload image'}</span><input aria-label="Upload keycap image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const moduleId = m.id; setBusy(true); setError(''); try { const asset = await readImageAsset(file); if (current.current === moduleId) upload(asset); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}/></label>
    {Object.keys(d.assets).length > 0 && <label className="field"><span>Image library</span><select aria-label="Image library" value={image.assetId} onChange={e => patch({ assetId: e.target.value, enabled: !!e.target.value })}><option value="">No image</option>{Object.entries(d.assets).map(([id, a]) => <option key={id} value={id}>{a.name}</option>)}</select></label>}
    {error && <p role="alert" className="warning">{error}</p>}
    {asset && <><div className="image-asset"><img src={asset.data} alt="Keycap artwork"/><div>{asset.name}<span>{asset.width} × {asset.height} · embedded in preset</span></div></div>
      <label className="visual-check"><input type="checkbox" checked={image.enabled} onChange={e => patch({ enabled: e.target.checked })}/>Show keycap image</label>
      <button className="secondary" onClick={() => setEditing(true)}>Position & scale image</button>
      <VRange label="Image opacity" value={image.opacity} change={opacity => patch({ opacity })}/><VSelect label="Image blending" value={image.blend} options={['normal', 'multiply', 'screen', 'soft-light', 'overlay']} change={blend => patch({ blend })}/>
      <details className="visual-details"><summary>Image adjustments</summary><VRange label="Image brightness" value={image.brightness} max={2} change={brightness => patch({ brightness })}/><VRange label="Image contrast" value={image.contrast} max={2} change={contrast => patch({ contrast })}/><VRange label="Image saturation" value={image.saturation} max={2} change={saturation => patch({ saturation })}/><Color label="Image tint" value={image.tint} change={tint => patch({ tint })}/><VRange label="Tint opacity" value={image.tintOpacity} change={tintOpacity => patch({ tintOpacity })}/></details>
      <VSelect label="Image on press" value={image.press} options={['Tint', 'Brighten', 'Hide']} change={press => patch({ press })}/>{image.press === 'Tint' && <VRange label="Pressed color overlay" value={image.pressTint} change={pressTint => patch({ pressTint })}/>}<button className="text-button danger" onClick={() => change({ image: defaultImageSettings() })}>Remove image from module</button>
    </>}
    {editing && asset && <ImagePlacementEditor document={d} module={m} close={() => setEditing(false)} apply={image => change({ image })}/>}
  </section>;
}
