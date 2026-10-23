import type { Catalog,DefinitionId,ModuleDefinition } from '../../core/architecture/contracts';
import type { VisualFactory } from './contracts';

export interface VisualRegistration { readonly definition:ModuleDefinition;readonly factory:VisualFactory }
// Compiled implementations only. Data and locale packages cannot register code.
export class VisualRuntimeRegistry {
 private entries=new Map<DefinitionId,VisualRegistration>();
 private types=new Map<string,DefinitionId>();
 private disabled=new Set<DefinitionId>();private listeners=new Set<()=>void>();private revision=0;
 constructor(readonly catalog:Catalog){}
 getSnapshot=()=>this.revision;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private notify(){this.revision++;for(const listener of [...this.listeners]){try{listener();}catch{/* Isolate scenes. */}}}
 register(id:DefinitionId,factory:VisualFactory){
  const definition=this.catalog.modules.get(id);
  if(!definition||definition.kind!=='visual'||typeof factory.create!=='function')throw Error(`Invalid visual implementation: ${id}`);
  if(this.entries.has(id))throw Error(`Visual implementation already registered: ${id}`);
  this.entries.set(id,Object.freeze({definition,factory:Object.freeze({...factory})}));if(definition.builtinType)this.types.set(definition.builtinType,id);this.notify();let active=true;
  return ()=>{if(!active)return;active=false;this.entries.delete(id);if(definition.builtinType)this.types.delete(definition.builtinType);this.disabled.delete(id);this.notify();};
 }
 all(){return Object.freeze([...this.entries.values()]);}
 resolve(type:string){const id=this.types.get(type)??(this.entries.has(type as DefinitionId)?type as DefinitionId:undefined);return id&&!this.disabled.has(id)?this.entries.get(id):undefined;}
 setEnabled(id:DefinitionId,enabled:boolean){if(!this.entries.has(id))throw Error(`Unknown visual implementation: ${id}`);const before=this.disabled.has(id);if(enabled)this.disabled.delete(id);else this.disabled.add(id);if(before!==this.disabled.has(id))this.notify();}
}
