import {describe,it,expect} from 'vitest';
import {parseConnectionStatus,connectionIndicators,type ConnectionStatus} from './connection-status';
const wire={sequence:1,capture_enabled:true,capture_running:true,runtimes:{connected:1,ready:1,failed:0,unresponsive:0}};
const status=parseConnectionStatus(wire)!;
const view=(connectionStatus:ConnectionStatus|null=status)=>({connectionState:'Connected' as const,connectionStatus,pending:false,conflict:false,unsupported:null});
describe('independent capture, save and source indicators',()=>{
 it('validates bounded counts and rejects invalid or contradictory reports',()=>{
  for(const value of [{...wire,sequence:-1},{...wire,capture_running:'yes'},{...wire,runtimes:{connected:0,ready:1,failed:0,unresponsive:0}},{...wire,runtimes:{connected:1,ready:0,failed:1,unresponsive:1}},{...wire,runtimes:{connected:NaN,ready:0,failed:0,unresponsive:0}}])expect(parseConnectionStatus(value)).toBeNull();
  expect(Object.isFrozen(status.runtimes)).toBe(true);
 });
 it('does not infer a source from an authenticated capture connection or a save',()=>{
  expect(connectionIndicators(view(null))).toEqual({capture:'unknown',source:'unknown'});
  expect(connectionIndicators(view({...status,runtimes:{connected:0,ready:0,failed:0,unresponsive:0}}))).toEqual({capture:'active',source:'none'});
 });
 it('keeps source readiness independent from disabled input capture',()=>{
  expect(connectionIndicators(view({...status,captureEnabled:false,captureRunning:false}))).toEqual({capture:'disabled',source:'ready'});
  expect(connectionIndicators(view({...status,captureRunning:false})).capture).toBe('unavailable');expect(connectionIndicators(view({...status,captureRunning:null})).capture).toBe('unknown');
 });
 it('does not claim local pending or conflicting changes have reached the source',()=>{
  for(const patch of [{pending:true},{conflict:true},{unsupported:{version:99}}])expect(connectionIndicators({...view(),...patch}).source).toBe('changes');
 });
 it('reports partial, failed, loading and unresponsive sources separately',()=>{
  for(const [runtimes,expected] of [[{connected:2,ready:1,failed:0,unresponsive:1},'partial'],[{connected:1,ready:0,failed:1,unresponsive:0},'error'],[{connected:1,ready:0,failed:0,unresponsive:0},'loading'],[{connected:1,ready:0,failed:0,unresponsive:1},'unresponsive']] as const)expect(connectionIndicators(view({...status,runtimes})).source).toBe(expected);
 });
 it('forgets all source certainty when Studio disconnects or pauses',()=>{
  for(const connectionState of ['Offline','Paused','Authentication failed'] as const)expect(connectionIndicators({...view(),connectionState})).toEqual({capture:'offline',source:'unknown'});
 });
});
