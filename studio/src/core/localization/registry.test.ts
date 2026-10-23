import { describe, expect, it, vi } from 'vitest';
import { LocalizationRegistry, parseLocalePack } from './registry';
import { createStudioLocalization } from './builtins';
import { builtinCatalog } from '../architecture/builtins';

const pack=(locale='en',namespaces:Record<string,Record<string,string>>={test:{hello:'Hello {{name}}'}})=>({version:1,locale,namespaces});
describe('declarative localization registry',()=>{
  it('resolves every builtin label from the English catalog',()=>{
    const registry=createStudioLocalization();
    for(const definition of [...builtinCatalog.modules.all(),...builtinCatalog.settings.all()])expect(registry.text(definition.label.key)).toBe(definition.label.fallback);
  });
  it('falls back from region to language to English, then explicit fallback',()=>{
    const registry=new LocalizationRegistry();registry.register(pack());registry.register(pack('ru',{test:{hello:'Привет {{name}}'}}));registry.setLocale('RU-Cyrl-RU');
    expect(registry.text('test:hello','',{name:'Ямио'})).toBe('Привет Ямио');expect(registry.text('missing:key','Fallback')).toBe('Fallback');
    registry.setLocale('qya');expect(registry.text('test:hello','',{name:'Yamio'})).toBe('Hello Yamio');
  });
  it('adds module namespaces atomically and refuses duplicates',()=>{
    const registry=new LocalizationRegistry();registry.register(pack());
    expect(()=>registry.register(pack('en',{other:{value:'Other'},test:{hello:'Duplicate'}}))).toThrow('already registered');
    expect(registry.text('other:value','absent')).toBe('absent');
  });
  it('copies and freezes registered dictionaries',()=>{
    const registry=new LocalizationRegistry(),input=pack();registry.register(input);input.namespaces.test.hello='Changed';expect(registry.text('test:hello')).toBe('Hello {{name}}');
  });
  it('unregisters only the supplied namespaces, once',()=>{
    const registry=new LocalizationRegistry(),listener=vi.fn();registry.subscribe(listener);const off=registry.register(pack());registry.register(pack('en',{second:{value:'Keep'}}));off();off();
    expect(registry.text('test:hello','absent')).toBe('absent');expect(registry.text('second:value')).toBe('Keep');expect(listener).toHaveBeenCalledTimes(3);
  });
  it('cleans subscriptions, isolates observers and only notifies changed locale',()=>{
    const registry=new LocalizationRegistry(),listener=vi.fn();const off=registry.subscribe(listener);registry.subscribe(()=>{throw Error('observer');});off();registry.setLocale('ru');registry.setLocale('RU');expect(listener).not.toHaveBeenCalled();expect(registry.getSnapshot()).toBe(1);
  });
  it('interpolates own scalar values once without evaluating expressions',()=>{
    const registry=new LocalizationRegistry();registry.register(pack('en',{test:{value:'{{name}} / {{unknown}} / ${alert(1)}'}}));
    expect(registry.text('test:value','',{name:'{{other}}'})).toBe('{{other}} / {{unknown}} / ${alert(1)}');
  });
  it.each([null,{...pack(),version:2},{...pack(),locale:'../ru'},{...pack(),execute:'alert(1)'},{...pack(),namespaces:{test:{fn:()=>1}}},{...pack(),namespaces:{test:{blank:''}}},JSON.parse('{"version":1,"locale":"en","namespaces":{"test":{"__proto__":"unsafe"}}}')])('rejects malformed or executable localization packages %#',input=>{
    expect(()=>parseLocalePack(input)).toThrow();
  });
  it('bounds package size before registration',()=>{
    expect(()=>parseLocalePack(pack('en',{test:{huge:'x'.repeat(4001)}}))).toThrow();
    expect(()=>parseLocalePack(pack('en',{test:Object.fromEntries(Array.from({length:10001},(_,i)=>['k'+i,'v']))}))).toThrow();
  });
  it('never resolves inherited object properties as translations',()=>{
    const registry=new LocalizationRegistry();registry.register(pack());for(const key of ['toString','constructor','__proto__'])expect(registry.text(`test:${key}`,'Fallback')).toBe('Fallback');
  });
});
