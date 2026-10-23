import type { OverlayModule, StudioDocument } from '../config';
import type { ElementStyle } from '../visual';
import { animationSettings } from '../animation';
import { resolvedStyle } from '../skins';
import type { DefinitionId, SettingDefinition, SettingsAddress } from '../architecture/contracts';
import type { SettingsService } from '../settings/service';

export type AnimationAddress=Extract<SettingsAddress,{scope:'module'}>;
export function animationStyle(document:StudioDocument,address:AnimationAddress) {
  const module=document.profiles.find(profile=>profile.id===address.profileId)?.modules.find(module=>module.id===address.moduleId);
  if(!module || !['keyboard','mouse'].includes(module.type))throw Error('Animation module does not exist.');
  let override:ElementStyle|undefined;
  if(address.element?.kind==='key') {
    const keyId=address.element.keyId,key=module.type==='keyboard' && module.keys.find(key=>key.id===keyId);
    if(!key)throw Error('Animation key does not exist.');override=key.style;
  } else if(address.element) {
    const button=address.element.button;
    if(module.type!=='mouse'||!Number.isInteger(button)||button<1||button>7)throw Error('Animation button does not exist.');
    override=module.buttonStyles[button];
  }
  return resolvedStyle(module,override);
}
export function animationRead(settings:SettingsService,definition:SettingDefinition,address:SettingsAddress):unknown {
  const raw=settings.read(definition.id,address);
  if(address.scope!=='module'||definition.ui.group!=='overlay.animation')return raw;
  const style=animationStyle(settings.document,address),animation=animationSettings(style);
  const effective={...style,...animation,pressDuration:animation.pressMs,releaseDuration:animation.releaseMs};
  const field=definition.binding.path.at(-1)!;
  return Object.hasOwn(effective,field) ? effective[field as keyof typeof effective] : raw;
}
export function animationWrite(settings:SettingsService,definition:SettingDefinition,address:SettingsAddress,value:unknown) {
  if(address.scope!=='module')throw Error('Animation settings require an explicit module address.');
  if(definition.id==='overlay.surface.effect-preset') {
    const effect=definition.schema.parse(value) as OverlayModule['effect'],preset=animationSettings({effect});
    const changes:readonly [DefinitionId,unknown][]=[['overlay.surface.effect-preset',effect],['overlay.animation.motion',preset.motion],['overlay.animation.lighting',preset.lighting],['overlay.animation.easing','Ease out'],['overlay.animation.press-delay',0],['overlay.animation.release-delay',0],['overlay.animation.lighting-opacity',1],['overlay.animation.press-duration',effect==='Instant'?0:90],['overlay.animation.release-duration',effect==='Instant'?0:140]];
    return settings.setMany(changes.map(([id,value])=>({id,address,value})));
  }
  if(definition.id==='overlay.animation.press-duration'||definition.id==='overlay.animation.release-duration') {
    const animation=animationSettings(animationStyle(settings.document,address));
    return settings.setMany([{id:definition.id,address,value},{id:'overlay.animation.motion',address,value:animation.motion},{id:'overlay.animation.lighting',address,value:animation.lighting}],{preserveGesture:true});
  }
  return settings.set(definition.id,address,value);
}
