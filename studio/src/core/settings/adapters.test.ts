import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeDocument,initialDocument } from '../config';
import { defaultShortcuts, shortcutStorageKey } from '../shortcuts';
import { createBrowserSettings, nativeConnection } from './browser';
import { SettingsEvents, type SettingsChange } from './events';
import { NativeSettings, type NativeBridge, type NativeConfig } from './native';
import { PreferenceSettings,languageStorageKey } from './preferences';
import type { SettingsTransport } from './service';

afterEach(()=>vi.unstubAllGlobals());
const nativeConfig:NativeConfig={host:'127.0.0.1',port:4455,auth_token:'synthetic-token',http_enabled:true,http_port:4456,analog_keyboard:'',capture_enabled:true,key_whitelist:['key_w'],raw_mouse_min_delta:0,send_mouse_move:true,cpu_affinity:[],linux_evdev_keyboard_device:'',linux_raw_mouse_device:''};
function preferenceFixture() {
  const data=new Map<string,string>(), events=new SettingsEvents(),storage={getItem:(key:string)=>data.get(key)??null,setItem:vi.fn((key:string,value:string)=>{data.set(key,value);})};
  return {data,events,storage,create:()=>new PreferenceSettings(storage,events)};
}
describe('existing local preference storage adapters',()=>{
  it('persists Studio locale separately without changing connection or profile settings',()=>{
    const f=preferenceFixture(),preferences=f.create();expect(preferences.getSnapshot().locale).toBe('en');preferences.write('locale','ru');expect(JSON.parse(f.data.get(languageStorageKey)!).locale).toBe('ru');expect(f.create().getSnapshot().locale).toBe('ru');expect(f.data.has('input-overlay-studio.document')).toBe(false);preferences.reset('locale');expect(JSON.parse(f.data.get(languageStorageKey)!).locale).toBe('en');
  });
  it('rejects invalid locale IDs before writing and falls back from corrupt preferences',()=>{
    const f=preferenceFixture();f.data.set('studio.locale','../ru');const preferences=f.create();expect(preferences.getSnapshot().locale).toBe('en');expect(()=>preferences.write('locale','../ru')).toThrow('Invalid locale');expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('reads existing keys without writes or data conversion',()=>{
    const f=preferenceFixture();f.data.set('studio.inspector-width','420');f.data.set('studio.inspector-section','artwork');f.data.set('studio.connection',JSON.stringify({url:'ws://test',token:'synthetic'}));
    const preferences=f.create();expect(preferences.getSnapshot()).toMatchObject({inspectorWidth:420,inspectorSection:'artwork',connection:{url:'ws://test',token:'synthetic'},shortcuts:defaultShortcuts()});expect(f.storage.setItem).not.toHaveBeenCalled();
  });
  it('retains existing fallbacks when optional storage is unavailable',()=>{
    const preferences=new PreferenceSettings({getItem:()=>{throw Error('denied');},setItem:()=>{}},new SettingsEvents());
    expect(preferences.getSnapshot()).toMatchObject({inspectorWidth:360,inspectorSection:'appearance',connection:{url:'ws://127.0.0.1:4455',token:''},shortcuts:defaultShortcuts()});
  });
  it('writes the same keys, emits metadata only and supports reset',()=>{
    const f=preferenceFixture(), preferences=f.create(),changes:SettingsChange[]=[];f.events.subscribe('global',e=>changes.push(e));
    preferences.write('inspectorWidth',480);preferences.write('connection',{url:'ws://test',token:'secret'});preferences.reset('inspectorWidth');
    expect(f.data.get('studio.inspector-width')).toBe('360');expect(JSON.parse(f.data.get('studio.connection')!)).toEqual({url:'ws://test',token:'secret'});
    expect(changes.map(e=>e.version)).toEqual([1,2,3]);expect(JSON.stringify(changes)).not.toContain('secret');expect(changes[1].store).toBe('preferences');
  });
  it('keeps the previous preference on disk failure and allows retry',()=>{
    const f=preferenceFixture(),preferences=f.create();f.storage.setItem.mockImplementationOnce(()=>{throw Error('quota');});
    expect(preferences.write('inspectorWidth',400)).toBe(false);expect(preferences.getSnapshot().inspectorWidth).toBe(360);expect(preferences.write('inspectorWidth',400)).toBe(true);expect(f.data.get('studio.inspector-width')).toBe('400');
  });
  it('accepts reordered command maps, rejects conflicting maps and preserves the shortcut key',()=>{
    const f=preferenceFixture(),preferences=f.create(), bindings=Object.fromEntries(Object.entries(defaultShortcuts()).reverse()) as ReturnType<typeof defaultShortcuts>;
    expect(preferences.write('shortcuts',bindings)).toBe(true);expect(JSON.parse(f.data.get(shortcutStorageKey)!)).toEqual(bindings);
    bindings.copy=bindings.paste;expect(()=>preferences.write('shortcuts',bindings)).toThrow('conflicting');expect(preferences.getSnapshot().shortcuts.copy).toEqual(['Ctrl+KeyC']);
  });
  it('rejects invalid values before storage and cleans subscriptions',()=>{
    const f=preferenceFixture(),preferences=f.create(),listener=vi.fn(),off=preferences.subscribe(listener);off();
    expect(()=>preferences.write('inspectorWidth',NaN)).toThrow('range');expect(()=>preferences.write('inspectorSection','invalid')).toThrow('section');expect(f.storage.setItem).not.toHaveBeenCalled();
    preferences.write('inspectorWidth',500);expect(listener).not.toHaveBeenCalled();preferences.dispose();expect(()=>preferences.reset('inspectorWidth')).toThrow('disposed');
  });
  it('persists every inspector section using its actual existing ID',()=>{
    const f=preferenceFixture(),preferences=f.create();
    for(const id of ['appearance','layout','keys','artwork','preview','specific','all'])expect(preferences.write('inspectorSection',id)).toBe(true);
    expect(f.data.get('studio.inspector-section')).toBe('all');
  });
});

describe('native persistence boundary',()=>{
  it('reads through the existing native bridge and formats its endpoint',async()=>{
    const invoke=vi.fn(async()=>nativeConfig), settings=new NativeSettings(()=>({invoke} as NativeBridge),new SettingsEvents());
    const read=await settings.read();read.key_whitelist.push('key_a');expect(nativeConfig.key_whitelist).toEqual(['key_w']);expect(invoke).toHaveBeenCalledWith('get_config');
    expect(nativeConnection({...nativeConfig,host:'0.0.0.0'})).toEqual({url:'ws://127.0.0.1:4455',token:'synthetic-token'});
  });
  it('snapshots and serializes writes and emits only after successful native persistence',async()=>{
    const events=new SettingsEvents(), changes:SettingsChange[]=[];events.subscribe(['capture','global'],e=>changes.push(e));
    let finish:()=>void=()=>{};const first=new Promise<void>(resolve=>{finish=resolve;}),invoke=vi.fn().mockImplementationOnce(()=>first).mockResolvedValueOnce(true);
    const settings=new NativeSettings(()=>({invoke} as NativeBridge),events), config=structuredClone(nativeConfig),save=settings.save(config),autostart=settings.setAutostart(true);config.port=9999;
    await Promise.resolve();expect(invoke).toHaveBeenCalledTimes(1);expect(invoke.mock.calls[0]).toEqual(['save_config',{newCfg:nativeConfig}]);expect(changes).toHaveLength(0);
    finish();expect(await save).toEqual(nativeConfig);expect(await autostart).toBe(true);expect(invoke).toHaveBeenLastCalledWith('set_autostart',{enabled:true});
    expect(changes.map(e=>e.scopes)).toEqual([['capture'],['global']]);expect(JSON.stringify(changes)).not.toContain('synthetic-token');
  });
  it('rejects failed commits without success notifications and allows retry',async()=>{
    const events=new SettingsEvents(),listener=vi.fn();events.subscribe(['capture','global'],listener);
    const invoke=vi.fn().mockRejectedValueOnce(Error('disk')).mockResolvedValueOnce(false).mockResolvedValueOnce(undefined),settings=new NativeSettings(()=>({invoke} as NativeBridge),events);
    await expect(settings.save(nativeConfig)).rejects.toThrow('could not be saved');await expect(settings.setAutostart(true)).rejects.toThrow('Startup');expect(listener).not.toHaveBeenCalled();
    await settings.save(nativeConfig);expect(listener).toHaveBeenCalledTimes(1);
  });
  it('clears observers when an in-flight native request completes after disposal',async()=>{
    const events=new SettingsEvents(),listener=vi.fn();events.subscribe('capture',listener);let finish:()=>void=()=>{};
    const invoke=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),settings=new NativeSettings(()=>({invoke} as NativeBridge),events),pending=settings.save(nativeConfig);
    await Promise.resolve();settings.dispose();finish();await pending;expect(listener).not.toHaveBeenCalled();expect(()=>settings.save(nativeConfig)).toThrow('disposed');
  });
  it('cancels native writes that have not started when the service is disposed',async()=>{
    let finish:()=>void=()=>{};const invoke=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),settings=new NativeSettings(()=>({invoke} as NativeBridge),new SettingsEvents());
    const first=settings.save(nativeConfig),second=settings.setAutostart(true),rejected=expect(second).rejects.toThrow('disposed');
    await Promise.resolve();settings.dispose();finish();await first;await rejected;expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('browser persistence facade',()=>{
  it('keeps the original backup when acknowledging an unchanged document',()=>{
    const data=new Map<string,string>(), document=initialDocument();data.set('input-overlay-studio.document',JSON.stringify(encodeDocument(document)));
    vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});
    const transport:SettingsTransport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>true};
    const services=createBrowserSettings(transport,()=>{throw Error('no native');}), settings=services.settings;
    settings.connect({url:'ws://127.0.0.1:4455',token:''});transport.onDocument(document,'r1');settings.transaction(d=>{d.profiles[0].name='Changed';});
    const backup=data.get('input-overlay-studio.document.backup');transport.onSaved(JSON.stringify(settings.document),'r2');
    expect(data.get('input-overlay-studio.document.backup')).toBe(backup);expect(JSON.parse(backup!).profiles[0].name).toBe(document.profiles[0].name);expect(JSON.parse(data.get('input-overlay-studio.document')!).__studioSync).toMatchObject({pending:false,baseRevision:'r2'});
    services.dispose();
  });

});
