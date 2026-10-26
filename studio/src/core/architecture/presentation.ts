import {settingGuidance} from './guidance';
import type { DefinitionId, SettingDefinition } from './contracts';

// Interaction metadata belongs with the definitions. Persisted schemas remain
// authoritative; compound edits are handled by the trusted document adapter.
export function configureDocumentPresentation(settings:SettingDefinition[]){
 const steps:Partial<Record<DefinitionId,number>>={
  'overlay.appearance.text-outline':.1,'overlay.appearance.border-width':.5,
  'overlay.trail.thickness':.5,'overlay.trail.scale':.01,
  'overlay.trail.origin-x':.01,'overlay.trail.origin-y':.01,
  'overlay.trail-appearance.speed-range':.1,
  'profiles.game.sensitivity':.01,'profiles.game.yaw':.001,
 };
 for(let i=0;i<settings.length;i++){
  const d=settings[i],step=steps[d.id];
  if(settingGuidance[d.id])settings[i]={...d,help:settingGuidance[d.id]};
  if(step!==undefined)settings[i]={...settings[i],ui:{...d.ui,step}};
  if(['overlay.trail.origin-x','overlay.trail.origin-y'].includes(d.id))settings[i]={...settings[i],ui:{...settings[i].ui,control:'number'}};
  if(['overlay.artwork.brightness','overlay.artwork.contrast','overlay.artwork.saturation'].includes(d.id))settings[i]={...settings[i],ui:{...settings[i].ui,control:'range'}};
  if(['overlay.instance.x','overlay.instance.y','overlay.instance.width','overlay.instance.height'].includes(d.id))settings[i]={...settings[i],enabledWhen:[{setting:'overlay.instance.locked',test:'equals',value:false}],disabledReason:{key:'settings:overlay.instance.locked.reason',fallback:'Unlock the module to change its position or size.'}};
 }
}
