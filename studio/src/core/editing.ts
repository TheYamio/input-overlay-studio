import type { OverlayModule } from './config';

export function copyName(name: string): string {
  let prefix = '';
  for (const character of name) { if (prefix.length + character.length > 95) break; prefix += character; }
  return `${prefix} copy`;
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

/** Old/imported compositions can have individually valid coordinates outside the canvas. */
export function normalizeBounds(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const d = value as Record<string, unknown>;
  const normalize = (profiles: unknown) => Array.isArray(profiles) ? profiles.map(p => {
    if (!p || typeof p !== 'object' || !Array.isArray(p.modules)) return p;
    return { ...p, modules: p.modules.map((m: unknown) => {
      if (!m || typeof m !== 'object') return m;
      const mod = m as Record<string, unknown>;
      const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
      return { ...mod,
        ...(finite(mod.x) && finite(mod.w) && mod.w >= 40 && mod.w <= 1920 ? { x: Math.max(0, Math.min(1920 - mod.w, mod.x)) } : {}),
        ...(finite(mod.y) && finite(mod.h) && mod.h >= 30 && mod.h <= 1080 ? { y: Math.max(0, Math.min(1080 - mod.h, mod.y)) } : {}),
      };
    }) };
  }) : profiles;
  return { ...d, profiles: normalize(d.profiles), presets: normalize(d.presets) };
}
