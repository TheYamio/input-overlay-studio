import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialDocument, type StudioDocument } from '../config';
import type { SettingsAddress } from '../architecture/contracts';
import type { SyncMetadata } from '../storage';
import type { VectorShape } from '../shapes';
import type { PreservedConfiguration } from '../compatibility/preserved';
import { SettingsEvents, type SettingsChange } from './events';
import { SettingsService, type DocumentStorage, type SettingsTransport } from './service';
import {bindDocumentLifecycle} from './lifecycle';

const endpoint='ws://local';
const services:SettingsService[]=[];
function fixture(options:{warning?:string;pending?:boolean;revision?:string;storedEndpoint?:string;unsupported?:PreservedConfiguration}={}) {
  const original=initialDocument();
  const writes:{document:StudioDocument;metadata:SyncMetadata}[]=[];
  const drafts:{document:StudioDocument;metadata:SyncMetadata}[]=[];
  const storage:DocumentStorage={load:()=>({document:original,warning:options.warning||'',unsupported:options.unsupported,sync:{pending:options.pending||false,baseRevision:options.revision||'r1',endpoint:options.storedEndpoint||endpoint}}),saveDraft:vi.fn((document,metadata)=>drafts.push(structuredClone({document,metadata}))),save:vi.fn((document,metadata)=>writes.push(structuredClone({document,metadata}))),backup:vi.fn(()=>structuredClone(original))};
  const transport:SettingsTransport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:vi.fn(),stop:vi.fn(),publish:vi.fn(()=>true)};
  const events=new SettingsEvents(), service=new SettingsService(storage,transport,endpoint,events);
  services.push(service);
  const connect=()=>{service.connect({url:endpoint,token:'private'});transport.onStatus('Connected');};
  const ready=()=>{connect();transport.onDocument(original,'r1');};
  const edit=(name:string)=>service.transaction(d=>{d.profiles[0].name=name;});
  const address:SettingsAddress={scope:'module',profileId:original.profiles[0].id,moduleId:original.profiles[0].modules[0].id};
  return {service,storage,transport,events,original,writes,drafts,connect,ready,edit,address};
}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{for(const service of services.splice(0))service.dispose();vi.useRealTimers();});

describe('durable gesture checkpoints',()=>{
  it('retains immediate full durability for adapters without a journal capability',()=>{
    const f=fixture();delete f.storage.saveDraft;f.service.beginGesture('custom adapter');f.edit('One');f.edit('Two');expect(f.writes).toHaveLength(2);f.service.endGesture();expect(f.writes).toHaveLength(2);
  });
  it('keeps a live draft and one Undo while committing a short gesture once',()=>{
    const f=fixture();f.service.beginGesture('drag');for(let i=0;i<25;i++)f.edit(`Step ${i}`);
    expect(f.writes).toHaveLength(0);expect(f.drafts).toHaveLength(25);expect(f.service.getSnapshot().saveStatus).toBe('Saved locally');expect(f.service.document.profiles[0].name).toBe('Step 24');
    f.service.endGesture();expect(f.writes).toHaveLength(1);expect(f.writes[0].document.profiles[0].name).toBe('Step 24');
    f.service.undo();expect(f.service.document).toEqual(f.original);expect(f.service.getSnapshot().canUndo).toBe(false);f.service.redo();expect(f.service.document.profiles[0].name).toBe('Step 24');
  });
  it('checkpoints continuous gestures every 250 ms without postponing the deadline',()=>{
    const f=fixture();f.service.beginGesture('slider');f.edit('First');vi.advanceTimersByTime(200);f.edit('Latest');vi.advanceTimersByTime(49);expect(f.writes).toHaveLength(0);
    vi.advanceTimersByTime(1);expect(f.writes).toHaveLength(1);expect(f.writes[0].document.profiles[0].name).toBe('Latest');
    f.edit('Continued');vi.advanceTimersByTime(250);expect(f.writes).toHaveLength(2);f.service.endGesture();expect(f.writes).toHaveLength(2);
  });
  it('persists ordinary operations and an explicit Save synchronously',()=>{
    const f=fixture();f.edit('Ordinary');expect(f.writes).toHaveLength(1);f.service.beginGesture('text');f.edit('Typing');expect(f.writes).toHaveLength(1);
    expect(f.service.save()).toBe(true);expect(f.writes).toHaveLength(2);expect(f.writes[1].metadata).toMatchObject({pending:true,baseRevision:'r1',endpoint});
  });
  it('persists the Undo target directly instead of committing an abandoned intermediate draft',()=>{
    const f=fixture();f.service.beginGesture('drag');f.edit('Abandoned');f.service.undo();expect(f.writes).toHaveLength(1);expect(f.writes[0].document).toEqual(f.original);
    vi.advanceTimersByTime(1000);expect(f.writes).toHaveLength(1);f.service.redo();expect(f.writes[1].document.profiles[0].name).toBe('Abandoned');
  });
  it('flushes the local draft before a server publish and retains its CAS base',()=>{
    const f=fixture();f.ready();f.writes.length=0;f.service.beginGesture('drag');f.edit('Pending');f.service.flush();
    expect(f.writes).toHaveLength(1);expect(f.writes[0].metadata).toMatchObject({pending:true,baseRevision:'r1'});expect(f.transport.publish).toHaveBeenCalledWith(f.service.document,'r1');
  });
  it('keeps conflict checkpoints paired with the old base until explicit resolution',()=>{
    const f=fixture();f.ready();f.writes.length=0;f.service.beginGesture('drag');f.edit('Local');const other=structuredClone(f.original);other.profiles[0].name='Other';f.transport.onDocument(other,'r2');
    vi.advanceTimersByTime(250);expect(f.writes[0].metadata.baseRevision).toBe('r1');expect(f.service.getSnapshot().conflict).toBe(true);expect(f.transport.publish).not.toHaveBeenCalled();
    f.service.resolveConflict('local');expect(f.writes.at(-1)?.metadata.baseRevision).toBe('r2');expect(f.service.document.profiles[0].name).toBe('Local');
  });
  it('keeps a failed checkpoint in memory and supports a synchronous explicit retry',()=>{
    const f=fixture();f.service.beginGesture('drag');f.edit('Keep me');vi.mocked(f.storage.save).mockImplementationOnce(()=>{throw Error('quota');});
    vi.advanceTimersByTime(250);expect(f.service.getSnapshot().saveStatus).toBe('Local save failed');expect(f.writes).toHaveLength(0);expect(f.service.document.profiles[0].name).toBe('Keep me');
    expect(f.service.save()).toBe(true);expect(f.writes).toHaveLength(1);expect(f.service.getSnapshot().warning).toBe('');
  });
  it('flushes page lifecycle events once and removes listeners on teardown',()=>{
    const f=fixture(),page=new EventTarget(),visibility=Object.assign(new EventTarget(),{visibilityState:'hidden'});const unbind=bindDocumentLifecycle(f.service,page,visibility as unknown as Document);
    f.service.beginGesture('drag');f.edit('Hidden');visibility.dispatchEvent(new Event('visibilitychange'));page.dispatchEvent(new Event('pagehide'));page.dispatchEvent(new Event('beforeunload'));expect(f.writes).toHaveLength(1);
    unbind();f.edit('Later');page.dispatchEvent(new Event('pagehide'));expect(f.writes).toHaveLength(1);f.service.dispose();expect(f.writes).toHaveLength(2);vi.advanceTimersByTime(1000);expect(f.writes).toHaveLength(2);
  });
});

describe('atomic settings operations and history',()=>{
  it('keeps connection reports ephemeral and ignores stale callbacks after a connection switch',()=>{
    const f=fixture();f.ready();const writes=f.writes.length,before=f.service.document;
    const packet={sequence:1,captureEnabled:false,captureRunning:false,runtimes:{connected:1,ready:1,failed:0,unresponsive:0}};
    f.transport.onConnectionStatus?.(packet);expect(f.service.getSnapshot().connectionStatus).toEqual(packet);expect(f.service.document).toBe(before);expect(f.writes).toHaveLength(writes);expect(f.service.getSnapshot().canUndo).toBe(false);
    const old=f.transport.onConnectionStatus;f.service.connect({url:'ws://other',token:'test'});old?.(packet);expect(f.service.getSnapshot().connectionStatus).toBeNull();f.transport.onStatus('Connected');f.transport.onConnectionStatus?.(packet);f.service.pause();expect(f.service.getSnapshot().connectionStatus).toBeNull();
  });
  it('validates, persists and notifies a whole operation once',()=>{
    const f=fixture(), changes:SettingsChange[]=[];f.service.subscribeChanges('game-profile',e=>changes.push(e));
    f.service.transaction(d=>{d.profiles[0].name='One operation';d.gameProfiles[0].dpi=800;},{source:'preset'});
    expect(f.writes).toHaveLength(1);expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({source:'preset',store:'document',version:1});
    expect(f.service.undo()).toBe(true);expect(f.service.document).toEqual(f.original);expect(f.service.undo()).toBe(false);
    f.service.redo();expect(f.service.document.profiles[0]).toMatchObject({name:'One operation'});
  });
  it('rejects an invalid final document without history or partial persistence',()=>{
    const f=fixture(), before=f.service.document;
    expect(f.service.transaction(d=>{d.gameProfiles[0].dpi=800;d.profiles[0].name='X'.repeat(101);})).toBe(false);
    expect(f.service.document).toBe(before);expect(f.writes).toHaveLength(0);expect(f.service.getSnapshot().canUndo).toBe(false);
  });
  it('rolls back thrown callbacks and rejects nested mutations',()=>{
    const f=fixture();expect(()=>f.service.transaction(d=>{d.profiles[0].name='Partial';throw Error('failed');})).toThrow('failed');
    expect(()=>f.service.transaction(()=>f.edit('Nested'))).toThrow('entire logical operation');
    expect(f.service.document).toEqual(f.original);expect(f.writes).toHaveLength(0);f.edit('Still writable');expect(f.writes).toHaveLength(1);
  });
  it('rejects asynchronous transactions before their detached draft can be committed',async()=>{
    const f=fixture();expect(()=>f.service.transaction(async d=>{d.gameProfiles[0].dpi=800;await Promise.resolve();d.gameProfiles[0].dpi=900;})).toThrow('asynchronous data');
    await Promise.resolve();expect(f.service.document).toEqual(f.original);expect(f.writes).toHaveLength(0);
  });
  it('ignores no-op edits and clears redo only on a real operation',()=>{
    const f=fixture();f.edit('Changed');f.service.undo();const count=f.writes.length;
    f.service.transaction(()=>{});expect(f.writes).toHaveLength(count);expect(f.service.getSnapshot().canRedo).toBe(true);
    f.edit('Different');expect(f.service.getSnapshot().canRedo).toBe(false);
  });
  it('groups an input gesture into one undo and shares its operation ID',()=>{
    const f=fixture(), changes:SettingsChange[]=[];f.service.subscribeChanges('module',e=>changes.push(e));
    f.service.beginGesture('slider');f.edit('Step1');f.edit('Step2');f.service.endGesture();f.edit('Separate');
    expect(changes[0].operationId).toBe(changes[1].operationId);expect(changes[2].operationId).not.toBe(changes[1].operationId);
    f.service.undo();expect(f.service.document.profiles[0].name).toBe('Step2');f.service.undo();expect(f.service.document).toEqual(f.original);
  });
  it('retains only sixty history entries',()=>{
    const f=fixture();for(let n=1;n<=65;n++)f.edit(String(n));
    for(let n=0;n<60;n++)expect(f.service.undo()).toBe(true);
    expect(f.service.document.profiles[0].name).toBe('5');expect(f.service.undo()).toBe(false);
  });
  it('joins SVG registration and application into one commit and undo',()=>{
    const f=fixture(), shape:VectorShape={name:'Triangle',viewBox:[0,0,10,10],paths:[{d:'M0 0L10 10H0Z',matrix:[1,0,0,1,0,0],fill:true,fillRule:'nonzero',strokeWidth:0,linecap:'butt',linejoin:'miter',opacity:1}]};
    expect(f.service.batch(()=>{
      f.service.transaction(d=>{d.profiles[0].modules[0].appearance.shapeId='triangle';});
      f.service.transaction(d=>{d.shapes.triangle=shape;});
      expect(f.service.document.shapes.triangle).toEqual(shape);expect(f.writes).toHaveLength(0);
    },{source:'shape-import'})).toBe(true);
    expect(f.writes).toHaveLength(1);f.service.undo();expect(f.service.document).toEqual(f.original);
  });
  it('rolls back the entire batch on an exception or invalid final reference',()=>{
    const f=fixture();expect(()=>f.service.batch(()=>{f.edit('Partial');throw Error('cancelled');})).toThrow('cancelled');
    expect(f.service.batch(()=>{f.edit('Partial');f.service.transaction(d=>{d.profiles[0].modules[0].appearance.shapeId='missing';});})).toBe(false);
    expect(f.service.document).toEqual(f.original);expect(f.writes).toHaveLength(0);
  });
  it('exposes stable read-only snapshots and copies read values',()=>{
    const f=fixture();expect(f.service.getSnapshot()).toBe(f.service.getSnapshot());
    expect(()=>{f.service.document.profiles[0].name='Outside transaction';}).toThrow();
    const modules=f.service.read('profiles.overlay.modules',{scope:'overlay-profile',profileId:f.original.activeProfileId}) as unknown[];modules.splice(0);
    expect(f.service.document.profiles[0].modules).not.toHaveLength(0);
  });
});

describe('registered settings and explicit addresses',()=>{
  it('applies fields as one transaction and limits notifications to the addressed scopes',()=>{
    const f=fixture(), game=vi.fn(), module=vi.fn();f.service.subscribeChanges('game-profile',game);f.service.subscribeChanges('module',module);
    expect(f.service.setMany([{id:'profiles.game.dpi',address:{scope:'game-profile',profileId:f.original.gameProfiles[0].id},value:800},{id:'profiles.game.sensitivity',address:{scope:'game-profile',profileId:f.original.gameProfiles[0].id},value:1.2}])).toBe(true);
    expect(game).toHaveBeenCalledTimes(1);expect(module).not.toHaveBeenCalled();expect(f.writes).toHaveLength(1);f.service.undo();expect(f.service.document).toEqual(f.original);
  });
  it('does not modify other profiles implicitly',()=>{
    const f=fixture(), other={...structuredClone(f.original.gameProfiles[0]),id:'other',name:'Other'};f.service.transaction(d=>{d.gameProfiles.push(other);});
    f.service.set('profiles.game.dpi',{scope:'game-profile',profileId:other.id},400);
    expect(f.service.document.gameProfiles[0].dpi).toBe(f.original.gameProfiles[0].dpi);expect(f.service.document.gameProfiles[1].dpi).toBe(400);
  });
  it('resets active selection to a real profile rather than a factory UUID',()=>{
    const f=fixture();f.service.transaction(d=>{d.profiles.push({...structuredClone(d.profiles[0]),id:'other'});d.activeProfileId='other';});
    expect(f.service.reset('studio.document.active-profile',{scope:'global'})).toBe(true);expect(f.service.document.activeProfileId).toBe(f.original.activeProfileId);
  });
  it('rejects unknown IDs, wrong scopes, missing targets and wrong module types',()=>{
    const f=fixture();for(const [id,address] of [
      ['missing.setting',f.address],['profiles.game.dpi',{scope:'global'}],['profiles.game.dpi',{scope:'game-profile',profileId:'missing'}],['overlay.trail.duration',f.address],
      ['overlay.instance.name',{...f.address,scope:'module',moduleId:'missing'}],
    ] as const)expect(()=>f.service.set(id,address as SettingsAddress,800)).toThrow();
    expect(f.writes).toHaveLength(0);
  });
  it('rejects a bad member atomically and validates document-wide references',()=>{
    const f=fixture();expect(()=>f.service.setMany([{id:'overlay.instance.name',address:f.address,value:'Changed'},{id:'overlay.surface.accent',address:f.address,value:'invalid'}])).toThrow('Invalid value');
    expect(f.service.set('studio.document.active-profile',{scope:'global'},'missing')).toBe(false);
    expect(f.service.document).toEqual(f.original);expect(f.writes).toHaveLength(0);
  });
  it('preserves lock protection when using the registered geometry API',()=>{
    const f=fixture();f.service.set('overlay.instance.locked',f.address,true);const before=f.service.document;
    expect(()=>f.service.set('overlay.instance.x',f.address,10)).toThrow('locked');expect(f.service.document).toBe(before);
    f.service.set('overlay.instance.locked',f.address,false);expect(f.service.set('overlay.instance.x',f.address,10)).toBe(true);
  });
  it('resets key overrides to module inheritance without inserting absent style fields',()=>{
    const f=fixture(), address:SettingsAddress={...f.address,scope:'module',element:{kind:'key',keyId:f.original.profiles[0].modules[0].keys[0].id}};
    f.service.reset('overlay.surface.accent',address);expect(f.writes).toHaveLength(0);
    f.service.set('overlay.surface.accent',address,'#123456');expect(f.service.read('overlay.surface.accent',address)).toBe('#123456');
    f.service.reset('overlay.surface.accent',address);expect(f.service.read('overlay.surface.accent',address)).toBe(f.original.profiles[0].modules[0].accent);
    expect(f.service.document.profiles[0].modules[0].keys[0].style?.accent).toBeUndefined();
  });
  it('supports button overrides and optional defaults without materializing absent values',()=>{
    const f=fixture(), mouse=f.original.profiles[0].modules.find(m=>m.type==='mouse')!, module:SettingsAddress={scope:'module',profileId:f.original.activeProfileId,moduleId:mouse.id}, button:SettingsAddress={...module,element:{kind:'mouse-button',button:1}};
    f.service.reset('overlay.animation.press-delay',button);expect(f.writes).toHaveLength(0);
    f.service.set('overlay.animation.press-delay',button,125);expect(f.service.read('overlay.animation.press-delay',button)).toBe(125);
    f.service.reset('overlay.animation.press-delay',button);expect(f.service.document.profiles[0].modules.find(m=>m.type==='mouse')!.buttonStyles[1].pressDelay).toBeUndefined();
    f.service.set('overlay.surface.radius',module,35);f.service.reset('overlay.surface.radius',module);expect(f.service.read('overlay.surface.radius',module)).toBe(12);
  });
});

describe('safe persistence and synchronization',()=>{
  it('does not publish until the initial server revision arrives',()=>{
    const f=fixture();f.connect();f.edit('Offline');vi.advanceTimersByTime(1000);expect(f.transport.publish).not.toHaveBeenCalled();
    f.transport.onDocument(f.original,'r1');expect(f.transport.publish).toHaveBeenCalledWith(f.service.document,'r1');
  });
  it('debounces draft publishing and commits revision metadata with the document',()=>{
    const f=fixture();f.ready();f.edit('One');f.edit('Two');vi.advanceTimersByTime(349);expect(f.transport.publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);expect(f.transport.publish).toHaveBeenCalledTimes(1);
    expect(f.writes.at(-1)).toMatchObject({document:{profiles:[{name:'Two'}]},metadata:{pending:true,baseRevision:'r1',endpoint}});
  });
  it('accepts a clean remote document without echoing it and keeps undo',()=>{
    const f=fixture();f.ready();const remote=structuredClone(f.original);remote.profiles[0].name='Remote';f.transport.onDocument(remote,'r2');vi.advanceTimersByTime(1000);
    expect(f.service.document).toEqual(remote);expect(f.transport.publish).not.toHaveBeenCalled();expect(f.writes.at(-1)?.metadata.pending).toBe(false);
    f.service.undo();expect(f.service.document).toEqual(f.original);expect(f.writes.at(-1)?.metadata.baseRevision).toBe('r2');
  });
  it('publishes defaults for an empty server',()=>{
    const f=fixture();f.connect();f.transport.onDocument(null,'empty');vi.advanceTimersByTime(350);expect(f.transport.publish).toHaveBeenCalledWith(f.service.document,'empty');
  });
  it('leaves the document intact on malformed remote data and pauses pending publishing',()=>{
    const f=fixture();f.ready();const invalid=structuredClone(f.original);invalid.activeProfileId='missing';f.transport.onDocument(invalid,'r2');expect(f.service.document).toEqual(f.original);
    f.edit('Draft');f.service.pause();vi.advanceTimersByTime(1000);expect(f.service.getSnapshot().connectionState).toBe('Paused');expect(f.transport.publish).not.toHaveBeenCalled();expect(f.writes.at(-1)?.metadata.pending).toBe(true);
  });
  it('keeps edits made during an outstanding ACK and immediately publishes the latest draft',()=>{
    const f=fixture();f.ready();f.edit('Sent');f.service.flush();const sent=JSON.stringify(f.service.document);f.edit('Newer');
    f.transport.onSaved(sent,'r2');expect(f.service.document.profiles[0].name).toBe('Newer');expect(f.service.getSnapshot().pending).toBe(true);
    expect(f.writes.at(-1)).toMatchObject({document:{profiles:[{name:'Newer'}]},metadata:{pending:true,baseRevision:'r2'}});
    expect(f.transport.publish).toHaveBeenLastCalledWith(f.service.document,'r2');
    f.transport.onSaved(JSON.stringify(f.service.document),'r3');expect(f.service.getSnapshot()).toMatchObject({pending:false,saveStatus:'Saved to capture server'});
  });
  it('restores a durable offline draft and detects a stale revision on reconnect',()=>{
    const f=fixture({pending:true});f.connect();const remote=structuredClone(f.original);remote.profiles[0].name='Other editor';f.transport.onDocument(remote,'r2');
    expect(f.service.getSnapshot()).toMatchObject({pending:true,conflict:true});expect(f.service.document).toEqual(f.original);expect(f.transport.publish).not.toHaveBeenCalled();
  });
  it('publishes explicit local conflict resolution against the latest remote revision',()=>{
    const f=fixture();f.ready();f.edit('Local');const remote=structuredClone(f.original);remote.profiles[0].name='Remote';f.transport.onConflict(remote,'r2');
    vi.advanceTimersByTime(500);expect(f.transport.publish).not.toHaveBeenCalled();f.service.resolveConflict('local');vi.advanceTimersByTime(350);
    expect(f.transport.publish).toHaveBeenLastCalledWith(f.service.document,'r2');expect(f.service.document.profiles[0].name).toBe('Local');
  });
  it('retains the discarded draft in undo after server conflict resolution',()=>{
    const f=fixture();f.ready();f.edit('Local');const remote=structuredClone(f.original);remote.profiles[0].name='Remote';f.transport.onConflict(remote,'r2');f.service.resolveConflict('server');
    expect(f.service.document.profiles[0].name).toBe('Remote');expect(f.service.getSnapshot().pending).toBe(false);
    f.service.undo();expect(f.service.document.profiles[0].name).toBe('Local');expect(f.writes.at(-1)?.metadata.baseRevision).toBe('r2');
  });
  it('keeps local data across disk/server failures and supports explicit retry',()=>{
    const f=fixture();f.ready();vi.mocked(f.storage.save).mockImplementationOnce(()=>{throw Error('quota');});f.edit('Kept');expect(f.service.getSnapshot().saveStatus).toBe('Local save failed');
    f.transport.onError('Server failed');expect(f.service.getSnapshot().pending).toBe(true);expect(f.service.document.profiles[0].name).toBe('Kept');
    expect(f.service.save()).toBe(true);vi.advanceTimersByTime(350);expect(f.transport.publish).toHaveBeenLastCalledWith(f.service.document,'r1');
  });
  it('protects corrupt source data until explicit save and ignores ACK persistence while protected',()=>{
    const f=fixture({warning:'Damaged source'});f.ready();f.edit('Working copy');f.transport.onSaved(JSON.stringify(f.service.document),'r2');vi.advanceTimersByTime(500);
    expect(f.writes).toHaveLength(0);expect(f.transport.publish).not.toHaveBeenCalled();expect(f.service.getSnapshot().protected).toBe(true);
    f.service.save();expect(f.writes).toHaveLength(1);expect(f.service.getSnapshot().protected).toBe(false);
  });
  it('does not clear protection when a replacement fails validation',()=>{
    const f=fixture({warning:'Damaged source'}), bad=structuredClone(f.original);bad.profiles=[];
    expect(f.service.replace(bad,{allowOverwrite:true})).toBe(false);expect(f.service.getSnapshot().protected).toBe(true);expect(f.writes).toHaveLength(0);
  });
  it('restores a server recovery backup through the same transaction API',()=>{
    const f=fixture();f.connect();const backup=structuredClone(f.original);backup.profiles[0].name='Recovered';f.transport.onRecovery(backup,'recovery');
    expect(f.service.getSnapshot().protected).toBe(true);f.service.restoreBackup();expect(f.service.document.profiles[0].name).toBe('Recovered');
    expect(f.writes.at(-1)?.metadata).toMatchObject({pending:true,baseRevision:'recovery'});f.service.undo();expect(f.service.document).toEqual(f.original);
  });
  it('does not reuse a revision after changing servers',()=>{
    const f=fixture();f.ready();f.edit('Local');f.service.connect({url:'ws://other',token:''});const remote=structuredClone(f.original);remote.profiles[0].name='Different server';f.transport.onDocument(remote,'r1');
    expect(f.service.getSnapshot().conflict).toBe(true);expect(f.transport.publish).not.toHaveBeenCalled();
  });
  it('recovers the stored draft base when native startup selects its actual server address',()=>{
    const f=fixture({pending:true,storedEndpoint:'ws://native'});f.connect();
    f.service.connect({url:'ws://native',token:'native'});const remote=structuredClone(f.original);remote.profiles[0].name='Server before the offline draft';f.transport.onDocument(remote,'r1');
    expect(f.service.getSnapshot().conflict).toBe(false);expect(f.transport.publish).toHaveBeenCalledWith(f.service.document,'r1');
  });
  it('ignores obsolete callbacks and obsolete cleanup after reconnect',()=>{
    const f=fixture();const cleanup=f.service.connect({url:endpoint,token:''}), previous=f.transport.onDocument;f.service.connect({url:endpoint,token:'new'});
    cleanup();expect(f.transport.stop).not.toHaveBeenCalled();const remote=structuredClone(f.original);remote.profiles[0].name='Stale';previous(remote,'r9');expect(f.service.document).toEqual(f.original);
  });
  it('keeps a conflicting remote change even when an earlier ACK arrives',()=>{
    const f=fixture();f.ready();f.edit('Local');const sent=JSON.stringify(f.service.document),remote=structuredClone(f.original);remote.profiles[0].name='Remote';f.transport.onConflict(remote,'r3');f.transport.onSaved(sent,'r2');
    expect(f.service.getSnapshot().conflict).toBe(true);f.service.resolveConflict('local');vi.advanceTimersByTime(350);expect(f.transport.publish).toHaveBeenLastCalledWith(f.service.document,'r3');
  });
});

describe('notification lifetime',()=>{
  it('isolates failing observers and rejects reentrant writes',()=>{
    const f=fixture(), callback=vi.fn();f.service.subscribeChanges('module',()=>{f.edit('Loop');});f.service.subscribeChanges('module',()=>{throw Error('observer');});f.service.subscribeChanges('module',callback);
    f.edit('Once');expect(f.service.document.profiles[0].name).toBe('Once');expect(f.writes).toHaveLength(1);expect(callback).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(callback.mock.calls)).not.toContain('private');
  });
  it('unsubscribes and disposes timers, history and transport callbacks',()=>{
    const f=fixture(), callback=vi.fn(), change=vi.fn();f.ready();const off=f.service.subscribe(callback), offChange=f.service.subscribeChanges('module',change);off();offChange();f.edit('Once');
    expect(callback).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();const stale=f.transport.onDocument;f.service.dispose();vi.advanceTimersByTime(1000);stale(f.original,'r5');
    expect(f.transport.publish).not.toHaveBeenCalled();expect(()=>f.edit('Disposed')).toThrow('disposed');
  });
});
describe('unsupported source inspection',()=>{
  const future:PreservedConfiguration={source:'local',version:99,reason:'Update Studio',text:' {"version":99,"keep":"raw"}\n'};
  it('blocks all destructive operations on a future local source, including explicit save',()=>{
    const f=fixture({unsupported:future,warning:future.reason});f.ready();const work=vi.fn();
    expect(f.edit('Rejected')).toBe(false);expect(f.service.save()).toBe(false);expect(f.service.replace(initialDocument(),{allowOverwrite:true})).toBe(false);
    expect(f.service.batch(work)).toBe(false);expect(work).not.toHaveBeenCalled();expect(f.service.restoreBackup()).toBe(false);expect(f.service.undo()).toBe(false);expect(f.service.redo()).toBe(false);
    f.service.flush();vi.advanceTimersByTime(1000);expect(f.writes).toHaveLength(0);expect(f.transport.publish).not.toHaveBeenCalled();expect(f.service.getSnapshot().unsupported?.text).toBe(future.text);
  });
  it('keeps a dirty local draft and ignores ACKs and remote replacements while inspecting a newer server source',()=>{
    const f=fixture();f.ready();f.edit('Draft');const count=f.writes.length;f.transport.onUnsupported?.({...future,source:'server'});
    f.transport.onSaved(JSON.stringify(f.service.document),'r3');f.transport.onDocument(f.original,'r4');f.transport.onRecovery(f.original,'r5');vi.advanceTimersByTime(1000);
    expect(f.service.document.profiles[0].name).toBe('Draft');expect(f.writes).toHaveLength(count);expect(f.service.getSnapshot().pending).toBe(true);expect(f.transport.publish).not.toHaveBeenCalled();
  });
  it('rechecks a server source after explicit reconnect without losing the draft base',()=>{
    const f=fixture();f.ready();f.edit('Draft');f.transport.onUnsupported?.({...future,source:'server'});f.ready();
    expect(f.service.getSnapshot().unsupported).toBeNull();expect(f.transport.publish).toHaveBeenCalledWith(f.service.document,'r1');
  });
  it('opens a future import without changing the working document or storage, then returns to it',()=>{
    const f=fixture();f.ready();const before=f.service.document,count=f.writes.length;
    expect(f.service.inspectUnsupported({...future,source:'import'})).toBe(true);expect(f.service.save()).toBe(false);expect(f.writes).toHaveLength(count);expect(f.service.document).toBe(before);
    expect(f.service.closeUnsupportedImport()).toBe(true);f.ready();expect(f.edit('After inspection')).toBe(true);
  });
  it('restores an existing recovery warning when future-file inspection is closed',()=>{
    const f=fixture({warning:'Original needs recovery'});f.service.inspectUnsupported({...future,source:'import'});f.service.closeUnsupportedImport();expect(f.service.getSnapshot()).toMatchObject({protected:true,warning:'Original needs recovery'});expect(f.writes).toHaveLength(0);
  });
  it('cannot dismiss a future local file by loading, restoring or reconnecting to other data',()=>{
    const f=fixture({unsupported:future});f.service.connect({url:'ws://other',token:''});f.transport.onUnsupported?.({...future,source:'server'});
    expect(f.service.closeUnsupportedImport()).toBe(false);expect(f.service.inspectUnsupported({...future,source:'import'})).toBe(false);expect(f.service.getSnapshot().unsupported?.source).toBe('local');expect(f.writes).toHaveLength(0);
  });
  it('ignores stale preservation callbacks after disconnect',()=>{
    const f=fixture();f.ready();const stale=f.transport.onUnsupported;f.service.pause();stale?.(future);expect(f.service.getSnapshot().unsupported).toBeNull();
  });
});
