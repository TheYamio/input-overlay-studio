import { moduleReferences } from './module-envelope';
import { encodeModule, decodeModule, persistedPresetSchema } from './module-format';
import { makeModule } from './config';
import { documentSchema, initialDocument, uid, type StudioDocument } from './config';
import { assetSchema } from './visual';
import { z } from 'zod';
import { shapeSchema } from './shapes';
import { MAX_IMPORT_BYTES, utf8Bytes } from './limits';

const bundleSchema = z.strictObject({ format: z.literal('input-overlay-studio-preset'), version: z.literal(2), preset: persistedPresetSchema, assets: z.record(z.string().min(1).max(80), assetSchema), shapes: z.record(z.string().min(1).max(80), shapeSchema).default({}) });
export function serializePresetBundle(bundle:{preset:StudioDocument['presets'][number];assets:StudioDocument['assets'];shapes:StudioDocument['shapes']}){
 return JSON.stringify({...bundle,format:'input-overlay-studio-preset',version:2,preset:{...bundle.preset,modules:bundle.preset.modules.map(module=>encodeModule(module))}});
}
export function usedShapes(modules: StudioDocument['profiles'][number]['modules']) {
  return new Set(modules.flatMap(m => moduleReferences(m).shapes));
}
export function exportPreset(d: StudioDocument, id: string) {
  const preset = d.presets.find(p => p.id === id); if (!preset) throw Error('Preset not found.');
  const used = new Set(preset.modules.flatMap(m => moduleReferences(m).assets));
  const shapes = usedShapes(preset.modules);
  return JSON.stringify({ format: 'input-overlay-studio-preset', version: 2, preset:{...preset,modules:preset.modules.map(m=>encodeModule(m))}, assets: Object.fromEntries(Object.entries(d.assets).filter(([id]) => used.has(id))), shapes: Object.fromEntries(Object.entries(d.shapes).filter(([id]) => shapes.has(id))) });
}
export function importPreset(text: string, existing?:StudioDocument) {
  if (utf8Bytes(text) > MAX_IMPORT_BYTES) throw Error('Preset exceeds 2 MB.');
  const raw=bundleSchema.parse(JSON.parse(text));
  const bundle={...raw,preset:{...raw.preset,modules:raw.preset.modules.map(module=>decodeModule(module,id=>makeModule('distance',0,id))) }},d=initialDocument();
  const opaque=bundle.preset.modules.some(module=>module.extension);
  if(opaque&&existing)for(const library of ['assets','shapes'] as const)for(const [id,value] of Object.entries(bundle[library]))if(Object.hasOwn(existing[library],id)&&JSON.stringify(existing[library][id])!==JSON.stringify(value))throw Error('A preserved module resource conflicts with an existing resource. Import into a separate configuration.');
  d.profiles[0].modules = bundle.preset.modules; d.assets = bundle.assets; d.shapes = bundle.shapes; documentSchema.parse(d);
  const ids = new Map(Object.keys(bundle.assets).map(id => [id, opaque?id:uid()]));
  const assets = Object.fromEntries(Object.entries(bundle.assets).map(([id, value]) => [ids.get(id)!, value]));
  const shapeIds = new Map(Object.keys(bundle.shapes).map(id => [id, opaque?id:uid()]));
  const shapes = Object.fromEntries(Object.entries(bundle.shapes).map(([id, shape]) => [shapeIds.get(id)!, shape]));
  const remap = <T extends { shapeId?: string }>(style: T): T => ({ ...style, ...(style.shapeId ? { shapeId: shapeIds.get(style.shapeId)! } : {}) });
  const groups = new Map(bundle.preset.modules.flatMap(m => m.image.groupId ? [[m.image.groupId, uid()] as const] : []));
  const preset = { ...bundle.preset, id: uid(), modules: bundle.preset.modules.map(m => ({ ...m, id: uid(), ...(m.mouseBodyShapeId ? { mouseBodyShapeId: shapeIds.get(m.mouseBodyShapeId)! } : {}), appearance: remap(m.appearance), keys: m.keys.map(k => ({ ...k, ...(k.style ? { style: remap(k.style) } : {}) })), buttonStyles: Object.fromEntries(Object.entries(m.buttonStyles).map(([id, style]) => [id, remap(style)])), image: { ...m.image, assetId: ids.get(m.image.assetId) || '', ...(m.image.groupId ? { groupId: groups.get(m.image.groupId)! } : {}) } })) };
  return { preset, assets, shapes };
}
