import {validUnicode} from './unicode.ts';
import type { OverlayModule } from './config-schema.ts';
import { z } from 'zod';
import {builtinConfigFields,builtinConfigVersions} from './modules/fields.ts';

export const moduleTypeSchema=z.string().max(100).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
const resourceId=z.string().min(1).max(80);
export const moduleResourcesSchema=z.strictObject({assets:z.array(resourceId).max(8),shapes:z.array(resourceId).max(32)}).refine(resources=>new Set(resources.assets).size===resources.assets.length&&new Set(resources.shapes).size===resources.shapes.length,'Duplicate module resource references.');
export function boundedModuleJSON(value:unknown):boolean {
 let nodes=0;const ancestors=new Set<object>();
 const visit=(v:unknown,depth:number):boolean=>{
  if(++nodes>10000||depth>16)return false;
  if(v===null||typeof v==='boolean')return true;
  if(typeof v==='number')return Number.isFinite(v);
  if(typeof v==='string')return v.length<=16384&&validUnicode(v);
  if(!v||typeof v!=='object'||ancestors.has(v)||Object.getPrototypeOf(v)!==Object.prototype&&!Array.isArray(v)&&Object.getPrototypeOf(v)!==null)return false;
  ancestors.add(v);const entries=Object.entries(v);
  const valid=entries.length<=(Array.isArray(v)?1000:256)&&entries.every(([key,child])=>key.length<=100&&validUnicode(key)&&!['__proto__','prototype','constructor'].includes(key)&&visit(child,depth+1));ancestors.delete(v);return valid;
 };
 try{return !!value&&typeof value==='object'&&!Array.isArray(value)&&visit(value,0)&&new TextEncoder().encode(JSON.stringify(value)).length<=262144;}catch{return false;}
}
export const moduleExtensionSchema=z.strictObject({type:moduleTypeSchema,schemaVersion:z.number().int().min(1).max(65535),enabled:z.boolean(),config:z.preprocess((value,ctx)=>{if(!boundedModuleJSON(value)){ctx.addIssue({code:'custom',message:'Module configuration exceeds safe JSON limits.'});return z.NEVER;}return value;},z.record(z.string(),z.unknown())),resources:moduleResourcesSchema});
export type ModuleExtension=z.infer<typeof moduleExtensionSchema>;
export function moduleKind(module:{type:string;extension?:ModuleExtension}){return module.extension?.type??module.type;}
export const commonFields=['name','x','y','w','h','visible','locked','z','opacity'] as const;
export function moduleEnvelopeData(module:OverlayModule){
 const common=Object.fromEntries(commonFields.map(field=>[field,module[field]]));
 if(module.extension&&!(module.extension.type===`overlay.${module.type}`&&module.extension.schemaVersion===builtinConfigVersions[module.type]))return {...module.extension,id:module.id,common};
 const fields=builtinConfigFields[module.type];
 const config=Object.fromEntries(fields.filter(key=>Object.hasOwn(module,key)).map(key=>[key,module[key]]));
 return {id:module.id,type:`overlay.${module.type}`,schemaVersion:builtinConfigVersions[module.type],enabled:module.extension?.enabled??true,common,config,resources:moduleReferences(module)};
}
export function persistedSize(document:{profiles:{modules:OverlayModule[]}[];presets:{modules:OverlayModule[]}[]}){
 const container=<T extends {modules:OverlayModule[]}>(profile:T)=>({...profile,modules:profile.modules.map(moduleEnvelopeData)});
 return new TextEncoder().encode(JSON.stringify({...document,version:4,profiles:document.profiles.map(container),presets:document.presets.map(container)})).length;
}

export interface ModuleMigration {
 readonly from:number;readonly to:number;readonly source:z.ZodType;
 readonly recipe?:Readonly<{kind:'pick-config';fields:readonly string[]}>;
 readonly transform?:(value:Readonly<Pick<ModuleExtension,'config'|'resources'>>)=>Pick<ModuleExtension,'config'|'resources'>;
}
export interface ConfigurationDefinition {readonly type:string;readonly schemaVersion:number;readonly schema:z.ZodType;readonly builtinType?:string;readonly fields?:readonly string[];readonly migrations?:readonly ModuleMigration[]}
function configurationDefaults(source:unknown,parsed:unknown):unknown {
 if(source&&parsed&&typeof source==='object'&&typeof parsed==='object'&&Array.isArray(source)===Array.isArray(parsed)){
  if(Array.isArray(source)){if(source.length!==(parsed as unknown[]).length)throw Error('Use a module migration to transform saved values.');return source.map((value,index)=>configurationDefaults(value,(parsed as unknown[])[index]));}
  const result={...source as Record<string,unknown>};for(const [key,value] of Object.entries(parsed))result[key]=Object.hasOwn(result,key)?configurationDefaults(result[key],value):structuredClone(value);return result;
 }
 if(!Object.is(source,parsed))throw Error('Use a module migration to transform saved values.');return source;
}

// Trusted compiled schemas only. Registering a schema never executes a module.
export class ModuleConfigurationRegistry {
 private entries=new Map<string,ConfigurationDefinition>();private disabled=new Set<string>();
 private revision=0;private listeners=new Set<()=>void>();
 getSnapshot=()=>this.revision;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private notify(){this.revision++;for(const listener of [...this.listeners]){try{listener();}catch{/* An observer cannot stop other modules. */}}}
 register(definition:ConfigurationDefinition){
  moduleTypeSchema.parse(definition.type);if(!Number.isSafeInteger(definition.schemaVersion)||definition.schemaVersion<1||definition.schemaVersion>65535||!definition.schema?.safeParse||this.entries.has(definition.type))throw Error('Invalid or duplicate module configuration definition.');
  if(definition.builtinType&&[...this.entries.values()].some(item=>item.builtinType===definition.builtinType))throw Error('Duplicate builtin module type.');
  const migrations=new Map<number,ModuleMigration>();
  for(const step of definition.migrations??[]){if(!Number.isSafeInteger(step.from)||step.from<1||step.to!==step.from+1||step.to>definition.schemaVersion||!step.source?.safeParse||migrations.has(step.from)||!!step.recipe===!!step.transform||step.recipe&&(step.recipe.kind!=='pick-config'||!step.recipe.fields.length||new Set(step.recipe.fields).size!==step.recipe.fields.length||step.recipe.fields.some(field=>!field||['__proto__','prototype','constructor'].includes(field))))throw Error('Invalid module migration.');migrations.set(step.from,step);}
  if(migrations.size){for(let version=Math.min(...migrations.keys());version<definition.schemaVersion;version++)if(!migrations.has(version))throw Error('Missing module migration step.');}
  const frozen=Object.freeze({...definition,...(definition.fields?{fields:Object.freeze([...definition.fields])}:{}),migrations:Object.freeze([...migrations.values()].map(step=>Object.freeze({...step,...(step.recipe?{recipe:Object.freeze({...step.recipe,fields:Object.freeze([...step.recipe.fields])})}:{})})))});
  this.entries.set(definition.type,frozen);this.notify();let active=true;return ()=>{if(active){active=false;this.entries.delete(definition.type);this.disabled.delete(definition.type);this.notify();}};
 }
 all(){return Object.freeze([...this.entries.values()]);}
 get(type:string){return this.entries.get(type);}
 available(extension:Pick<ModuleExtension,'type'|'schemaVersion'|'enabled'>){const definition=this.get(extension.type);return extension.enabled&&!this.disabled.has(extension.type)&&definition?.schemaVersion===extension.schemaVersion;}
 setEnabled(type:string,enabled:boolean){if(!this.entries.has(type))throw Error('Unknown module configuration definition.');const previous=this.disabled.has(type);if(enabled)this.disabled.delete(type);else this.disabled.add(type);if(previous!==this.disabled.has(type))this.notify();}
 validate(extension:ModuleExtension,structure=true){if(structure)moduleExtensionSchema.parse(extension);const definition=this.get(extension.type),schema=definition?.schemaVersion===extension.schemaVersion?definition.schema:definition?.migrations?.find(step=>step.from===extension.schemaVersion)?.source;if(schema&&!schema.safeParse(extension.config).success)throw Error(`Invalid configuration for ${extension.type}.`);}
 migrate(extension:ModuleExtension,structure=true):{value:ModuleExtension;changed:boolean;status:'current'|'migrated'|'unsupported'}{
  if(structure)moduleExtensionSchema.parse(extension);this.validate(extension,false);const definition=this.get(extension.type);
  if(!definition||extension.schemaVersion>definition.schemaVersion)return {value:structuredClone(extension),changed:false,status:'unsupported'};
  let value=structuredClone(extension),changed=false;
  while(value.schemaVersion<definition.schemaVersion){
   const step=definition.migrations?.find(step=>step.from===value.schemaVersion);if(!step)return {value:structuredClone(extension),changed:false,status:'unsupported'};
   const config=step.source.parse(value.config) as ModuleExtension['config'];
   const input={config:structuredClone(config),resources:structuredClone(value.resources)};
   const output=step.recipe?{config:Object.fromEntries(step.recipe.fields.filter(field=>Object.hasOwn(config,field)).map(field=>[field,config[field]])),resources:input.resources}:step.transform!(input);
   if(output&&typeof (output as {then?:unknown}).then==='function')throw Error('Module migrations must be synchronous.');
   const resources={assets:[...new Set([...value.resources.assets,...output.resources.assets])],shapes:[...new Set([...value.resources.shapes,...output.resources.shapes])]};
   value=moduleExtensionSchema.parse({...value,config:output.config,resources,schemaVersion:step.to});this.validate(value,false);changed=true;
  }
  const config=configurationDefaults(value.config,definition.schema.parse(value.config));value=moduleExtensionSchema.parse({...value,config});changed||=JSON.stringify(value.config)!==JSON.stringify(extension.config);
  return {value,changed,status:changed?'migrated':'current'};
 }

}

export function configurationReferences(type:string,config:Record<string,unknown>,legacy=false){
 const strings=(value:unknown)=>typeof value==='string'&&value?[value]:[];
 const image=config.image as {assetId?:unknown}|undefined,appearance=config.appearance as {shapeId?:unknown}|undefined;
 const keys=Array.isArray(config.keys)?config.keys:[],buttons=config.buttonStyles&&typeof config.buttonStyles==='object'?Object.values(config.buttonStyles):[];
 const shapes=[...strings(appearance?.shapeId),...(legacy||type==='keyboard'?keys.flatMap(key=>strings(key?.style?.shapeId)):[]),...(legacy||type==='mouse'?[...strings(config.mouseBodyShapeId),...buttons.flatMap(style=>strings((style as {shapeId?:unknown})?.shapeId))]:[])];
 return {assets:[...new Set(legacy||type==='keyboard'||type==='mouse'?strings(image?.assetId):[])],shapes:[...new Set(shapes)]};
}
export function moduleReferences(module:OverlayModule){
 const own=configurationReferences(module.type,module as unknown as Record<string,unknown>),extension=module.extension;
 if(!extension)return own;
 const old=extension.type===`overlay.${module.type}`&&extension.schemaVersion===builtinConfigVersions[module.type]?configurationReferences(module.type,extension.config):{assets:[],shapes:[]};
 const merge=(kind:'assets'|'shapes')=>[...new Set([...extension.resources[kind].filter(id=>!old[kind].includes(id)||own[kind].includes(id)),...own[kind]])];
 return {assets:merge('assets'),shapes:merge('shapes')};
}
