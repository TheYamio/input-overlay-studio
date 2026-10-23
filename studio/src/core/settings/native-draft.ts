import { externalDefinition, settingPlatform } from '../architecture/external';
import type { DefinitionId } from '../architecture/contracts';
import { immutable, SettingsError, SettingsEvents } from './events';
import type { NativeConfig, NativeSettings } from './native';

// An explicit-apply session, independent of document Undo and OBS input frames.
// Edits made while a save is in flight stay in the draft. Backend failures never
// clear the draft or announce success; unavailable/unknown fields survive copies.
export class NativeSettingsDraft {
 private state:Readonly<NativeConfig>|null=null;
 private listeners=new Set<()=>void>();
 private disposed=false;
 private notifications=new SettingsEvents();
 constructor(private readonly native:NativeSettings,readonly platform=settingPlatform()){}
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private active(){if(this.disposed)throw new SettingsError('disposed','Capture draft has been disposed.');}
 replace(config:NativeConfig){this.active();this.notifications.assertWritable();this.state=immutable(structuredClone(config));this.notifications.notify(this.listeners);}
 private definition(id:DefinitionId){const definition=externalDefinition(id,'native');if(definition.binding.scope!=='capture')throw Error('System settings require the system adapter.');return definition;}
 read(id:DefinitionId){const definition=this.definition(id);return this.state?.[definition.binding.path[0] as keyof NativeConfig];}
 set(id:DefinitionId,value:unknown){
  const definition=this.definition(id);
  if(!this.state || definition.platforms&&!definition.platforms.includes(this.platform))return false;
  const parsed=definition.schema.safeParse(value);if(!parsed.success)return false;
  this.replace({...this.state,[definition.binding.path[0]]:parsed.data});return true;
 }
 reset(id:DefinitionId){return this.set(id,externalDefinition(id,'native').defaultValue({}));}
 async apply(){this.active();if(!this.state)throw Error('Capture settings are unavailable.');return this.native.save(structuredClone(this.state));}
 dispose(){this.disposed=true;this.listeners.clear();}
}
