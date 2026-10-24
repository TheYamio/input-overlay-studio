import {localePackagesSchema} from '../localization/pack-schema';
import type {LocalePack} from '../localization/registry';
import { localeId } from '../localization/registry';
import type { ConnectionOptions } from '../connection';
import { defaultShortcuts, parseShortcuts, shortcutStorageKey, type ShortcutMap } from '../shortcuts';
import { immutable, SettingsError, SettingsEvents } from './events';
import { externalDefinition } from '../architecture/external';
import type { DefinitionId } from '../architecture/contracts';
import {z} from 'zod';
import {packageIdPattern,parseLocalePack,validateTranslation} from '../localization/registry';
import {studioLocalization} from '../localization/builtins';

export interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string,value: string): void }
export interface Preferences {
  locale: string;
  localePackageId: string|null;
  languagePacks: LocalePack[];
  inspectorWidth: number;
  inspectorSection: string;
  shortcuts: ShortcutMap;
  connection: ConnectionOptions;
}
const keys = {languagePacks:'studio.language-packs',locale:'studio.locale',inspectorWidth:'studio.inspector-width',inspectorSection:'studio.inspector-section',shortcuts:shortcutStorageKey,connection:'studio.connection'} as const;
export const languageStorageKey='studio.localization';
const languageStateSchema=z.strictObject({version:z.literal(1),locale:z.string().max(64),packageId:z.string().regex(packageIdPattern).nullable(),packs:localePackagesSchema});
type LanguageState={locale:string;packageId:string|null;packs:LocalePack[]};
export function storedStudioLocale(storage:Pick<PreferenceStorage,'getItem'>){
 try{const raw=storage.getItem(languageStorageKey);if(raw){const parsed=languageStateSchema.parse(JSON.parse(raw));return localeId(parsed.locale);}return localeId(storage.getItem(keys.locale)||'en');}catch{return 'en';}
}
export class PreferenceSettings {
  private state: Preferences;
  private listeners = new Set<() => void>();
  private disposed=false;
  private protectedLanguages=false;
  constructor(private readonly storage: PreferenceStorage, private readonly events: SettingsEvents) {
    const get = (key: string) => { try { return storage.getItem(key); } catch { return null; } };
    const width = Number(get(keys.inspectorWidth));
    let connection: ConnectionOptions = {url:'ws://127.0.0.1:4455',token:''};
    try { const value = JSON.parse(get(keys.connection) || '{}'); connection={url:typeof value.url==='string' ? value.url : connection.url,token:typeof value.token==='string' ? value.token : ''}; } catch { /* Keep the existing fallback. */ }
    let locale='en'; try { locale=localeId(get(keys.locale)||'en'); } catch { /* Invalid preferences use English. */ }
    let languagePacks:LocalePack[]=[],localePackageId:string|null=null;
    const raw=get(languageStorageKey);
    if(raw){try{const saved=languageStateSchema.parse(JSON.parse(raw));locale=localeId(saved.locale);languagePacks=saved.packs;localePackageId=saved.packageId;if(localePackageId&&!languagePacks.some(p=>p.id===localePackageId&&p.locale.toLowerCase()===locale))throw Error('Missing language package');}catch{this.protectedLanguages=true;locale='en';languagePacks=[];localePackageId=null;}}
    else{try{languagePacks=localePackagesSchema.parse(JSON.parse(get(keys.languagePacks)||'[]'));}catch{/* Keep the original data for recovery. */}}
    languagePacks=languagePacks.map(input=>({...parseLocalePack(input),id:input.id??crypto.randomUUID(),origin:'custom' as const}));
    if(!raw&&languagePacks.length){
      localePackageId=languagePacks.find(p=>p.locale===locale)?.id??null;
      // Back up current installed packages before moving them to one atomic record.
      try{storage.setItem('studio.localization.backup',JSON.stringify({locale:get(keys.locale),packs:get(keys.languagePacks)}));storage.setItem(languageStorageKey,JSON.stringify({version:1,locale,packageId:localePackageId,packs:languagePacks}));}catch{/* Old records remain intact and are retried on the next write. */}
    }
    this.state=immutable({locale,localePackageId,languagePacks,inspectorWidth:width>=320 && width<=560 ? width : 360,inspectorSection:get(keys.inspectorSection)||'appearance',shortcuts:parseShortcuts(get(keys.shortcuts)),connection});
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
    if(key==='locale'||key==='languagePacks'||key==='localePackageId'){
      const packs=key==='languagePacks'?localePackagesSchema.parse(value).map(p=>({...parseLocalePack(p),id:p.id??crypto.randomUUID(),origin:'custom' as const})):this.state.languagePacks;
      const locale=key==='locale'?localeId(value as string):this.state.locale;
      const packageId=key==='locale'?null:key==='localePackageId'?value as string|null:this.state.localePackageId;
      if(key==='localePackageId'&&packageId&&!packs.some(p=>p.id===packageId))return false;
      return this.changeLanguage({locale,packageId:packageId&&packs.some(p=>p.id===packageId)?packageId:null,packs});
    }
    if (key==='inspectorWidth' && (typeof value!=='number'||!Number.isFinite(value)||value<320||value>560)) throw new SettingsError('invalid-preference','Inspector width is out of range.');
    if (key==='inspectorSection' && !externalDefinition('studio.preferences.inspector-section','preferences').schema.safeParse(value).success) throw new SettingsError('invalid-preference','Unknown inspector section.');
    if (key==='connection' && (!value || typeof (value as ConnectionOptions).url!=='string'||typeof (value as ConnectionOptions).token!=='string')) throw new SettingsError('invalid-preference','Invalid connection preferences.');
    if (key==='shortcuts') {
      const parsed=parseShortcuts(JSON.stringify(value)), raw=value as ShortcutMap;
      if (!raw || Object.keys(raw).length!==Object.keys(parsed).length || Object.entries(parsed).some(([command,bindings])=>JSON.stringify(raw[command as keyof ShortcutMap])!==JSON.stringify(bindings))) throw new SettingsError('invalid-preference','Invalid or conflicting command bindings.');
    }
    const copy=structuredClone(value), same=JSON.stringify(copy)===JSON.stringify(this.state[key]);
    // Even an unchanged preference can be retried after a quota/permission failure.
    try { this.storage.setItem(keys[key as keyof typeof keys],key==='inspectorWidth'||key==='inspectorSection' ? String(copy) : JSON.stringify(copy)); } catch { return false; }
    if (!same) {
      this.state=immutable({...this.state,[key]:copy}); this.events.notify(this.listeners);
      this.events.emit({operationId:this.events.operation(),scopes:['global'],store:'preferences',source:`preferences.${key}`});
    }
    return true;
  }
  changeLanguage(value:LanguageState):boolean {
    this.events.assertWritable();if(this.disposed)throw new SettingsError('disposed','Preferences have been disposed.');if(this.protectedLanguages)return false;
    const parsed=languageStateSchema.safeParse({version:1,...value});if(!parsed.success)return false;
    const next=parsed.data,locale=localeId(next.locale);
    try{const reference=studioLocalization.exportPack('en');for(const pack of next.packs)validateTranslation(pack,reference);}catch{return false;}
    if(next.packs.some(p=>!p.id||p.origin!=='custom')||(next.packageId&&!next.packs.some(p=>p.id===next.packageId&&p.locale.toLowerCase()===locale)))return false;
    const patch={locale,localePackageId:next.packageId,languagePacks:structuredClone(next.packs)};
    try{this.storage.setItem(languageStorageKey,JSON.stringify({...next,locale}));}catch{return false;}
    if(JSON.stringify([this.state.locale,this.state.localePackageId,this.state.languagePacks])!==JSON.stringify([patch.locale,patch.localePackageId,patch.languagePacks])){
      this.state=immutable({...this.state,...patch});this.events.notify(this.listeners);this.events.emit({operationId:this.events.operation(),scopes:['global'],store:'preferences',source:'preferences.localization'});
    }
    return true;
  }
  reset(key: keyof Preferences) {
    const defaults: Preferences={locale:'en',localePackageId:null,languagePacks:[],inspectorWidth:360,inspectorSection:'appearance',shortcuts:defaultShortcuts(),connection:{url:'ws://127.0.0.1:4455',token:''}};
    return this.write(key,defaults[key]);
  }
  dispose() { this.disposed=true;this.listeners.clear(); }
}
