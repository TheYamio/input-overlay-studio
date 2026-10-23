import { z } from 'zod';
import { lightingModes, motionModes, easingModes } from './animation.ts';
import { rasterDimensions } from './raster.ts';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const effects = ['Instant', 'Soft Press', 'Glow', 'Pulse', 'Analog Fill'] as const;
export const fonts = ['Segoe UI', 'Arial', 'Verdana', 'Consolas', 'Georgia', 'Unicode'] as const;
export const appearanceSchema = z.object({
  lighting: z.enum(lightingModes).optional(), motion: z.enum(motionModes).optional(), easing: z.enum(easingModes).optional(),
  pressDelay: z.number().min(0).max(1000).optional(), releaseDelay: z.number().min(0).max(2000).optional(),
  lightingOpacity: z.number().min(0).max(1).optional(), secondaryColor: color.optional(), gradientAngle: z.number().min(-180).max(180).optional(), motionScale: z.number().min(.8).max(1.2).optional(),
  showLabels: z.boolean().optional(), shapeId: z.string().max(80).optional(),
  backgroundOpacity: z.number().min(0).max(1), textColor: color, activeTextColor: color,
  borderColor: color, activeBorderColor: color, borderOpacity: z.number().min(0).max(1), borderWidth: z.number().min(0).max(8),
  autoFitText: z.boolean(), fontFamily: z.enum(fonts), fontSize: z.number().min(6).max(96), fontWeight: z.number().int().min(100).max(900), letterSpacing: z.number().min(-2).max(12),
  textOutline: z.number().min(0).max(3), textShadow: z.number().min(0).max(12),
  pressDuration: z.number().min(0).max(500), releaseDuration: z.number().min(0).max(1000), pressTravel: z.number().min(0).max(8), glowStrength: z.number().min(0).max(40),
});
export const defaultAppearance = () => ({ backgroundOpacity: 1, textColor: '#d9e0e7', activeTextColor: '#10150e', borderColor: '#ffffff', activeBorderColor: '#a5ef6b', borderOpacity: .16, borderWidth: 1, autoFitText: true, fontFamily: 'Segoe UI' as const, fontSize: 16, fontWeight: 600, letterSpacing: 1, textOutline: 0, textShadow: 0, pressDuration: 90, releaseDuration: 140, pressTravel: 2, glowStrength: 22 });
export const elementStyleSchema = appearanceSchema.extend({ accent: color, background: color, radius: z.number().min(0).max(100), effect: z.enum(effects) }).partial();
export type ElementStyle = z.infer<typeof elementStyleSchema>;
export const imageSettingsSchema = z.object({
  groupId: z.string().min(1).max(80).optional(), flipX: z.boolean().optional(), flipY: z.boolean().optional(),
  enabled: z.boolean(), assetId: z.string().max(80), fit: z.enum(['Cover', 'Contain', 'Original', 'Tile']),
  scale: z.number().min(.05).max(8), x: z.number().min(-5000).max(5000), y: z.number().min(-5000).max(5000), rotation: z.number().min(-180).max(180),
  opacity: z.number().min(0).max(1), blend: z.enum(['normal', 'multiply', 'screen', 'soft-light', 'overlay']),
  brightness: z.number().min(0).max(2), contrast: z.number().min(0).max(2), saturation: z.number().min(0).max(2),
  tint: color, tintOpacity: z.number().min(0).max(1), press: z.enum(['Tint', 'Brighten', 'Hide']), pressTint: z.number().min(0).max(1),
});
export const defaultImageSettings = (): ImageSettings => ({ enabled: false, assetId: '', fit: 'Cover' as const, scale: 1, x: 0, y: 0, rotation: 0, opacity: .75, blend: 'normal' as const, brightness: 1, contrast: 1, saturation: 1, tint: '#ffffff', tintOpacity: 0, press: 'Tint' as const, pressTint: .55 });
export type ImageSettings = z.infer<typeof imageSettingsSchema>;
// Raster-only inline assets. No external paths, URLs or active SVG documents.
export const assetSchema = z.object({ name: z.string().max(100), width: z.number().int().min(1).max(2048), height: z.number().int().min(1).max(2048), data: z.string().max(420_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).refine(value => value.split(',')[1]?.length % 4 === 0, 'Invalid base64 image') }).superRefine((asset, ctx) => {
  const dimensions = rasterDimensions(asset.data);
  if (!dimensions || dimensions.width !== asset.width || dimensions.height !== asset.height) ctx.addIssue({ code: 'custom', message: `Image “${asset.name}” has invalid raster data or dimensions.` });
});
export type ImageAsset = z.infer<typeof assetSchema>;
export const mouseGeometrySchema = z.object({ x: z.number().min(0).max(1000), y: z.number().min(0).max(1000), w: z.number().min(10).max(1000), h: z.number().min(10).max(1000) }).partial();
export const trailAppearanceSchema = z.object({
  gridColor: color, gridOpacity: z.number().min(0).max(1), gridSpacing: z.number().min(8).max(160),
  centerColor: color, centerSize: z.number().min(2).max(30), markerColor: color, markerSize: z.number().min(1).max(30),
  slowColor: color, fastColor: color, speedRange: z.number().min(.1).max(100),
  leftClickColor: color, rightClickColor: color, clickDuration: z.number().min(100).max(1500), clickSize: z.number().min(2).max(60), followMs: z.number().min(10).max(2000),
});
export const defaultTrailAppearance = () => ({ gridColor: '#ffffff', gridOpacity: .05, gridSpacing: 36, centerColor: '#ffffff', centerSize: 6, markerColor: '#a5ef6b', markerSize: 4, slowColor: '#55cfff', fastColor: '#ff9055', speedRange: 10, leftClickColor: '#a5ef6b', rightClickColor: '#ff9cbd', clickDuration: 500, clickSize: 24, followMs: 240 });
