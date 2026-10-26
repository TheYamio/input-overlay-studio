import { moduleExtensionSchema,persistedSize } from './module-envelope.ts';
import {localePackagesSchema} from './localization/pack-schema.ts';
import {packageIdPattern} from './localization/registry.ts';
import {validUnicode} from './unicode.ts';
import { z } from 'zod';
import { shapeSchema } from './shapes.ts';
import { consistentArtworkGroups } from './artwork-groups.ts';
import { MAX_DOCUMENT_BYTES } from './limits.ts';
import { appearanceSchema, assetSchema, defaultAppearance, defaultImageSettings, defaultTrailAppearance, elementStyleSchema, imageSettingsSchema, mouseGeometrySchema, trailAppearanceSchema } from './visual.ts';
const positive = z.number().finite().positive().max(1e9);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const label = z.string().max(100).refine(validUnicode,'Invalid Unicode text');
const id = z.string().min(1).max(80);
export const games = ['Counter-Strike 2', 'Valorant', 'Apex Legends', 'Overwatch 2', "KovaaK’s", 'Custom'] as const;
export const yaws: Record<string, number> = { 'Counter-Strike 2': .022, Valorant: .07, 'Apex Legends': .022, 'Overwatch 2': .0066, Source: .022, Overwatch: .0066 };
export const keySchema = z.object({ id, code: z.number().int().min(1).max(255), label, x: z.number().min(0).max(1000), y: z.number().min(0).max(1000), w: positive.max(1000), h: positive.max(1000), style: elementStyleSchema.optional(), imageEnabled: z.boolean().optional() });
export type Key = z.infer<typeof keySchema>;
// Private editor projection and frozen v1 migration source. Canonical builtin
// configuration schemas are independently owned by core/modules/*.ts.
export const moduleViewSchema = z.object({
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
  mouseBodyShapeId: z.string().max(80).optional(),
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
export const moduleSchema=moduleViewSchema.extend({extension:moduleExtensionSchema.optional()});
export type OverlayModule = z.infer<typeof moduleSchema>;
export const themeNames = ['Essential', 'Competitive', 'Obsidian', 'Neon', 'Glass', 'Clean Recording', 'Classic Input'] as const;
export const gameProfileSchema = z.strictObject({
  id, name: label.min(1), game: z.enum(games), dpi: positive, sensitivity: positive, yaw: positive,
  scale: z.enum(['Source', 'Valorant', 'Overwatch', 'Custom yaw', 'Manual cm/360', 'Unknown']), manualCm: positive,
});
export type GameProfile = z.infer<typeof gameProfileSchema>;
export const profileSchema = z.strictObject({
  id, name: label.min(1), gameProfileId: id,
  localePackageId:z.string().regex(packageIdPattern).optional(),
  locale:z.string().max(64).regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).default('en'), caption: label, theme: z.enum(themeNames), modules: z.array(moduleSchema).max(32),
}).superRefine((p, ctx) => {
  if (new Set(p.modules.map(m => m.id)).size !== p.modules.length) ctx.addIssue({ code: 'custom', message: 'Duplicate module IDs' });
  if (!consistentArtworkGroups(p.modules)) ctx.addIssue({ code: 'custom', message: 'Artwork group members must share the same image settings' });
});
export type OverlayProfile = z.infer<typeof profileSchema>;
export type Profile = OverlayProfile & Omit<GameProfile, 'id' | 'name'>;
export const presetSchema = z.object({ id, name: label.min(1), description: z.string().max(500).refine(validUnicode,'Invalid Unicode text').optional(), kind: z.enum(['layout', 'style']).optional(), theme: z.enum(themeNames), modules: z.array(moduleSchema).max(32) }).superRefine((p, ctx) => {
  if (new Set(p.modules.map(m => m.id)).size !== p.modules.length) ctx.addIssue({ code: 'custom', message: 'Duplicate module IDs' });
  if (!consistentArtworkGroups(p.modules)) ctx.addIssue({ code: 'custom', message: 'Artwork group members must share the same image settings' });
});
export const currentDocumentSchema = z.strictObject({
  languagePacks:localePackagesSchema.default([]),
  shapes: z.record(id, shapeSchema).default({}),
  version: z.literal(4), assets: z.record(id, assetSchema).default({}), activeProfileId: id, gameProfiles: z.array(gameProfileSchema).min(1).max(50), profiles: z.array(profileSchema).min(1).max(50), presets: z.array(presetSchema).max(50),
  performance: z.object({ fps: z.enum(['Auto', '30', '60', '120']), quality: z.enum(['Low', 'Medium', 'High']), glowQuality: z.enum(['Off', 'Low', 'High']), reducedMotion: z.boolean() }),
  distance: z.object({ persist: z.boolean(), resetOnStart: z.boolean() }),
}).superRefine((d, ctx) => {
  const unicode=(value:unknown):boolean=>typeof value==='string'?validUnicode(value):Array.isArray(value)?value.every(unicode):!!value&&typeof value==='object'?Object.entries(value).every(([key,child])=>validUnicode(key)&&unicode(child)):true;
  if(!unicode(d))ctx.addIssue({code:'custom',message:'Invalid Unicode text'});
  if (new Set(d.gameProfiles.map(p=>p.id)).size!==d.gameProfiles.length) ctx.addIssue({code:'custom',message:'Duplicate game profile IDs'});
  for(const p of d.profiles)if(p.localePackageId&&!d.languagePacks.some(pack=>pack.id===p.localePackageId&&pack.locale.toLowerCase()===p.locale.toLowerCase()))ctx.addIssue({code:'custom',message:'Selected overlay language package does not exist'});
  if (d.profiles.some(p=>!d.gameProfiles.some(g=>g.id===p.gameProfileId))) ctx.addIssue({code:'custom',message:'Linked game profile does not exist'});
  if (!d.profiles.some(p => p.id === d.activeProfileId)) ctx.addIssue({ code: 'custom', message: 'Active profile does not exist' });
  if (new Set(d.profiles.map(p => p.id)).size !== d.profiles.length) ctx.addIssue({ code: 'custom', message: 'Duplicate profile IDs' });
  if (new Set(d.presets.map(p => p.id)).size !== d.presets.length) ctx.addIssue({ code: 'custom', message: 'Duplicate preset IDs' });
  if (Object.keys(d.assets).length > 8) ctx.addIssue({ code: 'custom', message: 'At most 8 images per configuration' });
  if (Object.keys(d.shapes).length > 32) ctx.addIssue({ code: 'custom', message: 'At most 32 custom shapes per configuration' });
  for (const p of [...d.profiles, ...d.presets]) for (const m of p.modules) {
    if(m.x+m.w>1920||m.y+m.h>1080)ctx.addIssue({code:'custom',message:'Module bounds exceed the canvas.'});
    for(const reference of m.extension?.resources.assets??[])if(!Object.hasOwn(d.assets,reference))ctx.addIssue({code:'custom',message:'Missing module image resource'});
    for(const reference of m.extension?.resources.shapes??[])if(!Object.hasOwn(d.shapes,reference))ctx.addIssue({code:'custom',message:'Missing module shape resource'});
    if (m.image.assetId && !Object.hasOwn(d.assets, m.image.assetId)) ctx.addIssue({ code: 'custom', message: 'Missing keycap image' });
    if (m.mouseBodyShapeId && !Object.hasOwn(d.shapes, m.mouseBodyShapeId)) ctx.addIssue({ code: 'custom', message: 'Missing mouse body shape' });
    for (const style of [m.appearance, ...m.keys.map(k => k.style), ...Object.values(m.buttonStyles)]) {
      if (style?.shapeId && !Object.hasOwn(d.shapes, style.shapeId)) ctx.addIssue({ code: 'custom', message: 'Missing custom shape' });
    }
    if (new Set(m.keys.map(k => k.id)).size !== m.keys.length) ctx.addIssue({ code: 'custom', message: 'Duplicate key IDs' });
  }
  if (persistedSize(d) > MAX_DOCUMENT_BYTES) ctx.addIssue({ code: 'custom', message: 'Configuration exceeds 1.8 MB. Remove unused images.' });
});
