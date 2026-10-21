import { useEffect, useRef, useState } from 'react';
import { activeProfile, type OverlayModule, type StudioDocument } from './core/config';
import { capsFor, imagePlacement, tilePlane } from './core/skins';
import { artworkBounds, artworkMembers } from './core/artwork-groups';
import { defaultImageSettings, type ImageSettings } from './core/visual';
import { InputEngine } from './core/input';
import type { PreviewState } from './core/preview';
import { Scene } from './renderer/scene';
import { PreviewControls } from './preview-controls';
import { VNumber, VRange, VSelect, Color } from './visual-fields';

function PlacementPreview({ document: d, module: m, image, state, sourceOpacity, zoom, change }: { document: StudioDocument; module: OverlayModule; image: ImageSettings; state: PreviewState; sourceOpacity: number; zoom: number; change: (p: Partial<ImageSettings>) => void }) {
  const host = useRef<HTMLDivElement>(null), wrapper = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null);
  const [width, setWidth] = useState(700), drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const p = activeProfile(d), bounds = capsFor(m), members = artworkMembers(m, p.modules);
  const region = m.image.groupId ? artworkBounds(m, p.modules) : { x: 0, y: 0, w: bounds.w, h: bounds.h };
  const fit = Math.min(752 / region.w, 356 / region.h), outerScale = width / 800, scale = outerScale * zoom, unit = fit * scale;
  useEffect(() => { scene.current = new Scene(host.current!, new InputEngine()); return () => scene.current?.dispose(); }, []);
  useEffect(() => {
    const modules = members.map(member => ({ ...member, image, visible: true, ...(!m.image.groupId ? { x: 0, y: 0, w: region.w, h: region.h } : {}) }));
    scene.current?.update(d, { ...p, modules }); scene.current?.setPreview(state);
  }, [d, m, image, state]);
  useEffect(() => { const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(wrapper.current!); return () => observer.disconnect(); }, []);
  useEffect(() => { const el = wrapper.current!; el.scrollLeft = (800 * scale - el.clientWidth) / 2; el.scrollTop = (380 * scale - el.clientHeight) / 2; }, [zoom, width]);
  useEffect(() => {
    const el = wrapper.current!;
    const wheel = (e: WheelEvent) => { e.preventDefault(); change({ scale: Math.max(.05, Math.min(8, image.scale * (e.deltaY > 0 ? .95 : 1.05))) }); };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, [image.scale, change]);
  const asset = d.assets[image.assetId], rect = asset ? imagePlacement(image, asset, region.w, region.h) : null, tile = tilePlane(region.w, region.h, image.x, image.y);
  const transform = `rotate(${image.rotation}deg) scale(${image.flipX ? -1 : 1},${image.flipY ? -1 : 1})`;
  return <div ref={wrapper} className="image-placement checker" tabIndex={0} aria-label="Image placement preview" style={{ height: 380 * outerScale }}
    onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const n = e.shiftKey ? 10 : 1; change({ x: Math.max(-5000, Math.min(5000, image.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0))), y: Math.max(-5000, Math.min(5000, image.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0))) }); } }}
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: image.x, y: image.y, startX: e.clientX, startY: e.clientY }; }}
    onPointerMove={e => { const a = drag.current; if (a) change({ x: Math.max(-5000, Math.min(5000, a.x + (e.clientX - a.startX) / unit)), y: Math.max(-5000, Math.min(5000, a.y + (e.clientY - a.startY) / unit)) }); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    <div style={{ width: 800 * scale, height: 380 * scale, position: 'relative', overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', width: 800, height: 380, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div style={{ position: 'absolute', transformOrigin: 'top left', transform: `translate(${(800 - region.w * fit) / 2}px,${(380 - region.h * fit) / 2}px) scale(${fit}) translate(${-region.x}px,${-region.y}px)` }}>
          {rect && sourceOpacity > 0 && <div className="source-image-guide" data-testid="source-image-guide" style={{ position: 'absolute', opacity: sourceOpacity, filter: `brightness(${image.brightness}) contrast(${image.contrast}) saturate(${image.saturation})`, left: region.x + (image.fit === 'Tile' ? tile.left : rect.x), top: region.y + (image.fit === 'Tile' ? tile.top : rect.y), width: image.fit === 'Tile' ? tile.size : rect.width, height: image.fit === 'Tile' ? tile.size : rect.height, backgroundImage: `url("${asset.data}")`, backgroundSize: image.fit === 'Tile' ? `${rect.width}px ${rect.height}px` : '100% 100%', backgroundRepeat: image.fit === 'Tile' ? 'repeat' : 'no-repeat', backgroundPosition: image.fit === 'Tile' ? tile.position : '0 0', transform, transformOrigin: 'center' }}/>}
          <div ref={host} style={{ width: Math.max(1920, region.x + region.w), height: Math.max(1080, region.y + region.h) }}/>
        </div>
      </div>
    </div>
  </div>;
}
export function ImagePlacementEditor({ document: d, module: m, close, apply }: { document: StudioDocument; module: OverlayModule; close: () => void; apply: (image: ImageSettings) => void }) {
  const [original] = useState(() => structuredClone(m.image)), [draft, setDraft] = useState(() => structuredClone(m.image));
  const [state, setState] = useState<PreviewState>({ mode: 'Idle', depth: .5 }), [compare, setCompare] = useState(false), [source, setSource] = useState(false), [sourceOpacity, setSourceOpacity] = useState(.18), [zoom, setZoom] = useState('Fit');
  const patch = (v: Partial<ImageSettings>) => { setCompare(false); setDraft(s => ({ ...s, ...v })); };
  const stale = JSON.stringify(original) !== JSON.stringify(m.image), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={dialog} className="image-dialog expanded-image-dialog" onCancel={e => { e.preventDefault(); close(); }} aria-label="Keycap image placement">
    <div className="image-dialog-head"><div><h2>Paint your keycaps</h2><p>{m.image.groupId ? 'One image across the linked modules.' : 'One continuous picture across your keycaps.'} Drag to position, scroll to scale.</p></div><button className="secondary" onClick={close}>Cancel</button></div>
    <div className="image-editor-body"><div className="image-visual-column">
    <div className="image-preview-toolbar"><button className="secondary small" aria-pressed={compare} onClick={() => setCompare(v => !v)}>{compare ? 'Showing original' : 'Compare original'}</button><label className="visual-check"><input type="checkbox" checked={source} onChange={e => setSource(e.target.checked)}/>Source guide (editor only)</label><VSelect label="Preview zoom" value={zoom} options={['Fit', '150%', '200%']} change={setZoom}/></div>
    {source && <VRange label="Source guide opacity" value={sourceOpacity} max={.6} change={setSourceOpacity}/>}
    <PlacementPreview document={d} module={m} image={compare ? original : draft} state={state} sourceOpacity={source ? sourceOpacity : 0} zoom={zoom === 'Fit' ? 1 : zoom === '150%' ? 1.5 : 2} change={patch}/>
    <h3>Key/button state</h3><PreviewControls value={state} change={setState} isolated/>
    </div><div className="image-editor-grid"><section><h3>Placement</h3><div className="field-grid"><VSelect label="Image fit" value={draft.fit} options={['Cover', 'Contain', 'Original', 'Tile']} change={fit => patch({ fit })}/><VNumber label="Image scale" value={draft.scale} min={.05} max={8} step={.05} change={scale => patch({ scale })}/><VNumber label="Image X" value={draft.x} min={-5000} max={5000} change={x => patch({ x })}/><VNumber label="Image Y" value={draft.y} min={-5000} max={5000} change={y => patch({ y })}/><VNumber label="Image rotation" value={draft.rotation} min={-180} max={180} change={rotation => patch({ rotation })}/></div>
      <div className="style-actions"><button className="secondary small" onClick={() => patch({ x: 0, y: 0 })}>Center image</button><button className="secondary small" aria-pressed={!!draft.flipX} onClick={() => patch({ flipX: !draft.flipX })}>Flip horizontally</button><button className="secondary small" aria-pressed={!!draft.flipY} onClick={() => patch({ flipY: !draft.flipY })}>Flip vertically</button></div>
      <button className="text-button" onClick={() => patch({ fit: 'Cover', scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false })}>Reset placement</button>
    </section><section><h3>Image & color</h3><label className="visual-check"><input type="checkbox" checked={draft.enabled} onChange={e => patch({ enabled: e.target.checked })}/>Show keycap image</label>
      <VRange label="Image opacity" value={draft.opacity} change={opacity => patch({ opacity })}/><VSelect label="Image blending" value={draft.blend} options={['normal', 'multiply', 'screen', 'soft-light', 'overlay']} change={blend => patch({ blend })}/>
      <VRange label="Image brightness" value={draft.brightness} max={2} change={brightness => patch({ brightness })}/><VRange label="Image contrast" value={draft.contrast} max={2} change={contrast => patch({ contrast })}/><VRange label="Image saturation" value={draft.saturation} max={2} change={saturation => patch({ saturation })}/><Color label="Image tint" value={draft.tint} change={tint => patch({ tint })}/><VRange label="Tint opacity" value={draft.tintOpacity} change={tintOpacity => patch({ tintOpacity })}/>
      <VSelect label="Image on press" value={draft.press} options={['Tint', 'Brighten', 'Hide']} change={press => patch({ press })}/>{draft.press === 'Tint' && <VRange label="Pressed color overlay" value={draft.pressTint} change={pressTint => patch({ pressTint })}/>}
      <button className="text-button" onClick={() => { const defaults = defaultImageSettings(); patch({ opacity: defaults.opacity, blend: defaults.blend, brightness: 1, contrast: 1, saturation: 1, tint: '#ffffff', tintOpacity: 0, press: defaults.press, pressTint: defaults.pressTint }); }}>Reset image adjustments</button>
    </section></div></div>
    {stale && <p role="alert" className="warning">The image settings changed in another edit. Cancel and reopen this editor to start from the current version.</p>}
    <div className="image-dialog-actions"><span className="hint">{compare ? 'Viewing original; Apply saves your edited settings.' : 'Cancel and Esc discard this image draft. Apply is one Undo step.'}</span><button className="primary" disabled={stale} onClick={() => { apply(draft); close(); }}>Apply image placement</button></div>
  </dialog>;
}
