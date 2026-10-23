import { validUnicode } from '../unicode.ts';
// Declarative text only: no HTML, executable expressions, storage or input state.
export interface LocalePack {
  version: 1;
  locale: string;
  name?: string;
  direction?: 'ltr'|'rtl';
  namespaces: Record<string, Record<string, string>>;
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const safeKey = (key: string) => /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(key) && !['constructor','prototype','__proto__'].includes(key);
export function localeId(value: string) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value)) throw Error('Invalid locale identifier');
  return value.toLowerCase();
}
export function parseLocalePack(input: unknown): LocalePack {
  if (!plain(input) || input.version !== 1 || Object.keys(input).some(key => !['version','locale','name','direction','namespaces'].includes(key)) || !plain(input.namespaces)) throw Error('Invalid localization package');
  if(input.name!==undefined&&(typeof input.name!=='string'||!input.name.trim()||input.name.length>100||!validUnicode(input.name)))throw Error('Invalid language name');
  if(input.direction!==undefined&&input.direction!=='ltr'&&input.direction!=='rtl')throw Error('Invalid language direction');
  const locale = localeId(input.locale as string), namespaces: LocalePack['namespaces'] = {};
  if (Object.keys(input.namespaces).length > 64) throw Error('Too many localization namespaces');
  let size = 0, count = 0;
  for (const [namespace, entries] of Object.entries(input.namespaces)) {
    if (namespace.length>64 || !/^[a-z][a-z0-9-]*$/.test(namespace) || !safeKey(namespace) || !plain(entries)) throw Error('Invalid localization namespace');
    const copy: Record<string, string> = {};
    for (const [key, value] of Object.entries(entries)) {
      if (!safeKey(key) || key.length > 200 || typeof value !== 'string' || !value.trim() || value.length > 4000 || !validUnicode(value) || ++count > 10000) throw Error('Invalid localization entry');
      size += key.length + value.length;
      if (size > 500000) throw Error('Localization package is too large');
      copy[key] = value;
    }
    namespaces[namespace] = copy;
  }
  return {version:1,locale,...(input.name?{name:input.name as string}:{}),...(input.direction?{direction:input.direction as 'ltr'|'rtl'}:{}),namespaces};
}
export class LocalizationRegistry {
  private packs = new Map<string, Map<string, Readonly<Record<string,string>>>>();
  private sources = new Map<string, Map<string, Readonly<Record<string,string>>[]>>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private locale = 'en';
  available() {return [...this.packs].filter(([,namespaces])=>namespaces.size).map(([locale])=>locale);}
  exportPack(locale:string):LocalePack {return {version:1,locale:localeId(locale),namespaces:Object.fromEntries([...(this.packs.get(localeId(locale))??[])].map(([name,entries])=>[name,{...entries}]))};}
  getSnapshot = () => this.revision;
  getLocale = () => this.locale;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { this.revision++; for (const listener of [...this.listeners]) { try { listener(); } catch { /* Isolate observers. */ } } }
  register(input: unknown, options: {override?:boolean;fallback?:boolean} = {}) {
    const pack = parseLocalePack(input), next = new Map(this.packs.get(pack.locale));
    const sources = new Map(this.sources.get(pack.locale)), installed = new Map<string,Readonly<Record<string,string>>>();
    for (const namespace of Object.keys(pack.namespaces)) if (next.has(namespace) && !options.override && !options.fallback) throw Error(`Localization namespace already registered: ${pack.locale}:${namespace}`);
    for (const [namespace, entries] of Object.entries(pack.namespaces)) {
      const value=Object.freeze(entries), existing=sources.get(namespace)??[], layers=options.fallback?[value,...existing]:[...existing,value];
      sources.set(namespace,layers); next.set(namespace,Object.freeze(Object.assign({},...layers))); installed.set(namespace,value);
    }
    this.sources.set(pack.locale,sources);
    this.packs.set(pack.locale,next); this.notify();
    // Only this package's namespaces are removed; unrelated module packages survive.
    let active = true;
    return () => {
      if (!active) return; active=false;
      const current=new Map(this.packs.get(pack.locale)), remaining=new Map(this.sources.get(pack.locale));
      for (const [key,value] of installed) {
        const layers=(remaining.get(key)??[]).filter(layer=>layer!==value);
        if(layers.length){remaining.set(key,layers);current.set(key,Object.freeze(Object.assign({},...layers)));}
        else{remaining.delete(key);current.delete(key);}
      }
      this.sources.set(pack.locale,remaining);this.packs.set(pack.locale,current);this.notify();
    };
  }
  setLocale(locale: string) { const next = localeId(locale); if (this.locale !== next) { this.locale=next; this.notify(); } }
  text(key: string, fallback = key, params: Readonly<Record<string,string|number>> = {}) {
    return this.textFor(this.locale,key,fallback,params);
  }
  textFor(selectedLocale:string,key:string,fallback=key,params:Readonly<Record<string,string|number>>={}) {
    const split = key.indexOf(':'), namespace=key.slice(0,split), entry=key.slice(split+1);
    const chain=[localeId(selectedLocale)]; let parent=chain[0];
    while (parent.includes('-')) { parent=parent.slice(0,parent.lastIndexOf('-')); chain.push(parent); }
    chain.push('en');
    const value=split<1 ? fallback : chain.map(locale => { const entries=this.packs.get(locale)?.get(namespace); return entries && Object.hasOwn(entries,entry) ? entries[entry] : undefined; }).find(text => text !== undefined) ?? fallback;
    // React renders the returned string as text. Interpolation is one pass, never eval.
    return value.replace(/\{\{([a-zA-Z0-9.-]+)\}\}/g,(match,name:string) => Object.hasOwn(params,name) ? String(params[name]) : match);
  }
}
