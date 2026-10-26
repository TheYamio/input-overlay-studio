import {version as appVersion} from '../package.json';
import {SettingsError} from './core/settings/events';
import {nativeSettingsError} from './core/settings/native-config';
import {ConnectionNoticeBanner} from './connection-notice';
import {DiagnosticSettings} from './diagnostic-settings';
import {SetupGuide} from './setup-guide';
import {applyPresetToDocument} from './core/preset-application';
import type {PresetBundle} from './core/factory-presets';
import {ConnectionIndicators,ConnectionDetails} from './connection-status';
import {SupportPage,SupportEntry,SupportPrompt} from './support';
import {loadBuiltinLanguage} from './core/localization/load-language';
import {UnicodeInput} from './unicode-input';
import {LanguageSettings} from './language-settings';
import {storedStudioLocale} from './core/settings/preferences';
import {languageChoices} from './core/localization/runtime';
import {tr,trText,trError} from './core/localization/messages.ts';
import { ProfilesPage } from './profiles-page';
import { moduleKind } from './core/module-envelope';
import { moduleAvailable } from './core/module-format';
import { encodeDocument } from './core/config';
import { NumberField,Toggle,Select,IconButton } from './editor-fields';
import { ModuleProperties } from './module-inspector';
import { RegisteredCanvasEditor } from './module-panel';
import { useModuleUIRegistry } from './module-ui-context';
import { ConnectionSettings } from './connection-settings';
import { registerSettingsView } from './settings-views';
import { NativeSettingsDraft } from './core/settings/native-draft';
import { NativeSettingsProvider } from './external-settings';
import { RegisteredField } from './registered-field';
import { DocumentSettingsProvider } from './settings-scope';
import type { DefinitionId } from './core/architecture/contracts';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Check, ChevronDown, ChevronRight, Copy, Download, Eye, EyeOff, FolderOpen, Grid2X2, Keyboard, Layers, Scissors, ClipboardPaste, CopyPlus, LockKeyhole, Maximize, Monitor, Mouse, MoveUpRight, Plus, Radio, Redo2, RotateCcw, Save, Settings2, SlidersHorizontal, Sparkles, Square, Target, Trash2, Undo2, UnlockKeyhole, Upload, X, Zap } from 'lucide-react';
import { activeProfile, resolvedProfile, cm360, games, initialDocument, MigrationError, parseDocument, uid, yaws, type OverlayModule, type GameProfile, type StudioDocument } from './core/config';
import { InputConnection, obsUrl, type ConnectionOptions } from './core/connection';
import { demo, InputEngine } from './core/input';
import { createBrowserSettings, nativeConnection } from './core/settings/browser';
import { Scene } from './renderer/scene';
import { snapPosition, type Guide } from './core/layout';
import './fonts.css';
import './style.css';
import './midnight.css';
import { capsFor } from './core/skins';
import { importError, validateArtwork } from './core/artwork';
import { nativeOverlayBase, type HttpStatus } from './core/obs';
import { patchModule } from './core/editing';
import { exportPreset, importPreset, usedShapes } from './core/presets';
import { ShapeLibrary } from './shape-controls';
import { PresetLibrary } from './preset-library';
import { setModuleImage, linkArtwork } from './core/artwork-groups';
import { inputPreview, type PreviewState } from './core/preview';
import { InspectorResize } from './inspector-resize';
import { NativeAdvanced, type NativeConfig } from './native-settings';
import { resizeBox, stageLimits, type Box, type ResizeDirection } from './core/transform';
import { TransformHandles } from './transform-handles';
import { commands, displayShortcut, eventShortcut, shortcutCommand, shortcutTargetBlocked, editorShortcutsSuppressed, type Command, type ShortcutMap } from './core/shortcuts';
import { ShortcutSettings } from './shortcut-settings';
import { copyObject, deleteObject, pasteObject, type ObjectClipboard, type ObjectSelection } from './core/object-clipboard';
import { VisualPreviewSettings } from './animation-controls';
import { StyleClipboard } from './style-tools';
import { SettingsFields } from './settings-renderer';
import type { SettingsService } from './core/settings/service';
import { studioLocalization } from './core/localization/builtins';

declare global { interface Window { __TAURI__?: { core: { invoke<T>(name: string, args?: Record<string, unknown>): Promise<T> } } } }

function LegacyPreview({ document: d, engine, selected, select, update, demoMode, snap, safe, background, zoom, setZoom, editingKeys, setEditingKeys, selectedKey, selectKey, previewState, undoShortcuts, viewCommand }: { undoShortcuts: string[]; viewCommand: { id: Command; version: number } | null; setEditingKeys: (value: boolean) => void; previewState: PreviewState; editingKeys: boolean; selectedKey: string | null; selectKey: (id: string) => void; document: StudioDocument; engine: InputEngine; selected: string | null; select: (id: string | null) => void; update: (fn: (draft: StudioDocument) => void) => void; demoMode: boolean; snap: boolean; safe: boolean; background: boolean; zoom: number; setZoom: (n: number) => void }) {
  const moduleUI=useModuleUIRegistry();
  const root = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null);
  const scrollport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 450 });
  const lastViewCommand = useRef(viewCommand?.version);
  const [focusSelection, setFocusSelection] = useState(false);
  const [fitContents, setFitContents] = useState(true);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [keepRatio, setKeepRatio] = useState(true);
  const dragRef = useRef<{ module: OverlayModule; startX: number; startY: number; scale: number; direction?: ResizeDirection; keyboard?: boolean; draft: Box } | null>(null);
  const p = useMemo(() => resolvedProfile(d), [d]);
  const focused = p.modules.find(m => m.id === selected && m.visible && (focusSelection || editingKeys && moduleUI.resolve(moduleKind(m))?.selection==='keys'));
  const renderedProfile = focused ? { ...p, modules: [focused] } : p;
  const visible = p.modules.filter(m => m.visible);
  const bounds = visible.length ? {
    x: Math.max(0, Math.min(...visible.map(m => m.x)) - 32),
    y: Math.max(0, Math.min(...visible.map(m => m.y)) - 48),
    right: Math.min(1920, Math.max(...visible.map(m => m.x + m.w)) + 32),
    bottom: Math.min(1080, Math.max(...visible.map(m => m.y + m.h)) + 32),
  } : null;
  const frame = focused ? { x: focused.x - 32, y: focused.y - 48, w: focused.w + 64, h: focused.h + 96 } : fitContents && bounds ? { x: bounds.x, y: bounds.y, w: Math.max(64, bounds.right - bounds.x), h: Math.max(64, bounds.bottom - bounds.y) } : { x: 0, y: 0, w: 1920, h: 1080 };
  const fitScale = Math.max(.025, Math.min((size.width - 80) / frame.w, (size.height - 96) / frame.h));
  const scale = zoom === 0 ? fitScale : zoom;
  useEffect(() => {
    scene.current = new Scene(root.current!, engine,{registry:moduleUI.runtime});
    return () => { scene.current?.dispose(); scene.current = null; };
  }, [engine,moduleUI]);
  useEffect(() => { scene.current?.update(d, renderedProfile, p.modules); }, [d, p, engine, focused,moduleUI]);
  useEffect(() => { const interactive = p.modules.some(m => m.id === selected && !!moduleUI.resolve(moduleKind(m))?.preview); scene.current?.setPreview(interactive ? previewState : inputPreview(), selected || undefined); }, [previewState, selected, engine, p,moduleUI]);
  useEffect(() => {
    const el = scrollport.current!;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = scrollport.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault(); setZoom(Math.max(.1, Math.min(4, Math.round((scale + (event.deltaY > 0 ? -.1 : .1)) * 100) / 100)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [scale, setZoom]);

  useEffect(() => { if (zoom === 0) scrollport.current?.scrollTo(0, 0); }, [zoom, focused?.id, fitContents]);
  useEffect(() => {
    if (!viewCommand || lastViewCommand.current === viewCommand.version) return; lastViewCommand.current = viewCommand.version; cancel();
    if (viewCommand.id === 'fit') { setFocusSelection(false); setFitContents(false); setZoom(0); scrollport.current?.scrollTo(0,0); }
    else if (viewCommand.id === 'actual') setZoom(1);
    else setZoom(Math.max(.1,Math.min(4,Math.round((scale + (viewCommand.id === 'zoomIn' ? .1 : -.1))*100)/100)));
  },[viewCommand]);
  const callbacks = useRef({ d, p, renderedProfile, update, undoShortcuts }); callbacks.current = { d, p, renderedProfile, update, undoShortcuts };
  const restore = () => { const c = callbacks.current; scene.current?.update(c.d, c.renderedProfile, c.p.modules); };
  const cancel = () => { if (!dragRef.current) return; dragRef.current = null; setDrag(null); setGuides([]); restore(); };
  const end = () => {
    const g = dragRef.current; if (!g) return;
    dragRef.current = null; setDrag(null); setGuides([]); restore();
    if ((['x', 'y', 'w', 'h'] as const).some(k => g.module[k] !== g.draft[k])) callbacks.current.update(doc => {
      const m = activeProfile(doc).modules.find(v => v.id === g.module.id);
      if (m && !m.locked && activeProfile(doc).id === callbacks.current.p.id) patchModule(m, g.draft);
    });
  };
  useEffect(() => {
    const keydown = (e: globalThis.KeyboardEvent) => { if (dragRef.current && (e.key === 'Escape' || callbacks.current.undoShortcuts.includes(eventShortcut(e) || ''))) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const keyup = (e: globalThis.KeyboardEvent) => { if (e.key.startsWith('Arrow') && dragRef.current?.keyboard) end(); };
    const blur = () => cancel();
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur); window.addEventListener('resize', blur);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, []);
  useEffect(() => { cancel(); }, [d, zoom, editingKeys]);
  const show = (box: Box) => {
    const g = dragRef.current; if (!g) return; g.draft = box;
    const draft = { ...g.module, ...box }; setDrag({ id: draft.id, ...box });
    scene.current?.update(d, { ...renderedProfile, modules: renderedProfile.modules.map(m => m.id === draft.id ? draft : m) }, p.modules.map(m => m.id === draft.id ? draft : m));
  };
  const begin = (e: React.PointerEvent, m: OverlayModule, direction?: ResizeDirection) => {
    e.stopPropagation(); if (e.button !== 0) return; e.preventDefault(); select(m.id);
    if (m.locked || !direction && editingKeys && moduleUI.resolve(moduleKind(m))?.selection==='keys' && selected === m.id) return;
    e.currentTarget.setPointerCapture(e.pointerId); (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    dragRef.current = { module: m, startX: e.clientX, startY: e.clientY, scale, direction, draft: { x: m.x, y: m.y, w: m.w, h: m.h } };
  };
  const move = (e: React.PointerEvent) => {
    const g = dragRef.current; if (!g || g.keyboard) return;
    const m = g.module, dx = (e.clientX - g.startX) / g.scale, dy = (e.clientY - g.startY) / g.scale;
    if (g.direction) { setGuides([]); show(resizeBox(m, g.direction, dx, dy, stageLimits, keepRatio !== e.shiftKey, snap && !e.altKey ? 8 : 1)); return; }
    let next = { x: Math.max(0, Math.min(1920 - m.w, Math.round(m.x + dx))), y: Math.max(0, Math.min(1080 - m.h, Math.round(m.y + dy))), w: m.w, h: m.h };
    if (snap && !e.altKey) { const snapped = snapPosition({ ...next, id: m.id }, p.modules, 6 / g.scale); next = { ...next, x: snapped.x, y: snapped.y }; setGuides(snapped.guides); } else setGuides([]);
    show(next);
  };
  const keyboard = (e: React.KeyboardEvent, m: OverlayModule, direction?: ResizeDirection) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); select(m.id); return; }
    if (!e.key.startsWith('Arrow') || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); select(m.id); if (m.locked || editingKeys && moduleUI.resolve(moduleKind(m))?.selection==='keys') return;
    if (!dragRef.current) dragRef.current = { module: m, startX: 0, startY: 0, scale, direction, keyboard: true, draft: { x: m.x, y: m.y, w: m.w, h: m.h } };
    const g = dragRef.current; if (!g.keyboard) return;
    const step = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    show(direction ? resizeBox(g.draft, direction, dx, dy, stageLimits, keepRatio) : { ...g.draft, x: Math.max(0, Math.min(1920 - g.draft.w, g.draft.x + dx)), y: Math.max(0, Math.min(1080 - g.draft.h, g.draft.y + dy)) });
  };
  return <div className="preview-viewport" ref={viewport}>
    <div className="canvas-info"><span className="canvas-live"><span className={demoMode ? 'dot amber' : 'dot'}/>{previewState.mode !== 'Input' && p.modules.some(m => m.id === selected && !!moduleUI.resolve(moduleKind(m))?.preview) ? tr('ui:s-ad7ecd5751b4',"{{p0}} · EDITOR PREVIEW",{p0:trText(previewState.mode).toUpperCase()}) : demoMode ? tr('ui:s-7e14a3db13c3',"DEMO PREVIEW") : tr('ui:s-9da051df9794',"LIVE PREVIEW")}</span><span>{focused ? `${editingKeys && moduleUI.resolve(moduleKind(focused))?.selection==='keys' ? trText('KEY LAYOUT') : trText('FOCUS')} · ${focused.name}` : <>{fitContents ? tr('ui:s-eabe6aca2f0d',"CONTENTS") : '1920 × 1080'} <span className="dim">/</span> {fitContents ? '1920 × 1080' : '16:9'}</>}</span></div>
    <div className="canvas-scroll" ref={scrollport}>
      <div className={`canvas-shell ${background ? 'game-background' : 'checker'}`} style={{ width: frame.w * scale + 48, height: frame.h * scale + 64 }} onPointerDown={() => select(null)}>
        {background && <div className="game-scene"><div className="map-lines"/><div className="crosshair">+</div><span>{tr('ui:s-9f34e4e5733d',"BACKGROUND PREVIEW")}</span></div>}
        <div className="scene-scale" style={{ left: 24, top: 32, transform: `scale(${scale})` }}><div className="canvas-origin" style={{ position: 'absolute', left: -frame.x, top: -frame.y, width: 1920, height: 1080 }}><div ref={root}/>
          {safe && <div className="safe-area"><span>{tr('ui:s-79ea7b14b8b2',"OBS SAFE AREA · 90%")}</span></div>}
          {renderedProfile.modules.filter(m => m.visible).map(m => { const r = drag?.id === m.id ? drag : m,CanvasEditor=moduleAvailable(m)?moduleUI.resolve(moduleKind(m))?.canvasEditor:undefined; return <div key={m.id} role="button" tabIndex={0} aria-label={tr('ui:s-f61bbed36f1d',"Select {{p0}}",{p0:String(m.name)})} className={`module-hitbox ${selected === m.id ? 'selected' : ''} ${m.locked ? 'locked' : ''} ${selected === m.id && editingKeys && moduleUI.resolve(moduleKind(m))?.selection==='keys' ? 'key-editing' : ''}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: m.z + 1001, '--handle-unit': `${1 / scale}px` } as React.CSSProperties} onKeyDown={e => keyboard(e, m)} onDoubleClick={e => { e.stopPropagation(); if (moduleUI.resolve(moduleKind(m))?.selection==='keys') { select(m.id); setEditingKeys(true); } }} onPointerDown={e => begin(e, m)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel}>
            {selected === m.id && CanvasEditor && editingKeys && <RegisteredCanvasEditor editor={CanvasEditor} module={m} undoShortcuts={undoShortcuts} scale={scale} selected={m.keys.find(k => k.id === selectedKey)?.id || m.keys[0]?.id || null} select={selectKey} snap={snap} preview={(module, capScale) => {
              const bounds = module ? capsFor(module) : null;
              const draft = module && bounds && capScale ? { ...module, w: bounds.w * capScale, h: bounds.h * capScale } : module;
              scene.current?.update(d, draft ? { ...renderedProfile, modules: renderedProfile.modules.map(v => v.id === draft.id ? draft : v) } : renderedProfile, draft ? p.modules.map(v => v.id === draft.id ? draft : v) : p.modules);
            }} commit={(id, key) => update(doc => { const current = activeProfile(doc).modules.find(v => v.id === m.id); if (!current || current.locked || activeProfile(doc).id !== p.id) return; current.keys = current.keys.map(k => k.id === id ? { ...k, x: key.x, y: key.y, w: key.w, h: key.h } : k); current.layout = 'Custom'; })}/>}
            {selected === m.id && <span className="selection-label">{m.name} <span>{Math.round(r.w)} × {Math.round(r.h)}</span></span>}
            {!m.locked && !(selected === m.id && editingKeys && moduleUI.resolve(moduleKind(m))?.selection==='keys') && <TransformHandles name={m.name} selected={selected === m.id} begin={(e, direction) => begin(e, m, direction)} move={move} finish={end} cancel={cancel} keyboard={(e, direction) => keyboard(e, m, direction)}/>}
          </div>; })}
          {guides.map((guide, i) => <div key={i} className={guide.axis === 'x' ? 'guide-x' : 'guide-y'} style={guide.axis === 'x' ? { left: guide.value } : { top: guide.value }}/>) }
        </div></div>
      </div>
    </div>
    <div className="canvas-bottom"><span><Mouse size={13}/>{editingKeys && focused && moduleUI.resolve(moduleKind(focused))?.selection==='keys' ? <>{tr('ui:s-d8ff8d786897',"Drag keys")}<i/>{tr('ui:s-c48202b36e59',"Arrows: 1 · Shift: 10")}</> : <>{tr('ui:s-c11c9025a45c',"Drag to position")}<i/>{tr('ui:s-380dca91b2f3',"Resize edges · Shift: ratio · Alt: no snap")}</>}</span><div>{!(editingKeys && focused && moduleUI.resolve(moduleKind(focused))?.selection==='keys') && <button className="focus-selection" aria-label={tr('ui:s-eef46f524b18',"Keep proportions")} aria-pressed={keepRatio} title={tr('ui:s-49f0b927e0d3',"Keep proportions while resizing. Hold Shift to invert; Alt disables snapping.")} onClick={() => setKeepRatio(!keepRatio)}>{keepRatio ? tr('ui:s-918daf79abb2',"Proportions locked") : tr('ui:s-fcbbb62a82be',"Free resize")}</button>}<button className="focus-selection" title={tr('ui:s-d3e2c4c9e075',"Fit all visible modules in the editor; OBS output stays the same")} aria-pressed={fitContents && !focusSelection} onClick={() => { setFocusSelection(false); setFitContents(true); setZoom(0); }}>{tr('ui:s-6f29c3463e78',"Fit contents")}</button><button className={`focus-selection ${focusSelection ? 'active' : ''}`} disabled={!p.modules.some(m => m.id === selected && m.visible)} title={tr('ui:s-28e50b5fabe2',"Enlarge the selected module for editing; OBS output stays the same")} aria-pressed={focusSelection} onClick={() => { setFocusSelection(!focusSelection); setZoom(0); }}>{tr('ui:s-32ab847ddf92',"Focus selection")}</button><button onClick={() => setZoom(Math.max(.1, Math.round((scale - .1) * 100) / 100))} aria-label={tr('ui:s-bc7b631a689b',"Zoom out")}>−</button><span title={tr('ui:s-7dec1aecebb6',"Actual scene scale")}>{Math.round(scale * 100)}%</span><button className="actual-size" title={tr('ui:s-327f2aadf5be',"Show at actual size (100%)")} aria-label={tr('ui:s-3322819f9a69',"Actual size (100%)")} onClick={() => setZoom(1)}>100%</button><button onClick={() => setZoom(Math.min(4, Math.round((scale + .1) * 100) / 100))} aria-label={tr('ui:s-0e47f09a748f',"Zoom in")}>+</button><IconButton title={tr('ui:s-438c41a7af19',"Fit canvas")} onClick={() => { setFocusSelection(false); setFitContents(false); setZoom(0); scrollport.current?.scrollTo(0, 0); }}><Maximize size={14}/></IconButton></div></div>
  </div>;
}

function ProfileEditor({ settings, profile: p, change }: { settings: SettingsService; profile: GameProfile; change: (patch: Partial<GameProfile>) => void }) {
  const cm = cm360(p);
  return <DocumentSettingsProvider settings={settings} address={{scope:'game-profile',profileId:p.id}}><div className="profile-editor"><div className="section-heading"><span className="eyebrow">{tr('ui:s-a18973e87f83',"MOUSE & SENSITIVITY")}</span><h2>{tr('ui:s-b8088dec8578',"A setup that feels like you.")}</h2><p>{tr('ui:s-aca69fee2baf',"DPI and sensitivity are shared by every overlay linked to this game.")}</p></div><div className="profile-form"><section><RegisteredField id="profiles.game.name" label={tr('ui:s-d3663280e101',"Profile name")} fallback={<label className="field"><span>{tr('ui:s-d3663280e101',"Profile name")}</span><UnicodeInput value={p.name} maxLength={100} onChange={e => { if (e.target.value.trim()) change({ name: e.target.value }); }}/></label>}/><Select settingId="profiles.game.game" label={tr('ui:s-5c412a262086',"Game")} value={p.game} options={games} onChange={game => change({ game, yaw: yaws[game] || p.yaw, scale: game === 'KovaaK’s' ? 'Unknown' : p.scale })}/><div className="field-grid"><NumberField settingId="profiles.game.dpi" label={tr('ui:s-943673819397',"Mouse DPI")} value={p.dpi} min={.01} onChange={dpi => change({ dpi })}/><NumberField settingId="profiles.game.sensitivity" label={tr('ui:s-e430a2ad130a',"In-game sensitivity")} step={.01} value={p.sensitivity} min={.000001} onChange={sensitivity => change({ sensitivity })}/></div>{p.game === 'KovaaK’s' && <Select settingId="profiles.game.scale" label={tr('ui:s-cefef7e4137f',"Sensitivity scale")} value={p.scale} options={['Unknown', 'Source', 'Valorant', 'Overwatch', 'Custom yaw', 'Manual cm/360']} onChange={scale => change({ scale })}/>}<NumberField settingId="profiles.game.yaw" label={tr('ui:s-f5017cb9b507',"Yaw factor / m_yaw")} step={.001} value={p.yaw} min={.000001} onChange={yaw => change({ yaw, ...(p.game === 'KovaaK’s' ? { scale: 'Custom yaw' as const } : {}) })}/>{p.game === 'KovaaK’s' && p.scale === 'Manual cm/360' && <NumberField settingId="profiles.game.manual-cm" label={tr('ui:s-6cf4113d28c0',"Manual cm/360")} value={p.manualCm} min={.001} onChange={manualCm => change({ manualCm })}/>}</section><section className="calculation"><Target size={26}/><span>{tr('ui:s-842f3c7fc9bd',"YOUR SENSITIVITY")}</span><strong>{cm === null ? '—' : cm.toFixed(2)}<small>{tr('ui:s-c3625d60b7e5',"cm / 360°")}</small></strong>{cm === null ? <p className="warning">{tr('ui:s-37c8eef63750',"Choose the actual KovaaK’s scale, enter a custom yaw, or supply cm/360. No scale is assumed.")}</p> : <p>{tr('ui:s-25c6983a30f1',"A full turn, in physical mouse movement.")}</p>}<div className="calc-details"><div><span>{tr('ui:s-3134a5551bed',"eDPI")}</span><b>{(p.dpi * p.sensitivity).toFixed(1)}</b></div><div><span>{tr('ui:s-943673819397',"Mouse DPI")}</span><b>{p.dpi}</b></div><div><span>{tr('ui:s-8611a515d59f',"In-game")}</span><b>{p.sensitivity}</b></div></div><p className="hint">{tr('ui:s-22c3ff5c8c56',"Linear, unscoped horizontal rotation. Acceleration, zoom sensitivity and FOV-dependent scales are not modeled. eDPI is specific to each game scale.")}</p></section></div></div></DocumentSettingsProvider>;
}

function App() {
  const moduleUI=useModuleUIRegistry();
  const [liveEngine] = useState(() => new InputEngine()), [demoEngine] = useState(() => new InputEngine());
  const [connection] = useState(() => new InputConnection(liveEngine,'studio',moduleUI.configurations));
  const [services] = useState(() => createBrowserSettings(connection, () => {
    const api = window.__TAURI__?.core; if (!api) throw Error('Native settings are unavailable in the browser.'); return api;
  },moduleUI.catalog,moduleUI.configurations));
  const { settings, preferences, native: nativeSettings, support } = services;
  const supportView=useSyncExternalStore(support.subscribe,support.getSnapshot);
  const settingsView = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const preferenceView = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot);
  const localeRevision=useSyncExternalStore(studioLocalization.subscribe,studioLocalization.getSnapshot);
  useEffect(() => {
    let active=true;
    const apply=()=>{try{studioLocalization.setCustomPacks(preferenceView.languagePacks);studioLocalization.selectPackage(preferenceView.localePackageId,preferenceView.locale);}catch{studioLocalization.setCustomPacks([]);studioLocalization.setLocale(preferenceView.locale);}};
    apply();void loadBuiltinLanguage(preferenceView.locale).then(()=>{if(active)apply();},()=>{});
    document.documentElement.lang=preferenceView.locale;document.documentElement.dir=languageChoices(preferenceView.languagePacks).find(p=>p.id===(preferenceView.localePackageId??preferenceView.locale))?.direction??'ltr';
    return ()=>{active=false;};
  },[preferenceView.locale,preferenceView.localePackageId,preferenceView.languagePacks]);
  useEffect(()=>{void window.__TAURI__?.core.invoke('set_interface_labels',{settings:trText('Settings'),quit:studioLocalization.text('language:exit','Exit')}).catch(()=>{});},[localeRevision]);
  const d = settingsView.document, warning = settingsView.warning, conflict = settingsView.conflict;
  const saveStatus = settingsView.saveStatus, connectionState = settingsView.connectionState, historyVersion = settingsView.version;
  const setWarning = useCallback((message: string) => settings.setWarning(message), [settings]);
  const [toast, setToast] = useState('');
  const [setupStart,setSetupStart]=useState(preferences.getSnapshot().setup.step);
  const [setupOpen,setSetupOpen]=useState(()=>['new','in-progress'].includes(preferences.getSnapshot().setup.status));
  const [setupSuspended,setSetupSuspended]=useState(false);
  const [page, setPage] = useState('Studio'), [selected, setSelected] = useState<string | null>(() => activeProfile(d).modules.find(m => moduleUI.resolve(moduleKind(m))?.preferred)?.id || null);
  const [connectionFocus,setConnectionFocus]=useState(0);
  const focusConnection=useRef(false);
  const openConnectionSettings=()=>{focusConnection.current=true;setConnectionFocus(value=>value+1);setPage('Settings');};
  useEffect(()=>{if(page!=='Settings'||!focusConnection.current)return;const section=document.querySelector<HTMLElement>('[data-settings-section=connection]');if(section){focusConnection.current=false;section.scrollIntoView({block:'start'});section.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});}},[page,connectionFocus]);
  const [previewState, setPreviewState] = useState(inputPreview);
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth >= 1240);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorSize = preferenceView.inspectorWidth, setInspectorSize = (value: number) => preferences.set('studio.preferences.inspector-width', value);
  const [windowWidth,setWindowWidth] = useState(window.innerWidth);
  const inspectorMax = Math.max(320,Math.min(560,Math.floor(windowWidth*.42))), inspectorWidth = Math.min(inspectorSize,inspectorMax);
  useEffect(() => { const resize = () => setWindowWidth(window.innerWidth), compact = matchMedia('(max-width:1239px)'), layers = () => setLayersOpen(!compact.matches); window.addEventListener('resize',resize); compact.addEventListener('change',layers); return () => { window.removeEventListener('resize',resize); compact.removeEventListener('change',layers); }; },[]);
  const selectModule = (id: string | null) => { if (id !== selected) { setEditingKeys(false); setEditingButtons(false); } setSelected(id); if (id) { setInspectorOpen(true); if (window.innerWidth < 1240) setLayersOpen(false); } };
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editingKeys, setEditingKeys] = useState(false), [selectedKey, selectKey] = useState<string | null>(null);
  const [editingButtons, setEditingButtons] = useState(false), [selectedButton, selectButton] = useState(1);
  const shortcuts = preferenceView.shortcuts;
  const [objectClipboard, setObjectClipboard] = useState<{ object: ObjectClipboard; count: number; cut: boolean } | null>(null);
  const [viewCommand, setViewCommand] = useState<{id:Command;version:number}|null>(null);

  const [demoMode, setDemoMode] = useState(false), [snap, setSnap] = useState(true), [safe, setSafe] = useState(false), [background, setBackground] = useState(false), [zoom, setZoom] = useState(0);
  const [options, setOptions] = useState<ConnectionOptions>(() => preferenceView.connection);
  const [connectionDraft, setConnectionDraft] = useState(options);
  const [connectionError,setConnectionError]=useState(false),[captureError,setCaptureError]=useState<ReturnType<typeof nativeSettingsError>|null>(null);
  useEffect(() => setConnectionDraft(options), [options]);
  const [devices, setDevices] = useState<{ keyboard_count: number; mouse_count: number; capture_running: boolean } | null>(null);
  const [httpStatus, setHttpStatus] = useState<HttpStatus | null>(null);
  const [nativeDraft]=useState(()=>new NativeSettingsDraft(nativeSettings));
  const native=useSyncExternalStore(nativeDraft.subscribe,nativeDraft.getSnapshot), setNative=(config:NativeConfig)=>nativeDraft.replace(config);
  useEffect(()=>()=>nativeDraft.dispose(),[nativeDraft]);
  const engine = demoMode ? demoEngine : liveEngine;
  const gestureTarget = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const editable = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement => target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button', 'submit'].includes(target.type);
  const beginGesture = (target: EventTarget | null, restart = false) => { if (editable(target)) { gestureTarget.current = target; settings.beginGesture(target, restart); } };
  const endGesture = () => { gestureTarget.current = null; settings.endGesture(); };
  useEffect(() => { const endRange = () => { if (gestureTarget.current?.type === 'range') endGesture(); }; window.addEventListener('pointerup', endRange); window.addEventListener('blur', endGesture); return () => { window.removeEventListener('pointerup', endRange); window.removeEventListener('blur', endGesture); }; }, []);
  const file = useRef<HTMLInputElement>(null);
  const p = resolvedProfile(d), selectedModule = p.modules.find(m => m.id === selected);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => { setToast(trText(text)); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4000); }, []);
  const update = useCallback((fn: (draft: StudioDocument) => void) => settings.transaction(fn), [settings]);
  const changeModule = (patch: Partial<OverlayModule>) => update(doc => { const m = activeProfile(doc).modules.find(v => v.id === selected); if (m) { patchModule(m, patch); if (patch.image) setModuleImage(activeProfile(doc).modules, m.id, m.image); } });
  const undo = settings.undo, redo = settings.redo;
  useEffect(() => { if (demoMode) { demoEngine.distanceCm = 0; return demo(demoEngine); } }, [demoMode, demoEngine]);
  useEffect(() => {
    if (!window.__TAURI__) return;
    const refresh = () => { void window.__TAURI__!.core.invoke<HttpStatus | null>('get_http_status').then(setHttpStatus).catch(() => setHttpStatus(null)); void window.__TAURI__!.core.invoke<{ keyboard_count: number; mouse_count: number; capture_running: boolean }>('get_device_status').then(setDevices).catch(() => setDevices(null)); };
    refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!window.__TAURI__) return;
    let active = true;
    void window.__TAURI__.core.invoke<unknown>('get_startup_warning').then(message => { if (active && message) setCaptureError(nativeSettingsError(message)); }).catch(() => {});
    void nativeSettings.read().then(cfg => { if (active) { setNative(cfg); setOptions(nativeConnection(cfg)); } }).catch(() => { if (active) setWarning(tr('ui:s-9fb94b1a7e3d',"Native server settings could not be loaded. Check the local server.")); });
    return () => { active = false; };
  }, [nativeSettings, setWarning]);
  useEffect(() => settings.connect(options), [settings, options]);
  useEffect(() => () => services.dispose(), [services]);
  useEffect(() => {
    const startup = settings.document; let active = true;
    void validateArtwork(startup.assets).catch(error => { if (active) settings.protect((error as Error).message, startup); });
    return () => { active = false; };
  }, [settings]);
  useEffect(() => { liveEngine.dpi = p.dpi; demoEngine.dpi = p.dpi; }, [p.dpi, liveEngine, demoEngine]);
  useEffect(() => { window.addEventListener('pagehide', settings.flush); return () => { window.removeEventListener('pagehide', settings.flush); clearTimeout(toastTimer.current); }; }, [settings]);
  const save = () => { if (settings.save()) notify(settings.getSnapshot().conflict ? tr('ui:s-bfeb2d28b098',"Local draft saved. Resolve the conflict to publish it.") : tr('ui:s-7ea24504bf3b',"Saved locally. Synchronizing with the server.")); };
  const makeOBSUrl = async () => {
    if (connectionState !== 'Connected') throw Error(tr('ui:s-73b6fba1bdd5',"Connect to the capture server in Settings before copying an OBS source."));
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
    } catch (error) { throw error instanceof Error ? error : Error(tr('ui:s-a3c34bac7e36',"The overlay page is unavailable. Check the HTTP server.")); }
    settings.flush();
    return obsUrl(options,base);
  };
  const copyOBS = async () => {
    let url:string;
    try{url=await makeOBSUrl();}catch(error){setWarning(trError(error));setPage('Settings');return;}
    try{await navigator.clipboard.writeText(url);notify(tr('ui:s-c232048d9b78',"OBS URL copied · Browser Source: 1920 × 1080"));}
    catch{setWarning(tr('ui:s-6341812541a4',"Clipboard access failed. Open Settings to select and copy the OBS URL manually."));setPage('Settings');}
  };
  const applyPreset = (preset:StudioDocument['presets'][number],colors:boolean,source?:PresetBundle) => {
    const accepted=update(doc=>applyPresetToDocument(doc,preset,colors,source));
    if(accepted){if(!colors)selectModule(activeProfile(settings.document).modules.find(m=>moduleUI.resolve(moduleKind(m))?.preferred)?.id??null);notify(colors?tr('ui:s-105e7878e70b',"Colors applied. Your layout is preserved."):tr('ui:s-98d441f33a24',"Full layout applied. Undo restores your previous composition."));}
    return accepted;
  };
  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(encodeDocument(d))], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'input-overlay-studio.json'; a.click(); URL.revokeObjectURL(url); notify(tr('ui:s-0f15368964ee',"Configuration exported without connection credentials"));
  };
  const exportOriginal = () => {
    const original = settings.getSnapshot().unsupported; if (!original?.text) return;
    const url = URL.createObjectURL(new Blob([original.text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `input-overlay-original-v${original.version}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const downloadPreset = (id: string) => {
    const url = URL.createObjectURL(new Blob([exportPreset(settings.document, id)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'input-overlay-preset.json'; a.click(); URL.revokeObjectURL(url); notify(tr('ui:s-733f3e9dd226',"Preset exported with embedded images"));
  };
  const readPreset = async (file: File) => { try { if (file.size > 2_000_000) throw Error(); const bundle = importPreset(await file.text(),settings.document); await validateArtwork(bundle.assets); if (settings.document.presets.length >= 50) throw Error(); update(doc => { Object.assign(doc.assets, bundle.assets); Object.assign(doc.shapes, bundle.shapes); doc.presets.push(bundle.preset); }); } catch (error) { setWarning(importError(error, 'Preset import rejected. Choose a valid Input Overlay Studio preset smaller than 2 MB.')); } };
  const importConfig = async (f: File) => {
    let text = '';
    try {
      if (f.size > 2_000_000) throw Error('File exceeds 2 MB.');
      text = await f.text(); const doc = parseDocument(text); await validateArtwork(doc.assets);
      if (!settings.replace(doc, { source: 'import', allowOverwrite: true })) throw Error('Configuration could not be applied.');
      setWarning(''); notify(tr('ui:s-301066d5e67f',"Configuration imported"));
    } catch (error) {
      if (error instanceof MigrationError && error.code === 'future-version') {
        settings.inspectUnsupported({source:'import',version:error.sourceVersion!,reason:error.message,text}); return;
      }
      setWarning(importError(error, 'Import rejected: invalid or unsupported configuration. Current settings are unchanged.'));
    }
  };

  const addModule = (id:DefinitionId) => { if(p.modules.length>=32)return;try{const m=moduleUI.create(id,p.modules.length),before=settings.document;update(doc=>activeProfile(doc).modules.push(m));if(settings.document!==before){selectModule(m.id);setLibraryOpen(false);}}catch{notify(tr('ui:s-efd43c094d45',"This module could not be added. The current layout is kept."));} };
  const restore = () => { try { if (settings.restoreBackup()) { setWarning(''); notify(tr('ui:s-0a4cba5f7bd3',"Backup restored")); } } catch (e) { notify(trError(e)); } };
  const saveNative = async () => { if (!native || !window.__TAURI__) return; try { const saved = await nativeDraft.apply(); setOptions(nativeConnection(saved)); setCaptureError(null); notify(tr('ui:s-5bae1efe0024',"Capture server settings saved")); } catch (error) { setCaptureError(error instanceof SettingsError?error:nativeSettingsError(error)); } };
  const objectSelection = (): ObjectSelection | null => selectedModule ? { moduleId: selectedModule.id, ...(editingKeys && moduleUI.resolve(moduleKind(selectedModule))?.selection==='keys' ? { keyId: selectedModule.keys.find(k => k.id === selectedKey)?.id || selectedModule.keys[0]?.id || '' } : editingButtons && moduleUI.resolve(moduleKind(selectedModule))?.selection==='buttons' ? {button:selectedButton} : {}) } : null;
  const selectObject = (selection: ObjectSelection | null, kind: ObjectClipboard['kind'] = 'module') => {
    if (!selection) { selectModule(null); setEditingKeys(false); setEditingButtons(false); return; }
    selectModule(selection.moduleId); setEditingKeys(kind === 'key'); setEditingButtons(kind === 'button');
    if (kind === 'key') selectKey(selection.keyId || null); if (selection.button) selectButton(selection.button);
  };
  const runCommand = (command: Command, override?: ObjectSelection) => {
    endGesture();
    if (command === 'undo') { undo(); return; } if (command === 'redo') { redo(); return; } if (command === 'save') { save(); return; }
    if (page !== 'Studio') return;
    if (command === 'grid') { setSnap(v => !v); return; } if (command === 'inspector') { setInspectorOpen(v => !v); return; } if (command === 'layers') { setLayersOpen(v => !v); return; }
    if (['fit','actual','zoomIn','zoomOut'].includes(command)) { setViewCommand(v => ({id:command,version:(v?.version || 0)+1})); return; }
    if (command === 'editKeys') { if (selectedModule && moduleUI.resolve(moduleKind(selectedModule))?.selection==='keys') setEditingKeys(v => !v); else if (selectedModule && moduleUI.resolve(moduleKind(selectedModule))?.selection==='buttons') setEditingButtons(v => !v); else notify(tr('ui:s-3423b1b9f134',"Select a keyboard or mouse module first.")); return; }
    const selection = override || objectSelection();
    try {
      if (command === 'paste') {
        if (!objectClipboard) { notify(tr('ui:s-8c7c292ba222',"Copy an object in Studio before pasting. Text clipboard contents are kept separately.")); return; }
        let pasted: ObjectSelection | null = null; const before = settings.document;
        update(doc => { pasted = pasteObject(doc,objectClipboard.object,selection,objectClipboard.cut && objectClipboard.count === 0 ? 0 : 24*(objectClipboard.count+1),false,objectClipboard.cut && objectClipboard.count === 0); });
        if (settings.document !== before) { selectObject(pasted,objectClipboard.object.kind); setObjectClipboard({...objectClipboard,count:objectClipboard.count+1}); notify(tr('ui:s-d587edd892e2',"Selection pasted. Undo restores the previous layout.")); }
        return;
      }
      if (!selection) { notify(tr('ui:s-556cf8d132b1',"Select a module, key or mouse button first.")); return; }
      const kind = selection.keyId !== undefined ? 'key' : selection.button !== undefined ? 'button' : 'module';
      if (command === 'copy') { setObjectClipboard({object:copyObject(settings.document,selection),count:0,cut:false}); notify(tr('ui:s-b36ca220e33b',"{{p0}} copied to the Studio object clipboard.",{p0:String(kind === 'key' ? 'Key' : kind === 'button' ? 'Mouse button' : 'Module')})); return; }
      if (command === 'duplicate') {
        const copy = copyObject(settings.document,selection,false); let pasted: ObjectSelection | null = null; const before = settings.document;
        update(doc => { pasted = pasteObject(doc,copy,selection,24,true); }); if (settings.document !== before) selectObject(pasted,copy.kind); return;
      }
      if (command === 'delete' || command === 'cut') {
        const copy = command === 'cut' ? copyObject(settings.document,selection) : null; let next: ObjectSelection | null = null; const before = settings.document;
        update(doc => { next = deleteObject(doc,selection); }); if (settings.document === before) return;
        if (copy) setObjectClipboard({object:copy,count:0,cut:true}); selectObject(next,kind); notify(command === 'cut' ? tr('ui:s-83c367848ba9',"Selection cut. Paste restores the object and its resources.") : kind === 'button' ? tr('ui:s-492e3a3952f6',"Mouse button hidden. Undo restores it.") : tr('ui:s-5f62e5bba397',"Selection deleted. Undo restores it."));
      }
    } catch (error) { notify(error instanceof Error ? trError(error) : tr('ui:s-130d77a7dcd0',"The command could not be completed.")); }
  };
  const shortcutActions = useRef({ runCommand, page, editingKeys, editingButtons, selectModule, setEditingKeys, setEditingButtons }); shortcutActions.current = { runCommand, page, editingKeys, editingButtons, selectModule, setEditingKeys, setEditingButtons };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || editorShortcutsSuppressed() || shortcutTargetBlocked(e.target) || document.querySelector('dialog[open],.key-recorder.waiting,[data-shortcut-capture=true]')) return;
      const state = shortcutActions.current;
      if (e.key === 'Escape' && state.page === 'Studio') { e.preventDefault(); if (state.editingKeys) state.setEditingKeys(false); else if (state.editingButtons) state.setEditingButtons(false); else state.selectModule(null); return; }
      const command = shortcutCommand(e,shortcuts); if (!command || state.page !== 'Studio' && !['undo','redo','save'].includes(command)) return;
      e.preventDefault(); if (!e.repeat) state.runCommand(command);
    };
    window.addEventListener('keydown',onKey); return () => window.removeEventListener('keydown',onKey);
  },[shortcuts]);
  const changeShortcuts = (bindings: ShortcutMap) => { if (!preferences.set('studio.preferences.shortcuts', bindings)) notify(tr('ui:s-1cedd11b37c0',"Could not save shortcuts. Your previous bindings are unchanged.")); };
  const commandHint = (id: Command) => shortcuts[id].map(displayShortcut).join(' / ') || 'Not assigned';
  let obsBase = new URL('overlay.html', location.href).toString().split('#')[0], httpMessage = '';
  if (window.__TAURI__) { try { obsBase = nativeOverlayBase(httpStatus); httpMessage = `HTTP server running · port ${httpStatus!.port}`; } catch (error) { obsBase = ''; httpMessage = (error as Error).message; } }

  const headingActions = <div className="heading-actions"><button className="secondary" disabled={!!settingsView.unsupported} onClick={save}><Save size={15}/>{tr('ui:s-0c8209e72ec8',"Save profile")}</button><button className="primary" onClick={copyOBS}><Copy size={15}/>{tr('ui:s-835ff4bcf601',"Copy OBS URL")}<MoveUpRight size={14}/></button></div>;
  return <VisualPreviewSettings.Provider value={d.performance}><ShapeLibrary.Provider value={{ shapes: d.shapes, add: (shape, apply) => {
    if (Object.keys(settings.document.shapes).length >= 32) throw Error('The shape library is full. Remove unused shapes first.');
    const id = uid();
    const accepted = settings.batch(() => { update(doc => { doc.shapes[id] = shape; }); apply(id); }, { source: 'shape-import', scopes: ['global', 'module'] });
    if (!accepted) throw Error('Shape exceeds configuration limits.');
  }, removeUnused: () => update(doc => { const used = usedShapes([...doc.profiles, ...doc.presets].flatMap(p => p.modules)); doc.shapes = Object.fromEntries(Object.entries(doc.shapes).filter(([id]) => used.has(id))); }) }}><div className="app-shell" data-page={page} data-history={historyVersion}
    onFocusCapture={e => beginGesture(e.target)} onInputCapture={e => beginGesture(e.target)}
    onBlurCapture={endGesture} onPointerCancelCapture={endGesture}
    onPointerDownCapture={e => { if (editable(e.target)) { if (e.target.type === 'range' || e.target.type === 'color') beginGesture(e.target, true); } else endGesture(); }}
    onKeyUpCapture={e => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') endGesture(); }}>
    <aside className="navigation"><div className="brand" translate="no"><div className="brand-mark"><img src="./logo.svg" width="36" height="36" alt=""/></div><div>input<span>OVERLAY STUDIO</span></div></div><div className="nav-caption">{tr('ui:s-5493ff8e9397',"WORKSPACE")}</div><nav>{[{ name: 'Studio', icon: SlidersHorizontal }, { name: 'Profiles', icon: FolderOpen }, { name: 'Presets', icon: Layers }, { name: 'Settings', icon: Settings2 }].map(({ name, icon: Icon }) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><Icon size={18}/>{trText(name)}{page === name && <span/>}</button>)}</nav><header className="topbar"><div className="breadcrumb">{tr('ui:s-87bb59ba2f92',"Workspace")}<ChevronRight size={13}/><b>{page==='Support'?studioLocalization.text('support:title'):trText(page)}</b></div><div className="topbar-right"><span className={`connection-badge ${connectionState === 'Connected' ? 'connected' : ''}`}><span className="dot"/>{connectionState === 'Connected' ? tr('ui:s-db7d7c03a8f5',"Capture server connected") : trText(connectionState)}</span><span className="divider"/><span className="platform"><Monitor size={14}/>{tr('ui:s-d598026a9cbc',"Windows")}</span></div></header>{page === 'Studio' && headingActions}<div className="nav-bottom support-navigation">{supportView.enabled&&!(page==='Studio'&&layersOpen)&&<SupportEntry active={page==='Support'} open={()=>setPage('Support')}/>}<div className="local-badge"><Monitor size={15}/><div>{tr('ui:s-5f5169e1e47c',"Made for your stream")}<span>{tr('ui:s-64f4f8bb2fd9',"LOCAL · PRIVATE · OFFLINE")}</span></div></div><div className="version">STUDIO<span>{appVersion}</span></div></div></aside>
    <div className="main-shell">
    {page !== 'Studio' && <div className="workspace-heading"><div><div className="eyebrow">{page === 'Studio' ? tr('ui:s-eefc2444127e',"YOUR INPUT. IN FOCUS.") : "INPUT OVERLAY STUDIO"}</div><h1>{page === 'Studio' ? tr('ui:s-0aa91af2ec4c',"Studio") : page==='Support'?studioLocalization.text('support:title'):trText(page)}<span className="beta-tag">{tr('ui:s-646c19373ac9',"LOCAL")}</span></h1><p>{page === 'Studio' ? tr('ui:s-ebdb9c8218e5',"Build an overlay that moves with you.") : page === 'Profiles' ? tr('ui:s-6ce58339f2d9',"Your games. Your sensitivity. Your setup.") : page === 'Presets' ? tr('ui:s-5dbfe726c336',"A strong starting point. Make it your own.") : page==='Support'?studioLocalization.text('support:intro'):tr('ui:s-a99adcdd5f6a',"Fine-tune your connection and performance.")}</p></div>{page!=='Support'&&headingActions}</div>}
    {setupOpen&&setupSuspended&&<div className="setup-resume" role="status"><span>{studioLocalization.text('setup:paused')}</span><button className="primary" data-setup-resume onClick={()=>setSetupSuspended(false)}>{studioLocalization.text('setup:resume')}</button></div>}
    <ConnectionNoticeBanner state={connectionState} endpointKey={JSON.stringify([options.url,options.token])} openSettings={openConnectionSettings}/>
    {captureError?.code.startsWith('native-startup-')&&page!=='Settings'&&<div role="alert" className="warning-banner native-startup-error"><span>{trError(captureError)}</span><button onClick={openConnectionSettings}>{trText('Settings')}</button><IconButton title={tr('ui:s-9f6e4da35a68',"Dismiss warning")} onClick={()=>setCaptureError(null)}><X size={15}/></IconButton></div>}
    {conflict && <div role="alert" className="warning-banner"><span>{tr('ui:s-7381ec46a0e0',"Another editor changed the server profile. Your local draft is kept. Choose which version to use.")}</span><button onClick={exportConfig}>{tr('ui:s-677df7058e6a',"Export local draft")}</button><button onClick={() => settings.resolveConflict('local')}>{tr('ui:s-2ee21eff9db8',"Publish local version")}</button><button disabled={!settingsView.hasRemoteDocument} onClick={() => settings.resolveConflict('server')}>{tr('ui:s-9958fde32a48',"Use server version")}</button></div>}
    {settingsView.unsupported && <div role="alert" className="warning-banner"><span>{tr('ui:s-4bbd2930795e',"Read-only configuration ·")}{trText(settingsView.unsupported.reason)}</span>{settingsView.unsupported.text !== undefined && <button onClick={exportOriginal}>{tr('ui:s-3576595de51d',"Export original JSON")}</button>}{settingsView.unsupported.source === 'import' && <button onClick={() => { if (settings.closeUnsupportedImport()) settings.connect(options); }}>{tr('ui:s-7da3277b84cc',"Back to current profile")}</button>}</div>}
    {warning && !settingsView.unsupported && <div role="alert" className="warning-banner"><span>{trText(warning)}</span>{settingsView.protected && !settingsView.unsupported && <><button onClick={restore}>{tr('ui:s-6da1c554212c',"Restore backup")}</button><button onClick={save}>{tr('ui:s-a91af2a1efd1',"Save defaults")}</button></>}<IconButton title={tr('ui:s-9f6e4da35a68',"Dismiss warning")} onClick={() => setWarning('')}><X size={15}/></IconButton></div>}
    {page === 'Studio' && <div inert={!!settingsView.unsupported} className={`studio-workspace ${layersOpen ? 'layers-open' : 'layers-closed'} ${inspectorOpen ? '' : 'inspector-collapsed'}`} style={{ '--inspector-width': `${inspectorWidth}px` } as React.CSSProperties}><aside className="modules-panel"><div className="panel-title"><span>{tr('ui:s-0bcd66e677f4',"Layers")}</span><span className="layer-heading-actions"><span className="count">{p.modules.length}</span><IconButton title={tr('ui:s-0cbb5e469796',"Close layers")} onClick={() => setLayersOpen(false)}><X size={15}/></IconButton></span></div><button className="secondary add-module-toggle" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(!libraryOpen)}><Plus size={16}/>{tr('ui:s-588fb6745f60',"Add module")}</button><div className="module-library" hidden={!libraryOpen}>{moduleUI.all().map(({definition,icon:Icon}) => { return <button key={definition.id} onClick={() => { addModule(definition.id); setLibraryOpen(false); }} disabled={p.modules.length >= 32}><Icon size={19}/><div>{studioLocalization.text(definition.label.key,definition.label.fallback)}<span>{studioLocalization.text(definition.description.key,definition.description.fallback)}</span></div><Plus size={14}/></button>; })}</div><div className="layer-list">{[...p.modules].sort((a, b) => b.z - a.z).map(m => { const Icon = moduleUI.resolve(moduleKind(m))?.icon??Square; return <div key={m.id} className={`layer-row ${selected === m.id ? 'active' : ''}`}><button onClick={() => selectModule(m.id)}><Icon size={14}/><span>{m.name}{!moduleAvailable(m)&&<small>{tr('ui:s-e514783eb7ad',"/ Unavailable")}</small>}</span></button><IconButton title={m.visible ? tr('ui:s-40a51daf19a0',"Hide {{p0}}",{p0:String(m.name)}) : tr('ui:s-b1995ae992a1',"Show {{p0}}",{p0:String(m.name)})} onClick={() => update(doc => { const v = activeProfile(doc).modules.find(v => v.id === m.id)!; v.visible = !v.visible; })}>{m.visible ? <Eye size={13}/> : <EyeOff size={13}/>}</IconButton><IconButton title={m.locked ? tr('ui:s-193119ecc65c',"Unlock {{p0}}",{p0:String(m.name)}) : tr('ui:s-b1935e2e20fb',"Lock {{p0}}",{p0:String(m.name)})} onClick={() => update(doc => { const v = activeProfile(doc).modules.find(v => v.id === m.id)!; v.locked = !v.locked; })}>{m.locked ? <LockKeyhole size={12}/> : <UnlockKeyhole size={12}/>}</IconButton></div>; })}</div><div className="module-tip"><Radio size={16}/><b>{tr('ui:s-954f805af128',"OBS overlay")}</b><p>{tr('ui:s-e23d70d80f77',"Your overlay runs independently. Close Studio and keep playing.")}</p>{supportView.enabled&&layersOpen&&<SupportEntry open={()=>setPage('Support')}/>}</div></aside>
      <main className="canvas-panel"><div className="editor-toolbar"><button className="secondary small" aria-label={tr('ui:s-7656e76e0336',"Toggle layers")} title={tr('ui:s-7656e76e0336',"Toggle layers")} aria-pressed={layersOpen} onClick={() => setLayersOpen(!layersOpen)}><Layers size={16}/>{tr('ui:s-0bcd66e677f4',"Layers")}</button><label className="profile-select"><span className="profile-initial">{p.game === 'Counter-Strike 2' ? tr('ui:s-3a22ef4d2495',"CS") : tr('ui:s-fed1d872f6d5',"IN")}</span><select aria-label={tr('ui:s-5608b89a8112',"Active profile")} value={d.activeProfileId} onChange={e => update(doc => { doc.activeProfileId = e.target.value; })}>{d.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={13}/></label><div className="editor-tools"><button className="secondary small" data-action="toggle-properties" aria-label={tr('ui:s-cee90ed413fd',"Toggle properties")} title={tr('ui:s-cee90ed413fd',"Toggle properties")} aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}><SlidersHorizontal size={16}/>{tr('ui:s-ae43692b2a31',"Properties")}</button><div className="mode-switch"><button className={!demoMode ? 'active' : ''} onClick={() => setDemoMode(false)}><Radio size={12}/>{tr('ui:s-b64ac05f17e6',"Live")}</button><button className={demoMode ? 'active demo' : ''} onClick={() => setDemoMode(true)}><Sparkles size={12}/>{tr('ui:s-8a2cc0673b1c',"Demo")}</button></div><span className="divider"/><button className="icon-button" aria-label={tr('ui:s-a8283ade3185',"Undo")} title={tr('ui:s-e68fa019a532',"Undo · {{p0}}",{p0:String(commandHint('undo'))})} onClick={undo} disabled={!settingsView.canUndo}><Undo2 size={16}/></button><button className="icon-button" aria-label={tr('ui:s-74273989b096',"Redo")} title={tr('ui:s-2bd0d9b9062e',"Redo · {{p0}}",{p0:String(commandHint('redo'))})} onClick={redo} disabled={!settingsView.canRedo}><Redo2 size={16}/></button></div></div>
      <Preview document={d} engine={engine} selected={selected} select={selectModule} update={update} demoMode={demoMode} snap={snap} safe={safe} background={background} zoom={zoom} setZoom={setZoom} editingKeys={editingKeys} setEditingKeys={setEditingKeys} selectedKey={selectedKey} selectKey={selectKey} previewState={previewState} undoShortcuts={shortcuts.undo} viewCommand={viewCommand}/>
      <div className="workspace-tools"><div className="selection-tools" role="group" aria-label={tr('ui:s-740f91193c04',"Selection commands")}><span>{selectedModule ? editingKeys && moduleUI.resolve(moduleKind(selectedModule))?.selection==='keys' ? tr('ui:s-61edc007f96d',"Key · {{p0}}",{p0:String(selectedModule.keys.find(k => k.id === selectedKey)?.label || selectedModule.keys[0]?.label || 'none')}) : editingButtons && moduleUI.resolve(moduleKind(selectedModule))?.selection==='buttons' ? tr('ui:s-f3374073b48d',"Mouse button · {{p0}}",{p0:String(selectedButton)}) : tr('ui:s-8af1169c74d7',"Module · {{p0}}",{p0:String(selectedModule.name)}) : tr('ui:s-16b8b33cab51',"Select an object")}</span><div>{([['copy',Copy],['cut',Scissors],['paste',ClipboardPaste],['duplicate',CopyPlus],['delete',Trash2]] as const).map(([id,Icon]) => <button key={id} aria-label={commands.find(c => c.id === id)!.label} title={`${commands.find(c => c.id === id)!.label} · ${commandHint(id)}`} disabled={id === 'paste' ? !objectClipboard : !selectedModule || (id === 'delete' || id === 'cut' || id === 'duplicate' && (editingKeys || editingButtons)) && selectedModule.locked} onClick={() => runCommand(id)}><Icon size={16}/></button>)}<button aria-label={tr('ui:s-8f38258e1e7f',"Configure keyboard shortcuts")} title={tr('ui:s-e8248dc73c6f',"Commands and keyboard shortcuts")} onClick={() => { setPage('Settings'); requestAnimationFrame(() => document.getElementById('keyboard-shortcuts')?.scrollIntoView({block:'start'})); }}><Keyboard size={16}/><span>{tr('ui:s-46e978d0c193',"Shortcuts")}</span></button></div></div><div><button className={snap ? 'enabled' : ''} onClick={() => setSnap(!snap)}><Grid2X2 size={14}/>{tr('ui:s-ce43cef987f3',"Snap to grid")}</button><button className={safe ? 'enabled' : ''} onClick={() => setSafe(!safe)}><Square size={14}/>{tr('ui:s-ac1f55ec2e9b',"Safe area")}</button></div><button className={background ? 'enabled' : ''} onClick={() => setBackground(!background)}><Monitor size={14}/>{background ? tr('ui:s-d5468ce5592e',"Scene background") : tr('ui:s-aac7e89fcd0e',"Transparent")}</button></div>
</main>
      {inspectorOpen && <button className="inspector-scrim" aria-label={tr('ui:s-ab0e79163590',"Close properties backdrop")} tabIndex={-1} onClick={() => setInspectorOpen(false)}/>}
      <aside className="properties-panel" aria-label={tr('ui:s-f8fa7942c4c9',"Properties inspector")} hidden={!inspectorOpen}><InspectorResize value={inspectorWidth} max={inspectorMax} change={setInspectorSize}/><div className="inspector-close"><IconButton title={tr('ui:s-60df2b7a67ae',"Close properties")} onClick={() => { setInspectorOpen(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-action="toggle-properties"]')?.focus()); }}><X size={16}/></IconButton></div>{selectedModule ? <ModuleProperties settings={settings} preferences={preferences} editingButtons={editingButtons} setEditingButtons={setEditingButtons} selectedButton={selectedButton} selectButton={button => { selectButton(button); setEditingButtons(true); }} key={`${p.id}:${selectedModule.id}`} document={d} previewState={previewState} previewChange={setPreviewState} linkImage={(targetId, join) => update(doc => { const profile = activeProfile(doc); if (profile.id === p.id) linkArtwork(profile, selectedModule.id, targetId, join); })} assignKey={(id, patch) => update(doc => { const profile = activeProfile(doc); if (profile.id !== p.id) return; const target = profile.modules.find(m => m.id === selectedModule.id), key = target?.keys.find(k => k.id === id); if (key && target) { if (key.code !== patch.code) target.layout = 'Custom'; Object.assign(key, patch); } })} bindingEngine={liveEngine} editingKeys={editingKeys} setEditingKeys={setEditingKeys} selectedKey={selectedKey} selectKey={selectKey} upload={asset => update(doc => { const profile = activeProfile(doc); if (profile.id !== p.id) return; const m = profile.modules.find(v => v.id === selectedModule.id); if (!m) return; const existing = Object.entries(doc.assets).find(([, a]) => a.data === asset.data)?.[0]; const id = existing || uid(); doc.assets[id] = asset; setModuleImage(profile.modules, m.id, { ...m.image, enabled: true, assetId: id }); })} module={selectedModule} change={changeModule} engine={engine} resetDistance={() => { engine.setDistance(0); if (!demoMode) connection.resetDistance(); }} duplicate={() => runCommand('duplicate',{moduleId:selectedModule.id})} remove={() => runCommand('delete',{moduleId:selectedModule.id})}/>: <div className="empty-selection"><SlidersHorizontal size={28}/><h3>{tr('ui:s-34ca8a4540f5',"Make it yours")}</h3><p>{tr('ui:s-ba023bb0804e',"Select a module on the canvas or add one from the library.")}</p></div>}</aside>
    </div>}
    {page === 'Support' && supportView.enabled && <SupportPage support={support} notify={notify}/>}
    {page === 'Profiles' && <ProfilesPage languagePacks={preferenceView.languagePacks} settings={settings} document={d} notify={notify} renderGame={game=><ProfileEditor settings={settings} profile={game} change={patch=>update(doc=>{Object.assign(doc.gameProfiles.find(g=>g.id===game.id)!,patch);})}/>}/>}

    {page === 'Presets' && <PresetLibrary document={d} update={update} notify={notify} exportPreset={downloadPreset} importPreset={readPreset} apply={applyPreset}/>}
    {page === 'Settings' && <div className="content-page settings-page"><section><div className="settings-section setup-entry"><h3><SlidersHorizontal size={18}/>{studioLocalization.text('setup:settingsLabel')}</h3><p className="hint">{studioLocalization.text('setup:settingsHelp')}</p><button className="secondary" onClick={()=>{if(!setupOpen)setSetupStart(0);setSetupOpen(true);setSetupSuspended(false);}}>{studioLocalization.text(setupOpen&&setupSuspended?'setup:resume':'setup:reopen')}</button></div><LanguageSettings preferences={preferences} notify={notify}/><div className="section-heading"><span className="eyebrow">{tr('ui:s-4b15c3f79252',"INPUT & CONNECTION")}</span><h2>{tr('ui:s-3c05263acddc',"A direct line to your devices.")}</h2><p>{tr('ui:s-5e595bb40639',"Studio connects to the local Input Overlay Studio capture server.")}</p></div><div className="settings-section" data-settings-section="connection"><h3><Radio size={18}/>{tr('ui:s-98853353781f',"WebSocket connection")}</h3><ConnectionSettings value={connectionDraft} change={setConnectionDraft} error={connectionError} apply={() => { if (!preferences.set('studio.preferences.connection', connectionDraft)) { setConnectionError(true); return; } setConnectionError(false); setOptions(connectionDraft); if (JSON.stringify(connectionDraft) === JSON.stringify(options)) settings.connect(connectionDraft); notify(tr('ui:s-42149184d8f4',"Reconnecting to capture server")); }}/><div className="device-status"><Keyboard size={17}/><div>{tr('ui:s-e950ec5b0288',"Keyboard input")}<span>{devices ? tr('ui:s-d9121a3fb80d',"{{p0}} keyboard devices available · capture {{p1}}",{p0:String(devices.keyboard_count),p1:trText(devices.capture_running ? 'running' : 'stopped')}) : connectionState === 'Connected' ? tr('ui:s-bcb7d41a1560',"Capture stream available · device presence unverified") : tr('ui:s-df5701b5b144',"Waiting for authenticated capture")}</span></div></div><div className="device-status"><Mouse size={17}/><div>{tr('ui:s-2f622c7a6c0e',"Mouse input")}<span>{devices ? tr('ui:s-21072c0e2386',"{{p0}} mouse devices available · capture {{p1}}",{p0:String(devices.mouse_count),p1:trText(devices.capture_running ? 'running' : 'stopped')}) : connectionState === 'Connected' ? tr('ui:s-dcd00df9db23',"Relative motion + buttons · device presence unverified") : tr('ui:s-df5701b5b144',"Waiting for authenticated capture")}</span></div></div><button className="text-button" onClick={() => { if (connectionState === 'Paused') settings.connect(options); else settings.pause(); }}>{connectionState === 'Paused' ? tr('ui:s-ed27281bb941',"Resume preview input") : tr('ui:s-aa614540c546',"Pause preview input")}</button><p className="hint">{tr('ui:s-e35c4d71538b',"Pausing this preview does not stop other OBS clients. Use the native capture switch below to stop broadcasting globally.")}</p></div>
      {native && <NativeSettingsProvider settings={settings} draft={nativeDraft}><div className="settings-section"><h3><Keyboard size={18}/>{tr('ui:s-bf59a0746617',"Native capture server")}</h3><Toggle settingId="capture.server.enabled" label={tr('ui:s-0496d34def7a',"Broadcast device input")} value={native.capture_enabled} onChange={capture_enabled => setNative({ ...native, capture_enabled })}/><Toggle settingId="capture.server.http-enabled" label={tr('ui:s-55705cf2b6c4',"Local HTTP server")} value={native.http_enabled} onChange={http_enabled => setNative({ ...native, http_enabled })}/><RegisteredField id="capture.server.host" label={tr('ui:s-d925351e9df5',"Bind host (loopback by default)")} fallback={<label className="field"><span>{tr('ui:s-d925351e9df5',"Bind host (loopback by default)")}</span><input value={native.host} onChange={e => setNative({ ...native, host: e.target.value })}/></label>}/><div className="field-grid"><NumberField settingId="capture.server.port" label={tr('ui:s-93436b11b77d',"WebSocket port")} value={native.port} min={1} max={65535} onChange={port => setNative({ ...native, port: Math.round(port) })}/><NumberField settingId="capture.server.http-port" label={tr('ui:s-dab12d2ccc22',"HTTP port")} value={native.http_port} min={1} max={65535} onChange={http_port => setNative({ ...native, http_port: Math.round(http_port) })}/></div><Select settingId="capture.server.analog-keyboard" label={tr('ui:s-b694caf764fd',"Analog keyboard")} value={native.analog_keyboard} options={['', 'auto', 'wooting', 'razer', 'nuphy', 'drunkdeer', 'keychron', 'madlions', 'bytech']} onChange={analog_keyboard => setNative({ ...native, analog_keyboard })}/><button className="secondary" onClick={() => { setNative({ ...native, key_whitelist: ['key_w', 'key_a', 'key_s', 'key_d', 'key_leftshift', 'key_rightshift', 'key_leftctrl', 'key_rightctrl', 'key_space', 'mouse_left', 'mouse_right', 'mouse_middle', 'mouse_4', 'mouse_5', 'mouse_wheel'] }); notify(tr('ui:s-5298605846c8',"FPS privacy filter selected. Apply server settings to activate it.")); }}>{tr('ui:s-d5d817870970',"Use FPS privacy filter")}</button><button className="text-button" onClick={() => setNative({ ...native, key_whitelist: [] })}>{tr('ui:s-7ebed584871f',"Clear key filter")}</button><p className="hint">{tr('ui:s-55c570d3d5a5',"No keystroke logging or telemetry. Analog selection changes restart the existing HID reader.")}</p><NativeAdvanced config={native} change={setNative} settings={nativeSettings}/><button className="primary" onClick={saveNative}>{tr('ui:s-4c08ab8dc55a',"Apply server settings")}</button>{captureError&&<p role="alert" className="warning native-config-error">{trError(captureError)}</p>}</div></NativeSettingsProvider>}
      <div className="settings-section"><h3><Monitor size={18}/>{tr('ui:s-6281c34b6252',"OBS Browser Source")}</h3><ConnectionDetails view={settingsView}/>{httpMessage && <p role="status" className="hint">{trText(httpMessage)}</p>}<p className="hint">{tr('ui:s-a0e0ab67ab08',"Add a Browser Source, paste this URL, and set width to 1920 and height to 1080. Keep the capture app running in the tray. The source has a transparent background.")}</p><input aria-label={tr('ui:s-0c04fa1829a1',"OBS URL")} type="password" readOnly value={obsBase ? obsUrl(options, obsBase) : ''} onFocus={e => e.currentTarget.select()}/><button className="secondary" onClick={copyOBS}><Copy size={14}/>{tr('ui:s-835ff4bcf601',"Copy OBS URL")}</button><p className="hint">{tr('ui:s-e04d0605c1a3',"The URL includes your access token. Profile exports exclude it. Demo mode is exclusive to the Studio preview.")}</p></div><DiagnosticSettings view={settingsView} http={httpStatus}/></section>
      <DocumentSettingsProvider settings={settings} address={{scope:'global'}}><section><ShortcutSettings bindings={shortcuts} change={changeShortcuts}/><div className="settings-section"><h3><Zap size={18}/>{tr('ui:s-08a796052014',"Rendering performance")}</h3><SettingsFields group="render.performance" settings={settings} address={{scope:'global'}}/><p className="hint">{tr('ui:s-74ea47a73a5c',"Actual refresh rate depends on OBS and your display. Input processing is independent of rendering FPS.")}</p></div><div className="settings-section"><h3><MoveUpRight size={18}/>{tr('ui:s-b7bdf7a2d6e7',"Distance")}</h3><Toggle settingId="capture.distance.persist" label={tr('ui:s-cb450cf1da56',"Keep total between launches")} value={d.distance.persist} onChange={persist => update(doc => { doc.distance.persist = persist; })}/><Toggle settingId="capture.distance.reset-on-start" label={tr('ui:s-1ead10d0067d',"Reset when capture app starts")} value={d.distance.resetOnStart} onChange={resetOnStart => update(doc => { doc.distance.resetOnStart = resetOnStart; })}/><button className="secondary" onClick={() => { liveEngine.setDistance(0); connection.resetDistance(); notify(tr('ui:s-bdac7ac3939d',"Distance reset")); }}><RotateCcw size={14}/>{tr('ui:s-d850329ca74f',"Reset total distance")}</button><p className="hint">{tr('ui:s-489d69029e84',"Already accumulated centimeters remain unchanged when DPI changes.")}</p></div><div className="settings-section"><h3><FolderOpen size={18}/>{tr('ui:s-235fa4283ba8',"Your configuration")}</h3><button className="secondary" onClick={exportConfig}><Download size={14}/>{tr('ui:s-ff25653ee9e4',"Export JSON")}</button><button className="secondary" onClick={() => file.current?.click()}><Upload size={14}/>{tr('ui:s-12dd2e2eda81',"Import JSON")}</button><button className="text-button" onClick={restore}>{tr('ui:s-cd349d725fbb',"Restore last local backup")}</button><p className="hint">{tr('ui:s-07157a9b80fc',"Versioned profiles, layouts, themes and performance settings. Connection credentials are stored separately.")}</p><button className="text-button danger" onClick={() => { settings.replace(initialDocument(), { source: 'reset', allowOverwrite: true }); notify(tr('ui:s-4e17cc168c63',"Factory defaults restored. Undo is available.")); }}>{tr('ui:s-2c95675bf5b5',"Restore factory defaults")}</button></div><div className="about-block"><Activity size={22}/><h3 translate="no">Input Overlay Studio</h3><p>{tr('ui:s-b55edc95ea40',"Local input overlay editor.")}<br/>{tr('ui:s-b61ee2ccd34b',"Free software · GPL-3.0")}</p><a href="https://github.com/TheYamio/input-overlay-studio" target="_blank" rel="noreferrer">{tr('ui:s-f803aa694000',"Project on GitHub")}<MoveUpRight size={12}/></a></div></section></DocumentSettingsProvider></div>}
    {setupOpen&&<SetupGuide visible={!setupSuspended} startStep={setupStart} preferences={preferences} view={settingsView} engine={liveEngine} apply={applyPreset} makeOBSUrl={makeOBSUrl} endpointKey={JSON.stringify([options.url,options.token,obsBase])} close={()=>{setSetupOpen(false);setSetupSuspended(false);}} openSettings={()=>{setSetupSuspended(true);openConnectionSettings();}} notify={notify}/>}
    <SupportPrompt support={support} allowed={page==='Studio'&&connectionState==='Connected'&&saveStatus==='Saved to capture server'&&!demoMode&&!editingKeys&&!editingButtons&&!settingsView.unsupported&&!warning&&!conflict} open={()=>setPage('Support')}/>
    <footer className="statusbar"><ConnectionIndicators view={settingsView}/><div className="statusbar-meta">{demoMode&&page==='Studio'&&<span>{tr('ui:s-01a7e51d9de2',"Demo input · preview only")}</span>}<span>{p.game}</span><span className="divider"/><span>{d.performance.fps === 'Auto' ? tr('ui:s-6ea56fae9eac',"AUTO") : tr('ui:s-ebd7a0aa1e87',"{{p0}} FPS",{p0:String(d.performance.fps)})}{' '}{tr('ui:s-3dc0db889344',"TARGET")}</span></div></footer>
    </div><input ref={file} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void importConfig(f); e.target.value = ''; }}/>{toast && <div role="status" className="toast"><Check size={16}/>{toast}</div>}
  </div></ShapeLibrary.Provider></VisualPreviewSettings.Provider>;
}

const Preview=registerSettingsView('editor.canvas',LegacyPreview);

if (new URLSearchParams(location.search).get('diagnostics') === '1') {
  void import('./diagnostics').then(({ startDiagnostics }) => startDiagnostics());
} else {
  void (async()=>{
    try{await loadBuiltinLanguage(storedStudioLocale(localStorage));}catch{/* Keep the English fallback if a local language asset is unavailable. */}
    createRoot(document.getElementById('root')!).render(<StyleClipboard><App/></StyleClipboard>);
  })();
}
