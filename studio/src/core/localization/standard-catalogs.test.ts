import {describe,it,expect} from 'vitest';
import {createStudioLocalization} from './builtins';
import {builtinLanguages,languageChoices,overlayText} from './runtime';
import {standardPacks} from './standard-packs';
import {LocalizationRegistry,parseLocalePack} from './registry';
import sindarin from './catalogs/sjn-teng-x-art.json';
import {loadBuiltinLanguage} from './load-language';
const placeholders=(value:string)=>[...value.matchAll(/\{\{[a-zA-Z0-9.-]+\}\}/g)].map(match=>match[0]).sort();

describe('Experimental built-in translations',()=>{
 it('provides all requested standard locales and an explicitly partial Tengwar glossary',()=>{
  expect(builtinLanguages.map(pack=>pack.locale)).toEqual(['en','ru','zh-cn','es','pt-br','de','fr','tr','pl','ja','ko','zh-tw','sjn-teng-x-art']);
  expect(new Set(builtinLanguages.map(pack=>pack.locale)).size).toBe(builtinLanguages.length);
  expect(builtinLanguages.at(-1)?.name).toContain('partial');
  expect(parseLocalePack(sindarin).locale).toBe('sjn-teng-x-art');
  expect(Object.values(sindarin.namespaces.ui).some(value=>/[\ue000-\ue10f]/.test(value))).toBe(true);
 });
 it('keeps product branding out of the translation template and language catalogs',()=>{
  const r=createStudioLocalization(standardPacks);
  for(const locale of r.available()){
   const ui=r.exportPack(locale).namespaces.ui??{};
   for(const key of ['s-c96c6d5be8d0','s-0150f6d8bb28','s-6994f174da0a','s-17eeaf6a27f7','s-d6db93dd3031'])expect(ui).not.toHaveProperty(key);
  }
 });
 it('uses plain-text packages, stable English keys and intact value placeholders',()=>{
  const registry=createStudioLocalization(standardPacks),english=registry.exportPack('en');
  for(const input of standardPacks){
   const pack=parseLocalePack(input);
   for(const [namespace,entries] of Object.entries(pack.namespaces)){
    for(const [key,value] of Object.entries(entries)){
     const source=english.namespaces[namespace]?.[key];
     expect(source,`${pack.locale}:${namespace}:${key}`).toBeDefined();
     expect(placeholders(value),`${pack.locale}:${namespace}:${key}`).toEqual(placeholders(source));
    }
   }
   expect(Object.keys(pack.namespaces.ui).length).toBeGreaterThan(900);
  }
 });
 it('covers every English namespace and key in every standard locale',()=>{
  const r=createStudioLocalization(standardPacks),english=r.exportPack('en');
  for(const {locale} of standardPacks){const actual=r.exportPack(locale);for(const [ns,entries] of Object.entries(english.namespaces))for(const key of Object.keys(entries))expect(Object.hasOwn(actual.namespaces[ns]??{},key),`${locale}:${ns}:${key}`).toBe(true);}
 });
 it('translates generated settings, language warning and navigation consistently',()=>{
  const r=createStudioLocalization(standardPacks);
  for(const [locale,label,badge] of [['zh-cn','字号','实验性'],['es','Tamaño de fuente','Experimental'],['pt-br','Tamanho da fonte','Experimental'],['de','Schriftgröße','Experimentell'],['fr','Taille de police','Expérimental'],['tr','Yazı boyutu','Deneysel'],['pl','Rozmiar czcionki','Eksperymentalne'],['ja','フォントサイズ','試験的'],['ko','글꼴 크기','실험적'],['zh-tw','字號','實驗性']]){
   r.setLocale(locale);expect(r.text('settings:overlay.appearance.font-size.label')).toBe(label);expect(r.text('language:experimental')).toBe(badge);
   expect(r.text('language:experimentalHelp')).not.toContain('language:');
  }
  r.setLocale('ru');expect(r.text('language:experimental')).toBe('Экспериментально');
 });
 it('keeps authored overlay translations ahead of new built-in defaults',()=>{
  const packs=[{version:1 as const,locale:'JA',namespaces:{overlay:{sensitivity:'My custom 感度'}}}];
  expect(overlayText(packs,'ja','sensitivity','SENS')).toBe('My custom 感度');
  expect(overlayText(packs,'ja','game','GAME')).toBe('ゲーム');
  expect(languageChoices(packs).filter(pack=>pack.locale==='ja')).toHaveLength(1);
  expect(overlayText([],'de','unknown','Unknown scale')).toBe('Unbekannte Skala');
 });
 it('restores built-ins when an override is removed, including out-of-order removal',()=>{
  const r=new LocalizationRegistry();r.register({version:1,locale:'de',namespaces:{ui:{a:'Basis',b:'Bleibt'}}});
  const first=r.register({version:1,locale:'de',namespaces:{ui:{a:'Erste'}}},{override:true});
  const second=r.register({version:1,locale:'de',namespaces:{ui:{a:'Zweite'}}},{override:true});
  first();expect(r.textFor('de','ui:a')).toBe('Zweite');second();
  expect(r.textFor('de','ui:a')).toBe('Basis');expect(r.textFor('de','ui:b')).toBe('Bleibt');
  expect(()=>r.register({version:1,locale:'de',namespaces:{ui:{a:'Duplikat'}}})).toThrow();
 });
 it('can load built-in defaults after a user package without replacing its translations',()=>{
  const r=new LocalizationRegistry();
  const remove=r.register({version:1,locale:'fr',namespaces:{ui:{a:'Mon choix'}}},{override:true});
  r.register({version:1,locale:'fr',namespaces:{ui:{a:'Valeur intégrée',b:'Autre'}}},{fallback:true});
  expect(r.textFor('fr','ui:a')).toBe('Mon choix');expect(r.textFor('fr','ui:b')).toBe('Autre');
  remove();expect(r.textFor('fr','ui:a')).toBe('Valeur intégrée');
 });
 it('loads a locale into its owning registry once and supports regional fallback',async()=>{
  const r=createStudioLocalization();await loadBuiltinLanguage('fr-FR',r);
  expect(r.textFor('fr-FR','language:studio')).toBe('Langue de Studio');
  const before=r.getSnapshot();await loadBuiltinLanguage('fr',r);expect(r.getSnapshot()).toBe(before);
  await expect(loadBuiltinLanguage('../invalid',r)).rejects.toThrow();expect(r.getSnapshot()).toBe(before);
 });
});
