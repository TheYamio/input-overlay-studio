import {describe,it,expect,vi} from 'vitest';
import {SupportSettings,eligible,supportStorageKey,type PromptContext} from './service';
import {paymentUrl,supportCatalog} from './schema';
import {SettingsEvents} from '../settings/events';
const day=86400000,first=1_700_000_000_000;
const configuration={enabled:true,prompt:{enabled:true},providers:[{id:'ko-fi',name:'Ko-fi',url:'https://ko-fi.com/example'}]};
const context:PromptContext={now:first+7*day,activity:{firstLaunchedAt:first,overlayConnections:3,runtimesActive:0,obsRunning:false,storageAvailable:true},studio:true,visible:true,safe:true};
function setup(config:unknown=configuration){const data=new Map<string,string>(),events=new SettingsEvents(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}},service=new SupportSettings(storage,events,config);return {data,events,storage,service};}
describe('Voluntary author support',()=>{
 it('requires seven days, three real connections and a safe active Studio with OBS closed',()=>{
  const {service}=setup(),state=service.getSnapshot();expect(eligible(state,context)).toBe(true);
  for(const change of [{now:context.now-1},{studio:false},{visible:false},{safe:false},{activity:null},{activity:{...context.activity!,overlayConnections:2}},{activity:{...context.activity!,runtimesActive:1}},{activity:{...context.activity!,obsRunning:true}},{activity:{...context.activity!,obsRunning:null}},{activity:{...context.activity!,storageAvailable:false}},{activity:{...context.activity!,firstLaunchedAt:context.now+day}},{activity:{...context.activity!,overlayConnections:Infinity}}])expect(eligible(state,{...context,...change})).toBe(false);
 });
 it('omits empty, invalid and duplicate providers and works with no payment links',()=>{
  const {service}=setup({enabled:true,prompt:{enabled:true},providers:[{id:'blank',name:'Blank',url:''},{id:'unsafe',name:'Unsafe',url:'javascript:alert(1)'},configuration.providers[0],configuration.providers[0],{id:'next',name:'Another service',url:'https://example.org/author'}]});
  expect(service.getSnapshot().providers.map(p=>p.id)).toEqual(['ko-fi','next']);expect(setup({enabled:true,prompt:{enabled:true},providers:[]}).service.getSnapshot().providers).toEqual([]);expect(eligible(setup().service.getSnapshot(),context)).toBe(true);expect(eligible(new SupportSettings(setup().storage,new SettingsEvents(),{...configuration,providers:[]}).getSnapshot(),context)).toBe(false);
 });
 it('never permits unsafe payment or browser-launch schemes and local URLs',()=>{
  for(const url of ['','javascript:alert(1)','file:///C:/foo','data:text/html,hello','http://example.org','https://user:pass@example.org/','https://127.0.0.1/','https://2130706433/','https://[::1]/','https://localhost/','https://host.local/','https://example.org:8443/','https://example.org/\n'])expect(paymentUrl(url),url).toBeNull();
  expect(paymentUrl('https://example.org/author?from=app')).toBe('https://example.org/author?from=app');
 });
 it('claims once before display and preserves the receipt across reload and another editor',()=>{
  const {service,storage}=setup();expect(service.claim(context)).toBe(true);expect(service.read('support.prompt.shown-at')).toBe(context.now);expect(service.claim(context)).toBe(false);const next=new SupportSettings(storage,new SettingsEvents(),configuration);expect(next.claim(context)).toBe(false);expect(service.dismiss()).toBe(true);expect(new SupportSettings(storage,new SettingsEvents(),configuration).claim(context)).toBe(false);
 });
 it('does not show or change memory when persistence fails',()=>{
  const {service,storage}=setup(),before=service.getSnapshot();storage.setItem=()=>{throw Error('quota');};const listener=vi.fn();service.subscribe(listener);expect(service.claim(context)).toBe(false);expect(service.dismiss()).toBe(false);expect(service.set('support.prompt.enabled',false)).toBe(false);expect(service.getSnapshot()).toBe(before);expect(listener).not.toHaveBeenCalled();
 });
 it('keeps dismissed and shown receipts irreversible through public setting commands',()=>{
  const {service}=setup();expect(service.dismiss()).toBe(true);expect(service.set('support.prompt.dismissed',false)).toBe(false);expect(service.set('support.prompt.shown-at',null)).toBe(false);expect(service.set('support.prompt.enabled',true)).toBe(true);expect(service.claim(context)).toBe(false);
 });
 it('supports disabling support or its automatic invitation without any paid feature state',()=>{
  expect(eligible(setup({...configuration,enabled:false}).service.getSnapshot(),context)).toBe(false);const {service}=setup();expect(service.set('support.prompt.enabled',false)).toBe(true);expect(eligible(service.getSnapshot(),context)).toBe(false);expect(service.set('support.providers',[])).toBe(false);
 });
 it('preserves unknown or corrupted stored data and fails closed',()=>{
  for(const raw of ['broken','{"version":99,"future":true}']){const {storage,data}=setup();data.set(supportStorageKey,raw);const service=new SupportSettings(storage,new SettingsEvents(),configuration);expect(service.claim(context)).toBe(false);expect(service.dismiss()).toBe(false);expect(data.get(supportStorageKey)).toBe(raw);}
 });
 it('registers Studio-only schema definitions and stores just the local prompt state',()=>{
  const {service,data}=setup();service.claim(context);expect([...data.keys()]).toEqual([supportStorageKey]);expect(JSON.parse(data.get(supportStorageKey)!)).toEqual({version:1,prompt:{enabled:true,dismissed:false,shownAt:context.now}});expect(supportCatalog.modules.all()).toHaveLength(1);for(const definition of supportCatalog.settings.all())expect(definition.targets).toEqual(['studio']);
 });
 it('observes another editor dismissing without resurrecting a previously shown invitation',()=>{
  const {service,storage}=setup();const other=new SupportSettings(storage,new SettingsEvents(),configuration);other.dismiss();expect(service.claim(context)).toBe(false);service.refresh();expect(service.getSnapshot().prompt.dismissed).toBe(true);service.dispose();expect(service.dismiss()).toBe(false);
 });
});
