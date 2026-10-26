import {it,expect,vi} from 'vitest';
import {z} from 'zod';
import {CompiledModuleHost,type CompiledModuleManifest} from './manifest';
import {createStudioModuleEnvironment} from '../../module-ui-builtins';
import {createVisualModuleEnvironment} from '../../renderer/modules/builtins';
import {makeModule} from '../config';
import {initialDocument,encodeDocument,parseDocument} from '../config';
import {encodeModule} from '../module-format';
import {SettingsService,type SettingsTransport} from '../settings/service';
import {SettingsEvents} from '../settings/events';

function counter():CompiledModuleManifest{
 const schema=z.strictObject({caption:z.string(),gain:z.number().min(1).max(4)});
 const definition={id:'test.counter',schemaVersion:1,kind:'visual',label:{key:'test:title',fallback:'Counter'},description:{key:'test:description',fallback:'Compiled counter'},dependencies:[],capabilities:['test.counter'],requires:[],settings:[],targets:['studio','obs'],configuration:schema,renderer:'test.counter.renderer',inspector:'test.counter.inspector'} as const;
 return {definition,settings:[],configuration:{type:definition.id,schemaVersion:1,schema},ui:{icon:()=>null,sections:[],create:()=>({...makeModule('distance'),extension:{type:definition.id,schemaVersion:1,enabled:true,config:{caption:'Test',gain:2},resources:{assets:[],shapes:[]}}})},runtime:{create:vi.fn(()=>({update:()=>{},dispose:()=>{}}))}};
}
it('installs builtin metadata, migrations, Studio UI and Runtime from coherent manifests',()=>{
 const environment=createStudioModuleEnvironment();expect(environment.runtime.all()).toHaveLength(5);expect(environment.ui.all()).toHaveLength(5);expect(environment.configurations.all()).toHaveLength(5);
 for(const manifest of environment.manifests.filter(item=>item.definition.kind==='visual')){expect(manifest.definition.schemaVersion).toBe(2);expect(manifest.configuration?.migrations).toHaveLength(1);expect(environment.available(manifest.definition.id)).toBe(true);}
});
it('publishes an installation once and rolls back every candidate registry on invalid additions',()=>{
 const host=new CompiledModuleHost('studio'),listener=vi.fn();host.subscribe(listener);const source=counter(),environment=host.install(source);expect(listener).toHaveBeenCalledTimes(1);expect(source.runtime!.create).not.toHaveBeenCalled();
 expect(()=>host.install({...counter(),definition:{...source.definition,id:'test.incomplete'},configuration:{...source.configuration!,type:'test.incomplete'},runtime:undefined})).toThrow('Incomplete');
 expect(host.getSnapshot()).toBe(environment);expect(listener).toHaveBeenCalledTimes(1);expect(environment.ui.all()).toHaveLength(1);
 expect(()=>host.install(source)).toThrow('Duplicate');expect(host.getSnapshot()).toBe(environment);
});
it('rejects a migration chain before publishing schemas or components',()=>{
 const host=new CompiledModuleHost('obs'),source=counter();host.install(source);const before=host.getSnapshot();
 expect(()=>host.install({...source,definition:{...source.definition,id:'test.invalid',schemaVersion:3},configuration:{...source.configuration!,type:'test.invalid',schemaVersion:3,migrations:[{from:1,to:2,source:z.object({}),recipe:{kind:'pick-config',fields:['caption']}}]}})).toThrow('Missing module migration');expect(host.getSnapshot()).toBe(before);
});
it('requires an actual compiled service adapter in addition to capability metadata',()=>{
 const host=new CompiledModuleHost('obs');const service={id:'test.input',schemaVersion:1,kind:'service',label:{key:'test:input',fallback:'Input'},description:{key:'test:description',fallback:'Input'},dependencies:[],capabilities:['test.input'],requires:[],settings:[],targets:['obs']} as const;
 expect(()=>host.install({definition:service,settings:[]})).toThrow('service adapter');expect(host.getSnapshot()).toBeUndefined();
});
it('resolves transitive implementation availability and keeps disabled state on additions',()=>{
 const host=new CompiledModuleHost('obs'),source=counter(),definition={id:'test.source',schemaVersion:1,kind:'service',label:{key:'test:source',fallback:'Source'},description:{key:'test:description',fallback:'Source'},dependencies:[],capabilities:['test.input'],requires:[],settings:[],targets:['obs']} as const;
 const environment=host.install({definition,settings:[],service:{read:()=>{}}},{...source,definition:{...source.definition,dependencies:['test.source'],requires:['test.input']}});
 environment.setEnabled('test.source',false);expect(environment.runtime.resolve('test.counter')).toBeUndefined();expect(environment.ui.all()).toHaveLength(0);expect(environment.available('test.counter')).toBe(false);
 const another=counter();const next=host.install({...another,definition:{...another.definition,id:'test.second',capabilities:[]},configuration:{...another.configuration!,type:'test.second'}});expect(next.available('test.counter')).toBe(false);next.setEnabled('test.source',true);expect(next.available('test.counter')).toBe(true);
});
it('does not expose mutable caller metadata or factories after installation',()=>{
 const source=counter(),host=new CompiledModuleHost('obs'),environment=host.install(source),original=environment.runtime.resolve('test.counter')!.factory.create;
 (source.definition as unknown as {dependencies:string[]}).dependencies=['missing.service'];source.runtime!.create=vi.fn();expect(environment.available('test.counter')).toBe(true);expect(environment.runtime.resolve('test.counter')!.factory.create).toBe(original);expect(Object.isFrozen(environment.manifests[0].definition)).toBe(true);
});
it('isolates observer failures after a successful installation',()=>{
 const host=new CompiledModuleHost('obs'),listener=vi.fn();host.subscribe(()=>{throw Error('observer');});host.subscribe(listener);expect(()=>host.install(counter())).not.toThrow();expect(listener).toHaveBeenCalledOnce();
});
it('installs an OBS package without importing or requiring editor components',()=>{const environment=createVisualModuleEnvironment();expect(environment.ui.all()).toHaveLength(0);expect(environment.runtime.all()).toHaveLength(5);});
it('connects a new manifest schema, migration and setting to the normal service without global registration',()=>{
 const source=counter(),schema=source.configuration!.schema;
 const setting={id:'test.counter.gain',schemaVersion:1,schema:z.number().min(1).max(4),binding:{scope:'module',store:'document',root:'module',path:['extension','config','gain']},ui:{control:'number',group:'test.counter'},label:{key:'test:gain',fallback:'Gain'},targets:['studio','obs'],apply:'live',defaultValue:()=>2} as const;
 const environment=new CompiledModuleHost('studio').install({...source,definition:{...source.definition,schemaVersion:2,configuration:schema,settings:[setting.id]},settings:[setting],configuration:{...source.configuration!,schemaVersion:2,migrations:[{from:1,to:2,source:z.strictObject({caption:z.string(),count:z.number()}),transform:value=>({config:{caption:value.config.caption,gain:value.config.count},resources:value.resources})}]}});
 const wire=encodeDocument(initialDocument());wire.profiles[0].modules.push({...encodeModule(makeModule('distance')),id:'manifest-counter',type:'test.counter',schemaVersion:1,config:{caption:'Legacy counter',count:2},resources:{assets:[],shapes:[]}});
 const transport:SettingsTransport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>true};
 const service=new SettingsService({load:()=>({document:parseDocument(JSON.stringify(wire)),warning:''}),save:()=>{},backup:initialDocument},transport,'manifest',new SettingsEvents(),environment.catalog,environment.configurations);
 try{const module=service.document.profiles[0].modules.at(-1)!;expect(module.extension).toMatchObject({schemaVersion:2,config:{caption:'Legacy counter',gain:2}});expect(environment.runtime.canRender(module)).toBe(true);service.set(setting.id,{scope:'module',profileId:service.document.activeProfileId,moduleId:module.id},3);expect(service.document.profiles[0].modules.at(-1)!.extension!.config.gain).toBe(3);expect(service.transaction(d=>{d.profiles[0].modules.at(-1)!.extension!.config.gain=99;})).toBe(false);expect(wire.profiles[0].modules.at(-1)!.schemaVersion).toBe(1);}finally{service.dispose();}
});
