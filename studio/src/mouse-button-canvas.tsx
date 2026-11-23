import type { OverlayModule } from './core/config';
import { tr } from './core/localization/messages';
import { capsFor } from './core/skins';
import { mouseSelectionLabel } from './selection-labels';

export function MouseButtonCanvas({ module, selected, select }: { module: OverlayModule; selected: number; select: (button: number) => void }) {
  const { caps, w, h } = capsFor(module);
  const scale = Math.min(module.w / w, module.h / h);
  return <div className="mouse-canvas-handles">
    {caps.map(cap => {
      const label = mouseSelectionLabel(module, cap.code);
      return <button key={cap.id} className="mouse-button-hitbox" data-mouse-button={cap.code}
        style={{ left: cap.x * scale, top: cap.y * scale, width: cap.w * scale, height: cap.h * scale }}
        aria-label={tr('ui:s-f61bbed36f1d', 'Select {{p0}}', { p0: label })} aria-pressed={cap.code === selected}
        onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={() => select(cap.code)}/>;
    })}
  </div>;
}
