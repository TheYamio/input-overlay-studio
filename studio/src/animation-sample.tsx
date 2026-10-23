import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { initialDocument, type StudioDocument } from './core/config';
import { InputEngine } from './core/input';
import type { resolvedStyle } from './core/skins';
import { Scene } from './renderer/scene';
import { ShapeLibrary } from './shape-controls';
import { useSettingsText } from './settings-localization';

export const VisualPreviewSettings = createContext<StudioDocument['performance'] | null>(null);
export function AnimationSample({ style, prefix, mouse }: { style: ReturnType<typeof resolvedStyle>; prefix: string; mouse: boolean }) {
  const t=useSettingsText();
  const host = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), replay = useRef(0);
  const [engine]=useState(()=>new InputEngine());
  const [document] = useState(initialDocument), { shapes } = useContext(ShapeLibrary), performance = useContext(VisualPreviewSettings);
  useEffect(() => { scene.current = new Scene(host.current!, engine); return () => { clearTimeout(timer.current); cancelAnimationFrame(replay.current); scene.current?.dispose(); }; }, [engine]);
  useEffect(() => {
    const m = structuredClone(document.profiles[0].modules[0]);
    Object.assign(m, { x: 48, y: 40, w: 96, h: 80, gap: 8, accent: style.accent, background: style.background, radius: style.radius, effect: style.effect, keys: [{ id: 'sample', code: 65, label: mouse ? 'M1' : 'A', x: 0, y: 0, w: 96, h: 80 }], appearance: { ...m.appearance, ...style } });
    scene.current?.update({ ...document, shapes, performance: performance || document.performance }, { ...document.profiles[0], modules: [m] });
  }, [document, style, shapes, performance, prefix, mouse]);
  const play = () => { clearTimeout(timer.current); cancelAnimationFrame(replay.current); engine.reset(); replay.current = requestAnimationFrame(() => { engine.ingest({ event_type: 'key_pressed', rawcode: 65 }); timer.current = setTimeout(() => engine.ingest({ event_type: 'key_released', rawcode: 65 }), 450); }); };
  return <div className="animation-sample"><div className="animation-sample-scene" ref={host} aria-hidden="true"/><button type="button" className="secondary small" aria-label={prefix+t('animation:play','Play animation')} onClick={play}>▶ {t('animation:play','Play animation')}</button><p className="hint">{t('animation:sampleHelp','One press, then release. Preview only; your overlay receives no simulated input.')}</p>{performance?.reducedMotion && <p className="hint">{t('animation:reducedMotion','Reduced motion is on: movement is disabled.')}</p>}</div>;
}
