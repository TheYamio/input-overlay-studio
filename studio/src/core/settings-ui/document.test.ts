import { afterEach,describe,expect,it,vi } from 'vitest';
import { builtinCatalog } from '../architecture/builtins';
import type { DefinitionId,SettingsAddress } from '../architecture/contracts';
import { initialDocument,layoutKeys,yaws } from '../config';
import { linkArtwork } from '../artwork-groups';
import { SettingsService,type SettingsTransport } from '../settings/service';
import { documentAdapter } from './document';
import { fieldModel } from './model';
const services:SettingsService[]=[];afterEach(()=>services.splice(0).forEach(service=>service.dispose()));
function fixture(){
 const doc=initialDocument(),save=vi.fn(),transport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false} as SettingsTransport;
 const service=new SettingsService({load:()=>({document:doc,warning:''}),save,backup:()=>doc},transport,'ws://isolated');services.push(service);
 const address=(type='keyboard'):SettingsAddress=>({scope:'module',profileId:doc.activeProfileId,moduleId:doc.profiles[0].modules.find(module=>module.type===type)!.id});
 const read=(id:DefinitionId,target=address())=>documentAdapter.read(service,builtinCatalog.settings.get(id)!,target);
 const write=(id:DefinitionId,value:unknown,target=address())=>documentAdapter.write!(service,builtinCatalog.settings.get(id)!,target,value);
 return {doc,service,save,address,read,write};
}
describe('all document settings through the schema adapter',()=>{
 it('reads every owned simple field for all five modules without writes or optional defaults',()=>{
  const f=fixture(),before=f.service.document;
  for(const module of before.profiles[0].modules)for(const id of builtinCatalog.modules.get(`overlay.${module.type}`)!.settings){
   const definition=builtinCatalog.settings.get(id)!;if(definition.ui.control==='custom')continue;
   expect(()=>fieldModel(builtinCatalog,f.service,id,f.address(module.type),new Set(),documentAdapter),id).not.toThrow();
  }
  expect(f.service.document).toBe(before);expect(f.save).not.toHaveBeenCalled();
 });
 it('resolves inherited optional labels and shapes without materializing them',()=>{
  const f=fixture(),base=f.address();if(base.scope!=='module')throw Error('module');const key={...base,element:{kind:'key' as const,keyId:f.doc.profiles[0].modules[0].keys[0].id}};
  expect(f.read('overlay.appearance.show-labels',key)).toBe(true);expect(f.read('overlay.appearance.shape',key)).toBe('');
  f.write('overlay.appearance.show-labels',false);expect(f.read('overlay.appearance.show-labels',key)).toBe(false);
  f.write('overlay.appearance.show-labels',true,key);expect(f.read('overlay.appearance.show-labels',key)).toBe(true);f.service.reset('overlay.appearance.show-labels',key);expect(f.read('overlay.appearance.show-labels',key)).toBe(false);
 });
 it('replaces keyboard layout and keys in one atomic undo, preserving Custom keys',()=>{
  const f=fixture(),before=f.service.document;expect(f.write('overlay.keyboard.layout','WASD')).toBe(true);expect(f.service.document.profiles[0].modules[0].keys).toEqual(layoutKeys('WASD'));expect(f.save).toHaveBeenCalledTimes(1);
  f.service.undo();expect(f.service.document).toEqual(before);f.write('overlay.keyboard.layout','Custom');expect(f.service.document.profiles[0].modules[0].keys).toEqual(before.profiles[0].modules[0].keys);
 });
 it('changes mouse mode with bounded geometry atomically, and preserves locked geometry',()=>{
  const f=fixture(),address=f.address('mouse'),before=f.service.document;f.write('overlay.mouse.mode','Mouse Diagram',address);expect(f.service.document.profiles[0].modules.find(module=>module.type==='mouse')).toMatchObject({mouseMode:'Mouse Diagram',w:220,h:300});f.service.undo();expect(f.service.document).toEqual(before);
  f.write('overlay.instance.locked',true,address);const locked=f.service.document.profiles[0].modules.find(module=>module.type==='mouse')!;f.write('overlay.mouse.mode','Mouse Diagram',address);expect(f.service.document.profiles[0].modules.find(module=>module.type==='mouse')).toMatchObject({x:locked.x,y:locked.y,w:locked.w,h:locked.h});
 });
 it('derives geometry limits from the addressed instance and exposes lock conditions',()=>{
  const f=fixture(),address=f.address(),module=f.doc.profiles[0].modules[0];expect(documentAdapter.constraints!(f.service,builtinCatalog.settings.get('overlay.instance.x')!,address)).toEqual({maximum:1920-module.w});f.write('overlay.instance.locked',true);
  expect(fieldModel(builtinCatalog,f.service,'overlay.instance.width',address,new Set(),documentAdapter).enabled).toBe(false);
 });
 it('propagates artwork adjustments and reset across linked modules in one undo',()=>{
  const f=fixture();f.service.transaction(doc=>{const p=doc.profiles[0];linkArtwork(p,p.modules[0].id,p.modules.find(m=>m.type==='mouse')!.id,true);});const before=f.service.document;
  f.write('overlay.artwork.opacity',.31);expect(f.service.document.profiles[0].modules.filter(m=>m.image.groupId).map(m=>m.image.opacity)).toEqual([.31,.31]);f.service.undo();expect(f.service.document).toEqual(before);
  f.write('overlay.artwork.opacity',.31);documentAdapter.reset!(f.service,builtinCatalog.settings.get('overlay.artwork.opacity')!,f.address());expect(f.service.document.profiles[0].modules.filter(m=>m.image.groupId).map(m=>m.image.opacity)).toEqual([.75,.75]);
 });
 it('rejects invalid compound values without touching linked artwork, geometry or history',()=>{
  const f=fixture(),before=f.service.document;for(const [id,value] of [['overlay.mouse.mode','missing'],['overlay.keyboard.layout','missing'],['overlay.artwork.opacity',3],['overlay.trail.origin-x',2]] as const)expect(f.write(id,value)).toBe(false);
  expect(f.service.document).toBe(before);expect(f.service.getSnapshot().canUndo).toBe(false);expect(f.save).not.toHaveBeenCalled();
 });
 it('applies game defaults only to the explicitly addressed profile with one undo',()=>{
  const f=fixture();f.service.transaction(doc=>{const p=structuredClone(doc.gameProfiles[0]);p.id='second';doc.gameProfiles.push(p);});const before=f.service.document,address={scope:'game-profile' as const,profileId:'second'};
  f.write('profiles.game.game','Valorant',address);expect(f.service.document.gameProfiles[1]).toMatchObject({game:'Valorant',yaw:yaws.Valorant});expect(f.service.document.profiles[0]).toEqual(before.profiles[0]);f.service.undo();expect(f.service.document).toEqual(before);
 });
 it('retains KovaaK’s scale/yaw compound semantics and a single numeric gesture',()=>{
  const f=fixture(),address={scope:'game-profile' as const,profileId:f.doc.gameProfiles[0].id};f.write('profiles.game.game','KovaaK’s',address);const before=f.service.document;expect(before.gameProfiles[0].scale).toBe('Unknown');f.service.beginGesture('yaw');for(const value of [.01,.012,.0123])f.write('profiles.game.yaw',value,address);f.service.endGesture();expect(f.service.document.gameProfiles[0]).toMatchObject({scale:'Custom yaw',yaw:.0123});f.service.undo();expect(f.service.document).toEqual(before);
 });
 it('reads every inherited style for keys and hidden wheel buttons without enabling them',()=>{
  const f=fixture();for(const type of ['keyboard','mouse']){const address=f.address(type);if(address.scope!=='module')throw Error('module');const module=f.doc.profiles[0].modules.find(m=>m.type===type)!;const element=type==='keyboard'?{kind:'key' as const,keyId:module.keys[0].id}:{kind:'mouse-button' as const,button:6};for(const id of builtinCatalog.modules.get(`overlay.${type}`)!.settings){const d=builtinCatalog.settings.get(id)!;if(d.binding.overrides)expect(()=>documentAdapter.read(f.service,d,{...address,element}),id).not.toThrow();}}
  expect(f.save).not.toHaveBeenCalled();
 });
});
