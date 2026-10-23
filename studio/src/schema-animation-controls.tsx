import { useState, useSyncExternalStore } from 'react';
import { animationGroup, animationSections } from './core/architecture/animation';
import { builtinCatalog } from './core/architecture/builtins';
import type { Catalog } from './core/architecture/contracts';
import { animationRead, animationStyle, animationWrite, type AnimationAddress } from './core/settings-ui/animation';
import { controlConstraints, optionTranslationKey, type SettingsFieldAdapter } from './core/settings-ui/model';
import type { SettingsService } from './core/settings/service';
import { SettingsComponentRegistry, SettingsFields, type SpecializedSettingProps } from './settings-renderer';
import { useSettingsText } from './settings-localization';
import { AnimationSample } from './animation-sample';

const adapter:SettingsFieldAdapter={read:animationRead,write:animationWrite};
export const animationComponents=new SettingsComponentRegistry();
function EffectPreset({definition,value,change,label,disabled}:SpecializedSettingProps) {
  const t=useSettingsText();
  return <label className="field"><span>{label}</span><select aria-label={label} value={value as string} disabled={disabled} onChange={event=>change(event.target.value)}>{(controlConstraints(definition).enum as string[]).map(option=><option key={option} value={option}>{t(optionTranslationKey(definition.id,option),option)}</option>)}</select></label>;
}
animationComponents.register('animation.effect-preset',EffectPreset);
export interface AnimationPreviewProps {settings:SettingsService;address:AnimationAddress;prefix:string;mouse:boolean}
export const animationViews=new SettingsComponentRegistry<AnimationPreviewProps>();
animationViews.register('animation.preview',({settings,address,prefix,mouse})=>{
  const snapshot=useSyncExternalStore(settings.subscribe,settings.getSnapshot);
  return <AnimationSample style={animationStyle(snapshot.document,address)} prefix={prefix} mouse={mouse}/>;
});

export function SchemaAnimationControls({settings,address,prefix,mouse=false,catalog=builtinCatalog}:{settings:SettingsService;address:AnimationAddress;prefix:string;mouse?:boolean;catalog?:Catalog}) {
  const [open,setOpen]=useState(false),t=useSettingsText(),Preview=animationViews.get('animation.preview');
  const identity=JSON.stringify([address.profileId,address.moduleId,address.element??null]);
  return <details className="visual-details animation-details" data-settings-group={animationGroup} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{t('animation:title','Press & release')}</summary>
    <p className="hint">{t('animation:intro','Movement, light and timing can be combined independently. Times are in milliseconds.')}</p>
    {animationSections.map(section=><div key={section.id} data-settings-section={section.id}>
      {section.label && <h4 className="animation-section-title">{t(section.label.key,section.label.fallback)}</h4>}
      <div className={section.grid?'field-grid':undefined}><SettingsFields settings={settings} address={address} group={animationGroup} section={section.id} defaultSection="animation.timing" adapter={adapter} specialized={animationComponents} labelPrefix={prefix} catalog={catalog}/></div>
      {section.help.fallback && <p className="hint">{t(section.help.key,section.help.fallback)}</p>}
    </div>)}
    {open && Preview && <Preview key={identity} settings={settings} address={address} prefix={prefix} mouse={mouse}/>}
  </details>;
}
