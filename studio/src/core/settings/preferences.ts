import {localePackagesSchema} from '../localization/pack-schema';
import type {LocalePack} from '../localization/registry';
import { localeId } from '../localization/registry';
import type { ConnectionOptions } from '../connection';
import { defaultShortcuts, parseShortcuts, shortcutStorageKey, type ShortcutMap } from '../shortcuts';
import { immutable, SettingsError, SettingsEvents } from './events';
import { externalDefinition } from '../architecture/external';
import type { DefinitionId } from '../architecture/contracts';

export interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string,value: string): void }
export interface Preferences {
  locale: string;
  languagePacks: LocalePack[];
  inspectorWidth: number;
  inspectorSection: string;
  shortcuts: ShortcutMap;
  connection: ConnectionOptions;
}
const keys = {languagePacks:'studio.language-packs',locale:'studio.locale',inspectorWidth:'studio.inspector-width',inspectorSection:'studio.inspector-section',shortcuts:shortcutStorageKey,connection:'studio.connection'} as const;
export class PreferenceSettings {
  private state: Preferences;
  private listeners = new Set<() => void>();
  private disposed=false;
  constructor(private readonly storage: PreferenceStorage, private readonly events: SettingsEvents) {
    const get = (key: string) => { try { return storage.getItem(key); } catch { return null; } };
    const width = Number(get(keys.inspectorWidth));
    let connection: ConnectionOptions = {url:'ws://127.0.0.1:4455',token:''};
    try { const value = JSON.parse(get(keys.connection) || '{}'); connection={url:typeof value.url==='string' ? value.url : connection.url,token:typeof value.token==='string' ? value.token : ''}; } catch { /* Keep the existing fallback. */ }
    let locale='en'; try { locale=localeId(get(keys.locale)||'en'); } catch { /* Invalid preferences use English. */ }
    let languagePacks:LocalePack[]=[];try{languagePacks=localePackagesSchema.parse(JSON.parse(get(keys.languagePacks)||'[]'));}catch{/* Preserve corrupt storage until explicit import. */}
    this.state=immutable({locale,languagePacks,inspectorWidth:width>=320 && width<=560 ? width : 360,inspectorSection:get(keys.inspectorSection)||'appearance',shortcuts:parseShortcuts(get(keys.shortcuts)),connection});
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; };
  read(id:DefinitionId) { const definition=externalDefinition(id,'preferences');return this.state[definition.binding.path[0] as keyof Preferences]; }
  set(id:DefinitionId,value:unknown) {
    const definition=externalDefinition(id,'preferences'), parsed=definition.schema.safeParse(value);
    if(!parsed.success)return false;
    return this.write(definition.binding.path[0] as keyof Preferences,parsed.data as Preferences[keyof Preferences]);
  }
  write<K extends keyof Preferences>(key: K, value: Preferences[K]): boolean {
    this.events.assertWritable();
    if(this.disposed)throw new SettingsError('disposed','Preferences have been disposed.');
    if(key==='languagePacks')localePackagesSchema.parse(value);
    if (key==='locale') localeId(value as string);
    if (key==='inspectorWidth' && (typeof value!=='number'||!Number.isFinite(value)||value<320||value>560)) throw new SettingsError('invalid-preference','Inspector width is out of range.');
    if (key==='inspectorSection' && !externalDefinition('studio.preferences.inspector-section','preferences').schema.safeParse(value).success) throw new SettingsError('invalid-preference','Unknown inspector section.');
    if (key==='connection' && (!value || typeof (value as ConnectionOptions).url!=='string'||typeof (value as ConnectionOptions).token!=='string')) throw new SettingsError('invalid-preference','Invalid connection preferences.');
    if (key==='shortcuts') {
      const parsed=parseShortcuts(JSON.stringify(value)), raw=value as ShortcutMap;
      if (!raw || Object.keys(raw).length!==Object.keys(parsed).length || Object.entries(parsed).some(([command,bindings])=>JSON.stringify(raw[command as keyof ShortcutMap])!==JSON.stringify(bindings))) throw new SettingsError('invalid-preference','Invalid or conflicting command bindings.');
    }
    const copy=structuredClone(value), same=JSON.stringify(copy)===JSON.stringify(this.state[key]);
    // Even an unchanged preference can be retried after a quota/permission failure.
    let saved=true;
    try { this.storage.setItem(keys[key],key==='locale'||key==='inspectorWidth'||key==='inspectorSection' ? String(copy) : JSON.stringify(copy)); } catch { saved=false; }
    if (!same) {
      this.state=immutable({...this.state,[key]:copy}); this.events.notify(this.listeners);
      this.events.emit({operationId:this.events.operation(),scopes:['global'],store:'preferences',source:`preferences.${key}`});
    }
    return saved;
  }
  reset(key: keyof Preferences) {
    const defaults: Preferences={locale:'en',languagePacks:[],inspectorWidth:360,inspectorSection:'appearance',shortcuts:defaultShortcuts(),connection:{url:'ws://127.0.0.1:4455',token:''}};
    return this.write(key,defaults[key]);
  }
  dispose() { this.disposed=true;this.listeners.clear(); }
}
