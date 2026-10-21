import { documentSchema, initialDocument, presetSchema, uid, type StudioDocument } from './config';
import { assetSchema } from './visual';
import { z } from 'zod';
import { MAX_IMPORT_BYTES, utf8Bytes } from './limits';

const bundleSchema = z.object({ format: z.literal('input-overlay-studio-preset'), version: z.literal(1), preset: presetSchema, assets: z.record(z.string().min(1).max(80), assetSchema) });
export function exportPreset(d: StudioDocument, id: string) {
  const preset = d.presets.find(p => p.id === id); if (!preset) throw Error('Preset not found.');
  const used = new Set(preset.modules.map(m => m.image.assetId));
  return JSON.stringify({ format: 'input-overlay-studio-preset', version: 1, preset, assets: Object.fromEntries(Object.entries(d.assets).filter(([id]) => used.has(id))) });
}
export function importPreset(text: string) {
  if (utf8Bytes(text) > MAX_IMPORT_BYTES) throw Error('Preset exceeds 2 MB.');
  const bundle = bundleSchema.parse(JSON.parse(text)), d = initialDocument();
  d.profiles[0].modules = bundle.preset.modules; d.assets = bundle.assets; documentSchema.parse(d);
  const ids = new Map(Object.keys(bundle.assets).map(id => [id, uid()]));
  const assets = Object.fromEntries(Object.entries(bundle.assets).map(([id, value]) => [ids.get(id)!, value]));
  const preset = { ...bundle.preset, id: uid(), modules: bundle.preset.modules.map(m => ({ ...m, id: uid(), image: { ...m.image, assetId: ids.get(m.image.assetId) || '' } })) };
  return { preset, assets };
}
