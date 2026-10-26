import {describe,it,expect} from 'vitest';
import {ConnectionNotices} from './connection-notice';
import {diagnosticReport,formatDiagnostics,diagnosticPlatform} from './diagnostics';
import type {SettingsSnapshot} from './settings/service';
import {builtinCatalog} from './architecture/builtins';
import {settingGuidance} from './architecture/guidance';

describe('connection incident messages',()=>{
 it('keeps initial connection quiet and reports actual loss and recovery once',()=>{
  const t=new ConnectionNotices();expect(t.update('Offline','a')).toBeNull();expect(t.update('Connecting','a')).toBeNull();expect(t.update('Connected','a')).toBeNull();const lost=t.update('Offline','a')!;expect(lost.code).toBe('lost');expect(t.update('Connecting','a')).toBe(lost);expect(t.update('Offline','a')).toBe(lost);const restored=t.update('Connected','a')!;expect(restored.code).toBe('restored');expect(t.update('Connected','a')).toBe(restored);
 });
 it('dismissal survives a retry loop and a later independent failure can notify again',()=>{
  const t=new ConnectionNotices();t.update('Connected','a');const first=t.update('Offline','a')!;t.dismiss(first.id);t.update('Connecting','a');expect(t.update('Offline','a')).toBeNull();const recovered=t.update('Connected','a')!;const later=t.update('Offline','a')!;expect(later.id).toBeGreaterThan(first.id);expect(t.dismiss(recovered.id)).toBe(later);
 });
 it('distinguishes initial connection failure, authentication and recovery',()=>{
  const t=new ConnectionNotices();t.update('Connecting','a');expect(t.update('Offline','a')?.code).toBe('unavailable');expect(t.update('Authentication failed','a')?.code).toBe('authentication');expect(t.update('Connected','a')?.code).toBe('restored');
 });
 it('does not mistake pause or an intentional reconnect for network failure',()=>{
  const t=new ConnectionNotices();t.update('Connected','a');expect(t.update('Connecting','a')).toBeNull();expect(t.update('Connected','a')).toBeNull();expect(t.update('Paused','a')).toBeNull();t.update('Connecting','a');expect(t.update('Connected','a')).toBeNull();
 });
 it('changing servers clears the prior incident without leaking endpoint data into messages',()=>{
  const t=new ConnectionNotices();t.update('Connected','private-server-token');t.update('Offline','private-server-token');expect(t.update('Connecting','different-token')).toBeNull();expect(t.update('Offline','different-token')?.code).toBe('unavailable');expect(JSON.stringify(t.update('Authentication failed','different-token'))).not.toContain('token');
 });
});
const canary='PRIVATE-CANARY-token-username-profile-device';
const view={connectionState:'Connected',connectionStatus:{sequence:1,captureEnabled:true,captureRunning:true,runtimes:{connected:1,ready:1,failed:0,unresponsive:0}},pending:false,conflict:false,unsupported:null,protected:false,saveStatus:'Saved to capture server',warning:canary,document:{name:canary,connection:{token:canary},assets:{secret:canary}}} as unknown as SettingsSnapshot;
const environment={platform:'Win32 '+canary,native:true,width:1366,height:768,scale:1.25};
describe('diagnostic allowlist',()=>{
 it('contains useful state and dimensions without serialising settings or credentials',()=>{
  const json=formatDiagnostics(view,environment,{running:true,overlay_available:true,bind_error:null,host:canary,port:9999});expect(json).not.toContain(canary);expect(json).not.toContain('9999');expect(JSON.parse(json)).toMatchObject({format:'input-overlay-studio-diagnostics',version:1,application:{platform:'windows',host:'desktop'},connection:{capture:'active',source:'ready',save:'capture-server'},window:{width:1366,height:768,scale:1.25}});
 });
 it('never reads the visual document, raw warning or native host',()=>{
  const guarded={...view};Object.defineProperty(guarded,'document',{get(){throw Error('private document accessed');}});Object.defineProperty(guarded,'warning',{get(){throw Error('private error accessed');}});const http={running:false,overlay_available:true,bind_error:canary,get host():string{throw Error('private host accessed');},port:4456};expect(()=>formatDiagnostics(guarded,environment,http)).not.toThrow();expect(diagnosticReport(guarded,environment,http).http?.bindError).toBe('other');
 });
 it('maps untrusted strings and impossible dimensions to enums or null',()=>{
  const malicious={...view,connectionState:canary,saveStatus:canary,connectionStatus:{...view.connectionStatus!,runtimes:{connected:Infinity,ready:-1,failed:NaN,unresponsive:1e12}}} as unknown as SettingsSnapshot;
  const report=diagnosticReport(malicious,{...environment,width:Infinity,height:-1,scale:999},null);expect(report.connection.state).toBe('Unknown');expect(report.connection.save).toBe('unknown');expect(report.window).toEqual({width:null,height:null,scale:null});expect(JSON.stringify(report)).not.toContain(canary);
 });
 it('reports failed pending saves and leaves browser-only native HTTP state unknown',()=>{
  const report=diagnosticReport({...view,pending:true,saveStatus:'Save failed · draft kept'},{...environment,native:false},null);expect(report.connection.save).toBe('error');expect(report.connection.pending).toBe(true);expect(report.http).toBeNull();expect(diagnosticPlatform('Darwin')).toBe('macos');expect(diagnosticPlatform('Linux x86_64')).toBe('linux');expect(diagnosticPlatform('')).toBe('unknown');
 });
});
it('attaches concise help through schema metadata without changing persisted validation',()=>{
 expect(settingGuidance['overlay.artwork.opacity']!.fallback).toContain('100%');expect(settingGuidance['overlay.artwork.blend']!.fallback).toContain('50%');
 for(const [id,help] of Object.entries(settingGuidance)){const setting=builtinCatalog.settings.get(id as keyof typeof settingGuidance)!;expect(setting.help).toEqual(help);expect(setting.help!.key).toBe(`settings:${id}.help`);expect(setting.schema).toBeDefined();}
});
