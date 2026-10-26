import {it,expect} from 'vitest';
import {z} from 'zod';
import {builtinCatalog} from '../architecture/builtins';
import {readFileSync} from 'node:fs';
import {initialDocument,parseDocument,encodeDocument} from '../config';
import {moduleConfigurations,decodeModule,encodeModule} from '../module-format';
import {ModuleConfigurationRegistry} from '../module-envelope';
import {builtinConfigFields} from './fields';
import {legacyBuiltinConfiguration} from './legacy-v1';
import frozenV1 from './legacy-v1.schema.json';
import {pruneAssets} from '../skins';
import {exportPreset,importPreset} from '../presets';
const cases=JSON.parse(readFileSync(new URL('../../../../ws-server/src-tauri/test-fixtures/module-migrations.json',import.meta.url),'utf8')) as {type:keyof typeof builtinConfigFields;legacy:ReturnType<typeof encodeDocument>;current:ReturnType<typeof encodeDocument>}[];
it.each(cases)('$type migrates, exports/imports and retains unknown resources without changing identity',item=>{
 const before=JSON.stringify(item.legacy),view=parseDocument(before),wire=encodeDocument(view),module=wire.profiles[0].modules[0];
 expect(wire).toEqual(item.current);expect(module.schemaVersion).toBe(2);expect(Object.keys(module.config).sort()).toEqual([...builtinConfigFields[item.type]].filter(key=>Object.hasOwn(module.config,key)).sort());expect(module.id).toBe(item.legacy.profiles[0].modules[0].id);expect(module.common).toEqual(item.legacy.profiles[0].modules[0].common);expect(module.resources).toEqual(item.legacy.profiles[0].modules[0].resources);expect(wire.profiles[0].modules[1]).toEqual(item.legacy.profiles[0].modules[1]);
 pruneAssets(view);expect(Object.keys(view.assets)).toEqual(Object.keys(item.legacy.assets));expect(Object.keys(view.shapes).sort()).toEqual(Object.keys(item.legacy.shapes).sort());
 view.presets=[{id:'migrated-layout',name:'Migrated',theme:view.profiles[0].theme,modules:view.profiles[0].modules}];const text=exportPreset(view,'migrated-layout'),imported=importPreset(text,initialDocument());expect(imported.assets).toEqual(view.assets);expect(imported.shapes).toEqual(view.shapes);expect({...encodeModule(imported.preset.modules[0]),id:module.id}).toEqual(module);expect(imported.preset.modules[0].id).not.toBe(module.id);expect(JSON.stringify(item.legacy)).toBe(before);
});
it('preserves authored edits and retained resources on disabled migrated builtins',()=>{
 const item=cases.find(item=>item.type==='keyboard')!,source={...item.legacy.profiles[0].modules[0],enabled:false};const module=decodeModule(source,id=>({...initialDocument().profiles[0].modules[0],id}));module.keys[0].label='Edited';const wire=encodeModule(module);expect(wire.enabled).toBe(false);expect((wire.config.keys as {label:string}[])[0].label).toBe('Edited');expect(wire.resources.shapes).toContain('retained-shape');
});
it('rejects missing steps, async transformations and invalid results without changing input',()=>{
 const registry=new ModuleConfigurationRegistry(),schema=z.strictObject({count:z.number()}),source={type:'test.chain',schemaVersion:1,enabled:false,config:{count:1},resources:{assets:['unknown'],shapes:[]}};
 expect(()=>registry.register({type:source.type,schemaVersion:3,schema,migrations:[{from:1,to:2,source:schema,transform:value=>value}]})).toThrow('Missing');expect(registry.all()).toHaveLength(0);
 registry.register({type:source.type,schemaVersion:2,schema,migrations:[{from:1,to:2,source:schema,transform:()=>({config:{count:'invalid'},resources:{assets:[],shapes:[]}})}]});const before=structuredClone(source);expect(()=>registry.migrate(source)).toThrow();expect(source).toEqual(before);
});
it('preserves unknown resources and enable state across a compiled config/resources transform',()=>{
 const registry=new ModuleConfigurationRegistry(),schema=z.strictObject({value:z.number()});registry.register({type:'test.transform',schemaVersion:2,schema,migrations:[{from:1,to:2,source:z.strictObject({count:z.number()}),transform:input=>({config:{value:input.config.count},resources:{assets:[],shapes:['new-shape']}})}]});
 const source={type:'test.transform',schemaVersion:1,enabled:false,config:{count:4},resources:{assets:['unknown'],shapes:['old-shape']}};const result=registry.migrate(source);expect(result.value).toEqual({...source,schemaVersion:2,config:{value:4},resources:{assets:['unknown'],shapes:['old-shape','new-shape']}});expect(result.changed).toBe(true);expect(source.schemaVersion).toBe(1);
});
it('never executes migrations for absent or future module versions',()=>{
 const source={type:'overlay.keyboard',schemaVersion:99,enabled:true,config:{future:true},resources:{assets:[],shapes:[]}};expect(moduleConfigurations.migrate(source)).toMatchObject({value:source,changed:false,status:'unsupported'});
});
it('uses frozen v1 appearance defaults rather than the current factory defaults',()=>{
 const item=cases.find(item=>item.type==='distance')!,{id:_,common:__,...source}=structuredClone(item.legacy.profiles[0].modules[0]);delete source.config.appearance;
 expect(legacyBuiltinConfiguration.parse(source.config)).toMatchObject({appearance:frozenV1.properties.appearance.default});expect(moduleConfigurations.migrate(source).value.config.appearance).toEqual(frozenV1.properties.appearance.default);
});
it('rejects asynchronous migration output without publishing a partial result',()=>{
 const registry=new ModuleConfigurationRegistry(),schema=z.strictObject({count:z.number()});registry.register({type:'test.async',schemaVersion:2,schema,migrations:[{from:1,to:2,source:schema,transform:(()=>Promise.resolve({config:{count:2},resources:{assets:[],shapes:[]}})) as unknown as NonNullable<import('../module-envelope').ModuleMigration['transform']>}]});
 expect(()=>registry.migrate({type:'test.async',schemaVersion:1,enabled:true,config:{count:1},resources:{assets:[],shapes:[]}})).toThrow('synchronous');
});
it('applies current defaults without stripping unknown nested data from a non-strict compiled schema',()=>{
 const registry=new ModuleConfigurationRegistry();registry.register({type:'test.defaults',schemaVersion:1,schema:z.object({nested:z.object({gain:z.number().default(2)})})});
 const source={type:'test.defaults',schemaVersion:1,enabled:false,config:{nested:{unknown:'keep'},rootUnknown:true},resources:{assets:[],shapes:[]}};const result=registry.migrate(source);expect(result.value.config).toEqual({nested:{gain:2,unknown:'keep'},rootUnknown:true});expect(result.value.enabled).toBe(false);expect(source.config.nested).toEqual({unknown:'keep'});
});

it.each(cases)('$type resets declared settings on a migrated module with retained resources',item=>{
 const view=parseDocument(JSON.stringify(item.legacy)),module=view.profiles[0].modules[0];expect(module.extension).toBeDefined();
 expect(builtinCatalog.settings.readDefault('overlay.surface.radius',{moduleType:module.extension!.type})).toBe(12);
});
