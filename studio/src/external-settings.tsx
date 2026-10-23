import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { DefinitionId } from './core/architecture/contracts';
import { builtinCatalog } from './core/architecture/builtins';
import type { NativeSettingsDraft } from './core/settings/native-draft';
import type { SettingsService } from './core/settings/service';
import type { SettingsFieldAdapter } from './core/settings-ui/model';
import { SettingsField } from './settings-renderer';
import { nativeComponents } from './native-controls';

export const ExternalSettingsScope=createContext<{settings:SettingsService;draft:NativeSettingsDraft}|null>(null);
export function NativeSettingsProvider({settings,draft,children}:{settings:SettingsService;draft:NativeSettingsDraft;children:ReactNode}){
 const scope=useMemo(()=>({settings,draft}),[settings,draft]);
 return <ExternalSettingsScope.Provider value={scope}>{children}</ExternalSettingsScope.Provider>;
}
export function ExternalField({id,label}:{id:DefinitionId;label:string}){
 const {settings,draft}=useContext(ExternalSettingsScope)!;
 useSyncExternalStore(draft.subscribe,draft.getSnapshot);
 const adapter=useMemo<SettingsFieldAdapter>(()=>({
  read:(_settings,definition)=>draft.read(definition.id),
  write:(_settings,definition,_address,value)=>draft.set(definition.id,value),
  reset:(_settings,definition)=>draft.reset(definition.id),
  unavailable:definition=>definition.platforms&&!definition.platforms.includes(draft.platform)?`Available on ${definition.platforms.join(', ')}. The saved value is preserved.`:undefined,
 }),[draft]);
 const definition=builtinCatalog.settings.get(id)!;
 return <SettingsField id={id} settings={settings} address={{scope:definition.binding.scope as 'capture'|'global'}} adapter={adapter} specialized={nativeComponents} caption={{key:`settings:${id}.caption`,fallback:label}}/>;
}
