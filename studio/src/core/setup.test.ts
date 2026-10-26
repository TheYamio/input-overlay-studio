import {describe,it,expect,vi} from 'vitest';
import {emptySetupInput,watchSetupInput,setupCanFinish,setupStorageKey} from './setup';
import {InputEngine} from './input';
import {PreferenceSettings} from './settings/preferences';
import {SettingsEvents} from './settings/events';
import {initialDocument,encodeDocument,activeProfile} from './config';
import {factoryPresets} from './factory-presets';
import {SettingsService,type SettingsTransport} from './settings/service';
import {applyPresetToDocument} from './preset-application';

function preferences(initial:Record<string,string>={}){
 const data=new Map(Object.entries(initial)),setItem=vi.fn((key:string,value:string)=>{data.set(key,value);}),storage={getItem:(key:string)=>data.get(key)??null,setItem};
 return {data,setItem,storage,settings:new PreferenceSettings(storage,new SettingsEvents())};
}
describe('first-run setup progress',()=>{
 it('offers a fresh installation but keeps an existing editor configuration out of automatic setup',()=>{
  expect(preferences().settings.getSnapshot().setup.status).toBe('new');expect(preferences({'input-overlay-studio.document':'existing'}).settings.getSnapshot().setup.status).toBe('skipped');
 });
 it('stores a bounded progress record through registered preferences and reloads skipped/completed states',()=>{
  const f=preferences();for(const status of ['in-progress','skipped','completed'] as const){expect(f.settings.set('studio.preferences.setup',{version:1,status,step:2})).toBe(true);expect(new PreferenceSettings(f.storage,new SettingsEvents()).getSnapshot().setup).toEqual({version:1,status,step:2});}
  expect([...f.data.keys()]).toEqual([setupStorageKey]);expect(JSON.parse(f.data.get(setupStorageKey)!)).not.toHaveProperty('input');
 });
 it('rejects invalid steps and preserves unknown or damaged records for recovery',()=>{
  const f=preferences();for(const value of [{version:1,status:'completed',step:4},{version:1,status:'new',step:-1},{version:2,status:'completed',step:0}])expect(f.settings.set('studio.preferences.setup',value)).toBe(false);expect(f.setItem).not.toHaveBeenCalled();
  for(const raw of ['{"version":99,"future":true}','damaged']){const p=preferences({[setupStorageKey]:raw});expect(p.settings.getSnapshot().setup.status).toBe('skipped');expect(p.settings.set('studio.preferences.setup',{version:1,status:'completed',step:3})).toBe(false);expect(p.data.get(setupStorageKey)).toBe(raw);}
 });
 it('protects an unreadable progress record instead of overwriting it',()=>{
  const setItem=vi.fn(),p=new PreferenceSettings({getItem:key=>{if(key===setupStorageKey)throw Error('unavailable');return null;},setItem},new SettingsEvents());expect(p.getSnapshot().setup.status).toBe('skipped');expect(p.set('studio.preferences.setup',{version:1,status:'completed',step:3})).toBe(false);expect(setItem).not.toHaveBeenCalled();
 });
 it('keeps the previous state on storage failure and can retry',()=>{
  const f=preferences(),before=f.settings.getSnapshot();f.setItem.mockImplementationOnce(()=>{throw Error('quota');});expect(f.settings.set('studio.preferences.setup',{version:1,status:'skipped',step:0})).toBe(false);expect(f.settings.getSnapshot()).toBe(before);expect(f.settings.set('studio.preferences.setup',{version:1,status:'skipped',step:0})).toBe(true);
 });
});
describe('observed input checks',()=>{
 it('ignores restored held inputs, releases and resets, and publishes at most four category changes',()=>{
  const engine=new InputEngine(),change=vi.fn(),baseline=engine.listeners.size,stop=watchSetupInput(engine,change);
  engine.applySnapshot({sequence:1,keys:[{rawcode:87,depth:1}],buttons:[1]});engine.reset();engine.ingest({event_type:'key_released',rawcode:87});engine.ingest({event_type:'analog_depth',rawcode:87,depth:0});engine.ingest({event_type:'mouse_wheel',rotation:0});engine.ingest({event_type:'mouse_moved',dx:0,dy:0});expect(change).toHaveBeenCalledTimes(1);
  engine.ingest({event_type:'analog_depth',rawcode:87,depth:.5});engine.ingest({event_type:'mouse_pressed',button:1});engine.ingest({event_type:'mouse_wheel',rotation:-1});for(let n=0;n<8000;n++)engine.ingest({event_type:'mouse_moved',dx:1,dy:0});expect(change).toHaveBeenCalledTimes(5);expect(change.mock.calls.at(-1)![0]).toEqual({keyboard:true,movement:true,buttons:true,wheel:true});stop();expect(engine.listeners.size).toBe(baseline);engine.ingest({event_type:'key_pressed',rawcode:65});expect(change).toHaveBeenCalledTimes(5);
 });
 it('resumes a partial input check without mutating its saved in-memory evidence',()=>{
  const engine=new InputEngine(),change=vi.fn(),initial=Object.freeze({keyboard:true,movement:false,buttons:true,wheel:false}),stop=watchSetupInput(engine,change,initial);expect(change).toHaveBeenLastCalledWith(initial);engine.ingest({event_type:'mouse_wheel',rotation:1});expect(change).toHaveBeenLastCalledWith({...initial,wheel:true});expect(initial.wheel).toBe(false);stop();expect(engine.listeners.size).toBe(0);
 });
 it('a separate demo engine cannot satisfy the live checks',()=>{
  const live=new InputEngine(),demo=new InputEngine(),change=vi.fn(),stop=watchSetupInput(live,change);demo.ingest({event_type:'key_pressed',rawcode:87});demo.ingest({event_type:'mouse_pressed',button:1});expect(change).toHaveBeenLastCalledWith(emptySetupInput());stop();
 });
 it('requires a current source and capture readiness; unknown capture can use real input evidence',()=>{
  const view={connectionState:'Connected' as const,connectionStatus:{sequence:0,captureEnabled:true,captureRunning:true,runtimes:{connected:1,ready:1,failed:0,unresponsive:0}},pending:false,conflict:false,unsupported:null};
  expect(setupCanFinish(view,emptySetupInput())).toBe(true);for(const patch of [{pending:true},{conflict:true},{unsupported:{version:99}},{connectionState:'Offline' as const}])expect(setupCanFinish({...view,...patch},emptySetupInput())).toBe(false);
  for(const patch of [{captureEnabled:false},{captureRunning:false},{runtimes:{connected:1,ready:0,failed:0,unresponsive:0}},{runtimes:{connected:1,ready:0,failed:0,unresponsive:1}}])expect(setupCanFinish({...view,connectionStatus:{...view.connectionStatus,...patch}},emptySetupInput())).toBe(false);
  const unknown={...view,connectionStatus:{...view.connectionStatus,captureRunning:null}};expect(setupCanFinish(unknown,emptySetupInput())).toBe(false);expect(setupCanFinish(unknown,{keyboard:true,movement:true,buttons:true,wheel:true})).toBe(true);
 });
});
describe('setup layout application',()=>{
 it('applies complete shapes with one Undo and preserves game settings and unrelated profiles',()=>{
  const document=initialDocument();document.gameProfiles[0].dpi=1600;document.gameProfiles[0].sensitivity=2.42;const original=structuredClone(document),source=factoryPresets.find(b=>b.preset.theme==='Neon')!;
  const transport={stop:vi.fn()} as unknown as SettingsTransport,storage={load:()=>({document,warning:''}),save:vi.fn(),backup:()=>original};const service=new SettingsService(storage,transport,'ws://test');
  expect(service.transaction(d=>applyPresetToDocument(d,source.preset,false,source))).toBe(true);expect(service.document.gameProfiles).toEqual(original.gameProfiles);expect(activeProfile(service.document).theme).toBe('Neon');expect(Object.keys(service.document.shapes).length).toBeGreaterThan(0);expect(JSON.stringify(encodeDocument(service.document))).not.toContain('studio.setup');expect(service.undo()).toBe(true);expect(service.document).toEqual(original);expect(service.getSnapshot().canUndo).toBe(false);service.dispose();
 });
});
