import { describe, expect, it, vi } from 'vitest';
import * as config from '../config';
import { appearanceSchema, imageSettingsSchema, trailAppearanceSchema } from '../visual';
import { builtinCatalog, createBuiltinCatalog, createBuiltinDefinitions, createBuiltinModule, builtinVisualModules } from './builtins';
import { SettingsSchemaRegistry, settingConstraints } from './registry';
import type { DefinitionId } from './contracts';

describe('legacy built-in adapters', () => {
  it('discovers the existing five visual modules in their original order', () => {
    expect(builtinVisualModules.map(m=>m.type)).toEqual(['keyboard','mouse','trail','distance','sensitivity']);
    expect(builtinVisualModules.map(m=>m.definition.label.fallback)).toEqual(['Keyboard','Mouse Buttons','Mouse Trail','Distance','Sensitivity']);
    expect(builtinCatalog.modules.all()).toHaveLength(9);
    expect(builtinCatalog.modules.all().filter(m=>m.kind==='visual').every(m=>m.configuration===config.moduleSchema)).toBe(true);
  });
  it('builds registries without creating instances or documents', () => {
    const factory=vi.spyOn(config,'makeModule'), initial=vi.spyOn(config,'initialDocument');
    try { createBuiltinCatalog(); expect(factory).not.toHaveBeenCalled(); expect(initial).not.toHaveBeenCalled(); }
    finally { factory.mockRestore(); initial.mockRestore(); }
  });
  it('creates instances through the unchanged factory, keeping placement and per-type defaults', () => {
    for (const {type,definition} of builtinVisualModules) {
      const before=config.makeModule(type,3), after=createBuiltinModule(type,3);
      expect({...after,id:before.id}).toEqual(before); expect(after.id).not.toBe(before.id);
      expect(definition.builtinType).toBe(type); expect(config.moduleSchema.safeParse(after).success).toBe(true);
    }
    expect(()=>createBuiltinModule('missing' as config.OverlayModule['type'])).toThrow('Unregistered');
  });
  it('describes every editable v2 module field without registering identity as a setting', () => {
    const settings=builtinCatalog.settings.all().filter(s=>s.binding.scope==='module');
    const leaves=new Set(settings.map(s=>s.binding.path.join('.')));
    for (const field of Object.keys(config.moduleSchema.shape)) {
      if (field==='id'||field==='type'||field==='extension') { expect(leaves.has(field)).toBe(false); continue; }
      const nested={appearance:appearanceSchema.shape,image:imageSettingsSchema.shape,trailAppearance:trailAppearanceSchema.shape}[field as 'appearance'|'image'|'trailAppearance'];
      if (nested) for (const child of Object.keys(nested)) expect(leaves.has(`${field}.${child}`),`${field}.${child}`).toBe(true);
      else expect(leaves.has(field),field).toBe(true);
    }
    expect(new Set(settings.map(s=>s.id)).size).toBe(settings.length);
  });
  it('references authoritative schemas and optional legacy defaults', () => {
    const press=builtinCatalog.settings.get('overlay.animation.press-delay')!;
    expect(press.binding.path).toEqual(['appearance','pressDelay']); expect(press.schema).toBe(appearanceSchema.shape.pressDelay);
    expect(settingConstraints(press)).toMatchObject({type:'number',minimum:0,maximum:1000});
    const registry=new SettingsSchemaRegistry().register(...builtinCatalog.settings.all());
    expect(registry.readDefault(press.id,{moduleType:'keyboard'})).toBeUndefined();
    expect(registry.readDefault('overlay.mouse.wheel-duration',{moduleType:'mouse'})).toBe(110);
  });
  it('validates every lazy default against its current schema', () => {
    const {settings}=createBuiltinDefinitions(), registry=new SettingsSchemaRegistry().register(...settings);
    for (const descriptor of settings) {
      if (descriptor.binding.scope==='module') {
        for (const module of builtinCatalog.modules.all().filter(m=>m.settings.includes(descriptor.id))) {
          expect(()=>registry.readDefault(descriptor.id,{moduleType:module.builtinType})).not.toThrow();
        }
      } else expect(()=>registry.readDefault(descriptor.id)).not.toThrow();
    }
  });
  it('keeps key/button inheritance explicit and independent', () => {
    expect(builtinCatalog.settings.get('overlay.animation.press-delay')!.binding.overrides).toEqual({key:['style','pressDelay'],mouseButton:['pressDelay']});
    expect(builtinCatalog.settings.get('overlay.surface.accent')!.binding.overrides).toEqual({key:['style','accent'],mouseButton:['accent']});
    expect(builtinCatalog.settings.get('profiles.game.dpi')!.binding.overrides).toBeUndefined();
    expect(builtinCatalog.settings.get('overlay.instance.x')!.binding.overrides).toBeUndefined();
  });

  it('separates game and overlay ownership without inventing profile inheritance', () => {
    expect(builtinCatalog.settings.get('profiles.game.dpi')!.binding).toEqual({scope:'game-profile',store:'document',root:'profile',path:['dpi']});
    expect(builtinCatalog.settings.get('profiles.overlay.theme')!.binding).toEqual({scope:'overlay-profile',store:'document',root:'profile',path:['theme']});
    expect(builtinCatalog.settings.get('render.performance.fps')!.binding).toEqual({scope:'global',store:'document',root:'document',path:['performance','fps']});
  });
  it('uses stable references for specialized controls and conditional parameters', () => {
    expect(builtinCatalog.settings.get('overlay.keyboard.keys')!.ui.component).toBe('editor.key-layout');
    expect(builtinCatalog.settings.get('overlay.animation.secondary-color')!.visibleWhen).toEqual([{setting:'overlay.animation.lighting',test:'equals',value:'Gradient'}]);
    const allIds=new Set(builtinCatalog.settings.all().map(s=>s.id));
    for (const module of builtinCatalog.modules.all()) for (const id of module.settings) expect(allIds.has(id)).toBe(true);
    const owned=new Set(builtinCatalog.modules.all().flatMap(m=>[...m.settings]));
    expect([...allIds].filter(id=>!owned.has(id as DefinitionId))).toEqual([]);
  });
  it('describes native distance consumers and the real restart boundary', () => {
    for (const id of ['profiles.game.dpi','studio.document.active-profile','capture.distance.persist','capture.distance.reset-on-start'] as const) expect(builtinCatalog.settings.get(id)!.targets).toContain('native');
    expect(builtinCatalog.settings.get('capture.distance.reset-on-start')!.apply).toBe('restart');
    expect(builtinCatalog.settings.get('profiles.game.dpi')!.apply).toBe('live');
  });
});
