import {useModuleUIRegistry} from './module-ui-context';
import { useEffect, useRef, useState } from 'react';
import type { OverlayModule, Profile, StudioDocument } from './core/config';
import { InputEngine } from './core/input';
import { Scene } from './renderer/scene';

/** Uses the production renderer, and releases canvases/blob URLs while off-screen. */
export function SceneThumbnail({ document: d, modules, profile, fullCanvas = false }: { document: StudioDocument; modules: OverlayModule[]; profile: Profile; fullCanvas?: boolean }) {
  const moduleUI=useModuleUIRegistry();
  const wrapper = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null);
  const [visible, setVisible] = useState(false), [size, setSize] = useState({ w: 200, h: 100 });
  const shown = modules.filter(m => m.visible);
  const x = fullCanvas ? 0 : Math.max(0, (shown.length ? Math.min(...shown.map(m => m.x)) : 24) - 24);
  const y = fullCanvas ? 0 : Math.max(0, (shown.length ? Math.min(...shown.map(m => m.y)) : 24) - 24);
  const w = fullCanvas ? 1920 : Math.max(1, ...shown.map(m => m.x + m.w + 24 - x));
  const h = fullCanvas ? 1080 : Math.max(1, ...shown.map(m => m.y + m.h + 24 - y));
  const fit = Math.min(size.w / w, size.h / h);
  useEffect(() => {
    const el = wrapper.current!, observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' }); observer.observe(el);
    const resize = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height })); resize.observe(el);
    return () => { observer.disconnect(); resize.disconnect(); };
  }, []);
  useEffect(() => { if (!visible) return; scene.current = new Scene(host.current!, new InputEngine(),{registry:moduleUI.runtime}); scene.current.setPreview({ mode: 'Idle', depth: .5 }); return () => { scene.current?.dispose(); scene.current = null; }; }, [visible,moduleUI]);
  useEffect(() => { scene.current?.update(d, { ...profile, modules }); }, [d, profile, modules, visible,moduleUI]);
  return <div ref={wrapper} className="scene-thumbnail" aria-hidden="true"><div style={{ position: 'absolute', left: (size.w - w * fit) / 2, top: (size.h - h * fit) / 2, transformOrigin: 'top left', transform: `scale(${fit}) translate(${-x}px,${-y}px)` }}><div ref={host}/></div></div>;
}
