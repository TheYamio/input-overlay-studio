import {describe,it,expect,vi} from 'vitest';
import corpus from '../../../../ws-server/src-tauri/test-fixtures/capture-config.json';
import {nativeConfigSchema,type NativeConfig} from '../native-config';
import {NativeSettings} from './native';
import {SettingsEvents,SettingsError} from './events';
import {nativeSettingsError} from './native-config';
import {nativeConnection} from './browser';

describe('complete capture configuration contract',()=>{
 for(const example of corpus)it(example.name,()=>{expect(nativeConfigSchema.safeParse(example.config).success).toBe(example.valid);});
 it('rejects invalid full snapshots before invoking native code or notifying observers',()=>{
  const events=new SettingsEvents(),changed=vi.fn(),invoke=vi.fn();events.subscribe('capture',changed);const native=new NativeSettings(()=>({invoke} as never),events);
  for(const example of corpus.filter(example=>!example.valid))expect(()=>native.save(example.config as NativeConfig)).toThrow(SettingsError);
  expect(invoke).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();native.dispose();
 });
 it('does not expose backend error text, tokens or paths in rejected operations',async()=>{
  const invoke=vi.fn().mockRejectedValueOnce(Error('PRIVATE-TOKEN-PATH')).mockRejectedValueOnce({code:'native-invalid-field',field:'auth_token',value:'PRIVATE-TOKEN-PATH'});
  const native=new NativeSettings(()=>({invoke} as never),new SettingsEvents()),config=corpus[0].config as NativeConfig;
  for(let i=0;i<2;i++){try{await native.save(config);throw Error('expected rejection');}catch(error){expect(error).toBeInstanceOf(SettingsError);expect(JSON.stringify(error)).not.toContain('PRIVATE-TOKEN-PATH');expect((error as Error).message).not.toContain('PRIVATE-TOKEN-PATH');}}
  expect(nativeSettingsError({code:'native-invalid-field',field:'PRIVATE-TOKEN-PATH'}).params).toEqual({});native.dispose();
 });
 it('formats wildcard and IPv6 endpoints consistently for validated bind hosts',()=>{
  for(const [host,expected]of [['::','[::1]'],['::1','[::1]'],['[::1]','[::1]'],['0.0.0.0','127.0.0.1']]){
   const {url}=nativeConnection({host,port:4455,auth_token:'test'});expect(url).toBe(`ws://${expected}:4455`);expect(()=>new URL(url)).not.toThrow();
  }
 });
 it('copies opaque fields when reading native settings',async()=>{
  const config={...corpus[0].config,future:{data:['keep']}},native=new NativeSettings(()=>({invoke:async()=>config} as never),new SettingsEvents());
  const read=await native.read();(read.future as {data:string[]}).data.push('changed');expect(config.future.data).toEqual(['keep']);native.dispose();
 });
});
