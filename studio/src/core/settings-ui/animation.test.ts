import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialDocument, type StudioDocument } from '../config';
import { animationSettings } from '../animation';
import { effects, type ElementStyle } from '../visual';
import { builtinCatalog, createBuiltinDefinitions } from '../architecture/builtins';
import { animationGroup } from '../architecture/animation';
import { SettingsSchemaRegistry } from '../architecture/registry';
import { SettingsService, type SettingsTransport } from '../settings/service';
import { animationRead, animationStyle, animationWrite, type AnimationAddress } from './animation';
import { fieldModel } from './model';

const services:SettingsService[]=[];afterEach(()=>services.splice(0).forEach(service=>service.dispose()));
function fixture(effect:typeof effects[number]='Soft Press') {
  const doc=initialDocument();doc.profiles[0].modules[0].effect=effect;
  const save=vi.fn(),transport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false} as SettingsTransport;
  const service=new SettingsService({load:()=>({document:doc,warning:''}),save,backup:()=>doc},transport,'ws://isolated');services.push(service);
  const address:AnimationAddress={scope:'module',profileId:doc.activeProfileId,moduleId:doc.profiles[0].modules[0].id};
  const read=(id:Parameters<typeof builtinCatalog.settings.get>[0],target=address)=>animationRead(service,builtinCatalog.settings.get(id)!,target);
  const write=(id:Parameters<typeof builtinCatalog.settings.get>[0],value:unknown,target=address)=>animationWrite(service,builtinCatalog.settings.get(id)!,target,value);
  return {doc,service,save,address,read,write};
}
function patchStyle(doc:StudioDocument,address:AnimationAddress,patch:ElementStyle) {
  const module=doc.profiles[0].modules.find(module=>module.id===address.moduleId)!;
  if(address.element?.kind==='key'){const id=address.element.keyId,key=module.keys.find(key=>key.id===id)!;key.style={...key.style,...patch};}
  else if(address.element){const button=address.element.button;module.buttonStyles[button]={...module.buttonStyles[button],...patch};}
  else {const {effect,...appearance}=patch;if(effect!==undefined)module.effect=effect;Object.assign(module.appearance,appearance);}
}
describe('animation schema presentation without a data migration',()=>{
  it.each(effects)('reads legacy %s using production fallback without materializing optional values',effect=>{
    const f=fixture(effect),before=JSON.stringify(f.service.document),a=animationSettings(animationStyle(f.service.document,f.address));
    expect(f.read('overlay.animation.motion')).toBe(a.motion);expect(f.read('overlay.animation.lighting')).toBe(a.lighting);expect(f.read('overlay.animation.press-duration')).toBe(a.pressMs);expect(f.read('overlay.animation.release-duration')).toBe(a.releaseMs);
    expect(f.read('overlay.animation.secondary-color')).toBe(a.secondaryColor);expect(f.read('overlay.animation.motion-scale')).toBe(a.motionScale);
    for(const definition of builtinCatalog.settings.all().filter(setting=>setting.ui.group===animationGroup))expect(()=>fieldModel(builtinCatalog,f.service,definition.id,f.address,new Set(),{read:animationRead})).not.toThrow();
    expect(JSON.stringify(f.service.document)).toBe(before);expect(f.service.getSnapshot().version).toBe(0);expect(f.save).not.toHaveBeenCalled();
  });
  it.each(effects)('applies %s quick preset exactly like the previous panel in one atomic undo',effect=>{
    const f=fixture(),expected=structuredClone(f.doc),preset=animationSettings({effect});
    patchStyle(expected,f.address,{effect,motion:preset.motion,lighting:preset.lighting,easing:'Ease out',pressDelay:0,releaseDelay:0,lightingOpacity:1,pressDuration:effect==='Instant'?0:90,releaseDuration:effect==='Instant'?0:140});
    expect(f.write('overlay.surface.effect-preset',effect)).toBe(true);expect(f.service.document).toEqual(expected);expect(f.save).toHaveBeenCalledTimes(1);f.service.undo();expect(f.service.document).toEqual(f.doc);expect(f.service.getSnapshot().canUndo).toBe(false);
  });
  it('keeps duration, effective motion and lighting atomic across a whole numeric gesture',()=>{
    const f=fixture('Instant'),before=f.service.document,events:string[]=[];f.service.subscribeChanges('module',event=>events.push(event.operationId));f.service.beginGesture('duration');
    for(const value of [1,12,123])f.write('overlay.animation.press-duration',value);
    f.service.endGesture();expect(new Set(events).size).toBe(1);expect(f.service.document.profiles[0].modules[0].appearance).toMatchObject({pressDuration:123,motion:'None',lighting:'Fill'});
    f.service.undo();expect(f.service.document).toEqual(before);expect(f.service.getSnapshot().canUndo).toBe(false);
  });
  it('rejects a failed compound duration without partial overrides or persistence',()=>{
    const f=fixture('Instant'),before=f.service.document;expect(()=>f.write('overlay.animation.press-duration',501)).toThrow('Invalid value');expect(f.service.document).toBe(before);expect(f.save).not.toHaveBeenCalled();
  });
  it('inherits effective key values, writes only requested overrides, resets by ID and tracks the module',()=>{
    const f=fixture('Glow'),key:AnimationAddress={...f.address,element:{kind:'key',keyId:f.doc.profiles[0].modules[0].keys[0].id}};
    expect(f.read('overlay.animation.lighting',key)).toBe('Fill + glow');f.write('overlay.animation.press-delay',150,key);expect(f.service.document.profiles[0].modules[0].keys[0].style).toEqual({pressDelay:150});
    f.service.reset('overlay.animation.press-delay',key);expect(f.service.document.profiles[0].modules[0].keys[0].style).toEqual({});f.write('overlay.animation.press-delay',220);expect(f.read('overlay.animation.press-delay',key)).toBe(220);
  });
  it('keeps explicit key effects and optional modern values independent from siblings',()=>{
    const f=fixture('Glow'),key:AnimationAddress={...f.address,element:{kind:'key',keyId:f.doc.profiles[0].modules[0].keys[0].id}};
    f.write('overlay.surface.effect-preset','Instant',key);expect(f.read('overlay.animation.motion',key)).toBe('None');expect(f.read('overlay.animation.press-duration',key)).toBe(0);expect(f.read('overlay.animation.motion')).toBe('Press');
    expect(f.service.document.profiles[0].modules[0].keys[1].style?.motion).toBeUndefined();
  });
  it('edits and resets hidden mouse buttons without making them visible',()=>{
    const f=fixture(),mouse=f.doc.profiles[0].modules.find(module=>module.type==='mouse')!;
    f.service.transaction(doc=>{doc.profiles[0].modules.find(module=>module.id===mouse.id)!.buttons=[1];});
    const address:AnimationAddress={...f.address,moduleId:mouse.id,element:{kind:'mouse-button',button:7}};
    f.write('overlay.animation.release-delay',333,address);expect(f.read('overlay.animation.release-delay',address)).toBe(333);expect(f.service.document.profiles[0].modules.find(module=>module.id===mouse.id)!.buttons).toEqual([1]);
    f.service.reset('overlay.animation.release-delay',address);expect(f.read('overlay.animation.release-delay',address)).toBe(0);
    expect(()=>f.write('overlay.animation.press-delay',1,{...address,element:{kind:'mouse-button',button:8}})).toThrow('does not exist');
  });
  it('uses effective legacy conditions for travel, glow, gradient and light intensity',()=>{
    const f=fixture('Glow'),adapter={read:animationRead},model=(id:Parameters<typeof f.read>[0])=>fieldModel(builtinCatalog,f.service,id,f.address,new Set(),adapter);
    expect(model('overlay.animation.press-travel').visible).toBe(true);expect(model('overlay.animation.glow-strength').visible).toBe(true);expect(model('overlay.animation.secondary-color').visible).toBe(false);
    f.write('overlay.animation.motion','Scale');expect(model('overlay.animation.press-travel').visible).toBe(false);expect(model('overlay.animation.motion-scale').visible).toBe(true);
    f.write('overlay.animation.lighting','Off');expect(model('overlay.animation.lighting-opacity').visible).toBe(false);
  });
  it('preserves explicit zero values and authored modern combinations',()=>{
    const f=fixture('Instant');f.service.transaction(doc=>Object.assign(doc.profiles[0].modules[0].appearance,{motion:'Bounce',lighting:'Off',pressDuration:0,releaseDuration:0,pressDelay:0,lightingOpacity:0,motionScale:1.2}));
    expect(f.read('overlay.animation.press-duration')).toBe(0);expect(f.read('overlay.animation.lighting-opacity')).toBe(0);expect(f.read('overlay.animation.motion')).toBe('Bounce');expect(f.read('overlay.animation.motion-scale')).toBe(1.2);
  });
  it('retains registered schemas, optional defaults and stable IDs in presentation metadata',()=>{
    const {settings}=createBuiltinDefinitions(),registry=new SettingsSchemaRegistry().register(...settings);
    expect(settings.filter(setting=>setting.binding.store==='document')).toHaveLength(132);expect(registry.readDefault('overlay.animation.press-delay',{moduleType:'keyboard'})).toBeUndefined();
    const preset=registry.get('overlay.surface.effect-preset')!;expect(preset.ui).toMatchObject({group:animationGroup,component:'animation.effect-preset',section:'animation.preset'});
    expect(registry.get('overlay.animation.press-travel')!.ui.step).toBe(.5);expect(registry.get('overlay.animation.motion-scale')!.ui.step).toBe(.01);
  });
});
