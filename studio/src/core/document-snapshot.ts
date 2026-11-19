import {documentSchema,type OverlayModule,type StudioDocument} from './config';
import {moduleConfigurations,upgradeDocumentModules,validateModuleExtensions} from './module-format';
import {moduleSchema,validateModuleReferences,validDocumentUnicode} from './config-schema';
import {moduleEnvelopeData,moduleReferences,persistedSize} from './module-envelope';
import {consistentArtworkGroups} from './artwork-groups';
import {MAX_DOCUMENT_BYTES,utf8Bytes} from './limits';
import {z} from 'zod';
import {immutable} from './settings/events';
type Registry = typeof moduleConfigurations;
const validated = new WeakMap<StudioDocument, {version: number; registry: Registry; revision: number}>();
const sizes = new WeakMap<StudioDocument, number>();
const pruned = new WeakSet<StudioDocument['assets']>();
function remember(document: StudioDocument, registry: Registry) {
  validated.set(document, {version: moduleConfigurations.getSnapshot(), registry, revision: registry.getSnapshot()});
  return document;
}
export function parseModuleDocument(input:unknown,registry=moduleConfigurations){
 let result=documentSchema.safeParse(input);
 if(result.success&&registry!==moduleConfigurations){try{
  const upgraded=upgradeDocumentModules(result.data,registry);if(upgraded!==result.data)result=documentSchema.safeParse(upgraded);
 }catch(error){return {success:false,error:new z.ZodError([{code:'custom',path:[],message:error instanceof Error?error.message:'Invalid module configuration.'}])} as const;}}
 return result;
}
export function checkDocumentSnapshot(input:unknown,registry=moduleConfigurations){
 const document = input as StudioDocument;
 const stamp = validated.get(document);
 if (stamp?.version === moduleConfigurations.getSnapshot()) {
   if (registry === moduleConfigurations || stamp.registry === registry && stamp.revision === registry.getSnapshot()) {
     return {success:true,data:document} as const;
   }
   try {
     // A browser storage snapshot can be reused by Studio when its installed
     // registry accepts every retained module without a migration.
     if (upgradeDocumentModules(document,registry) === document) return {success:true,data:remember(document,registry)} as const;
   } catch { /* Parse again to return the normal validation error. */ }
 }
 const result=parseModuleDocument(input,registry);
 if(result.success) remember(immutable(result.data),registry);
 return result;
}
export function documentSnapshot(document:StudioDocument,registry=moduleConfigurations){
 const result=checkDocumentSnapshot(document,registry);if(!result.success)throw result.error;return result.data;
}

export function markAssetsPruned(document: StudioDocument) { pruned.add(document.assets); }

// The rest of the immutable document is already validated. Undefined delegates
// edits affecting document-wide invariants back to the complete transaction.
export function checkModuleEdit(base: StudioDocument, profileIndex: number, moduleIndex: number, draft: OverlayModule, registry: Registry): StudioDocument | null | undefined {
  const previous = base.profiles[profileIndex].modules[moduleIndex];
  const stamp = validated.get(base);
  if (stamp?.version !== moduleConfigurations.getSnapshot() ||
      registry !== moduleConfigurations && (stamp.registry !== registry || stamp.revision !== registry.getSnapshot()) ||
      previous.id !== draft.id || previous.type !== draft.type || previous.extension || draft.extension ||
      Object.keys(base.assets).length > 0 && !pruned.has(base.assets)) return undefined;
  const parsed = moduleSchema.safeParse(draft);
  if (!parsed.success || !validDocumentUnicode(parsed.data)) return null;
  const module = parsed.data;
  const oldAssets = moduleReferences(previous).assets, nextAssets = moduleReferences(module).assets;
  if (oldAssets.length !== nextAssets.length || oldAssets.some(id => !nextAssets.includes(id))) return undefined;
  let valid = true;
  validateModuleReferences(module, base, () => { valid = false; });
  if (!valid) return null;
  try { validateModuleExtensions([module]); } catch { return null; }
  if (JSON.stringify(previous) === JSON.stringify(module)) return base;

  const profile = base.profiles[profileIndex];
  const modules = profile.modules.slice();
  modules[moduleIndex] = module;
  if (!consistentArtworkGroups(modules)) return null;
  let baseSize = sizes.get(base);
  if (baseSize === undefined) {
    baseSize = persistedSize(base);
    sizes.set(base, baseSize);
  }
  const bytes = (value: OverlayModule) => utf8Bytes(JSON.stringify(moduleEnvelopeData(value)));
  const size = baseSize - bytes(previous) + bytes(module);
  if (size > MAX_DOCUMENT_BYTES) return null;
  const profiles = base.profiles.slice();
  profiles[profileIndex] = {...profile, modules};
  const next = remember(immutable({...base, profiles}),registry);
  sizes.set(next, size);
  return next;
}
