import { describe,expect,it,vi } from 'vitest';
import { builtinCatalog } from '../architecture/builtins';
import { externalDefinitions } from '../architecture/external';
import { initialDocument } from '../config';
import { SettingsEvents } from './events';
import { NativeSettings,type NativeBridge,type NativeConfig } from './native';
import { NativeSettingsDraft } from './native-draft';
import { PreferenceSettings } from './preferences';
const config:NativeConfig={host:'127.0.0.1',port:4455,auth_token:'synthetic-secret',http_enabled:true,http_port:4456,analog_keyboard:'',capture_enabled:false,key_whitelist:[],raw_mouse_min_delta:0,send_mouse_move:true,cpu_affinity:[0,1],linux_evdev_keyboard_device:'/dev/input/unavailable-keyboard',linux_raw_mouse_device:'/dev/input/unavailable-mouse'};
function fixture(platform:'windows'|'linux'|'macos'='windows'){
 const events=new SettingsEvents(),invoke=vi.fn().mockResolvedValue(undefined),native=new NativeSettings(()=>({invoke} as NativeBridge),events),draft=new NativeSettingsDraft(native,platform);draft.replace(config);return {events,invoke,native,draft};
}
describe('Capture schema and explicit-apply sessions',()=>{
 it('registers every existing native field, ownership, platform and application policy',()=>{
  for(const key of Object.keys(config))expect(externalDefinitions.some(d=>d.binding.store==='native'&&d.binding.path[0]===key),key).toBe(true);
  expect(builtinCatalog.settings.get('capture.server.token')).toMatchObject({sensitive:true,apply:'reconnect'});expect(builtinCatalog.settings.get('capture.server.cpu-affinity')).toMatchObject({platforms:['windows'],apply:'restart'});
  expect(builtinCatalog.settings.get('capture.server.linux-mouse')!.platforms).toEqual(['linux']);expect(builtinCatalog.settings.all().filter(d=>d.binding.store==='document')).toHaveLength(132);
 });
 it('keeps observations/drafts outside persistence, input and the visual document',()=>{
  const f=fixture();expect(f.draft.read('capture.server.port')).toBe(4455);f.draft.set('capture.server.port',4457);f.draft.set('capture.server.allowed-inputs',['key_w']);expect(f.invoke).not.toHaveBeenCalled();expect(JSON.stringify(initialDocument())).not.toContain('synthetic-secret');f.draft.dispose();f.native.dispose();
 });
 it('rejects invalid scalar and list edits atomically and allows resetting a field',()=>{
  const {draft}=fixture(),before=draft.getSnapshot();for(const [id,value] of [['capture.server.port',0],['capture.server.port',1.5],['capture.server.minimum-delta',-1],['capture.server.allowed-inputs',['bad value']],['capture.server.cpu-affinity',[64]]] as const)expect(draft.set(id,value)).toBe(false);expect(draft.getSnapshot()).toBe(before);draft.set('capture.server.port',4457);draft.reset('capture.server.port');expect(draft.read('capture.server.port')).toBe(4455);
 });
 it('preserves unavailable platform values and unknown structurally valid fields on Apply',async()=>{
  const {draft,invoke}=fixture();draft.replace({...config,future:{data:['preserved']}} as NativeConfig);expect(draft.set('capture.server.linux-keyboard','/dev/input/changed')).toBe(false);draft.set('capture.server.port',4457);await draft.apply();expect(invoke).toHaveBeenCalledWith('save_config',{newCfg:{...config,port:4457,future:{data:['preserved']}}});
 });
 it('edits Linux devices but preserves unavailable Windows affinity values',async()=>{
  const {draft,invoke}=fixture('linux');expect(draft.set('capture.server.linux-keyboard','/dev/input/new')).toBe(true);expect(draft.set('capture.server.cpu-affinity',[3])).toBe(false);await draft.apply();expect(invoke.mock.calls[0][1].newCfg).toMatchObject({linux_evdev_keyboard_device:'/dev/input/new',cpu_affinity:[0,1]});
 });
 it('retains failed drafts, emits no success event and retries the same values',async()=>{
  const f=fixture(),listener=vi.fn();f.events.subscribe('capture',listener);f.invoke.mockRejectedValueOnce(Error('disk'));f.draft.set('capture.server.port',4457);await expect(f.draft.apply()).rejects.toThrow('could not be saved');expect(f.draft.read('capture.server.port')).toBe(4457);expect(listener).not.toHaveBeenCalled();await f.draft.apply();expect(listener).toHaveBeenCalledTimes(1);expect(JSON.stringify(listener.mock.calls)).not.toContain('synthetic-secret');
 });
 it('snapshots an in-flight Apply and keeps later edits for the next Apply',async()=>{
  const f=fixture();let finish=()=>{};f.invoke.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));f.draft.set('capture.server.port',4457);const save=f.draft.apply();await Promise.resolve();f.draft.set('capture.server.port',4458);finish();expect((await save).port).toBe(4457);expect(f.draft.read('capture.server.port')).toBe(4458);await f.draft.apply();expect(f.invoke.mock.calls[1][1].newCfg.port).toBe(4458);
 });
 it('isolates observers, rejects reentrant draft writes and disposes listeners',async()=>{
  const {draft}=fixture(),seen=vi.fn();draft.subscribe(()=>draft.set('capture.server.port',9999));const off=draft.subscribe(seen);draft.set('capture.server.port',4457);expect(draft.read('capture.server.port')).toBe(4457);expect(seen).toHaveBeenCalledTimes(1);off();draft.dispose();expect(()=>draft.replace(config)).toThrow('disposed');await expect(draft.apply()).rejects.toThrow('disposed');
 });
 it('keeps arbitrary absent adapter IDs from reading or writing unrelated native fields',()=>{
  const {draft}=fixture();expect(()=>draft.read('capture.server.missing')).toThrow('Unknown');expect(()=>draft.set('studio.preferences.locale','ru')).toThrow('Unknown');
 });
});
describe('preferences registered by stable ID',()=>{
 it('uses the existing keys and reloads values without putting them in a profile',()=>{
  const data=new Map<string,string>(),storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}},events=new SettingsEvents(),preferences=new PreferenceSettings(storage,events);
  expect(preferences.set('studio.preferences.inspector-width',440)).toBe(true);expect(preferences.set('studio.preferences.inspector-section','specific')).toBe(true);expect(preferences.set('studio.preferences.locale','ru')).toBe(true);expect(preferences.set('studio.preferences.connection',{url:'ws://test',token:'synthetic-secret'})).toBe(true);
  const next=new PreferenceSettings(storage,events);expect(next.read('studio.preferences.inspector-width')).toBe(440);expect(next.read('studio.preferences.inspector-section')).toBe('specific');expect(next.getSnapshot().locale).toBe('ru');expect(data.get('studio.inspector-width')).toBe('440');expect(JSON.stringify(initialDocument())).not.toContain('synthetic-secret');
 });
 it('rejects invalid schema values before disk and retains shortcut conflict validation',()=>{
  const setItem=vi.fn(),preferences=new PreferenceSettings({getItem:()=>null,setItem},new SettingsEvents());expect(preferences.set('studio.preferences.inspector-width',600)).toBe(false);expect(preferences.set('studio.preferences.inspector-section','missing')).toBe(false);expect(preferences.set('studio.preferences.connection',{url:1,token:false})).toBe(false);expect(setItem).not.toHaveBeenCalled();const shortcuts=structuredClone(preferences.getSnapshot().shortcuts);shortcuts.copy=shortcuts.paste;expect(()=>preferences.set('studio.preferences.shortcuts',shortcuts)).toThrow('conflicting');
 });
});
