import {validUnicode} from './unicode.ts';
import type { OverlayModule } from './config-schema.ts';
import { z } from 'zod';

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
 if(module.extension)return {...module.extension,id:module.id,common};
 const config=Object.fromEntries(Object.entries(module).filter(([key])=>!['id','type','extension',...commonFields].includes(key)));
 return {id:module.id,type:`overlay.${module.type}`,schemaVersion:1,enabled:true,common,config,resources:moduleReferences(module)};
}
export function persistedSize(document:{profiles:{modules:OverlayModule[]}[];presets:{modules:OverlayModule[]}[]}){
 const container=<T extends {modules:OverlayModule[]}>(profile:T)=>({...profile,modules:profile.modules.map(moduleEnvelopeData)});
 return new TextEncoder().encode(JSON.stringify({...document,version:4,profiles:document.profiles.map(container),presets:document.presets.map(container)})).length;
}

export interface ConfigurationDefinition {readonly type:string;readonly schemaVersion:number;readonly schema:z.ZodType;readonly builtinType?:string}
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
  this.entries.set(definition.type,Object.freeze({...definition}));this.notify();let active=true;return ()=>{if(active){active=false;this.entries.delete(definition.type);this.disabled.delete(definition.type);this.notify();}};
 }
 all(){return Object.freeze([...this.entries.values()]);}
 get(type:string){return this.entries.get(type);}
 available(extension:Pick<ModuleExtension,'type'|'schemaVersion'|'enabled'>){const definition=this.get(extension.type);return extension.enabled&&!this.disabled.has(extension.type)&&definition?.schemaVersion===extension.schemaVersion;}
 setEnabled(type:string,enabled:boolean){if(!this.entries.has(type))throw Error('Unknown module configuration definition.');const previous=this.disabled.has(type);if(enabled)this.disabled.delete(type);else this.disabled.add(type);if(previous!==this.disabled.has(type))this.notify();}
 validate(extension:ModuleExtension,structure=true){if(structure)moduleExtensionSchema.parse(extension);const definition=this.get(extension.type);if(definition?.schemaVersion===extension.schemaVersion&&!definition.schema.safeParse(extension.config).success)throw Error(`Invalid configuration for ${extension.type}.`);}
}

export function moduleReferences(module:OverlayModule){
 return {assets:[...new Set([module.image.assetId,...module.extension?.resources.assets??[]].filter(Boolean))],shapes:[...new Set([module.mouseBodyShapeId,module.appearance.shapeId,...module.keys.map(key=>key.style?.shapeId),...Object.values(module.buttonStyles).map(style=>style.shapeId),...module.extension?.resources.shapes??[]].filter((id):id is string=>!!id))]};
}
