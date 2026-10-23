import {tr,trText} from './core/localization/messages.ts';
import { useContext, useState } from 'react';
import { animationSettings, easingModes, lightingModes, motionModes } from './core/animation';
import type { resolvedStyle } from './core/skins';
import { effects, type ElementStyle } from './core/visual';
import { Color, VNumber, VRange, VSelect } from './visual-fields';
import { AnimationSample } from './animation-sample';
import { AnimationBinding } from './animation-binding';
import { SchemaAnimationControls } from './schema-animation-controls';
export { VisualPreviewSettings } from './animation-sample';

export function AnimationControls(props:{value:ReturnType<typeof resolvedStyle>;prefix:string;mouse?:boolean;change:(patch:ElementStyle)=>void}) {
  const binding=useContext(AnimationBinding);
  return binding ? <SchemaAnimationControls {...binding} prefix={props.prefix} mouse={props.mouse}/> : <StandaloneAnimationControls {...props}/>;
}

function StandaloneAnimationControls({ value: v, prefix, change, mouse = false }: { value: ReturnType<typeof resolvedStyle>; prefix: string; mouse?: boolean; change: (patch: ElementStyle) => void }) {
  const a = animationSettings(v), name = (label: string) => `${trText(prefix)}${trText(label)}`, [open, setOpen] = useState(false);
  return <details className="visual-details animation-details" onToggle={e => setOpen(e.currentTarget.open)}><summary>{tr('ui:s-3f4f0acd1a28',"Press & release")}</summary>
    <p className="hint">{tr('ui:s-fd63a2f84e63',"Movement, light and timing can be combined independently. Times are in milliseconds.")}</p>
    <VSelect label={name('Press effect')} value={v.effect} options={effects} change={effect => { const preset = animationSettings({ effect }); change({ effect, motion: preset.motion, lighting: preset.lighting, easing: 'Ease out', pressDelay: 0, releaseDelay: 0, lightingOpacity: 1, pressDuration: effect === 'Instant' ? 0 : 90, releaseDuration: effect === 'Instant' ? 0 : 140 }); }}/>
    <p className="hint">{tr('ui:s-ef8b5b4a2664',"Quick starting point. Fine-tune it below.")}</p>
    <h4 className="animation-section-title">{tr('ui:s-f53ad10d551c',"MOVEMENT")}</h4>
    <VSelect label={name('Button motion')} value={a.motion} options={motionModes} change={motion => change({ motion })}/>
    <VSelect label={name('Animation easing')} value={a.easing} options={easingModes} change={easing => change({ easing })}/>
    {(a.motion === 'Press' || a.motion === 'Lift' || a.motion === 'Bounce') && <VNumber label={name('Press travel')} value={v.pressTravel} max={8} step={.5} change={pressTravel => change({ pressTravel })}/>}
    {a.motion === 'Scale' && <VNumber label={name('Pressed scale')} value={a.motionScale} min={.8} max={1.2} step={.01} change={motionScale => change({ motionScale })}/>}
    <h4 className="animation-section-title">{tr('ui:s-1bc41967b7f3',"LIGHTING")}</h4>
    <VSelect label={name('Lighting mode')} value={a.lighting} options={lightingModes} change={lighting => change({ lighting })}/>
    {a.lighting !== 'Off' && <VRange label={name('Lighting intensity')} value={a.lightingOpacity} change={lightingOpacity => change({ lightingOpacity })}/>}
    {(a.lighting === 'Glow' || a.lighting === 'Fill + glow') && <VNumber label={name('Glow strength')} value={v.glowStrength} max={40} change={glowStrength => change({ glowStrength })}/>}
    {a.lighting === 'Gradient' && <><Color label={name('Secondary light color')} value={a.secondaryColor} change={secondaryColor => change({ secondaryColor })}/><VNumber label={name('Gradient angle')} value={a.gradientAngle} min={-180} max={180} step={15} change={gradientAngle => change({ gradientAngle })}/></>}
    <p className="hint">{tr('ui:s-c74cea97cd61',"Uses Accent color and Pressed border color. Outline needs a border width above zero. Glow follows SVG contours; its quality follows Performance settings.")}</p>
    <h4 className="animation-section-title">{tr('ui:s-31ea30b2db05',"TIMING · MS")}</h4>
    <div className="field-grid"><VNumber label={name('Press duration')} value={a.pressMs} max={500} change={pressDuration => change({ pressDuration, motion: a.motion, lighting: a.lighting })}/><VNumber label={name('Release duration')} value={a.releaseMs} max={1000} change={releaseDuration => change({ releaseDuration, motion: a.motion, lighting: a.lighting })}/><VNumber label={name('Press delay')} value={a.pressDelay} max={1000} change={pressDelay => change({ pressDelay })}/><VNumber label={name('Release delay')} value={a.releaseDelay} max={2000} change={releaseDelay => change({ releaseDelay })}/></div>
    <p className="hint">{tr('ui:s-2c69b11c10ee',"Delay waits before the visual change; duration controls its speed. Short taps remain visible. Input capture and sensitivity calculations stay immediate.")}</p>
    {open && <AnimationSample style={v} prefix={prefix} mouse={mouse}/>}
  </details>;
}
