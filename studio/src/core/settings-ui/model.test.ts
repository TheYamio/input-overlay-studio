import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { builtinCatalog } from '../architecture/builtins';
import { createCatalog, SettingsSchemaRegistry } from '../architecture/registry';
import type { SettingsAddress, SettingDefinition } from '../architecture/contracts';
import { initialDocument } from '../config';
import { SettingsService, type SettingsTransport } from '../settings/service';
import { controlConstraints, fieldModel, groupSettings, isInherited, optionTranslationKey } from './model';

const services:SettingsService[]=[];afterEach(()=>services.splice(0).forEach(service=>service.dispose()));
function fixture() {
  const doc=initialDocument(),transport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false} as SettingsTransport;
  const service=new SettingsService({load:()=>({document:doc,warning:''}),save:vi.fn(),backup:()=>doc},transport,'ws://test');services.push(service);
  const address:SettingsAddress={scope:'module',profileId:doc.profiles[0].id,moduleId:doc.profiles[0].modules[0].id};
  return {doc,service,address};
}
describe('schema UI model',()=>{
  it('discovers registered group fields without hardcoded UI IDs and respects module ownership',()=>{
    const {service,address,doc}=fixture();
    expect(groupSettings(builtinCatalog,service,'render.performance',{scope:'global'}).map(setting=>setting.id)).toEqual(['render.performance.fps','render.performance.quality','render.performance.glow-quality','render.performance.reduced-motion']);
    expect(groupSettings(builtinCatalog,service,'overlay.mouse',address)).toEqual([]);
    if(address.scope!=='module')throw Error('module');
    expect(groupSettings(builtinCatalog,service,'overlay.instance',{...address,element:{kind:'key',keyId:doc.profiles[0].modules[0].keys[0].id}})).toEqual([]);
    const definition=builtinCatalog.settings.get('render.performance.reduced-motion')!;
    const extended=createCatalog(builtinCatalog.modules.all(),[...builtinCatalog.settings.all(),{...definition,id:'render.performance.extra'}]);
    expect(groupSettings(extended,service,'render.performance',{scope:'global'}).at(-1)?.id).toBe('render.performance.extra');
  });
  it('derives bounds and enum values from the authoritative schema and caches them',()=>{
    const radius=builtinCatalog.settings.get('overlay.surface.radius')!,fps=builtinCatalog.settings.get('render.performance.fps')!;
    expect(controlConstraints(radius)).toMatchObject({minimum:0,maximum:100});expect(controlConstraints(radius)).toBe(controlConstraints(radius));expect(controlConstraints(fps).enum).toEqual(expect.arrayContaining(['Auto','30','60','120']));expect(fps.ui.firstOption).toBe('Auto');
  });
  it('uses explicit module/profile addresses without writing on observation',()=>{
    const {service,address}=fixture(),before=service.document;
    expect(fieldModel(builtinCatalog,service,'overlay.instance.name',address,new Set()).value).toBe('Keyboard');expect(service.document).toBe(before);expect(service.getSnapshot().version).toBe(0);
  });
  it('resolves conditional visibility from current settings',()=>{
    const {service,address}=fixture();
    service.set('overlay.animation.lighting',address,'Fill');expect(fieldModel(builtinCatalog,service,'overlay.animation.secondary-color',address,new Set()).visible).toBe(false);
    service.set('overlay.animation.lighting',address,'Gradient');expect(fieldModel(builtinCatalog,service,'overlay.animation.secondary-color',address,new Set()).visible).toBe(true);
  });
  it('disables radius with a reason when a custom shape is selected',()=>{
    const {service,address}=fixture();expect(fieldModel(builtinCatalog,service,'overlay.surface.radius',address,new Set()).enabled).toBe(true);
    const reader={read:(id:string)=>id==='overlay.appearance.shape'?'test':12} as unknown as SettingsService;
    const model=fieldModel(builtinCatalog,reader,'overlay.surface.radius',address,new Set());expect(model.enabled).toBe(false);expect(model.definition.disabledReason?.fallback).toContain('custom button shape');
  });
  it('keeps inheritance/reset tied to IDs after labels change and restores module values',()=>{
    const {service,address,doc}=fixture();if(address.scope!=='module')throw Error('module');
    const key:SettingsAddress={...address,element:{kind:'key',keyId:doc.profiles[0].modules[0].keys[0].id}};
    expect(isInherited(service,builtinCatalog,'overlay.surface.accent',key)).toBe(true);service.set('overlay.surface.accent',key,'#123456');expect(isInherited(service,builtinCatalog,'overlay.surface.accent',key)).toBe(false);
    service.reset('overlay.surface.accent',key);expect(isInherited(service,builtinCatalog,'overlay.surface.accent',key)).toBe(true);expect(service.read('overlay.surface.accent',key)).toBe(service.read('overlay.surface.accent',address));
  });
  it('evaluates known capabilities and fails registration for unknown ones',()=>{
    const original=builtinCatalog.settings.get('overlay.instance.opacity')!,definition:SettingDefinition={...original,enabledWhen:[{capability:'render.scene',test:'available'}]};
    const catalog=createCatalog(builtinCatalog.modules.all(),builtinCatalog.settings.all().map(setting=>setting.id===definition.id?definition:setting));const {service,address}=fixture();
    expect(fieldModel(catalog,service,definition.id,address,new Set()).enabled).toBe(false);expect(fieldModel(catalog,service,definition.id,address,new Set(['render.scene'])).enabled).toBe(true);
    expect(()=>createCatalog([],[{...definition,enabledWhen:[{capability:'missing.feature',test:'available'}]}])).toThrow('missing-capability');
  });
  it('validates declarative steps and capability operators without evaluating code',()=>{
    const definition=builtinCatalog.settings.get('overlay.instance.opacity')!;
    expect(()=>new SettingsSchemaRegistry().register({...definition,ui:{...definition.ui,step:0}})).toThrow('Invalid interaction step');
    expect(()=>new SettingsSchemaRegistry().register({...definition,enabledWhen:[{capability:'render.scene',test:'eval' as 'available'}]})).toThrow('Invalid capability condition');
    expect(()=>new SettingsSchemaRegistry().register({...definition,schema:z.number(),visibleWhen:[{setting:'missing.setting',test:'defined'}]})).toThrow('missing-dependency');
  });
  it('option translation keys use enum values, not translated labels or order',()=>{
    expect(optionTranslationKey('render.performance.fps','Auto')).toBe('settings:render.performance.fps.option.41-75-74-6f');expect(optionTranslationKey('render.performance.fps','30')).not.toBe(optionTranslationKey('render.performance.fps','60'));
  });
});
