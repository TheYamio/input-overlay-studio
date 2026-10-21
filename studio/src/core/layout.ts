import { factoryModules, type OverlayModule } from './config';

export const STAGE = { width: 1920, height: 1080 } as const;
export function fitStage(width: number, height: number) {
  const scale = Math.max(0, Math.min(width / STAGE.width, height / STAGE.height));
  return { scale, x: (width - STAGE.width * scale) / 2, y: (height - STAGE.height * scale) / 2 };
}
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export function alignModule(m: OverlayModule, alignment: Alignment): Pick<OverlayModule, 'x' | 'y'> {
  const { x, y, w, h } = m;
  return { x: alignment === 'left' ? 0 : alignment === 'center' ? (STAGE.width - w) / 2 : alignment === 'right' ? STAGE.width - w : x,
    y: alignment === 'top' ? 0 : alignment === 'middle' ? (STAGE.height - h) / 2 : alignment === 'bottom' ? STAGE.height - h : y };
}
export function resetModulePosition(m: OverlayModule): Pick<OverlayModule, 'x' | 'y'> {
  const original = factoryModules().find(v => v.type === m.type)!;
  return { x: Math.min(original.x, STAGE.width - m.w), y: Math.min(original.y, STAGE.height - m.h) };
}
export interface Guide { axis: 'x' | 'y'; value: number }
/** Snap edges and centers in logical coordinates; tolerance stays constant on screen. */
export function snapPosition(m: Pick<OverlayModule, 'id' | 'x' | 'y' | 'w' | 'h'>, others: OverlayModule[], tolerance: number, grid = 8) {
  const xTargets = [0, STAGE.width / 2, STAGE.width], yTargets = [0, STAGE.height / 2, STAGE.height];
  for (const other of others) {
    if (other.id === m.id || !other.visible) continue;
    xTargets.push(other.x, other.x + other.w / 2, other.x + other.w);
    yTargets.push(other.y, other.y + other.h / 2, other.y + other.h);
  }
  const axis = (position: number, size: number, limit: number, targets: number[]) => {
    let best = tolerance + Number.EPSILON, match: number | undefined, result = Math.round(position / grid) * grid;
    for (const offset of [0, size / 2, size]) for (const target of targets) {
      const distance = Math.abs(position + offset - target), candidate = target - offset;
      if (distance <= best && candidate >= 0 && candidate + size <= limit) { best = distance; match = target; result = candidate; }
    }
    return { value: Math.max(0, Math.min(limit - size, result)), guide: match };
  };
  const x = axis(m.x, m.w, STAGE.width, xTargets), y = axis(m.y, m.h, STAGE.height, yTargets);
  const guides: Guide[] = [];
  if (x.guide !== undefined) guides.push({ axis: 'x', value: x.guide });
  if (y.guide !== undefined) guides.push({ axis: 'y', value: y.guide });
  return { x: x.value, y: y.value, guides };
}
