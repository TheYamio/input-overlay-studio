import type { ComponentType } from 'react';
import type { DefinitionId } from './core/architecture/contracts';
import type { SpecializedSettingProps } from './settings-renderer';
// Trusted, compiled components only. Localization/config packages cannot register code.
export class SettingsComponentRegistry<Props=SpecializedSettingProps> {
  private components=new Map<DefinitionId,ComponentType<Props>>();
  private listeners=new Set<()=>void>();
  private revision=0;
  getSnapshot=()=>this.revision;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private notify(){this.revision++;for(const listener of [...this.listeners]){try{listener();}catch{/* Isolate observers. */}}}
  get(id:DefinitionId){return this.components.get(id);}
  register(id:DefinitionId,component:ComponentType<Props>){
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id) || typeof component!=='function') throw Error('Invalid specialized editor');
    if(this.components.has(id))throw Error(`Specialized editor already registered: ${id}`);
    this.components.set(id,component);this.notify();let active=true;
    return ()=>{if(!active)return;active=false;this.components.delete(id);this.notify();};
  }
}
