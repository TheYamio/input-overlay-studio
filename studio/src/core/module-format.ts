import { z } from 'zod';
import { MAX_DOCUMENT_BYTES,utf8Bytes } from './limits.ts';
import { moduleViewSchema, currentDocumentSchema, profileSchema, presetSchema, type OverlayModule } from './config-schema.ts';
import { moduleExtensionSchema, ModuleConfigurationRegistry, type ModuleExtension, moduleReferences, commonFields } from './module-envelope.ts';

export {commonFields} from './module-envelope.ts';
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
const ownShape=Object.fromEntries(Object.entries(moduleViewSchema.shape).filter(([key])=>!['id','type',...commonFields].includes(key)));
// Builtin editing views share visual controls. Registered modules own their
// config schema; the persisted envelope stays independent of UI components.
const builtinConfigurations=moduleViewSchema.shape.type.options.map(type=>({type:`overlay.${type}`,builtinType:type,schemaVersion:1,schema:z.strictObject(ownShape)}));
for(const definition of builtinConfigurations)moduleConfigurations.register(definition);
export function encodeModule(module:OverlayModule,registry=moduleConfigurations):PersistedModule {
 const common=commonModuleSchema.parse(Object.fromEntries(commonFields.map(field=>[field,module[field]])));
 if(module.extension){registry.validate(module.extension);const envelope=moduleEnvelopeSchema.parse({...structuredClone(module.extension),id:module.id,common});const definition=registry.get(module.extension.type);if(definition?.builtinType&&definition.schemaVersion===module.extension.schemaVersion)projectModule(envelope,()=>module,registry);return envelope;}
 const definition=registry.all().find(item=>item.builtinType===module.type)??builtinConfigurations.find(item=>item.builtinType===module.type);if(!definition)throw Error(`Unregistered module type ${module.type}.`);
 const authored=Object.fromEntries(Object.keys(ownShape).filter(key=>Object.hasOwn(module,key)).map(key=>[key,module[key as keyof OverlayModule]]));
 if(!definition.schema.safeParse(authored).success)throw Error(`Invalid configuration for ${definition.type}.`);
 // Optional builtin overrides may be undefined in the editor projection. JSON
 // has always omitted those properties; opaque configs must already be JSON.
 const config=JSON.parse(JSON.stringify(authored)) as Record<string,unknown>;
 const extension={type:definition.type,schemaVersion:definition.schemaVersion,enabled:true,config,resources:moduleReferences(module)};registry.validate(extension);
 return moduleEnvelopeSchema.parse({...extension,id:module.id,common});
}
export function decodeModule(value:unknown,fallback:(id:string)=>OverlayModule,registry=moduleConfigurations):OverlayModule {
 return projectModule(moduleEnvelopeSchema.parse(value),fallback,registry);
}
// The document schema already validated each envelope and bounded its raw JSON.
// Do not parse that envelope again for every projection step.
function projectModule(envelope:PersistedModule,fallback:(id:string)=>OverlayModule,registry:ModuleConfigurationRegistry):OverlayModule {
 const definition=registry.get(envelope.type),{id,common,...extension}=envelope;
 if(definition?.builtinType&&definition.schemaVersion===envelope.schemaVersion){
  const builtin=builtinConfigurations.some(item=>item.type===definition.type&&item.schema===definition.schema);
  if(builtin){if(Object.keys(envelope.config).some(key=>!Object.hasOwn(ownShape,key)))throw Error(`Invalid configuration for ${definition.type}.`);}
  else registry.validate(extension,false);
  const validated=moduleViewSchema.safeParse({...envelope.config,...common,id,type:definition.builtinType});
  if(!validated.success)throw Error(`Invalid configuration for ${definition.type}.`);
  const parsed=validated.data;
  const references=moduleReferences(parsed);
  if(references.assets.some(id=>!envelope.resources.assets.includes(id))||references.shapes.some(id=>!envelope.resources.shapes.includes(id)))throw Error('Module resources do not declare all configuration references.');
  // Builtins have no opaque extra resource references that an old editor could lose.
  if(references.assets.length!==envelope.resources.assets.length||references.shapes.length!==envelope.resources.shapes.length)throw Error('Unexpected builtin module resources.');
  return {...parsed,...(!envelope.enabled?{extension:structuredClone(extension)}:{})};
 }
 registry.validate(extension,false);
 return {...fallback(id),...common,id,extension:structuredClone(extension)};
}
export function validateModuleExtensions(modules:readonly OverlayModule[]){
 for(const module of modules)if(module.extension){
  const definition=moduleConfigurations.get(module.extension.type);
  if(definition?.builtinType&&definition.schemaVersion===module.extension.schemaVersion){
   const envelope=moduleEnvelopeSchema.parse({...module.extension,id:module.id,common:Object.fromEntries(commonFields.map(field=>[field,module[field]]))});
   projectModule(envelope,()=>module,moduleConfigurations);
  }else moduleConfigurations.validate(module.extension,false);
 }
}
export function moduleAvailable(module:OverlayModule){if(module.extension)return moduleConfigurations.available(module.extension);if(!moduleViewSchema.shape.type.options.includes(module.type))return true;return moduleConfigurations.available({type:`overlay.${module.type}`,schemaVersion:1,enabled:true});}
export function moduleConfiguration(module:OverlayModule):ModuleExtension['config']|undefined{return module.extension?.config;}

export function encodeDocument(value:z.infer<typeof currentDocumentSchema>,registry=moduleConfigurations):PersistedDocument {
 const document=currentDocumentSchema.parse(value);const container=<T extends {modules:OverlayModule[]}>(profile:T)=>({...profile,modules:profile.modules.map(module=>encodeModule(module,registry))});
 const wire=persistedDocumentSchema.parse({...document,version:4,profiles:document.profiles.map(container),presets:document.presets.map(container)});if(utf8Bytes(JSON.stringify(wire))>MAX_DOCUMENT_BYTES)throw Error('Configuration exceeds 1.8 MB. Remove unused images.');return wire;
}
export function projectDocument(value:unknown,fallback:(id:string)=>OverlayModule,registry=moduleConfigurations){
 // Local sync metadata is separate from the strict persisted document contract.
 const source=value&&typeof value==='object'?{...value as Record<string,unknown>}:value;
 if(source&&typeof source==='object')delete (source as Record<string,unknown>).__studioSync;
 if(utf8Bytes(JSON.stringify(source))>MAX_DOCUMENT_BYTES)throw Error('Configuration exceeds 1.8 MB. Remove unused images.');
 const document=persistedDocumentSchema.parse(source);const container=<T extends {modules:PersistedModule[]}>(profile:T)=>({...profile,modules:profile.modules.map(module=>projectModule(module,fallback,registry))});
 return {...document,version:4 as const,profiles:document.profiles.map(container),presets:document.presets.map(container)};
}
export function decodeDocument(value:unknown,fallback:(id:string)=>OverlayModule,registry=moduleConfigurations){
 return currentDocumentSchema.parse(projectDocument(value,fallback,registry));
}
export { moduleReferences } from './module-envelope.ts';
