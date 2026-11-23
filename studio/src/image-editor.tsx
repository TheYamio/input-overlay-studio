import {tr,trError} from './core/localization/messages.ts';
import { registerSettingsView } from './settings-views';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { activeProfile, uid, type OverlayModule, type StudioDocument } from './core/config';
import { capsFor, imagePlacement, readImageAsset, tilePlane } from './core/skins';
import { artworkBounds, artworkMembers, setModuleImage } from './core/artwork-groups';
import { defaultImageSettings, type ImageAsset, type ImageSettings } from './core/visual';
import type { SettingsService } from './core/settings/service';
import { InputEngine } from './core/input';
import type { PreviewState } from './core/preview';
import { Scene } from './renderer/scene';
import { PreviewControls } from './preview-controls';
import { VNumber, VRange, VSelect, Color } from './visual-fields';

function PlacementPreview({ document: d, module: m, image, state, sourceOpacity, zoom, change }: { document: StudioDocument; module: OverlayModule; image: ImageSettings; state: PreviewState; sourceOpacity: number; zoom: number; change: (p: Partial<ImageSettings>) => void }) {
  const host = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null);
  const [viewport, setViewport] = useState({ width: 700, height: 333 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const p = activeProfile(d), bounds = capsFor(m), anchor = { ...m, image }, members = artworkMembers(anchor, p.modules);
  const region = image.groupId ? artworkBounds(anchor, p.modules) : { x: 0, y: 0, w: bounds.w, h: bounds.h };
  const asset = d.assets[image.assetId];
  const fit = Math.min(752 / region.w, 356 / region.h);
  const scale = Math.max(.01, Math.min(viewport.width / 800, viewport.height / 380)) * zoom;
  const unit = fit * scale;
  useEffect(() => { scene.current = new Scene(host.current!, new InputEngine()); return () => scene.current?.dispose(); }, []);
  useEffect(() => {
    const modules = members.map(member => ({ ...member, image, visible: true, ...(!image.groupId ? { x: 0, y: 0, w: region.w, h: region.h } : {}) }));
    scene.current?.update(d, { ...p, modules }); scene.current?.setPreview(state);
  }, [d, m, image, state]);
  useEffect(() => {
    const observer = new ResizeObserver(([{ contentRect: { width, height } }]) => setViewport({ width, height }));
    observer.observe(wrapper.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = wrapper.current!;
    element.scrollTo((800 * scale - element.clientWidth) / 2, (380 * scale - element.clientHeight) / 2);
  }, [scale]);
  useEffect(() => {
    if (!asset) return;
    const el = wrapper.current!;
    const wheel = (e: WheelEvent) => { e.preventDefault(); change({ scale: Math.max(.05, Math.min(8, image.scale * (e.deltaY > 0 ? .95 : 1.05))) }); };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, [asset, image.scale, change]);
  const rect = asset ? imagePlacement(image, asset, region.w, region.h) : null, tile = tilePlane(region.w, region.h, image.x, image.y);
  const transform = `rotate(${image.rotation}deg) scale(${image.flipX ? -1 : 1},${image.flipY ? -1 : 1})`;
  return <div ref={wrapper} className="image-placement checker" tabIndex={0} aria-label={tr('ui:s-a956f98a119e',"Image placement preview")}
    onKeyDown={e => { if (asset && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const n = e.shiftKey ? 10 : 1; change({ x: Math.max(-5000, Math.min(5000, image.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0))), y: Math.max(-5000, Math.min(5000, image.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0))) }); } }}
    onPointerDown={e => { if (!asset || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: image.x, y: image.y, startX: e.clientX, startY: e.clientY }; }}
    onPointerMove={e => { const a = drag.current; if (a) change({ x: Math.max(-5000, Math.min(5000, a.x + (e.clientX - a.startX) / unit)), y: Math.max(-5000, Math.min(5000, a.y + (e.clientY - a.startY) / unit)) }); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
    <div style={{ width: 800 * scale, height: 380 * scale, marginInline: 'auto', position: 'relative', overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', width: 800, height: 380, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div style={{ position: 'absolute', transformOrigin: 'top left', transform: `translate(${(800 - region.w * fit) / 2}px,${(380 - region.h * fit) / 2}px) scale(${fit}) translate(${-region.x}px,${-region.y}px)` }}>
          {rect && sourceOpacity > 0 && <div className="source-image-guide" data-testid="source-image-guide" style={{ position: 'absolute', opacity: sourceOpacity, filter: `brightness(${image.brightness}) contrast(${image.contrast}) saturate(${image.saturation})`, left: region.x + (image.fit === 'Tile' ? tile.left : rect.x), top: region.y + (image.fit === 'Tile' ? tile.top : rect.y), width: image.fit === 'Tile' ? tile.size : rect.width, height: image.fit === 'Tile' ? tile.size : rect.height, backgroundImage: `url("${asset.data}")`, backgroundSize: image.fit === 'Tile' ? `${rect.width}px ${rect.height}px` : '100% 100%', backgroundRepeat: image.fit === 'Tile' ? 'repeat' : 'no-repeat', backgroundPosition: image.fit === 'Tile' ? tile.position : '0 0', transform, transformOrigin: 'center' }}/>}
          <div ref={host} style={{ width: Math.max(1920, region.x + region.w), height: Math.max(1080, region.y + region.h) }}/>
        </div>
      </div>
    </div>
  </div>;
}
function ImagePlacementDialog({ settings, document: d, module: m, close }: { settings: SettingsService; document: StudioDocument; module: OverlayModule; close: () => void }) {
  const [base] = useState(() => ({ profileId: d.activeProfileId, image: m.image, asset: d.assets[m.image.assetId] }));
  const original = base.image;
  const [draft, setDraft] = useState(m.image);
  const [pending, setPending] = useState<{ id: string; asset: ImageAsset } | null>(null);
  const [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState(''), [saveError, setSaveError] = useState('');
  const [state, setState] = useState<PreviewState>({ mode: 'Idle', depth: .5 }), [compare, setCompare] = useState(false), [source, setSource] = useState(false), [sourceOpacity, setSourceOpacity] = useState(.18), [zoom, setZoom] = useState('Fit');
  const patch = (v: Partial<ImageSettings>) => { setCompare(false); setSaveError(''); setDraft(s => ({ ...s, ...v })); };
  const previewDocument = useMemo(() => pending ? { ...d, assets: { ...d.assets, [pending.id]: pending.asset } } : d, [d, pending]);
  const asset = previewDocument.assets[draft.assetId], dialog = useRef<HTMLDialogElement>(null);
  const isStale = (doc: StudioDocument, module?: OverlayModule) => doc.activeProfileId !== base.profileId || !module ||
    JSON.stringify(original) !== JSON.stringify(module.image) || doc.assets[original.assetId]?.data !== base.asset?.data;
  const stale = isStale(d, m) || !!draft.assetId && !asset;
  const importImage = async (file: File) => {
    setUploading(true); setUploadError('');
    try {
      const asset = await readImageAsset(file), id = uid();
      setPending({ id, asset });
      patch({ assetId: id, enabled: true });
    } catch (error) { setUploadError(trError(error)); }
    finally { setUploading(false); }
  };
  const apply = () => {
    const live = settings.document, profile = activeProfile(live);
    if (isStale(live, profile.modules.find(module => module.id === m.id))) {
      setSaveError(tr('ui:s-4f284d744d48', 'The image settings changed in another edit. Cancel and reopen this editor to start from the current version.'));
      return;
    }
    const imported = pending?.id === draft.assetId ? pending.asset : undefined;
    if (draft.assetId && !imported && !live.assets[draft.assetId]) {
      setSaveError(tr('ui:s-27683b276ad9', 'Configuration could not be applied.'));
      return;
    }
    if (!imported && JSON.stringify(original) === JSON.stringify(draft)) { close(); return; }
    try {
      settings.endGesture();
      const saved = settings.transaction(doc => {
        let { assetId } = draft;
        if (imported) {
          const existing = Object.entries(doc.assets).find(([, asset]) => asset.data === imported.data)?.[0];
          if (existing) assetId = existing;
          else doc.assets[assetId] = imported;
        }
        setModuleImage(activeProfile(doc).modules, m.id, { ...draft, assetId });
      }, { source: 'artwork', scopes: ['global', 'module'] });
      if (saved) close();
      else setSaveError(tr('ui:s-27683b276ad9', 'Configuration could not be applied.'));
    } catch (error) {
      setSaveError(trError(error, tr('ui:s-27683b276ad9', 'Configuration could not be applied.')));
    }
  };
  useLayoutEffect(() => {
    const element = dialog.current!, previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="image-dialog expanded-image-dialog studio-dialog" onCancel={e => { e.preventDefault(); close(); }} aria-label={tr('ui:s-527f31c88695',"Keycap image placement")}>
    <div className="image-dialog-head studio-dialog-header"><div><h2>{tr('ui:s-2a9da5160803',"Paint your keycaps")}</h2><p className="artwork-target"><bdi>{m.name}</bdi> · {(compare ? original : draft).groupId ? tr('ui:s-b45f0d05b59c',"One image across the linked modules.") : tr('ui:s-658c28dbc2dd',"One continuous picture across your keycaps.")}</p></div></div>
    <div className="image-editor-body"><div className="image-visual-column">
    <div className="image-preview-toolbar"><button className="secondary small" aria-pressed={compare} onClick={() => setCompare(v => !v)}>{compare ? tr('ui:s-a9486689c64f',"Showing original") : tr('ui:s-aa815541be56',"Compare original")}</button><label className="visual-check"><input type="checkbox" checked={source} onChange={e => setSource(e.target.checked)}/>{tr('ui:s-5f2478ecc075',"Source guide (editor only)")}</label><VSelect label={tr('ui:s-317ab210624d',"Preview zoom")} value={zoom} options={['Fit', '150%', '200%']} change={setZoom}/></div>
    {source && <VRange label={tr('ui:s-5fd758c67579',"Source guide opacity")} value={sourceOpacity} max={.6} change={setSourceOpacity}/>}
    <PlacementPreview document={previewDocument} module={m} image={compare ? original : draft} state={state} sourceOpacity={source ? sourceOpacity : 0} zoom={zoom === 'Fit' ? 1 : zoom === '150%' ? 1.5 : 2} change={patch}/>
    {asset && <p className="hint image-placement-hint">{tr('ui:s-ca644ee14418', 'Drag to position, scroll to scale.')}</p>}
    <h3>{tr('ui:s-32f5a36d5f8e',"Key/button state")}</h3><PreviewControls value={state} change={setState} isolated/>
    </div><div className="image-editor-grid">
    <section className="artwork-source">
      <h3>{tr('ui:s-ea63c9d49b5f', 'Keycap artwork')}</h3>
      <label className="image-upload"><span>{uploading ? tr('ui:s-4d0ef130cf52', 'Preparing image…') : asset ? tr('ui:s-fcedcb5edd38', 'Replace image') : tr('ui:s-ffe4df6c7ca6', 'Upload image')}</span>
        <input aria-label={tr('ui:s-66907052be05', 'Upload keycap image')} type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importImage(file); }}/>
      </label>
      {Object.keys(previewDocument.assets).length > 0 && <label className="field">
        <span>{tr('ui:s-9adb15962023', 'Image library')}</span>
        <select aria-label={tr('ui:s-9adb15962023', 'Image library')} value={draft.assetId} onChange={event => {
          const assetId = event.target.value;
          setUploadError(''); patch({ assetId, enabled: !!assetId });
        }}>
          <option value="">{tr('ui:s-0a8216612de0', 'No image')}</option>
          {Object.entries(previewDocument.assets).map(([id, image]) => <option key={id} value={id}>{image.name}</option>)}
        </select>
      </label>}
      {uploadError && <p role="alert" className="warning">{uploadError}</p>}
      {asset && <div className="image-asset">
        <img src={asset.data} alt={tr('ui:s-ea63c9d49b5f', 'Keycap artwork')}/>
        <div><bdi>{asset.name}</bdi><span>{asset.width} × {asset.height}</span></div>
      </div>}
    </section>
    {asset && <><section><h3>{tr('ui:s-4df9939944a7',"Placement")}</h3><div className="field-grid"><VSelect label={tr('ui:s-08e74b64d3c4',"Image fit")} value={draft.fit} options={['Cover', 'Contain', 'Original', 'Tile']} change={fit => patch({ fit })}/><VNumber label={tr('ui:s-4da9f465e579',"Image scale")} value={draft.scale} min={.05} max={8} step={.05} change={scale => patch({ scale })}/><VNumber label={tr('ui:s-c162620f5b74',"Image X")} value={draft.x} min={-5000} max={5000} change={x => patch({ x })}/><VNumber label={tr('ui:s-299e3e033ae6',"Image Y")} value={draft.y} min={-5000} max={5000} change={y => patch({ y })}/><VNumber label={tr('ui:s-168e86bfb028',"Image rotation")} value={draft.rotation} min={-180} max={180} change={rotation => patch({ rotation })}/></div>
      <div className="style-actions"><button className="secondary small" onClick={() => patch({ x: 0, y: 0 })}>{tr('ui:s-e818b8b4b0df',"Center image")}</button><button className="secondary small" aria-pressed={!!draft.flipX} onClick={() => patch({ flipX: !draft.flipX })}>{tr('ui:s-7edc03ef932e',"Flip horizontally")}</button><button className="secondary small" aria-pressed={!!draft.flipY} onClick={() => patch({ flipY: !draft.flipY })}>{tr('ui:s-6282842cf945',"Flip vertically")}</button></div>
      <button className="text-button" onClick={() => patch({ fit: 'Cover', scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false })}>{tr('ui:s-5a8831d95b09',"Reset placement")}</button>
    </section><section><h3>{tr('ui:s-b0d5b9a79567',"Image & color")}</h3><label className="visual-check"><input type="checkbox" checked={draft.enabled} onChange={e => patch({ enabled: e.target.checked })}/>{tr('ui:s-dd5a6c2af28d',"Show keycap image")}</label>
      <VRange label={tr('ui:s-1719e36eb302',"Image opacity")} value={draft.opacity} change={opacity => patch({ opacity })}/><VSelect label={tr('ui:s-a1539d4a04e4',"Image blending")} value={draft.blend} options={['normal', 'multiply', 'screen', 'soft-light', 'overlay']} change={blend => patch({ blend })}/>
      <VRange label={tr('ui:s-aa76f19db347',"Image brightness")} value={draft.brightness} max={2} change={brightness => patch({ brightness })}/><VRange label={tr('ui:s-28917d7333d5',"Image contrast")} value={draft.contrast} max={2} change={contrast => patch({ contrast })}/><VRange label={tr('ui:s-4425150a174d',"Image saturation")} value={draft.saturation} max={2} change={saturation => patch({ saturation })}/><Color label={tr('ui:s-cb42f4b06a0c',"Image tint")} value={draft.tint} change={tint => patch({ tint })}/><VRange label={tr('ui:s-563269109b26',"Tint opacity")} value={draft.tintOpacity} change={tintOpacity => patch({ tintOpacity })}/>
      <VSelect label={tr('ui:s-3526ae8d36b0',"Image on press")} value={draft.press} options={['Tint', 'Brighten', 'Hide']} change={press => patch({ press })}/>{draft.press === 'Tint' && <VRange label={tr('ui:s-9866b0fe4fbb',"Pressed color overlay")} value={draft.pressTint} change={pressTint => patch({ pressTint })}/>}
      <button className="text-button" onClick={() => { const defaults = defaultImageSettings(); patch({ opacity: defaults.opacity, blend: defaults.blend, brightness: 1, contrast: 1, saturation: 1, tint: '#ffffff', tintOpacity: 0, press: defaults.press, pressTint: defaults.pressTint }); }}>{tr('ui:s-caec3819f5b5',"Reset image adjustments")}</button>
    </section>
    <button className="text-button danger" onClick={() => { setCompare(false); setSaveError(''); setDraft(defaultImageSettings()); }}>{tr('ui:s-dbd17b15c118', 'Remove image from module')}</button>
    </>}
    </div></div>
    {(stale || saveError) && <p role="alert" className="warning">{stale ? tr('ui:s-4f284d744d48',"The image settings changed in another edit. Cancel and reopen this editor to start from the current version.") : saveError}</p>}
    <div className="image-dialog-actions studio-dialog-footer">{compare && <span className="hint">{tr('ui:s-e874c5bc8603',"Viewing original; Apply saves your edited settings.")}</span>}<div className="image-dialog-buttons"><button className="secondary" onClick={close}>{tr('ui:s-19766ed6ccb2',"Cancel")}</button><button className="primary" disabled={stale || uploading} onClick={apply}>{tr('ui:s-4f45ab6c9e02',"Apply image placement")}</button></div></div>
  </dialog>;
}

export const ImagePlacementEditor=registerSettingsView('editor.image-placement',ImagePlacementDialog);
