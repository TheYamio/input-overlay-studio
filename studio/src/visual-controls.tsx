import { useRef, useState } from 'react';
import { activeProfile, type OverlayModule, type StudioDocument } from './core/config';
import { capsFor, readImageAsset, resolvedStyle } from './core/skins';
import { defaultImageSettings, effects, fonts, type ElementStyle, type ImageAsset, type ImageSettings } from './core/visual';
import { ElementStyleTools, Inheritance, StyleInheritance } from './style-tools';

export { VNumber, VSelect, VRange } from './visual-fields';
import { VNumber, VSelect, VRange, Color } from './visual-fields';
import { ImagePlacementEditor } from './image-editor';
export function StyleFields({ value: v, change, prefix = '', kind = 'keyboard', overrides, reset }: { overrides?: ElementStyle; reset?: (field: keyof ElementStyle) => void; value: ReturnType<typeof resolvedStyle>; change: (patch: ElementStyle) => void; prefix?: string; kind?: OverlayModule['type'] }) {
  const name = (label: string) => `${prefix}${label}`;
  const interactive = kind === 'keyboard' || kind === 'mouse', text = kind !== 'trail';
  return <StyleInheritance.Provider value={{ overrides, reset, prefix }}><div className="style-fields">
    <Color label={name(kind === 'trail' ? 'Line color' : 'Accent color')} value={v.accent} change={accent => change({ accent })}/><Color label={name('Surface color')} value={v.background} change={background => change({ background })}/>
    <VRange label={name('Background opacity')} value={v.backgroundOpacity} change={backgroundOpacity => change({ backgroundOpacity })}/>
    {text && <details className="visual-details"><summary>Text & typography</summary>
      <label className="visual-check"><input type="checkbox" checked={v.autoFitText} onChange={e => change({ autoFitText: e.target.checked })}/>{name(interactive ? 'Fit text inside key' : 'Fit text inside module')}<Inheritance label={name('Fit text inside key')}/></label><Color label={name('Text color')} value={v.textColor} change={textColor => change({ textColor })}/>{interactive && <Color label={name('Pressed text color')} value={v.activeTextColor} change={activeTextColor => change({ activeTextColor })}/>}
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
  </div></StyleInheritance.Provider>;
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
    <ElementStyleTools module={m} override={m.buttonStyles[button]} change={style => { const styles = { ...m.buttonStyles }; if (style) styles[button] = style; else delete styles[button]; change({ buttonStyles: styles }); }} applyAll={style => change({ buttonStyles: { ...m.buttonStyles, ...Object.fromEntries(m.buttons.map(code => [code, structuredClone(style)])) } })}/>
    <label className="visual-check"><input type="checkbox" checked={!!m.buttonStyles[button]} onChange={e => { const styles = { ...m.buttonStyles }; if (e.target.checked) styles[button] = {}; else delete styles[button]; change({ buttonStyles: styles }); }}/>Customize this button</label>
    {m.buttonStyles[button] && <StyleFields prefix="Button " overrides={m.buttonStyles[button]} reset={field => { const style = { ...m.buttonStyles[button] }; delete style[field]; change({ buttonStyles: { ...m.buttonStyles, [button]: style } }); }} value={resolvedStyle(m, m.buttonStyles[button])} change={patch => change({ buttonStyles: { ...m.buttonStyles, [button]: { ...m.buttonStyles[button], ...patch } } })}/>}
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
export function KeycapImagePanel({ document: d, module: m, change, upload, link }: { link: (targetId: string, join: boolean) => void; document: StudioDocument; module: OverlayModule; change: (patch: Partial<OverlayModule>) => void; upload: (asset: ImageAsset) => void }) {
  const [editing, setEditing] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const image = m.image, asset = d.assets[image.assetId]; const patch = (p: Partial<ImageSettings>) => change({ image: { ...image, ...p } });
  const current = useRef(m.id); current.current = m.id;
  return <section className="property-section keycap-panel"><h4>KEYCAP IMAGE <span className="new-tag">NEW</span></h4><p className="hint">One continuous picture, clipped to the key shapes. Labels and borders stay above it.</p>
    <label className="image-upload"><span>{busy ? 'Preparing image…' : asset ? 'Replace image' : 'Upload image'}</span><input aria-label="Upload keycap image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const moduleId = m.id; setBusy(true); setError(''); try { const asset = await readImageAsset(file); if (current.current === moduleId) upload(asset); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}/></label>
    {Object.keys(d.assets).length > 0 && <label className="field"><span>Image library</span><select aria-label="Image library" value={image.assetId} onChange={e => patch({ assetId: e.target.value, enabled: !!e.target.value })}><option value="">No image</option>{Object.entries(d.assets).map(([id, a]) => <option key={id} value={id}>{a.name}</option>)}</select></label>}
    <details className="visual-details artwork-group"><summary>Shared artwork across modules</summary><p className="hint">Members share the image, placement and adjustments. Coordinates span their painted surfaces on the canvas, including hidden members.</p>{activeProfile(d).modules.filter(other => other.id !== m.id && (other.type === 'keyboard' || other.type === 'mouse')).map(other => <label key={other.id} className="visual-check"><input type="checkbox" aria-label={`Share artwork with ${other.name}`} checked={!!image.groupId && other.image.groupId === image.groupId} onChange={e => link(other.id, e.target.checked)}/>{other.name}</label>)}<p className="hint">Unchecking keeps that module's current image settings as an independent copy.</p></details>
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
