import type {Catalog,DefinitionId,ModuleDefinition,SettingDefinition} from './contracts';
import {createCatalog} from './registry';
import {ModuleConfigurationRegistry,type ConfigurationDefinition} from '../module-envelope';
import {moduleConfigurations} from '../module-format';
import {ModuleUIRegistry,type ModuleUI} from './module-ui';
import {VisualRuntimeRegistry} from '../../renderer/modules/registry';
import type {VisualFactory} from '../../renderer/modules/contracts';

export interface CompiledModuleManifest {
 readonly definition:ModuleDefinition;
 readonly settings:readonly SettingDefinition[];
 readonly configuration?:ConfigurationDefinition;
 readonly ui?:ModuleUI;
 readonly runtime?:VisualFactory;
 // An installed compiled adapter, not just a capability name in metadata.
 readonly service?:Readonly<object>;
 readonly available?:()=>boolean;
}
export interface ModuleEnvironment {
 readonly catalog:Catalog;readonly configurations:ModuleConfigurationRegistry;
 readonly ui:ModuleUIRegistry;readonly runtime:VisualRuntimeRegistry;
 readonly manifests:readonly CompiledModuleManifest[];
 available(id:DefinitionId):boolean;
 setEnabled(id:DefinitionId,enabled:boolean):void;
}
export class CompiledModuleHost {
 private environment?:ModuleEnvironment;private entries:readonly CompiledModuleManifest[]=[];private listeners=new Set<()=>void>();private disabled=new Set<DefinitionId>();
 constructor(readonly target:'studio'|'obs'){}
 getSnapshot=()=>this.environment;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 install(...additions:readonly CompiledModuleManifest[]):ModuleEnvironment {
  const manifests=[...this.entries,...additions],ids=new Set<DefinitionId>(),settings=new Map<DefinitionId,SettingDefinition>();
  for(const manifest of manifests){
   const {definition,configuration}=manifest;if(ids.has(definition.id))throw Error(`Duplicate module manifest: ${definition.id}`);ids.add(definition.id);
   for(const setting of manifest.settings){const previous=settings.get(setting.id);if(previous&&previous!==setting){const metadata=({schema:_,defaultValue:__,...rest}:SettingDefinition)=>JSON.stringify(rest);if(previous.schema!==setting.schema||previous.defaultValue!==setting.defaultValue||metadata(previous)!==metadata(setting))throw Error(`Conflicting manifest setting: ${setting.id}`);}settings.set(setting.id,setting);}
   if(definition.kind==='service'){if(!manifest.service||configuration||manifest.runtime||manifest.ui)throw Error(`Missing or invalid service adapter: ${definition.id}`);}
   else if(!configuration||configuration.type!==definition.id||configuration.schemaVersion!==definition.schemaVersion||configuration.builtinType!==definition.builtinType||!manifest.runtime||this.target==='studio'&&!manifest.ui)throw Error(`Incomplete module manifest: ${definition.id}`);
  }
  // Build every candidate registry off to the side. No active observer sees it
  // until metadata, schemas, migration chains, UI and renderers all validate.
  const catalog=createCatalog(manifests.map(manifest=>manifest.definition),[...settings.values()]);
  const configurations=new ModuleConfigurationRegistry();for(const manifest of manifests)if(manifest.configuration)configurations.register(manifest.configuration);
  const staged=manifests.map(manifest=>Object.freeze({...manifest,definition:catalog.modules.get(manifest.definition.id)!,settings:Object.freeze(manifest.settings.map(setting=>catalog.settings.get(setting.id)!)),configuration:configurations.get(manifest.definition.id),...(manifest.ui?{ui:Object.freeze({...manifest.ui,sections:Object.freeze(manifest.ui.sections.map(panel=>Object.freeze({...panel})))})}:{}),...(manifest.runtime?{runtime:Object.freeze({...manifest.runtime})}:{})}));
  const disabled=new Set([...this.disabled].filter(id=>ids.has(id))),byId=new Map(staged.map(manifest=>[manifest.definition.id,manifest]));
  const available=(id:DefinitionId,visiting=new Set<DefinitionId>()):boolean=>{
   const manifest=byId.get(id);if(!manifest||disabled.has(id)||visiting.has(id))return false;
   try{if(manifest.available&&!manifest.available())return false;}catch{return false;}
   const path=new Set(visiting).add(id),definition=manifest.definition;
   if(definition.kind==='visual'&&!configurations.available({type:id,schemaVersion:definition.schemaVersion,enabled:true}))return false;
   return definition.dependencies.every(dependency=>available(dependency,path))&&definition.requires.every(capability=>definition.capabilities.includes(capability)||staged.some(provider=>provider.definition.capabilities.includes(capability)&&available(provider.definition.id,path)));
  };
  const runtime=new VisualRuntimeRegistry(catalog,id=>available(id),configurations),ui=new ModuleUIRegistry(catalog,id=>available(id),configurations,runtime);
  for(const manifest of staged){
   if(manifest.ui)ui.register(manifest.definition.id,manifest.ui);
   if(manifest.runtime){
    const factory=manifest.runtime,definition=manifest.configuration!;
    const checked=moduleConfigurations.get(definition.type)?.schema===definition.schema?factory:{...factory,create:(context:Parameters<VisualFactory['create']>[0])=>{
     const instance=factory.create(context);
     return {update:(state:Parameters<typeof instance.update>[0])=>{if(!state.module.extension)throw Error('Missing module configuration.');configurations.validate(state.module.extension);instance.update(state);},dispose:()=>instance.dispose(),...(instance.frame?{frame:instance.frame.bind(instance)}:{}),...(instance.input?{input:instance.input.bind(instance)}:{}),...(instance.resize?{resize:instance.resize.bind(instance)}:{}),...(instance.preview?{preview:instance.preview.bind(instance)}:{})};
    }};
    runtime.register(manifest.definition.id,checked);
   }
  }
  const environment:ModuleEnvironment=Object.freeze({catalog,configurations,ui,runtime,manifests:Object.freeze(staged),available:(id:DefinitionId)=>available(id),setEnabled:(id:DefinitionId,enabled:boolean)=>{if(!byId.has(id))throw Error(`Unknown module manifest: ${id}`);const before=disabled.has(id);if(enabled)disabled.delete(id);else disabled.add(id);if(before!==disabled.has(id)){ui.refresh();runtime.refresh();}}});
  this.entries=environment.manifests;this.environment=environment;this.disabled=disabled;for(const listener of [...this.listeners]){try{listener();}catch{/* A listener cannot roll back a completed installation. */}}
  return environment;
 }
}
