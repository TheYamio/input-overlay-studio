import {describe,it,expect,vi} from 'vitest';
import {LanguageLibrary} from './library';
import {createStudioLocalization} from './builtins';
import {PreferenceSettings,languageStorageKey,storedStudioLocale} from '../settings/preferences';
import {SettingsEvents} from '../settings/events';
import {localePackagesSchema} from './pack-schema';
import {overlayText} from './runtime';
import {initialDocument,encodeDocument,parseDocument} from '../config';
import {isolateDocumentLanguages} from './document';

const input={version:1,locale:'ru',name:'Русский',author:'Author',translationVersion:'2.1',namespaces:{language:{title:'Custom title'},overlay:{sensitivity:'My SENS'}}};
function fixture(data=new Map<string,string>()){
 const events=new SettingsEvents(),storage={getItem:(key:string)=>data.get(key)??null,setItem:vi.fn((key:string,value:string)=>{data.set(key,value);})},preferences=new PreferenceSettings(storage,events),registry=createStudioLocalization(),library=new LanguageLibrary(preferences,registry);
 const apply=()=>{registry.setCustomPacks(preferences.getSnapshot().languagePacks);registry.selectPackage(preferences.getSnapshot().localePackageId,preferences.getSnapshot().locale);};
 return {data,events,storage,preferences,registry,library,apply};
}
describe('independent custom translations',()=>{
 it('creates a new UUID for every import, including identical names, locales and imported IDs',()=>{
  const f=fixture(),a=f.library.import(input),b=f.library.import({...input,id:a.id,origin:'builtin'});expect(a.id).not.toBe(b.id);expect(a.origin).toBe('custom');expect(b.origin).toBe('custom');expect(f.preferences.getSnapshot().languagePacks).toHaveLength(2);expect(localePackagesSchema.safeParse([a,{...b,id:a.id}]).success).toBe(false);
 });
 it('selects exactly one package and restores built-in Russian without leaked strings',()=>{
  const f=fixture(),a=f.library.import(input),b=f.library.import({...input,namespaces:{language:{title:'Second title'}}});
  f.library.select(a.id!);f.apply();expect(f.registry.text('language:title')).toBe('Custom title');expect(f.registry.text('language:studio')).toBe('Язык Studio');
  f.library.select(b.id!);f.apply();expect(f.registry.text('language:title')).toBe('Second title');
  f.library.select('ru');f.apply();expect(f.registry.text('language:title')).toBe('Языки и текст');expect(f.registry.textFor('ru','language:title')).toBe('Языки и текст');
  expect(()=>f.registry.register(a,{override:true})).toThrow('isolated');
 });
 it('protects built-ins from deletion and from being stored as library entries',()=>{
  const f=fixture();expect(()=>f.library.remove('ru')).toThrow('protected');expect(f.preferences.set('studio.preferences.language-packs',[{...input,origin:'builtin'}])).toBe(false);expect(f.storage.setItem).not.toHaveBeenCalled();
 });
 it('deletes only the requested UUID, falling back to its built-in locale',()=>{
  const f=fixture(),a=f.library.import(input),b=f.library.import(input);f.library.select(a.id!);f.library.remove(a.id!);expect(f.preferences.getSnapshot()).toMatchObject({locale:'ru',localePackageId:null,languagePacks:[b]});
 });
 it('keeps the active peer when deleting an inactive same-name package',()=>{
  const f=fixture(),a=f.library.import(input),b=f.library.import(input);f.library.select(b.id!);f.library.remove(a.id!);expect(f.preferences.getSnapshot().localePackageId).toBe(b.id);
 });
 it('falls back to English after deleting a package without a built-in language',()=>{
  const f=fixture(),a=f.library.import({...input,locale:'zz'});f.library.select(a.id!);f.library.remove(a.id!);expect(f.preferences.getSnapshot()).toMatchObject({locale:'en',localePackageId:null});
 });
 it('roundtrips metadata and text, exports only translation data and assigns a new ID on reimport',()=>{
  const f=fixture(),a=f.library.import(input),exported=f.library.export(a.id!);expect(exported).toEqual(input);expect(exported).not.toHaveProperty('id');expect(f.library.import(exported).id).not.toBe(a.id);expect(f.library.export('ru')).toMatchObject({locale:'ru',name:'Русский',origin:'builtin'});expect(JSON.stringify(exported)).not.toContain('studio.connection');
 });
 it.each(['{{wrong}}','No parameter','{{label','{{ label }}'])('rejects incorrect known placeholders before mutating memory or storage: %s',value=>{
  const f=fixture(),before=f.preferences.getSnapshot();expect(()=>f.library.import({...input,namespaces:{controls:{'range.value':value}}})).toThrow('placeholders');expect(f.preferences.getSnapshot()).toBe(before);expect(f.storage.setItem).not.toHaveBeenCalled();
 });
 it('allows reordered and repeated matching parameters and preserves unknown module namespaces',()=>{
  const f=fixture();expect(()=>f.library.import({...input,namespaces:{controls:{'range.value':'{{label}}: {{label}}'},'new-module':{future:'{{later}}'}}})).not.toThrow();
 });
 it('validates direct service writes as well as UI imports',()=>{
  const f=fixture();expect(f.preferences.changeLanguage({locale:'ru',packageId:null,packs:[{...input,version:1,id:crypto.randomUUID(),origin:'custom',namespaces:{controls:{'range.value':'{{wrong}}'}}}]})).toBe(false);expect(f.storage.setItem).not.toHaveBeenCalled();
 });
 it('leaves memory, disk and notifications unchanged when importing fails to save',()=>{
  const f=fixture(),before=f.preferences.getSnapshot(),notify=vi.fn();f.events.subscribe('global',notify);f.storage.setItem.mockImplementationOnce(()=>{throw Error('quota');});expect(()=>f.library.import(input)).toThrow('storage');expect(f.preferences.getSnapshot()).toBe(before);expect(f.data.has(languageStorageKey)).toBe(false);expect(notify).not.toHaveBeenCalled();
 });
 it('atomically rolls back selected-package deletion on a write failure',()=>{
  const f=fixture(),a=f.library.import(input);f.library.select(a.id!);const before=f.preferences.getSnapshot(),stored=f.data.get(languageStorageKey);f.storage.setItem.mockImplementationOnce(()=>{throw Error('quota');});expect(()=>f.library.remove(a.id!)).toThrow('storage');expect(f.preferences.getSnapshot()).toBe(before);expect(f.data.get(languageStorageKey)).toBe(stored);f.library.remove(a.id!);expect(f.preferences.getSnapshot().locale).toBe('ru');
 });
 it('persists separate IDs and the active choice in a single write, including reload',()=>{
  const f=fixture(),a=f.library.import(input),b=f.library.import(input);f.storage.setItem.mockClear();f.library.select(b.id!);expect(f.storage.setItem).toHaveBeenCalledTimes(1);const next=fixture(f.data);expect(next.preferences.getSnapshot()).toMatchObject({locale:'ru',localePackageId:b.id,languagePacks:[a,b]});expect(storedStudioLocale(next.storage)).toBe('ru');next.apply();expect(next.registry.text('language:title')).toBe('Custom title');
 });
 it('backs up installed current-format packages before assigning persistent IDs',()=>{
  const data=new Map([['studio.locale','zz'],['studio.language-packs',JSON.stringify([{...input,locale:'zz'}])]]),f=fixture(data),pack=f.preferences.getSnapshot().languagePacks[0];expect(pack.id).toBeTruthy();expect(f.preferences.getSnapshot().localePackageId).toBe(pack.id);expect(JSON.parse(data.get('studio.localization.backup')!).packs).toBe(data.get('studio.language-packs'));expect(fixture(data).preferences.getSnapshot().languagePacks[0].id).toBe(pack.id);
 });
 it('preserves future or corrupt localization records without overwriting them',()=>{
  for(const raw of ['{"version":99}','broken']){const f=fixture(new Map([[languageStorageKey,raw]]));expect(()=>f.library.import(input)).toThrow('storage');expect(f.data.get(languageStorageKey)).toBe(raw);expect(f.preferences.getSnapshot().languagePacks).toHaveLength(0);}
 });
 it('preserves an installed Russian override as an explicit custom choice during upgrade',()=>{
  const f=fixture(new Map([['studio.locale','ru'],['studio.language-packs',JSON.stringify([input])]]));expect(f.preferences.getSnapshot().localePackageId).toBe(f.preferences.getSnapshot().languagePacks[0].id);f.apply();expect(f.registry.text('language:title')).toBe('Custom title');f.library.select('ru');f.apply();expect(f.registry.text('language:title')).toBe('Языки и текст');
 });
 it('isolates current v4 locale resources deterministically without changing authored strings',()=>{
  const d=initialDocument();d.languagePacks=[{...input,version:1}];d.profiles[0].locale='ru';const a=isolateDocumentLanguages(d),b=isolateDocumentLanguages(structuredClone(d));expect(a).toEqual(b);expect(d.languagePacks[0].id).toBeUndefined();expect(a.profiles[0].localePackageId).toBe(a.languagePacks[0].id);expect(a.languagePacks[0].namespaces).toEqual(input.namespaces);expect(isolateDocumentLanguages(a)).toBe(a);expect(parseDocument(JSON.stringify(encodeDocument(a)))).toEqual(a);
 });
 it('keeps selected overlay variants isolated through standalone export and parsing',()=>{
  const f=fixture(),a=f.library.import(input),b=f.library.import({...input,namespaces:{overlay:{sensitivity:'Second SENS'}}}),d=initialDocument();d.languagePacks=[a,b].map(p=>({...p,namespaces:{overlay:p.namespaces.overlay}}));d.profiles[0].locale='ru';d.profiles[0].localePackageId=b.id;
  const next=parseDocument(JSON.stringify(encodeDocument(d)));expect(overlayText(next.languagePacks,'ru','sensitivity','SENS',a.id)).toBe('My SENS');expect(overlayText(next.languagePacks,'ru','sensitivity','SENS',b.id)).toBe('Second SENS');expect(overlayText(next.languagePacks,'ru','sensitivity','SENS')).toBe('СЕНСА');expect(next.profiles[0].localePackageId).toBe(b.id);
 });
});
