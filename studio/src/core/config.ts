import { z } from 'zod';
import { MAX_DOCUMENT_BYTES, MAX_IMPORT_BYTES, utf8Bytes } from './limits.ts';
import { appearanceSchema, assetSchema, defaultAppearance, defaultImageSettings, defaultTrailAppearance, elementStyleSchema, imageSettingsSchema, mouseGeometrySchema, trailAppearanceSchema } from './visual.ts';

const positive = z.number().finite().positive().max(1e9);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const label = z.string().max(100);
const id = z.string().min(1).max(80);
export const games = ['Counter-Strike 2', 'Valorant', 'Apex Legends', 'Overwatch 2', "KovaaK’s", 'Custom'] as const;
export const yaws: Record<string, number> = { 'Counter-Strike 2': .022, Valorant: .07, 'Apex Legends': .022, 'Overwatch 2': .0066, Source: .022, Overwatch: .0066 };
export const keySchema = z.object({ id, code: z.number().int().min(1).max(255), label, x: z.number().min(0).max(1000), y: z.number().min(0).max(1000), w: positive.max(1000), h: positive.max(1000), style: elementStyleSchema.optional(), imageEnabled: z.boolean().optional() });
export type Key = z.infer<typeof keySchema>;
export const moduleSchema = z.object({
  id, type: z.enum(['keyboard', 'mouse', 'trail', 'distance', 'sensitivity']), name: label,
  x: z.number().finite().min(0).max(1920), y: z.number().finite().min(0).max(1080),
  w: z.number().min(40).max(1920), h: z.number().min(30).max(1080),
  visible: z.boolean(), locked: z.boolean(), z: z.number().int().min(0).max(1000),
  accent: color, background: color, opacity: z.number().min(0).max(1), radius: z.number().min(0).max(100),
  effect: z.enum(['Instant', 'Soft Press', 'Glow', 'Pulse', 'Analog Fill']),
  appearance: appearanceSchema.default(defaultAppearance), image: imageSettingsSchema.default(defaultImageSettings),
  buttonStyles: z.record(z.string().regex(/^[1-7]$/), elementStyleSchema).default({}),
  buttonGeometry: z.record(z.string().regex(/^[1-7]$/), mouseGeometrySchema).default({}),
  buttonImages: z.record(z.string().regex(/^[1-7]$/), z.boolean()).default({}),
  trailAppearance: trailAppearanceSchema.default(defaultTrailAppearance),
  wheelDuration: z.number().min(50).max(500).default(110),
  textLayout: z.enum(['Horizontal', 'Vertical']).default('Horizontal'),
  keys: z.array(keySchema).max(100), layout: z.enum(['WASD', 'WASD + modifiers', 'FPS Extended', 'Custom']), gap: z.number().min(0).max(30),
  mouseMode: z.enum(['Compact Buttons', 'Mouse Diagram']), buttons: z.array(z.number().int().min(1).max(7)).max(7), buttonLabels: z.array(label).length(7),
  trailStyle: z.enum(['Clean Line', 'Fade Trail', 'Neon Trail', 'Speed Gradient', 'Segmented Trail']),
  position: z.enum(['Fixed Field', 'Follow / Recenter']), scaleMode: z.enum(['Manual Scale', 'DPI Normalized Scale']),
  scale: z.number().min(.01).max(10), duration: z.number().min(100).max(10000), thickness: z.number().min(.5).max(15), glow: z.number().min(0).max(30),
  grid: z.boolean(), center: z.boolean(), marker: z.enum(['Dot', 'Crosshair', 'None']), clickEffects: z.enum(['Off', 'Marker', 'Ripple']),
  originX: z.number().min(0).max(1), originY: z.number().min(0).max(1),
  unit: z.enum(['Auto', 'cm', 'm']), decimals: z.number().int().min(0).max(3), caption: label,
  sensitivityStyle: z.enum(['Minimal', 'Standard', 'Detailed']), showGame: z.boolean(), showDpi: z.boolean(), showSens: z.boolean(), showEdpi: z.boolean(), showCm: z.boolean(),
});
export type OverlayModule = z.infer<typeof moduleSchema>;
export const themeNames = ['Essential', 'Competitive', 'Obsidian', 'Neon', 'Glass', 'Clean Recording', 'Classic Input'] as const;
export const profileSchema = z.object({
  id, name: label.min(1), game: z.enum(games), dpi: positive, sensitivity: positive, yaw: positive,
  scale: z.enum(['Source', 'Valorant', 'Overwatch', 'Custom yaw', 'Manual cm/360', 'Unknown']), manualCm: positive,
  caption: label, theme: z.enum(themeNames), modules: z.array(moduleSchema).max(32),
}).superRefine((p, ctx) => {
  if (new Set(p.modules.map(m => m.id)).size !== p.modules.length) ctx.addIssue({ code: 'custom', message: 'Duplicate module IDs' });
});
export type Profile = z.infer<typeof profileSchema>;
export const presetSchema = z.object({ id, name: label.min(1), theme: z.enum(themeNames), modules: z.array(moduleSchema).max(32) }).superRefine((p, ctx) => {
  if (new Set(p.modules.map(m => m.id)).size !== p.modules.length) ctx.addIssue({ code: 'custom', message: 'Duplicate module IDs' });
});
export const currentDocumentSchema = z.object({
  version: z.literal(2), assets: z.record(id, assetSchema).default({}), activeProfileId: id, profiles: z.array(profileSchema).min(1).max(50), presets: z.array(presetSchema).max(50),
  performance: z.object({ fps: z.enum(['Auto', '30', '60', '120']), quality: z.enum(['Low', 'Medium', 'High']), glowQuality: z.enum(['Off', 'Low', 'High']), reducedMotion: z.boolean() }),
  distance: z.object({ persist: z.boolean(), resetOnStart: z.boolean() }),
}).superRefine((d, ctx) => {
  if (!d.profiles.some(p => p.id === d.activeProfileId)) ctx.addIssue({ code: 'custom', message: 'Active profile does not exist' });
  if (new Set(d.profiles.map(p => p.id)).size !== d.profiles.length) ctx.addIssue({ code: 'custom', message: 'Duplicate profile IDs' });
  if (new Set(d.presets.map(p => p.id)).size !== d.presets.length) ctx.addIssue({ code: 'custom', message: 'Duplicate preset IDs' });
  if (Object.keys(d.assets).length > 8) ctx.addIssue({ code: 'custom', message: 'At most 8 images per configuration' });
  for (const p of [...d.profiles, ...d.presets]) for (const m of p.modules) {
    if (m.image.assetId && !d.assets[m.image.assetId]) ctx.addIssue({ code: 'custom', message: 'Missing keycap image' });
    if (new Set(m.keys.map(k => k.id)).size !== m.keys.length) ctx.addIssue({ code: 'custom', message: 'Duplicate key IDs' });
  }
  if (utf8Bytes(JSON.stringify(d)) > MAX_DOCUMENT_BYTES) ctx.addIssue({ code: 'custom', message: 'Configuration exceeds 1.8 MB. Remove unused images.' });
});
// v1 is upgraded in memory; the original storage remains available as a backup.
export const documentSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
    const migrate = (p: unknown) => {
      if (!p || typeof p !== 'object' || !('modules' in p) || !Array.isArray(p.modules)) return p;
      return { ...p, modules: p.modules.map((m: unknown) => { if (!m || typeof m !== 'object' || !('type' in m)) return m; return { ...m, appearance: 'appearance' in m ? m.appearance : { ...defaultAppearance(), ...(m.type === 'distance' || m.type === 'sensitivity' ? { backgroundOpacity: 0, borderWidth: 0 } : {}) } }; }) };
    };
    const legacy = value as Record<string, unknown>;
    return { ...legacy, version: 2, assets: {}, profiles: Array.isArray(legacy.profiles) ? legacy.profiles.map(migrate) : legacy.profiles, presets: Array.isArray(legacy.presets) ? legacy.presets.map(migrate) : legacy.presets };
  }
  return value;
}, currentDocumentSchema);
export type StudioDocument = z.infer<typeof documentSchema>;
export const uid = () => crypto.randomUUID();
export function layoutKeys(layout: OverlayModule['layout']): Key[] {
  const k = (code: number, label: string, x: number, y: number, w = 54): Key => ({ id: `${code}`, code, label, x, y, w, h: 54 });
  const keys = [k(87, 'W', 62, 0), k(65, 'A', 0, 62), k(83, 'S', 62, 62), k(68, 'D', 124, 62)];
  if (layout !== 'WASD') keys.push(k(160, 'SHIFT', 0, 124, 84), k(162, 'CTRL', 0, 186, 54), k(32, 'SPACE', 62, 186, 116));
  if (layout === 'FPS Extended') keys.push(k(81, 'Q', 0, 0), k(69, 'E', 124, 0), k(82, 'R', 186, 0), k(70, 'F', 186, 62), k(161, 'R SHIFT', 92, 124, 148));
  return keys;
}
export function makeModule(type: OverlayModule['type'], index = 0): OverlayModule {
  return {
    id: uid(), type, name: { keyboard: 'Keyboard', mouse: 'Mouse Buttons', trail: 'Mouse Trail', distance: 'Distance', sensitivity: 'Sensitivity' }[type],
    x: 120 + index * 24, y: Math.min(type === 'trail' ? 740 : type === 'keyboard' ? 780 : 970, 160 + index * 24), w: type === 'trail' ? 470 : type === 'sensitivity' ? 650 : 300, h: type === 'trail' ? 340 : type === 'keyboard' ? 300 : 110,
    appearance: { ...defaultAppearance(), ...(type === 'distance' || type === 'sensitivity' ? { backgroundOpacity: 0, borderWidth: 0 } : {}) }, image: defaultImageSettings(), buttonStyles: {}, buttonGeometry: {}, buttonImages: {}, trailAppearance: defaultTrailAppearance(), wheelDuration: 110, textLayout: 'Horizontal',
    visible: true, locked: false, z: index, accent: '#a5ef6b', background: '#161b20', opacity: 1, radius: 12, effect: 'Soft Press',
    keys: layoutKeys('WASD + modifiers'), layout: 'WASD + modifiers', gap: 8, mouseMode: 'Compact Buttons', buttons: [1, 2, 3, 4, 5, 6, 7], buttonLabels: ['M1', 'M2', 'M3', 'M4', 'M5', '↑', '↓'],
    trailStyle: 'Fade Trail', position: 'Follow / Recenter', scaleMode: 'DPI Normalized Scale', scale: .65, duration: 1200, thickness: 2, glow: 10, grid: true, center: true, marker: 'Dot', clickEffects: 'Ripple', originX: .5, originY: .5,
    unit: 'Auto', decimals: 1, caption: 'DISTANCE', sensitivityStyle: 'Standard', showGame: true, showDpi: true, showSens: true, showEdpi: true, showCm: true,
  };
}
export function factoryModules(theme: Profile['theme'] = 'Obsidian'): OverlayModule[] {
  const modules = [makeModule('keyboard'), makeModule('mouse'), makeModule('trail'), makeModule('distance'), makeModule('sensitivity')];
  Object.assign(modules[0], { x: 440, y: 400, w: 290, h: 310 });
  Object.assign(modules[1], { x: 440, y: 735, w: 290, h: 100 });
  Object.assign(modules[2], { x: 790, y: 400, w: 550, h: 430 });
  Object.assign(modules[3], { x: 1400, y: 510, w: 300, h: 100 });
  Object.assign(modules[4], { x: 440, y: 890, w: 980, h: 65 });
  return applyTheme(modules, theme);
}
export const themeColors: Record<Profile['theme'], string> = { Essential: '#e4e7eb', Competitive: '#a5ef6b', Obsidian: '#a5ef6b', Neon: '#be93ff', Glass: '#8acbff', 'Clean Recording': '#ffffff', 'Classic Input': '#efb574' };
export function applyTheme(modules: OverlayModule[], theme: Profile['theme']): OverlayModule[] {
  return modules.map(m => ({ ...m, accent: themeColors[theme], radius: theme === 'Classic Input' ? 0 : theme === 'Competitive' ? 5 : 12,
    background: theme === 'Glass' ? '#24384a' : theme === 'Clean Recording' ? '#080a0d' : '#161b20', opacity: 1,
    appearance: { ...m.appearance, backgroundOpacity: m.type === 'distance' || m.type === 'sensitivity' ? 0 : theme === 'Glass' ? .38 : 1, activeBorderColor: themeColors[theme] },
    trailAppearance: { ...m.trailAppearance, markerColor: themeColors[theme], leftClickColor: themeColors[theme] },
    effect: theme === 'Neon' ? 'Glow' : theme === 'Essential' || theme === 'Clean Recording' ? 'Instant' : 'Soft Press',
    trailStyle: theme === 'Neon' ? 'Neon Trail' : theme === 'Competitive' || theme === 'Clean Recording' ? 'Clean Line' : theme === 'Classic Input' ? 'Segmented Trail' : 'Fade Trail',
    thickness: theme === 'Clean Recording' ? 4 : 2,
  }));
}
export function initialDocument(): StudioDocument {
  const p: Profile = { id: uid(), name: 'CS2 · Main', game: 'Counter-Strike 2', dpi: 800, sensitivity: 1.3, yaw: .022, scale: 'Source', manualCm: 40, caption: '', theme: 'Obsidian', modules: factoryModules() };
  return { version: 2, assets: {}, activeProfileId: p.id, profiles: [p], presets: [], performance: { fps: '60', quality: 'High', glowQuality: 'Low', reducedMotion: false }, distance: { persist: false, resetOnStart: true } };
}
export function activeProfile(d: StudioDocument): Profile { return d.profiles.find(p => p.id === d.activeProfileId)!; }
export function cm360(p: Pick<Profile, 'game' | 'scale' | 'dpi' | 'sensitivity' | 'yaw' | 'manualCm'>): number | null {
  if (![p.dpi, p.sensitivity, p.yaw, p.manualCm].every(v => Number.isFinite(v) && v > 0)) return null;
  if (p.game === 'KovaaK’s' && p.scale === 'Unknown') return null;
  if (p.game === 'KovaaK’s' && p.scale === 'Manual cm/360') return p.manualCm;
  const yaw = p.game === 'KovaaK’s' && p.scale !== 'Custom yaw' ? yaws[p.scale] : p.yaw;
  return yaw ? 914.4 / (p.dpi * p.sensitivity * yaw) : null;
}
export function parseDecimal(value: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const n = Number(value.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function parseDocument(text: string): StudioDocument {
  if (utf8Bytes(text) > MAX_IMPORT_BYTES) throw new Error('File exceeds 2 MB.');
  return documentSchema.parse(JSON.parse(text));
}
