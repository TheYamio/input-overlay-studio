import { moduleKind } from '../module-envelope';
import type { Catalog, DefinitionId, SettingDefinition, SettingsAddress } from '../architecture/contracts';
import { conditionsMatch, settingConstraints } from '../architecture/registry';
import type { SettingsService } from '../settings/service';
import { immutable } from '../settings/events';

const constraintsCache=new WeakMap<SettingDefinition,ReturnType<typeof settingConstraints>>();
export interface SettingsFieldAdapter {
  read:(settings:SettingsService,definition:SettingDefinition,address:SettingsAddress)=>unknown;
  write?:(settings:SettingsService,definition:SettingDefinition,address:SettingsAddress,value:unknown)=>boolean;
  reset?:(settings:SettingsService,definition:SettingDefinition,address:SettingsAddress)=>boolean;
  unavailable?:(definition:SettingDefinition)=>string | undefined;
  constraints?:(settings:SettingsService,definition:SettingDefinition,address:SettingsAddress)=>{minimum?:number;maximum?:number};
}
export function controlConstraints(definition:SettingDefinition) {
  let result=constraintsCache.get(definition);
  if(!result){result=immutable(settingConstraints(definition));constraintsCache.set(definition,result);}
  return result;
}
export function optionTranslationKey(id:DefinitionId,value:string) {
  return `settings:${id}.option.${Array.from(value,char=>char.codePointAt(0)!.toString(16)).join('-')}`;
}
export function groupSettings(catalog:Catalog,settings:SettingsService,group:DefinitionId,address:SettingsAddress) {
  const module=address.scope==='module' ? settings.document.profiles.find(profile=>profile.id===address.profileId)?.modules.find(module=>module.id===address.moduleId) : undefined;
  const owned=module ? catalog.modules.all().find(definition=>definition.id===moduleKind(module)||definition.builtinType===moduleKind(module))?.settings : undefined;
  return catalog.settings.all().filter(definition=>definition.ui.group===group && definition.binding.scope===address.scope && definition.binding.store==='document'
    && (address.scope!=='module' || owned?.includes(definition.id) && (!address.element || !!definition.binding.overrides)));
}

export function fieldModel(catalog: Catalog, settings: SettingsService, id: DefinitionId, address: SettingsAddress, capabilities: ReadonlySet<DefinitionId>, adapter?:SettingsFieldAdapter) {
  const definition=catalog.settings.get(id);
  if (!definition) throw Error(`Unknown setting: ${id}`);
  const values=new Map<DefinitionId,unknown>();
  for (const condition of [...definition.visibleWhen??[],...definition.enabledWhen??[]]) if ('setting' in condition) {
    const source=catalog.settings.get(condition.setting)!;
    const target=address.scope==='module' && address.element && !source.binding.overrides ? {scope:'module' as const,profileId:address.profileId,moduleId:address.moduleId} : address;
    values.set(condition.setting,adapter ? adapter.read(settings,source,target) : settings.read(condition.setting,target));
  }
  return {definition,constraints:{...controlConstraints(definition),...adapter?.constraints?.(settings,definition,address)},value:adapter ? adapter.read(settings,definition,address) : settings.read(id,address),
    visible:conditionsMatch(definition.visibleWhen??[],values,capabilities),
    enabled:definition.targets.includes('studio') && conditionsMatch(definition.enabledWhen??[],values,capabilities)};
}

// Defaults remain absent until an explicit edit. This only observes ownership;
// reset always goes through SettingsService using the same ID/address as the edit.
export function isInherited(settings: SettingsService, catalog: Catalog, id: DefinitionId, address: SettingsAddress) {
  if (address.scope!=='module' || !address.element) return false;
  const binding=catalog.settings.get(id)?.binding.overrides;
  if (!binding) return false;
  const module=settings.document.profiles.find(profile=>profile.id===address.profileId)?.modules.find(module=>module.id===address.moduleId);
  let value:unknown=address.element.kind==='key' ? module?.keys.find(key=>key.id===(address.element as {keyId:string}).keyId) : module?.buttonStyles[address.element.button];
  for (const part of address.element.kind==='key' ? binding.key : binding.mouseButton) value=value && typeof value==='object' ? (value as Record<string,unknown>)[part] : undefined;
  return value===undefined;
}
