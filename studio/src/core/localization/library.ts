import {builtinLanguages} from './runtime';
import {parseLocalePack,validateTranslation,type LocalePack,type LocalizationRegistry} from './registry';
import {localePackagesSchema} from './pack-schema';
import type {PreferenceSettings} from '../settings/preferences';

// The only import/delete/select API used by the language UI. Built-ins never enter storage.
export class LanguageLibrary {
 constructor(private preferences:PreferenceSettings,private registry:LocalizationRegistry){}
 import(input:unknown){
  const parsed=parseLocalePack(input);validateTranslation(parsed,this.registry.exportPack('en'));
  const pack:LocalePack={...parsed,id:crypto.randomUUID(),origin:'custom',name:parsed.name??parsed.locale,translationVersion:parsed.translationVersion??'1.0'};
  const state=this.preferences.getSnapshot(),packs=localePackagesSchema.parse([...state.languagePacks,pack]);
  if(!this.preferences.changeLanguage({locale:state.locale,packageId:state.localePackageId,packs}))throw Error('language-storage');
  return pack;
 }
 select(id:string){
  const state=this.preferences.getSnapshot(),custom=state.languagePacks.find(p=>p.id===id),builtin=builtinLanguages.find(p=>p.locale===id);
  if(!custom&&!builtin)throw Error('language-missing');
  if(!this.preferences.changeLanguage({locale:(custom??builtin)!.locale,packageId:custom?.id??null,packs:state.languagePacks}))throw Error('language-storage');
 }
 remove(id:string){
  const state=this.preferences.getSnapshot(),pack=state.languagePacks.find(p=>p.id===id);
  if(!pack||pack.origin!=='custom')throw Error('language-protected');
  const active=state.localePackageId===id,locale=active?(builtinLanguages.some(p=>p.locale===pack.locale)?pack.locale:'en'):state.locale;
  if(!this.preferences.changeLanguage({locale,packageId:active?null:state.localePackageId,packs:state.languagePacks.filter(p=>p.id!==id)}))throw Error('language-storage');
 }
 export(id:string):LocalePack {
  const custom=this.preferences.getSnapshot().languagePacks.find(p=>p.id===id);
  if(custom){const {id:_,origin:__,...portable}=custom;return structuredClone(portable);}
  const builtin=builtinLanguages.find(p=>p.locale===id);if(!builtin)throw Error('language-missing');
  return {...this.registry.exportPack(builtin.locale),name:builtin.name,direction:builtin.direction,origin:'builtin',translationVersion:'1.0'};
 }
}
