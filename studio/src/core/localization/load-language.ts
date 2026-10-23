import {studioLocalization} from './builtins';
import {localeId,parseLocalePack,type LocalePack,type LocalizationRegistry} from './registry';

// Static imports let Vite package offline assets, while each catalog stays a separate lazy chunk.
const loaders={
 'zh-cn':()=>import('./catalogs/zh-cn.json'),
 es:()=>import('./catalogs/es.json'),
 'pt-br':()=>import('./catalogs/pt-br.json'),
 de:()=>import('./catalogs/de.json'),
 fr:()=>import('./catalogs/fr.json'),
 tr:()=>import('./catalogs/tr.json'),
 pl:()=>import('./catalogs/pl.json'),
 ja:()=>import('./catalogs/ja.json'),
 ko:()=>import('./catalogs/ko.json'),
 'zh-tw':()=>import('./catalogs/zh-tw.json'),
 ru:()=>import('./catalogs/ru-supplement.json'),
};
const pending=new Map<string,Promise<LocalePack>>();
const registered=new WeakMap<LocalizationRegistry,Set<string>>();
export async function loadBuiltinLanguage(requested:string,registry:LocalizationRegistry=studioLocalization):Promise<void>{
 let locale=localeId(requested);
 while(!Object.hasOwn(loaders,locale)&&locale.includes('-'))locale=locale.slice(0,locale.lastIndexOf('-'));
 if(!Object.hasOwn(loaders,locale))return;
 const id=locale as keyof typeof loaders;
 if(!pending.has(id)){
  const promise=loaders[id]().then(({default:pack})=>parseLocalePack(pack)).catch(error=>{pending.delete(id);throw error;});
  pending.set(id,promise);
 }
 const pack=await pending.get(id)!;
 const installed=registered.get(registry)??new Set<string>();
 if(!installed.has(id)){
  registry.register({...pack,namespaces:Object.fromEntries(Object.entries(pack.namespaces).filter(([name])=>name!=='overlay'))},{fallback:true});
  installed.add(id);registered.set(registry,installed);
 }
}
