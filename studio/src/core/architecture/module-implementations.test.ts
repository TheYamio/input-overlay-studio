import { describe,expect,it,vi } from 'vitest';
import { z } from 'zod';
import { builtinCatalog } from './builtins';
import { createCatalog } from './registry';
import { ModuleUIRegistry } from './module-ui';
import { VisualRuntimeRegistry } from '../../renderer/modules/registry';
import { createVisualRuntimeRegistry } from '../../renderer/modules/builtins';
import { createModuleUIRegistry } from '../../module-ui-builtins';
import { makeModule,moduleSchema,type OverlayModule } from '../config';
import { PreferenceSettings } from '../settings/preferences';
import { SettingsEvents } from '../settings/events';
const factory={create:vi.fn(()=>({update:()=>{},dispose:()=>{}}))},icon=()=>null,panel=()=>null;
function extended(){const original=builtinCatalog.modules.get('overlay.distance')!;return createCatalog([...builtinCatalog.modules.all(),{...original,id:'probe.visual',builtinType:'probe',renderer:'probe.runtime',inspector:'probe.inspector',configuration:z.object({...moduleSchema.shape,type:z.literal('probe')})}],builtinCatalog.settings.all());}
describe('compiled visual implementations',()=>{
 it('registers all five runtimes without constructing them',()=>{
  const registry=createVisualRuntimeRegistry();expect(registry.all().map(entry=>entry.definition.id)).toEqual(['overlay.keyboard','overlay.mouse','overlay.trail','overlay.distance','overlay.sensitivity']);for(const type of ['keyboard','mouse','trail','distance','sensitivity'])expect(registry.resolve(type)?.factory).toBeDefined();
 });
 it('rejects missing/service/duplicate registrations without modifying existing ones',()=>{
  const registry=new VisualRuntimeRegistry(builtinCatalog);expect(()=>registry.register('missing.visual',factory)).toThrow('Invalid');expect(()=>registry.register('core.capture',factory)).toThrow('Invalid');registry.register('overlay.distance',factory);expect(()=>registry.register('overlay.distance',factory)).toThrow('already registered');expect(registry.all()).toHaveLength(1);
 });
 it('disables, enables and unregisters one runtime without changing its siblings or catalog',()=>{
  const registry=new VisualRuntimeRegistry(builtinCatalog),off=registry.register('overlay.distance',factory);registry.register('overlay.trail',factory);registry.setEnabled('overlay.distance',false);expect(registry.resolve('distance')).toBeUndefined();expect(registry.resolve('trail')).toBeDefined();registry.setEnabled('overlay.distance',true);expect(registry.resolve('distance')).toBeDefined();off();off();expect(registry.resolve('distance')).toBeUndefined();expect(registry.catalog.modules.get('overlay.distance')).toBeDefined();
 });
 it('isolates observers and stops notifying unsubscribed scene hosts',()=>{
  const registry=new VisualRuntimeRegistry(builtinCatalog),listener=vi.fn(),off=registry.subscribe(listener);registry.subscribe(()=>{throw Error('observer');});registry.register('overlay.distance',factory);expect(listener).toHaveBeenCalledTimes(1);off();registry.setEnabled('overlay.distance',false);expect(listener).toHaveBeenCalledTimes(1);expect(registry.getSnapshot()).toBe(2);
 });
 it('registers an additional catalog type with a renderer through the same lookup contract',()=>{
  const registry=new VisualRuntimeRegistry(extended());registry.register('probe.visual',factory);expect(registry.resolve('probe')?.definition.renderer).toBe('probe.runtime');expect(registry.resolve('missing')).toBeUndefined();expect(factory.create).not.toHaveBeenCalled();
 });
 it('keeps copied registrations immutable and registration itself free of DOM state',()=>{
  const registry=new VisualRuntimeRegistry(builtinCatalog),source={...factory};registry.register('overlay.distance',source);source.create=vi.fn();expect(registry.resolve('distance')?.factory.create).toBe(factory.create);expect(Object.isFrozen(registry.resolve('distance'))).toBe(true);expect(Object.isFrozen(registry.all())).toBe(true);
 });
});
describe('module UI and factories from registrations',()=>{
 it('discovers builtins in their original library order and creates unchanged v2 modules',()=>{
  const registry=createModuleUIRegistry();expect(registry.all().map(entry=>entry.definition.builtinType)).toEqual(['keyboard','mouse','trail','distance','sensitivity']);for(const entry of registry.all()){const type=entry.definition.builtinType as OverlayModule['type'],before=makeModule(type,3),after=registry.create(entry.definition.id,3);expect({...after,id:before.id}).toEqual(before);}
 });
 it('preserves keyboard/mouse editing capabilities, panel ordering and canvas editor',()=>{
  const registry=createModuleUIRegistry();expect(registry.resolve('keyboard')).toMatchObject({selection:'keys',preview:true});expect(registry.resolve('keyboard')?.canvasEditor).toBeDefined();expect(registry.resolve('keyboard')?.sections.map(panel=>panel.id)).toEqual(['keys','artwork','preview']);expect(registry.resolve('mouse')).toMatchObject({selection:'buttons',preview:true});expect(registry.resolve('trail')?.preferred).toBe(true);
 });
 it('adds a new UI and factory from its catalog without editing central inspector/library code',()=>{
  const registry=new ModuleUIRegistry(extended());registry.register('probe.visual',{icon,sections:[{id:'probe.settings',label:'Probe settings',component:panel}],create:()=>({...makeModule('distance'),type:'probe'} as unknown as OverlayModule)});expect(registry.resolve('probe')?.sections[0].component).toBe(panel);expect(registry.create('probe.visual').type).toBe('probe');
 });
 it('validates factory output before it can enter a document transaction',()=>{
  const registry=new ModuleUIRegistry(builtinCatalog);registry.register('overlay.distance',{icon,sections:[],create:()=>makeModule('keyboard')});expect(()=>registry.create('overlay.distance')).toThrow('incompatible');expect(()=>registry.create('missing.visual')).toThrow('Unknown');
 });
 it('rejects panel ID conflicts, unpersistable section IDs and duplicated module registration',()=>{
  const registry=new ModuleUIRegistry(builtinCatalog),ui={icon,create:()=>makeModule('distance'),sections:[{id:'specific',label:'Distance',component:panel}]};for(const sections of [[{...ui.sections[0],id:'appearance'}],[ui.sections[0],ui.sections[0]],[{...ui.sections[0],id:'unknown'}]])expect(()=>registry.register('overlay.distance',{...ui,sections})).toThrow('Invalid module panel');registry.register('overlay.distance',ui);expect(()=>registry.register('overlay.distance',ui)).toThrow('already registered');
 });
 it('unregisters UI idempotently, isolates observers and preserves metadata',()=>{
  const registry=new ModuleUIRegistry(builtinCatalog),listener=vi.fn(),unsubscribe=registry.subscribe(listener);registry.subscribe(()=>{throw Error('observer');});const remove=registry.register('overlay.distance',{icon,sections:[],create:()=>makeModule('distance')});expect(listener).toHaveBeenCalledTimes(1);remove();remove();expect(registry.resolve('distance')).toBeUndefined();expect(listener).toHaveBeenCalledTimes(2);unsubscribe();
 });
 it('persists namespaced extension sections through the existing preference key',()=>{
  const data=new Map<string,string>(),storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}},events=new SettingsEvents(),preferences=new PreferenceSettings(storage,events);expect(preferences.set('studio.preferences.inspector-section','probe.settings')).toBe(true);expect(new PreferenceSettings(storage,events).getSnapshot().inspectorSection).toBe('probe.settings');expect(()=>preferences.write('inspectorSection','invalid')).toThrow('section');
 });
});
