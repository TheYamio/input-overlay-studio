import {LocalizationRegistry,type LocalePack} from './registry.ts';
import runtimeCatalogs from './catalogs/overlay.json';
export const builtinLanguages=[
 {locale:'en',name:'English',direction:'ltr' as const},
 {locale:'ru',name:'Русский',direction:'ltr' as const},
 {locale:'zh-cn',name:'简体中文',direction:'ltr' as const},
 {locale:'es',name:'Español',direction:'ltr' as const},
 {locale:'pt-br',name:'Português (Brasil)',direction:'ltr' as const},
 {locale:'de',name:'Deutsch',direction:'ltr' as const},
 {locale:'fr',name:'Français',direction:'ltr' as const},
 {locale:'tr',name:'Türkçe',direction:'ltr' as const},
 {locale:'pl',name:'Polski',direction:'ltr' as const},
 {locale:'ja',name:'日本語',direction:'ltr' as const},
 {locale:'ko',name:'한국어',direction:'ltr' as const},
 {locale:'zh-tw',name:'繁體中文',direction:'ltr' as const},
 {locale:'sjn-teng-x-art',name:'Sindarin · Tengwar (partial)',direction:'ltr' as const},
];
// Runtime imports only these small label catalogs, never the Studio interface dictionaries.
export const overlayPacks:LocalePack[]=Object.entries(runtimeCatalogs).map(([locale,overlay])=>({version:1,locale,namespaces:{overlay}}));
const registries=new WeakMap<readonly LocalePack[],LocalizationRegistry>();
export function overlayText(packs:readonly LocalePack[],locale:string,key:string,fallback:string){
 let registry=registries.get(packs);
 if(!registry){registry=new LocalizationRegistry();for(const pack of overlayPacks)registry.register(pack);for(const pack of packs)registry.register(pack,{override:true});registries.set(packs,registry);}
 return registry.textFor(locale,`overlay:${key}`,fallback);
}
export function languageChoices(packs:readonly LocalePack[]){return [...builtinLanguages,...packs.filter(p=>!builtinLanguages.some(l=>l.locale===p.locale.toLowerCase())).map(p=>({locale:p.locale.toLowerCase(),name:p.name||p.locale,direction:p.direction??'ltr'}))];}
