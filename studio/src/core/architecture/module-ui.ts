import { moduleKind } from '../module-envelope';
import type { ComponentProps,ComponentType } from 'react';
import type { Catalog,DefinitionId,ModuleDefinition } from './contracts';
import type { OverlayModule } from '../config';
import type { ModuleEditorProps } from '../../module-editor-contracts';
import type { KeyCanvas } from '../../key-canvas';
import { externalDefinition } from './external';

export interface ModulePanel {readonly id:string;readonly label:string;readonly component:ComponentType<ModuleEditorProps>;readonly placement?:'before-common';readonly order?:number}
export interface ModuleUI {
 readonly icon:ComponentType<{size?:number}>;readonly create:(index:number)=>OverlayModule;
 readonly sections:readonly ModulePanel[];readonly selection?:'keys'|'buttons';
 readonly canvasEditor?:ComponentType<ComponentProps<typeof KeyCanvas>>;
 readonly preview?:boolean;readonly lineColor?:boolean;readonly preferred?:boolean;
}
export type ModuleUIRegistration=ModuleUI&{readonly definition:ModuleDefinition};
export class ModuleUIRegistry {
 private entries=new Map<DefinitionId,ModuleUIRegistration>();private types=new Map<string,DefinitionId>();private revision=0;private listeners=new Set<()=>void>();
 constructor(readonly catalog:Catalog){}
 getSnapshot=()=>this.revision;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private notify(){this.revision++;for(const listener of [...this.listeners]){try{listener();}catch{/* Isolate editors. */}}}
 register(id:DefinitionId,ui:ModuleUI){
  const definition=this.catalog.modules.get(id);
  if(!definition||definition.kind!=='visual'||typeof ui.create!=='function'||!ui.icon)throw Error(`Invalid module UI: ${id}`);
  if(this.entries.has(id))throw Error(`Module UI already registered: ${id}`);
  const panelIds=new Set<string>();
  for(const panel of ui.sections){if(!externalDefinition('studio.preferences.inspector-section','preferences').schema.safeParse(panel.id).success||['appearance','layout','all'].includes(panel.id)||panelIds.has(panel.id)||!panel.label.trim()||typeof panel.component!=='function'||panel.placement!==undefined&&panel.placement!=='before-common'||panel.order!==undefined&&!Number.isFinite(panel.order))throw Error(`Invalid module panel: ${panel.id}`);panelIds.add(panel.id);}
  this.entries.set(id,Object.freeze({...ui,definition,sections:Object.freeze(ui.sections.map(panel=>Object.freeze({...panel})))}));if(definition.builtinType)this.types.set(definition.builtinType,id);this.notify();let active=true;
  return ()=>{if(!active)return;active=false;this.entries.delete(id);if(definition.builtinType)this.types.delete(definition.builtinType);this.notify();};
 }
 resolve(type:string){const id=this.types.get(type)??(this.entries.has(type as DefinitionId)?type as DefinitionId:undefined);return id?this.entries.get(id):undefined;}
 all(){return Object.freeze(this.catalog.modules.all().flatMap(definition=>this.entries.get(definition.id)??[]));}
 create(id:DefinitionId,index=0){const registration=this.entries.get(id);if(!registration)throw Error(`Unknown module UI: ${id}`);const result=registration.create(index);if(moduleKind(result)!==registration.definition.builtinType&&moduleKind(result)!==registration.definition.id||result.extension&&result.extension.schemaVersion!==registration.definition.schemaVersion||!registration.definition.configuration?.safeParse(result.extension?result.extension.config:result).success)throw Error('Module factory returned an incompatible configuration.');return result;}
}
