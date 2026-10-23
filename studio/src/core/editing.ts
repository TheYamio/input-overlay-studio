import {truncateText} from './unicode';
import type { OverlayModule } from './config';

export function copyName(name: string): string {
  return `${truncateText(name,95)} copy`;
}

/** Lock protects the module transform through every property editor. */
export function patchModule(module: OverlayModule, patch: Partial<OverlayModule>) {
  const locked = module.locked;
  const { x, y, w, h, ...other } = patch;
  Object.assign(module, other);
  // Unlocking and transforming in one operation must still respect the old lock.
  if (locked) return;
  Object.assign(module, { x: x ?? module.x, y: y ?? module.y, w: w ?? module.w, h: h ?? module.h });
}
