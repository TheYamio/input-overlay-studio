import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { scopes, defineSetting, type DefinitionId, type ModuleDefinition, type SettingDefinition } from './contracts';
import { conditionsMatch, createCatalog, ModuleRegistry, SettingsSchemaRegistry, settingConstraints } from './registry';

const module = (id: DefinitionId, dependencies: DefinitionId[] = []): ModuleDefinition => ({
  id, schemaVersion:1, kind:'service', label:{key:`modules:${id}.label`,fallback:id}, description:{key:`modules:${id}.description`,fallback:'Internal test service'}, dependencies, capabilities:[], requires:[], settings:[], targets:['studio'],
});
const setting = (id: DefinitionId, dependencies: DefinitionId[] = []): SettingDefinition => ({
  id, schemaVersion:1, schema:z.number().min(0).max(10), binding:{scope:'module',store:'document',root:'module',path:['value']},
  label:{key:`settings:${id}.label`,fallback:'Value'}, ui:{control:'number',group:'test.group'}, targets:['studio'], apply:'live', dependencies, defaultValue:()=>5,
});

describe('module registry contracts', () => {
  it('rejects duplicate IDs atomically, including duplicates in the same batch', () => {
    const registry = new ModuleRegistry().register(module('test.first'));
    expect(() => registry.register(module('test.second'), module('test.first'))).toThrow('duplicate-id');
    expect(registry.all().map(m => m.id)).toEqual(['test.first']);
    expect(() => new ModuleRegistry().register(module('test.a'),module('test.a'))).toThrow('duplicate-id');
  });
  it('accepts forward declarations within one batch and orders dependencies first', () => {
    const registry = new ModuleRegistry().register(module('test.a',['test.b']),module('test.b',['test.c']),module('test.c'));
    expect(registry.all().map(m => m.id)).toEqual(['test.a','test.b','test.c']);
    expect(registry.ordered().map(m => m.id)).toEqual(['test.c','test.b','test.a']);
  });
  it('rejects missing dependencies without retaining the rejected registration', () => {
    const registry = new ModuleRegistry();
    expect(() => registry.register(module('test.a',['test.missing']))).toThrow('missing-dependency');
    expect(registry.all()).toEqual([]);
    registry.register(module('test.a')); expect(registry.all()).toHaveLength(1);
  });
  it('rejects self-dependencies and cycles with their path', () => {
    expect(() => new ModuleRegistry().register(module('test.a',['test.a']))).toThrow('test.a → test.a');
    expect(() => new ModuleRegistry().register(module('test.a',['test.b']),module('test.b',['test.c']),module('test.c',['test.a']))).toThrow('dependency-cycle');
  });
  it('rejects labels as IDs, invalid versions and incomplete visual definitions', () => {
    expect(() => new ModuleRegistry().register({...module('test.a'),id:'Keyboard' as DefinitionId})).toThrow('invalid-id');
    expect(() => new ModuleRegistry().register({...module('test.a'),schemaVersion:0})).toThrow('schemaVersion');
    expect(() => new ModuleRegistry().register({...module('test.a'),kind:'visual'})).toThrow('Visual schema');
  });
  it('freezes copied metadata without freezing or invoking configuration logic', () => {
    const refine = vi.fn(()=>true), schema=z.object({value:z.number()}).refine(refine);
    const definition={...module('test.a'),configuration:schema}, registry=new ModuleRegistry().register(definition);
    (definition.dependencies as DefinitionId[]).push('test.later');
    expect(registry.get('test.a')!.dependencies).toEqual([]);
    expect(registry.get('test.a')!.configuration).toBe(schema); expect(refine).not.toHaveBeenCalled();
    expect(()=>{ (registry.all() as ModuleDefinition[]).push(module('test.b')); }).toThrow();
    expect((registry.view() as unknown as {register?:unknown}).register).toBeUndefined();
  });
});

describe('settings schema registry', () => {
  it('rejects duplicate IDs, unresolved references and cycles atomically', () => {
    const registry=new SettingsSchemaRegistry().register(setting('test.a'));
    expect(()=>registry.register(setting('test.b'),setting('test.a'))).toThrow('duplicate-id');
    expect(()=>registry.register(setting('test.b',['test.missing']))).toThrow('missing-dependency');
    expect(()=>registry.register(setting('test.b',['test.c']),setting('test.c',['test.b']))).toThrow('dependency-cycle');
    expect(registry.all().map(s=>s.id)).toEqual(['test.a']);
  });
  it('treats visibility and enabled conditions as dependencies and rejects their cycles', () => {
    expect(()=>new SettingsSchemaRegistry().register(
      {...setting('test.a'),visibleWhen:[{setting:'test.b',test:'equals',value:1}]},
      {...setting('test.b'),enabledWhen:[{setting:'test.a',test:'defined'}]},
    )).toThrow('dependency-cycle');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),enabledWhen:[{setting:'test.absent',test:'defined'}]})).toThrow('missing-dependency');
  });
  it('checks condition types, scopes, targets and scalar equality', () => {
    const dependent=setting('test.b'), rule={setting:'test.a',test:'equals',value:'wrong'} as const;
    expect(()=>new SettingsSchemaRegistry().register(setting('test.a'),{...dependent,visibleWhen:[rule]})).toThrow('invalid-condition');
    const crossScope={...setting('test.a'),binding:{scope:'global',store:'preferences',root:'preferences',path:['a']}} as const;
    expect(()=>new SettingsSchemaRegistry().register(crossScope,{...dependent,visibleWhen:[{...rule,value:1}]})).toThrow('Cross-scope');
    expect(()=>new SettingsSchemaRegistry().register(setting('test.a'),{...dependent,targets:['studio','obs'],visibleWhen:[{...rule,value:1}]})).toThrow('unavailable');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),schema:z.object({value:z.number()}),ui:{control:'custom',component:'test.control',group:'test.group'}},{...dependent,visibleWhen:[{...rule,value:{value:1}} as unknown as NonNullable<SettingDefinition['visibleWhen']>[number]]})).toThrow('scalar');
  });
  it('evaluates only the explicit snapshot and fails closed on a missing dependency', () => {
    const rules=[{setting:'test.a',test:'equals',value:1},{setting:'test.b',test:'not-equals',value:false}] as const;
    expect(conditionsMatch(rules,new Map<DefinitionId,unknown>([['test.a',1],['test.b',true]]))).toBe(true);
    expect(conditionsMatch(rules,new Map([['test.a',1]]))).toBe(false);
    expect(conditionsMatch([{setting:'test.a',test:'defined'}],new Map([['test.a',undefined]]))).toBe(false);
  });
  it('keeps defaults lazy, validates on request and returns independent data', () => {
    const defaults=vi.fn(()=>({items:[1]})), definition={...setting('test.a'),schema:z.object({items:z.array(z.number())}),ui:{control:'custom',component:'test.control',group:'test.group'} as const,defaultValue:defaults};
    const registry=new SettingsSchemaRegistry().register(definition);
    expect(defaults).not.toHaveBeenCalled();
    const first=registry.readDefault('test.a') as {items:number[]}; first.items.push(2);
    expect(registry.readDefault('test.a')).toEqual({items:[1]});
    const bad=new SettingsSchemaRegistry().register({...setting('test.b'),defaultValue:()=>100});
    expect(()=>bad.readDefault('test.b')).toThrow('invalid-default');
    expect(()=>bad.readDefault('test.missing')).toThrow('missing-setting');
  });
  it('derives numeric bounds and options from the existing schema', () => {
    const schema=z.number().int().min(20).max(90).optional(), definition={...setting('test.a'),schema};
    const registry=new SettingsSchemaRegistry().register(definition);
    expect(registry.get('test.a')!.schema).toBe(schema);
    expect(settingConstraints(definition)).toMatchObject({type:'integer',minimum:20,maximum:90});
    expect(settingConstraints({...definition,schema:z.enum(['A','B']),ui:{control:'select',group:'test.group'}})).toMatchObject({enum:['A','B']});
  });
  it('rejects incompatible controls, missing specialized components and invalid store paths', () => {
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),ui:{control:'checkbox',group:'test.group'}})).toThrow('incompatible');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),ui:{control:'custom',group:'test.group'}})).toThrow('Specialized');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),binding:{scope:'runtime',root:'runtime',store:'document',path:['distance']}})).toThrow('Store');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),binding:{scope:'constructor' as 'runtime',root:'runtime',store:'transient',path:['distance']}})).toThrow('Unknown configuration scope');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),binding:{scope:'global',root:'document',store:'preferences',path:['value']}})).toThrow('binding');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),binding:{scope:'module',root:'module',store:'document',path:['__proto__']}})).toThrow('binding');
    expect(()=>new SettingsSchemaRegistry().register({...setting('test.a'),binding:{scope:'global',root:'document',store:'document',path:['value'],overrides:{key:['style'],mouseButton:['value']}}})).toThrow('inheritance');
  });
  it('keeps definition IDs independent of translated labels and storage names', () => {
    const a=setting('test.stable-id'), b={...a,label:{key:'settings:test.renamed.label',fallback:'Other language label'} as const,binding:{...a.binding,path:['renamedLegacyField']}};
    expect(new SettingsSchemaRegistry().register(b).get(a.id)!.id).toBe('test.stable-id');
  });
  it('keeps six scopes explicit, runtime transient, and profile inheritance disabled', () => {
    expect(Object.keys(scopes)).toHaveLength(6);
    expect(scopes.runtime.stores).toEqual(['transient']);
    expect(scopes['game-profile'].inheritance).toBe('none'); expect(scopes['overlay-profile'].inheritance).toBe('none');
    expect(scopes.module.inheritance).toBe('module-to-element'); expect(Object.isFrozen(scopes.module.stores)).toBe(true);
  });
  it('offers schema-typed definition helpers', () => {
    const typed=defineSetting({...setting('test.a'),schema:z.number(),defaultValue:()=>2});
    expect(typed.defaultValue({})).toBe(2);
    // @ts-expect-error Number schemas cannot declare string defaults.
    defineSetting({...setting('test.b'),schema:z.number(),defaultValue:()=>'wrong'});
  });
});

describe('catalog cross references', () => {
  it('validates one-of scalar conditions before registering a whole batch',()=>{
    const source={...setting('test.mode'),schema:z.enum(['Press','Lift','Scale']),ui:{control:'select' as const,group:'test.group' as const},defaultValue:()=> 'Press'};
    const dependent={...setting('test.travel'),visibleWhen:[{setting:'test.mode' as const,test:'one-of' as const,values:['Press','Lift']}]};
    expect(()=>new SettingsSchemaRegistry().register(source,dependent)).not.toThrow();
    expect(conditionsMatch(dependent.visibleWhen,new Map([['test.mode','Lift']]))).toBe(true);expect(conditionsMatch(dependent.visibleWhen,new Map([['test.mode','Scale']]))).toBe(false);
    for(const values of [[],['Unknown'],[1],[{}]])expect(()=>new SettingsSchemaRegistry().register(source,{...dependent,visibleWhen:[{setting:'test.mode',test:'one-of',values:values as string[]}]})).toThrow('invalid-condition');
  });
  it('rejects invalid presentation sections and field order without changing bindings',()=>{
    const value=setting('test.value');expect(()=>new SettingsSchemaRegistry().register({...value,ui:{...value.ui,section:'invalid' as never}})).toThrow('invalid-id');expect(()=>new SettingsSchemaRegistry().register({...value,ui:{...value.ui,order:NaN}})).toThrow('Invalid field order');
  });
  it('rejects unresolved settings, missing capabilities and ambiguous legacy adapters', () => {
    expect(()=>createCatalog([{...module('test.a'),settings:['test.missing']}],[])).toThrow('missing-setting');
    expect(()=>createCatalog([{...module('test.a'),requires:['test.missing']}],[])).toThrow('missing-capability');
    expect(()=>createCatalog([{...module('test.a'),builtinType:'keyboard'},{...module('test.b'),builtinType:'keyboard'}],[])).toThrow('duplicate-builtin-type');
  });
  it('discovers an internal extension by registration without activating it', () => {
    const defaults=vi.fn(()=>5), descriptor={...module('test.extension'),capabilities:['test.capability'] as const,settings:['test.value'] as const};
    const catalog=createCatalog([descriptor],[{...setting('test.value'),defaultValue:defaults}]);
    expect(catalog.modules.get('test.extension')!.settings).toEqual(['test.value']);
    expect(catalog.settings.get('test.value')!.ui.control).toBe('number');
    expect(defaults).not.toHaveBeenCalled();
    expect(catalog.settings.readDefault('test.value')).toBe(5);
    expect((catalog.settings as unknown as {register?:unknown}).register).toBeUndefined();
  });
});
