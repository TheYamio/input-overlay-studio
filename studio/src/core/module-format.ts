import { z } from 'zod';
import { MAX_DOCUMENT_BYTES,utf8Bytes } from './limits.ts';
import {isolateDocumentLanguages} from './localization/document.ts';
import { moduleViewSchema, currentDocumentSchema, profileSchema, presetSchema, type OverlayModule } from './config-schema.ts';
import { moduleExtensionSchema, ModuleConfigurationRegistry, type ModuleExtension, moduleReferences, configurationReferences, commonFields } from './module-envelope.ts';

export {commonFields} from './module-envelope.ts';
import {builtinConfigurations} from './modules/configurations.ts';
const commonShape=Object.fromEntries(commonFields.map(field=>[field,moduleViewSchema.shape[field]])) as Pick<typeof moduleViewSchema.shape,typeof commonFields[number]>;
export const commonModuleSchema=z.strictObject(commonShape).refine(common=>common.x+common.w<=1920&&common.y+common.h<=1080,'Module bounds exceed the canvas.');
export const moduleEnvelopeSchema=moduleExtensionSchema.safeExtend({id:moduleViewSchema.shape.id,common:commonModuleSchema});
export type PersistedModule=z.infer<typeof moduleEnvelopeSchema>;
const moduleList=z.array(moduleEnvelopeSchema).max(32);
export const persistedProfileSchema=z.strictObject({...profileSchema.shape,modules:moduleList});
export const persistedPresetSchema=z.strictObject({...presetSchema.shape,modules:moduleList});
export const persistedDocumentSchema=z.strictObject({...currentDocumentSchema.shape,version:z.literal(4),profiles:z.array(persistedProfileSchema).min(1).max(50),presets:z.array(persistedPresetSchema).max(50)});
export type PersistedDocument=z.infer<typeof persistedDocumentSchema>;
export const moduleConfigurations=new ModuleConfigurationRegistry();
for(const definition of builtinConfigurations)moduleConfigurations.register(definition);
export function encodeModule(module:OverlayModule,registry=moduleConfigurations):PersistedModule {
 const common=commonModuleSchema.parse(Object.fromEntries(commonFields.map(field=>[field,module[field]])));
 const definition=registry.get(module.extension?.type??`overlay.${module.type}`);
 if(module.extension&&(!definition?.builtinType||definition.schemaVersion!==module.extension.schemaVersion)){
  registry.validate(module.extension);return moduleEnvelopeSchema.parse({...structuredClone(module.extension),id:module.id,common});
 }
 const current=definition??builtinConfigurations.find(item=>item.builtinType===module.type);if(!current)throw Error(`Unregistered module type ${module.type}.`);
 const fields=current.fields??Object.keys((current.schema as z.ZodObject).shape??{});
 const authored=Object.fromEntries(fields.filter(key=>Object.hasOwn(module,key)||module.extension&&Object.hasOwn(module.extension.config,key)).map(key=>[key,Object.hasOwn(module,key)?module[key as keyof OverlayModule]:module.extension!.config[key]]));
 const config=JSON.parse(JSON.stringify(current.schema.parse(authored))) as Record<string,unknown>;
 const extension={type:current.type,schemaVersion:current.schemaVersion,enabled:module.extension?.enabled??true,config,resources:moduleReferences(module)};registry.validate(extension);
 return moduleEnvelopeSchema.parse({...extension,id:module.id,common});
}
export function decodeModule(value:unknown,fallback:(id:string)=>OverlayModule,registry=moduleConfigurations):OverlayModule {
 return projectModule(moduleEnvelopeSchema.parse(value),fallback,registry);
}
function projectModule(source:PersistedModule,fallback:(id:string)=>OverlayModule,registry:ModuleConfigurationRegistry):OverlayModule {
 const definition=registry.get(source.type);
 if(definition?.builtinType&&source.schemaVersion===1&&definition.schemaVersion>1){
  registry.validate(source,false);const legacy=configurationReferences(definition.builtinType,source.config,true);
  if(['assets','shapes'].some(kind=>{const key=kind as 'assets'|'shapes';return legacy[key].length!==source.resources[key].length||legacy[key].some(id=>!source.resources[key].includes(id));}))throw Error('Unexpected builtin module resources.');
 }
 const {id:sourceId,common:sourceCommon,...sourceExtension}=source;
 const migrated=registry.migrate(sourceExtension,false).value,envelope={...migrated,id:sourceId,common:sourceCommon};const {id,common,...extension}=envelope;
 if(definition?.builtinType&&definition.schemaVersion===envelope.schemaVersion){
  registry.validate(extension,false);
  const validated=moduleViewSchema.safeParse({...fallback(id),...envelope.config,...common,id,type:definition.builtinType});
  if(!validated.success)throw Error(`Invalid configuration for ${definition.type}.`);
  const parsed=validated.data,references=moduleReferences(parsed);
  if(references.assets.some(id=>!envelope.resources.assets.includes(id))||references.shapes.some(id=>!envelope.resources.shapes.includes(id)))throw Error('Module resources do not declare all configuration references.');
  const retained=JSON.stringify(references)!==JSON.stringify(envelope.resources)||Object.keys(envelope.config).some(key=>!Object.hasOwn(moduleViewSchema.shape,key));
  return {...parsed,...(!envelope.enabled||retained?{extension:structuredClone(extension)}:{})};
 }
 return {...fallback(id),...common,id,extension:structuredClone(extension)};
}
export function validateModuleExtensions(modules:readonly OverlayModule[]){
 for(const module of modules){
  const current=moduleConfigurations.get(module.extension?.type??`overlay.${module.type}`);
  if(current?.builtinType&&(!module.extension||module.extension.schemaVersion===current.schemaVersion)){const config=Object.fromEntries((current.fields??[]).filter(field=>Object.hasOwn(module,field)||module.extension&&Object.hasOwn(module.extension.config,field)).map(field=>[field,Object.hasOwn(module,field)?module[field as keyof OverlayModule]:module.extension!.config[field]]));if(!current.schema.safeParse(config).success)throw Error(`Invalid configuration for ${current.type}.`);}
  if(!module.extension)continue;
  const definition=moduleConfigurations.get(module.extension.type);
  if(definition?.builtinType&&definition.schemaVersion===module.extension.schemaVersion){
   const envelope=moduleEnvelopeSchema.parse({...module.extension,id:module.id,common:Object.fromEntries(commonFields.map(field=>[field,module[field]]))});
   projectModule(envelope,()=>module,moduleConfigurations);
  }else moduleConfigurations.validate(module.extension,false);
 }
}
export function moduleAvailable(module:OverlayModule,registry=moduleConfigurations){if(module.extension)return registry.available(module.extension);if(!moduleViewSchema.shape.type.options.includes(module.type))return true;return registry.available({type:`overlay.${module.type}`,schemaVersion:registry.get(`overlay.${module.type}`)?.schemaVersion??1,enabled:true});}
export function moduleSchemaVersion(module:OverlayModule,registry=moduleConfigurations){return module.extension?.schemaVersion??registry.get(`overlay.${module.type}`)?.schemaVersion??1;}
export function upgradeDocumentModules(document:z.infer<typeof currentDocumentSchema>,registry:ModuleConfigurationRegistry){
 let changed=false;
 const container=<T extends {modules:OverlayModule[]}>(profile:T)=>{let updated=false;const modules=profile.modules.map(module=>{
  if(!module.extension)return module;
  const definition=registry.get(module.extension.type);if(!definition)return module;registry.validate(module.extension,false);
  if(module.extension.schemaVersion>definition.schemaVersion)return module;
  const result=registry.migrate(module.extension,false);if(!result.changed)return module;updated=true;changed=true;
  return decodeModule({...result.value,id:module.id,common:Object.fromEntries(commonFields.map(field=>[field,module[field]]))},()=>module,registry);
 });return updated?{...profile,modules}:profile;};
 const profiles=document.profiles.map(container),presets=document.presets.map(container);return changed?{...document,profiles,presets}:document;
}
export function moduleConfiguration(module:OverlayModule):ModuleExtension['config']|undefined{return module.extension?.config;}

export function encodeDocument(value:z.infer<typeof currentDocumentSchema>,registry=moduleConfigurations):PersistedDocument {
 const document=isolateDocumentLanguages(currentDocumentSchema.parse(value));const container=<T extends {modules:OverlayModule[]}>(profile:T)=>({...profile,modules:profile.modules.map(module=>encodeModule(module,registry))});
 const wire=persistedDocumentSchema.parse({...document,version:4,profiles:document.profiles.map(container),presets:document.presets.map(container)});if(utf8Bytes(JSON.stringify(wire))>MAX_DOCUMENT_BYTES)throw Error('Configuration exceeds 1.8 MB. Remove unused images.');return wire;
}
export function projectDocument(value:unknown,fallback:(id:string)=>OverlayModule,registry=moduleConfigurations){
 // Local sync metadata is separate from the strict persisted document contract.
 const source=value&&typeof value==='object'?{...value as Record<string,unknown>}:value;
 if(source&&typeof source==='object')delete (source as Record<string,unknown>).__studioSync;
 if(utf8Bytes(JSON.stringify(source))>MAX_DOCUMENT_BYTES)throw Error('Configuration exceeds 1.8 MB. Remove unused images.');
 const document=isolateDocumentLanguages(persistedDocumentSchema.parse(source));const container=<T extends {modules:PersistedModule[]}>(profile:T)=>({...profile,modules:profile.modules.map(module=>projectModule(module,fallback,registry))});
 return {...document,version:4 as const,profiles:document.profiles.map(container),presets:document.presets.map(container)};
}
export function decodeDocument(value:unknown,fallback:(id:string)=>OverlayModule,registry=moduleConfigurations){
 return currentDocumentSchema.parse(projectDocument(value,fallback,registry));
}
export { moduleReferences } from './module-envelope.ts';
