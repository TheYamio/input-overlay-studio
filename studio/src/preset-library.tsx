import {UnicodeInput,UnicodeTextarea} from './unicode-input';
import {tr,trText} from './core/localization/messages.ts';
import { registerSettingsView } from './settings-views';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { resolvedProfile, uid, type StudioDocument } from './core/config';
import { factoryPresets, type PresetBundle } from './core/factory-presets';
import { applyPresetColors, presetPalette } from './core/preset-colors';
import { copyName } from './core/editing';
import { SceneThumbnail } from './scene-thumbnail';
import './preset-library.css';

type Preset = StudioDocument['presets'][number];
type Details = { id?: string; name: string; description: string; kind: 'layout' | 'style' };
function DetailsDialog({ details, close, save }: { details: Details; close: () => void; save: (value: Details) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [value, setValue] = useState(details);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, element = dialog.current!;
    element.showModal(); element.querySelector('input')?.focus();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="preset-dialog" onCancel={close} onClick={e => { if (e.target === dialog.current) close(); }}><form onSubmit={e => { e.preventDefault(); if (value.name.trim()) save(value); }}>
    <header><h2>{details.id ? tr('ui:s-6aaf5dc9232d',"Edit preset details") : tr('ui:s-6aebc3d96fa2',"Save your setup")}</h2><button type="button" aria-label={tr('ui:s-c3128cd87891',"Close preset details")} onClick={close}><X size={20}/></button></header>
    <div className="preset-dialog-body">
    <label>{tr('ui:s-dcd1d5223f73',"Name")}<UnicodeInput aria-label={tr('ui:s-e534a6662ac8',"Preset name")} value={value.name} maxLength={100} required onChange={e => setValue({ ...value, name: e.target.value })}/></label>
    <label>{tr('ui:s-526e0087cc3f',"Description")}<UnicodeTextarea aria-label={tr('ui:s-6a109c102189',"Preset description")} value={value.description} maxLength={500} rows={4} placeholder={tr('ui:s-e7335cf558c4',"What makes this preset yours?")} onChange={e => setValue({ ...value, description: e.target.value })}/><small>{value.description.length}/500</small></label>
    <label>{tr('ui:s-60af8a30e5e6',"Save as")}<select aria-label={tr('ui:s-fd20edad2ec6',"Preset type")} value={value.kind} onChange={e => setValue({ ...value, kind: e.target.value as Details['kind'] })}><option value="layout">{tr('ui:s-8814cee5ed66',"Full layout — buttons, shapes, artwork & colors")}</option><option value="style">{tr('ui:s-238f44d988d7',"Colors only — reusable on any layout")}</option></select></label>
    <p>{value.kind === 'layout' ? tr('ui:s-fada43a0ddef',"Captures the entire composition. Game and sensitivity settings stay in your profile.") : tr('ui:s-29ad37383f86',"Captures a palette. Applying it keeps your buttons, layout, artwork and animations.")}</p>
    </div>
    <footer><button type="button" className="secondary" onClick={close}>{tr('ui:s-19766ed6ccb2',"Cancel")}</button><button className="primary" disabled={!value.name.trim()}>{details.id ? tr('ui:s-bb76faabfd0b',"Save details") : tr('ui:s-362a1376e641',"Save preset")}</button></footer>
  </form></dialog>;
}
function PresetLibraryView({ document: d, update, apply, exportPreset, importPreset, notify }: {
  document: StudioDocument; update: (fn: (doc: StudioDocument) => void) => boolean;
  apply: (preset: Preset, colors: boolean, bundle?: PresetBundle) => void;
  exportPreset: (id: string) => void; importPreset: (file: File) => Promise<void>; notify: (message: string) => void;
}) {
  const profile = resolvedProfile(d), [mode, setMode] = useState<'layout' | 'colors'>('layout'), [filter, setFilter] = useState('All'), [query, setQuery] = useState(''), [details, setDetails] = useState<Details | null>(null), file = useRef<HTMLInputElement>(null);
  const cards = useMemo(() => [
    ...factoryPresets.map(bundle => ({ preset: bundle.preset as Preset, bundle, saved: false })),
    ...d.presets.map(preset => ({ preset, bundle: undefined, saved: true })),
  ].map(card => ({ ...card, colorsOnly: mode === 'colors' || card.preset.kind === 'style', modules: mode === 'colors' || card.preset.kind === 'style' ? applyPresetColors(profile.modules, card.preset.modules) : card.preset.modules })), [d.presets, profile.modules, mode]);
  const shown = cards.filter(card => (filter === 'All' || card.saved === (filter === 'Saved')) && `${card.preset.name} ${card.preset.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const save = (value: Details) => {
    const saved = update(doc => {
      const metadata = { name: value.name.trim(), ...(value.description.trim() ? { description: value.description.trim() } : {}), ...(value.kind === 'style' ? { kind: 'style' as const } : {}) };
      if (value.id) { const preset = doc.presets.find(p => p.id === value.id); if (preset) { delete preset.description; delete preset.kind; Object.assign(preset, metadata); } }
      else if (doc.presets.length < 50) doc.presets.push({ id: uid(), theme: profile.theme, modules: structuredClone(profile.modules), ...metadata });
    });
    if (!saved) return;
    if (!value.id) { setFilter('Saved'); setQuery(''); } setDetails(null); notify(value.id ? tr('ui:s-8388160b3818',"Preset details saved.") : tr('ui:s-c9f6e4c632bf',"Preset saved."));
  };
  return <div className="content-page presets-page preset-library">
    <div className="library-heading"><div><span className="eyebrow">{tr('ui:s-daa70ca00eea',"BUILT TO BE PERSONAL")}</span><h2>{tr('ui:s-5437cbf591e9',"Find your signature.")}</h2><p>{tr('ui:s-0d400668784a',"Start with a complete composition, or try a new palette on your own buttons.")}</p></div><div className="library-actions"><input ref={file} type="file" accept="application/json,.json" aria-label={tr('ui:s-9f0569dc6a21',"Import preset file")} hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importPreset(f).then(() => { setFilter('Saved'); setQuery(''); }); }}/><button className="secondary" onClick={() => file.current?.click()}><Upload size={16}/>{tr('ui:s-67ba094da99f',"Import preset")}</button><button className="primary" disabled={d.presets.length >= 50} onClick={() => setDetails({ name: 'My custom layout', description: '', kind: 'layout' })}><Plus size={16}/>{tr('ui:s-17481b8f4e05',"Save current setup")}</button></div></div>
    <div className="preset-mode" role="group" aria-label={tr('ui:s-4033aa100d44',"Preset application mode")}><button aria-pressed={mode === 'layout'} onClick={() => setMode('layout')}><strong>{tr('ui:s-d29b06772c7b',"Full layouts")}</strong><span>{tr('ui:s-88c67634a187',"Use the entire composition")}</span></button><button aria-pressed={mode === 'colors'} onClick={() => setMode('colors')}><strong>{tr('ui:s-8f0c6fc34926',"Colors on my layout")}</strong><span>{tr('ui:s-e1b4dd22ee51',"Keep my buttons & arrangement")}</span></button></div>
    <p className="preset-explanation" role="status">{mode === 'layout' ? tr('ui:s-f787bb53f08a',"Full layouts replace your buttons, shapes, artwork and positions. Your game, DPI and sensitivity stay the same. You can Undo any change.") : tr('ui:s-46c4c20caae0',"Previews show YOUR current buttons in each palette. Only colors and surface transparency change; shapes, labels, layout, artwork and animations stay yours.")}</p>
    <div className="library-toolbar"><div role="group" aria-label={tr('ui:s-99392ba311f7',"Preset source")}>{['All','Factory','Saved'].map(source => <button key={source} aria-pressed={filter === source} onClick={() => setFilter(source)}>{source} <span>{source === 'Factory' ? factoryPresets.length : source === 'Saved' ? d.presets.length : cards.length}</span></button>)}</div><input type="search" aria-label={tr('ui:s-b2e5d6ff00c3',"Search presets")} placeholder={tr('ui:s-a9ba33f919bf',"Search names & descriptions…")} value={query} onChange={e => setQuery(e.target.value)}/></div>
    <div className="preset-grid">{shown.map(({ preset, bundle, saved, colorsOnly, modules }) => <article key={preset.id} className={`preset-large library-card${saved ? ' saved-preset' : ''}`} aria-label={tr('ui:s-4c8eecbc2b3a',"{{p0}} preset",{p0:String(preset.name)})}>
      <div className="preset-art"><SceneThumbnail document={bundle ? { ...d, shapes: { ...d.shapes, ...bundle.shapes } } : d} profile={profile} modules={modules}/><span className="preset-type">{colorsOnly ? tr('ui:s-a8fb7590020e',"COLORS ONLY") : tr('ui:s-1223ec528c19',"FULL LAYOUT")}</span></div>
      <div className="library-card-content"><div className="preset-origin">{saved ? tr('ui:s-032a5ee792a9',"YOUR COLLECTION") : preset.id === 'sora-miao-zhaoyun' ? tr('ui:s-69f82629b63d',"PERSONAL PRESET") : tr('ui:s-253faad9191b',"STUDIO COLLECTION")}</div><h3>{preset.name}</h3><p className="preset-description">{saved ? preset.description || trText('Your personal preset. Add a description using Edit details.') : trText(preset.description || '')}</p><div className="preset-palette" aria-label={tr('ui:s-c0192664eb21',"{{p0}} color palette",{p0:String(preset.name)})}>{presetPalette(preset.modules).map(color => <i key={color} title={color} aria-label={color} style={{ background: color }}/>)}</div>
      <div className="preset-summary">{colorsOnly ? tr('ui:s-099b77b9eaca',"Your layout · new palette") : tr('ui:s-4828ad827734',"{{p0}} modules · {{p1}} keys",{p0:String(preset.modules.filter(m => m.visible).length),p1:String(preset.modules.filter(m => m.visible && m.type === 'keyboard').reduce((n,m) => n + m.keys.length, 0))})}</div>
      <button className="primary preset-apply" onClick={() => apply(preset, colorsOnly, bundle)}>{colorsOnly ? tr('ui:s-4cd7c855742e',"Apply colors") : tr('ui:s-003857be2479',"Use full layout")}</button>
      {saved && <div className="preset-management"><button title={tr('ui:s-fd9c61ac500e',"Edit details")} aria-label={tr('ui:s-fd9c61ac500e',"Edit details")} onClick={() => setDetails({ id: preset.id, name: preset.name, description: preset.description || '', kind: preset.kind || 'layout' })}><Pencil size={15}/><span>{tr('ui:s-fd9c61ac500e',"Edit details")}</span></button><button title={tr('ui:s-fe22091983de',"Update from current setup")} aria-label={tr('ui:s-fe22091983de',"Update from current setup")} onClick={() => { const updated = update(doc => { const target = doc.presets.find(p => p.id === preset.id)!; target.modules = structuredClone(profile.modules); target.theme = profile.theme; }); if (updated) notify(tr('ui:s-6cc0e00047c0',"Preset updated from your current setup. Undo restores the previous version.")); }}><RefreshCw size={15}/></button><button title={tr('ui:s-ae61913e54dc',"Export preset")} aria-label={tr('ui:s-ae61913e54dc',"Export preset")} onClick={() => exportPreset(preset.id)}><Download size={15}/></button><button title={tr('ui:s-a5c8c8272f25',"Duplicate preset")} aria-label={tr('ui:s-a5c8c8272f25',"Duplicate preset")} disabled={d.presets.length >= 50} onClick={() => update(doc => doc.presets.push({ ...structuredClone(preset), id: uid(), name: copyName(preset.name) }))}><Copy size={15}/></button><button title={tr('ui:s-f307af853667',"Delete preset")} aria-label={tr('ui:s-f307af853667',"Delete preset")} onClick={() => { update(doc => { doc.presets = doc.presets.filter(p => p.id !== preset.id); }); notify(tr('ui:s-d4fa1dd04a5a',"Preset deleted. Undo restores it.")); }}><Trash2 size={15}/></button></div>}
      </div></article>)}</div>
    {!shown.length && <div className="library-empty"><h3>{query ? tr('ui:s-7afe10e5dc38',"No matching presets") : tr('ui:s-db5eedb4c7fd',"Your collection starts here")}</h3><p>{query ? tr('ui:s-cdddcd96f4ee',"Try another name or description.") : tr('ui:s-ac6601aa90a1',"Save your current setup as a full layout or a reusable color palette.")}</p></div>}
    {details && <DetailsDialog key={details.id || 'new'} details={details} close={() => setDetails(null)} save={save}/>}
  </div>;
}

export const PresetLibrary=registerSettingsView('editor.preset-library',PresetLibraryView);
