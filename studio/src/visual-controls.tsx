import {tr,trText} from './core/localization/messages.ts';
import { registerSettingsView } from './settings-views';
import { RegisteredField } from './registered-field';
import { AnimationElement } from './animation-binding';
import type { ReactNode } from 'react';
import type { OverlayModule } from './core/config';
import { capsFor, resolvedStyle } from './core/skins';
import { fonts, type ElementStyle } from './core/visual';
import { ElementStyleTools, Inheritance, StyleInheritance } from './style-tools';

export { VNumber, VSelect, VRange } from './visual-fields';
import { VNumber, VSelect, VRange, Color } from './visual-fields';
import { AnimationControls } from './animation-controls';
import { ShapeControl } from './shape-controls';
import { mouseSelectionLabel } from './selection-labels';
export function StyleFields({ value: v, change, prefix = '', kind = 'keyboard', overrides, reset, settingField }: { settingField?: (id: import('./core/architecture/contracts').DefinitionId, fallback: ReactNode) => ReactNode; overrides?: ElementStyle; reset?: (field: keyof ElementStyle) => void; value: ReturnType<typeof resolvedStyle>; change: (patch: ElementStyle) => void; prefix?: string; kind?: OverlayModule['type'] }) {
  const field = (id: import('./core/architecture/contracts').DefinitionId, fallback: ReactNode) => settingField ? settingField(id,fallback) : fallback;
  const name = (label: string) => `${trText(prefix)}${trText(label)}`;
  const interactive = kind === 'keyboard' || kind === 'mouse', text = kind !== 'trail';
  return <StyleInheritance.Provider value={{ overrides, reset, prefix }}><div className="style-fields">
    {field('overlay.surface.accent',<Color settingId="overlay.surface.accent" label={name(kind === 'trail' ? 'Line color' : 'Accent color')} value={v.accent} change={accent => change({ accent })}/>)}{field('overlay.surface.surface',<Color settingId="overlay.surface.surface" label={name('Surface color')} value={v.background} change={background => change({ background })}/>)}
    {field('overlay.appearance.background-opacity',<VRange settingId="overlay.appearance.background-opacity" label={name('Background opacity')} value={v.backgroundOpacity} change={backgroundOpacity => change({ backgroundOpacity })}/>)}
    {text && <details className="visual-details"><summary>{tr('ui:s-e29ec5621475',"Text & typography")}</summary>
      {interactive && <RegisteredField id="overlay.appearance.show-labels" label={name('Show labels')} fallback={<label className="visual-check"><input type="checkbox" checked={v.showLabels} onChange={e => change({ showLabels: e.target.checked })}/>{name('Show labels')}<Inheritance label={name('Show labels')}/></label>}/>}
      <RegisteredField id="overlay.appearance.auto-fit-text" label={name(interactive ? 'Fit text inside key' : 'Fit text inside module')} fallback={<label className="visual-check"><input type="checkbox" checked={v.autoFitText} onChange={e => change({ autoFitText: e.target.checked })}/>{name(interactive ? 'Fit text inside key' : 'Fit text inside module')}<Inheritance label={name('Fit text inside key')}/></label>}/><Color settingId="overlay.appearance.text-color" label={name('Text color')} value={v.textColor} change={textColor => change({ textColor })}/>{interactive && <Color settingId="overlay.appearance.active-text-color" label={name('Pressed text color')} value={v.activeTextColor} change={activeTextColor => change({ activeTextColor })}/>}
      <VSelect settingId="overlay.appearance.font-family" label={name('Font family')} value={v.fontFamily} options={fonts} change={fontFamily => change({ fontFamily })}/>
      <div className="field-grid"><VNumber settingId="overlay.appearance.font-size" label={name('Font size')} value={v.fontSize} min={6} max={96} change={fontSize => change({ fontSize })}/><VNumber settingId="overlay.appearance.font-weight" label={name('Font weight')} value={v.fontWeight} min={100} max={900} change={fontWeight => change({ fontWeight: Math.round(fontWeight) })}/><VNumber settingId="overlay.appearance.letter-spacing" label={name('Letter spacing')} value={v.letterSpacing} min={-2} max={12} change={letterSpacing => change({ letterSpacing })}/><VNumber settingId="overlay.appearance.text-outline" label={name('Text outline')} value={v.textOutline} max={3} step={.1} change={textOutline => change({ textOutline })}/><VNumber settingId="overlay.appearance.text-shadow" label={name('Text shadow')} value={v.textShadow} max={12} change={textShadow => change({ textShadow })}/></div>
    </details>}
    <details className="visual-details"><summary>{tr('ui:s-34bc26ef4392',"Borders & shape")}</summary>
      {interactive && <ShapeControl settingId="overlay.appearance.shape" value={v.shapeId} change={shapeId => change({ shapeId })} prefix={prefix}/>}
      <Color settingId="overlay.appearance.border-color" label={name('Border color')} value={v.borderColor} change={borderColor => change({ borderColor })}/>{interactive && <Color settingId="overlay.appearance.active-border-color" label={name('Pressed border color')} value={v.activeBorderColor} change={activeBorderColor => change({ activeBorderColor })}/>}
      <VRange settingId="overlay.appearance.border-opacity" label={name('Border opacity')} value={v.borderOpacity} change={borderOpacity => change({ borderOpacity })}/><div className="field-grid"><VNumber settingId="overlay.appearance.border-width" label={name('Border width')} value={v.borderWidth} max={8} step={.5} change={borderWidth => change({ borderWidth })}/>{field('overlay.surface.radius',<VNumber settingId="overlay.surface.radius" label={name('Corner radius')} value={v.radius} disabled={interactive && !!v.shapeId} max={100} change={radius => change({ radius })}/>)}</div>
    </details>
    {interactive && <AnimationControls value={v} prefix={prefix} change={change} mouse={kind === 'mouse'}/>}
  </div></StyleInheritance.Provider>;
}
export function ModuleAppearance({ module: m, change, settingField }: { settingField?: (id: import('./core/architecture/contracts').DefinitionId, fallback: ReactNode) => ReactNode; module: OverlayModule; change: (patch: Partial<OverlayModule>) => void }) {
  return <StyleFields settingField={settingField} kind={m.type} value={resolvedStyle(m)} change={patch => {
    const { accent, background, radius, effect, ...appearance } = patch;
    change({ ...(accent !== undefined ? { accent } : {}), ...(background !== undefined ? { background } : {}), ...(radius !== undefined ? { radius } : {}), ...(effect !== undefined ? { effect } : {}), appearance: { ...m.appearance, ...appearance } });
  }}/>;
}
function MouseCustomizationView({ module: m, change, selected, select }: { selected: number; select: (code: number) => void; module: OverlayModule; change: (patch: Partial<OverlayModule>) => void }) {
  const button = String(selected), code = selected, cap = capsFor({ ...m, buttons: [code] }).caps[0];
  const editLabel = tr('ui:s-6940306154a3', 'Edit mouse button');
  return <section className="property-section"><h4>{tr('ui:s-f3374073b48d', 'Mouse button · {{p0}}', { p0: mouseSelectionLabel(m, code) })}</h4>
    <label className="field"><span>{editLabel}</span><select aria-label={editLabel} value={button} onChange={e => select(Number(e.target.value))}>
      {m.buttonLabels.map((_, i) => <option key={i + 1} value={i + 1}>{mouseSelectionLabel(m, i + 1)}</option>)}
    </select></label>
    <p className="hint">{tr('ui:s-b260cca46ba5',"1–5: mouse buttons · 6: scroll up · 7: scroll down. Enable individual editing to target this button with selection commands. Paste keeps its physical input; Delete hides it. Positions use the local mouse layout.")}</p>
    <div className="field-grid">{(['x', 'y', 'w', 'h'] as const).map(key => <VNumber key={key} label={tr('ui:s-a257f2539e2f',"Button {{p0}}",{p0:String(key.toUpperCase())})} value={cap[key]} min={key === 'w' || key === 'h' ? 10 : 0} max={1000} disabled={m.locked} change={n => change({ buttonGeometry: { ...m.buttonGeometry, [button]: { ...m.buttonGeometry[button], [key]: n } } })}/>)}</div>
    <button className="text-button" disabled={m.locked} onClick={() => { const next = { ...m.buttonGeometry }; delete next[button]; change({ buttonGeometry: next }); }}>{tr('ui:s-86eb06b7b2d0',"Reset button position & size")}</button>
    <label className="visual-check"><input type="checkbox" checked={m.buttonImages[button] !== false} onChange={e => change({ buttonImages: { ...m.buttonImages, [button]: e.target.checked } })}/>{tr('ui:s-82058b024386',"Include in keycap image")}</label>
    <ElementStyleTools module={m} override={m.buttonStyles[button]} change={style => { const styles = { ...m.buttonStyles }; if (style) styles[button] = style; else delete styles[button]; change({ buttonStyles: styles }); }} applyAll={style => change({ buttonStyles: { ...m.buttonStyles, ...Object.fromEntries(m.buttons.map(code => [code, structuredClone(style)])) } })}/>
    <label className="visual-check"><input type="checkbox" checked={!!m.buttonStyles[button]} onChange={e => { const styles = { ...m.buttonStyles }; if (e.target.checked) styles[button] = {}; else delete styles[button]; change({ buttonStyles: styles }); }}/>{tr('ui:s-bc527e5bc753',"Customize this button")}</label>
    {m.buttonStyles[button] && <AnimationElement element={{kind:'mouse-button',button:code}}><StyleFields prefix="Button " overrides={m.buttonStyles[button]} reset={field => { const style = { ...m.buttonStyles[button] }; delete style[field]; change({ buttonStyles: { ...m.buttonStyles, [button]: style } }); }} value={resolvedStyle(m, m.buttonStyles[button])} change={patch => change({ buttonStyles: { ...m.buttonStyles, [button]: { ...m.buttonStyles[button], ...patch } } })}/></AnimationElement>}
  </section>;
}
export function TrailAppearance({ module: m, change }: { module: OverlayModule; change: (patch: Partial<OverlayModule>) => void }) {
  const t = m.trailAppearance; const patch = (v: Partial<typeof t>) => change({ trailAppearance: { ...t, ...v } });
  return <section className="property-section"><h4>{tr('ui:s-514c8577ff71',"TRAIL APPEARANCE")}</h4>
    <details className="visual-details"><summary>{tr('ui:s-e6f8a85da861',"Grid & markers")}</summary><Color settingId="overlay.trail-appearance.grid-color" label={tr('ui:s-b485b8caf86f',"Grid color")} value={t.gridColor} change={gridColor => patch({ gridColor })}/><VRange settingId="overlay.trail-appearance.grid-opacity" label={tr('ui:s-a2d34f004ddf',"Grid opacity")} value={t.gridOpacity} change={gridOpacity => patch({ gridOpacity })}/><VNumber settingId="overlay.trail-appearance.grid-spacing" label={tr('ui:s-cce55fe5c0bc',"Grid spacing")} value={t.gridSpacing} min={8} max={160} change={gridSpacing => patch({ gridSpacing })}/><Color settingId="overlay.trail-appearance.center-color" label={tr('ui:s-99df89fac615',"Center color")} value={t.centerColor} change={centerColor => patch({ centerColor })}/><VNumber settingId="overlay.trail-appearance.center-size" label={tr('ui:s-08c5ec411e50',"Center size")} value={t.centerSize} min={2} max={30} change={centerSize => patch({ centerSize })}/><Color settingId="overlay.trail-appearance.marker-color" label={tr('ui:s-9aa9e24e651d',"Marker color")} value={t.markerColor} change={markerColor => patch({ markerColor })}/><VNumber settingId="overlay.trail-appearance.marker-size" label={tr('ui:s-e4a3642a8f6a',"Marker size")} value={t.markerSize} min={1} max={30} change={markerSize => patch({ markerSize })}/></details>
    <details className="visual-details"><summary>{tr('ui:s-db048bfddcc4',"Speed gradient")}</summary><Color settingId="overlay.trail-appearance.slow-color" label={tr('ui:s-5e60c40989c7',"Slow color")} value={t.slowColor} change={slowColor => patch({ slowColor })}/><Color settingId="overlay.trail-appearance.fast-color" label={tr('ui:s-95861f849b13',"Fast color")} value={t.fastColor} change={fastColor => patch({ fastColor })}/><VNumber settingId="overlay.trail-appearance.speed-range" label={tr('ui:s-3e02f4cee300',"Speed color range")} value={t.speedRange} min={.1} max={100} change={speedRange => patch({ speedRange })}/></details>
    <details className="visual-details"><summary>{tr('ui:s-b32b0c9f3de8',"Clicks & camera")}</summary><Color settingId="overlay.trail-appearance.left-click-color" label={tr('ui:s-6373ccdcd140',"M1 click color")} value={t.leftClickColor} change={leftClickColor => patch({ leftClickColor })}/><Color settingId="overlay.trail-appearance.right-click-color" label={tr('ui:s-e14a6b932295',"M2 click color")} value={t.rightClickColor} change={rightClickColor => patch({ rightClickColor })}/><VNumber settingId="overlay.trail-appearance.click-duration" label={tr('ui:s-7d79fb6a4807',"Click duration (ms)")} value={t.clickDuration} min={100} max={1500} change={clickDuration => patch({ clickDuration })}/><VNumber settingId="overlay.trail-appearance.click-size" label={tr('ui:s-e9b447d2756b',"Click size")} value={t.clickSize} min={2} max={60} change={clickSize => patch({ clickSize })}/><VNumber settingId="overlay.trail-appearance.follow-time" label={tr('ui:s-8c134f812ee6',"Camera follow (ms)")} value={t.followMs} min={10} max={2000} change={followMs => patch({ followMs })}/></details>
  </section>;
}

export const MouseCustomization=registerSettingsView('editor.mouse-buttons',MouseCustomizationView);
