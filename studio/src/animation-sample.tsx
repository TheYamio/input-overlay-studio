import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { animationSettings } from './core/animation';
import { initialDocument, type StudioDocument } from './core/config';
import { InputEngine } from './core/input';
import type { resolvedStyle } from './core/skins';
import { Scene } from './renderer/scene';
import { ShapeLibrary } from './shape-controls';
import { useSettingsText } from './settings-localization';

export const VisualPreviewSettings = createContext<StudioDocument['performance'] | null>(null);
export function AnimationSample({ style, prefix, mouse, label = mouse ? 'M1' : 'A' }: { style: ReturnType<typeof resolvedStyle>; prefix: string; mouse: boolean; label?: string }) {
  const t=useSettingsText();
  const host = useRef<HTMLDivElement>(null), scene = useRef<Scene | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), replay = useRef(0);
  const [engine]=useState(()=>new InputEngine());
  const [held, setHeld] = useState(false);
  const [document] = useState(initialDocument), { shapes } = useContext(ShapeLibrary), performance = useContext(VisualPreviewSettings);
  useEffect(() => { scene.current = new Scene(host.current!, engine); return () => { clearTimeout(timer.current); cancelAnimationFrame(replay.current); scene.current?.dispose(); }; }, [engine]);
  useEffect(() => {
    const m = structuredClone(document.profiles[0].modules[0]);
    Object.assign(m, { x: 48, y: 40, w: 96, h: 80, gap: 8, accent: style.accent, background: style.background, radius: style.radius, effect: style.effect, keys: [{ id: 'sample', code: 65, label, x: 0, y: 0, w: 96, h: 80 }], appearance: { ...m.appearance, ...style } });
    scene.current?.update({ ...document, shapes, performance: performance || document.performance }, { ...document.profiles[0], modules: [m] });
  }, [document, style, shapes, performance, label]);
  const stopPlayback = () => { clearTimeout(timer.current); cancelAnimationFrame(replay.current); };
  const input = (pressed: boolean) => {
    engine.ingest({ event_type: pressed ? 'key_pressed' : 'key_released', rawcode: 65 });
    setHeld(pressed);
  };
  const manual = (pressed: boolean) => { stopPlayback(); input(pressed); };
  const play = () => {
    stopPlayback();
    engine.reset();
    setHeld(false);
    const { pressDelay, pressMs } = animationSettings(style);
    replay.current = requestAnimationFrame(() => {
      input(true);
      timer.current = setTimeout(() => input(false), Math.max(450, pressDelay + pressMs + 250));
    });
  };
  return <div className="animation-sample">
    <div className="animation-sample-scene" ref={host} aria-hidden="true"/>
    <div className="animation-sample-actions">
      <button type="button" className="secondary small play-sample" aria-label={prefix + t('animation:play')} onClick={play}>
        <Play size={14} aria-hidden="true"/>{t('animation:play')}
      </button>
      <div className="animation-sample-manual">
        <button type="button" className="secondary small" aria-label={prefix + t('preview:press')} aria-pressed={held} onClick={() => manual(true)}>{t('preview:press')}</button>
        <button type="button" className="secondary small" aria-label={prefix + t('preview:release')} disabled={!held} onClick={() => manual(false)}>{t('preview:release')}</button>
      </div>
    </div>
    {performance?.reducedMotion && <p className="hint">{t('animation:reducedMotion')}</p>}
  </div>;
}
