import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ElementStyle } from './core/visual';
import type { OverlayModule } from './core/config';
import { resolvedStyle } from './core/skins';

const Clipboard = createContext<{ style: ElementStyle | null; set: (style: ElementStyle) => void }>({ style: null, set: () => {} });
export function StyleClipboard({ children }: { children: ReactNode }) {
  const [style, set] = useState<ElementStyle | null>(null);
  return <Clipboard.Provider value={{ style, set }}>{children}</Clipboard.Provider>;
}
export const StyleInheritance = createContext<{ overrides?: ElementStyle; reset?: (key: keyof ElementStyle) => void; prefix: string }>({ prefix: '' });
const styleKeys: Record<string, keyof ElementStyle> = {
  'Accent color': 'accent', 'Surface color': 'background', 'Background opacity': 'backgroundOpacity', 'Text color': 'textColor', 'Pressed text color': 'activeTextColor', 'Font family': 'fontFamily', 'Font size': 'fontSize', 'Font weight': 'fontWeight', 'Letter spacing': 'letterSpacing', 'Text outline': 'textOutline', 'Text shadow': 'textShadow', 'Border color': 'borderColor', 'Pressed border color': 'activeBorderColor', 'Border opacity': 'borderOpacity', 'Border width': 'borderWidth', 'Corner radius': 'radius', 'Press effect': 'effect', 'Press duration': 'pressDuration', 'Release duration': 'releaseDuration', 'Press travel': 'pressTravel', 'Glow strength': 'glowStrength', 'Fit text inside key': 'autoFitText',
};
export function Inheritance({ label }: { label: string }) {
  const { overrides, reset, prefix } = useContext(StyleInheritance), key = styleKeys[label.slice(prefix.length)];
  if (!overrides || !reset || !key) return null;
  return <span className="inheritance" data-style-source={overrides[key] === undefined ? 'inherited' : 'overridden'}>{overrides[key] === undefined
    ? <small>Inherited</small>
    : <button type="button" aria-label={`Reset ${label} to module`} title="Use the module value" onClick={e => { e.preventDefault(); e.stopPropagation(); reset(key); }}>Reset ↶</button>}</span>;
}
export function ElementStyleTools({ module: m, override, change, applyAll }: { module: OverlayModule; override?: ElementStyle; change: (style: ElementStyle | undefined) => void; applyAll: (style: ElementStyle) => void }) {
  const clipboard = useContext(Clipboard), [message, setMessage] = useState('');
  return <div className="style-tools">
    <div className="style-actions"><button className="secondary small" onClick={() => { clipboard.set(structuredClone(resolvedStyle(m, override))); setMessage('Appearance copied. Choose another key or mouse button to paste.'); }}>Copy style</button><button className="secondary small" disabled={!clipboard.style} onClick={() => { change(structuredClone(clipboard.style!)); setMessage('Style pasted as individual overrides.'); }}>Paste style</button></div>
    <button className="text-button" disabled={!override || !Object.keys(override).length} onClick={() => { change(undefined); setMessage('All fields inherit the module style.'); }}>Use module style</button>
    {clipboard.style && <button className="text-button" onClick={() => { applyAll(structuredClone(clipboard.style!)); setMessage('Copied style applied. Undo restores the previous appearance.'); }}>{m.type === 'mouse' ? 'Paste style to shown buttons' : 'Paste style to all keys'}</button>}
    <p className="hint" role="status">{message || (override && Object.keys(override).length ? `${Object.keys(override).length} overridden fields. Reset a field to follow the module again.` : 'All fields inherit the module style. Pasting creates individual overrides.')}</p>
  </div>;
}
