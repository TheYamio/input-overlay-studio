import {UnicodeInput} from './unicode-input';
import {tr,trText} from './core/localization/messages.ts';
import { moduleKind } from './core/module-envelope';
import { moduleAvailable,moduleSchemaVersion,encodeModule,decodeModule } from './core/module-format';
import { makeModule } from './core/config';
import React,{useEffect,useRef,useState} from 'react';
import { Copy,RotateCcw,Square,Trash2 } from 'lucide-react';
import { activeProfile } from './core/config';
import { documentAdapter } from './core/settings-ui/document';
import { alignModule,resetModulePosition,type Alignment } from './core/layout';
import { AnimationSettingsProvider } from './animation-binding';
import { NumberField,Toggle,IconButton } from './editor-fields';
import { SettingsField } from './settings-renderer';
import { ModuleAppearance } from './visual-controls';
import { VRange } from './visual-fields';
import { useModuleUIRegistry } from './module-ui-context';
import { RegisteredModulePanel } from './module-panel';
import type { ModuleEditorProps } from './module-editor-contracts';
export function ModuleProperties(props:ModuleEditorProps) {
  const {settings,preferences,module:m,document:doc,change,remove,duplicate,editingKeys}=props;
  const address = {scope:'module' as const,profileId:activeProfile(doc).id,moduleId:m.id};
  const field = (id: import('./core/architecture/contracts').DefinitionId, fallback: React.ReactNode) => registration?.lineColor && id==='overlay.surface.accent' || !registration?.preview && id==='overlay.surface.radius' ? fallback : <SettingsField settings={settings} id={id} address={address} adapter={documentAdapter}/>;
  const registry=useModuleUIRegistry(),candidate=registry.resolve(moduleKind(m)),registration=candidate?.definition.schemaVersion===(m.extension?moduleSchemaVersion(m,registry.configurations):candidate?.definition.schemaVersion)?candidate:undefined;
  const Icon=registration?.icon??Square;
  const panels=moduleAvailable(m,registry.configurations)?registration?.sections??[]:[];
  const groups=[['appearance','Appearance'],['layout','Position'],...panels.map(panel=>[panel.id,panel.label]),['all','All properties']];
  const [section, setSection] = useState(() => {
    const saved = preferences.getSnapshot().inspectorSection; if (groups.some(([id]) => id === saved)) return saved;
    return 'appearance';
  });
  const content = useRef<HTMLDivElement>(null);
  const shown = (group: string) => section === 'all' || section === group;
  useEffect(() => { if (editingKeys && registration?.selection==='keys') setSection(current => current === 'all' ? current : 'keys'); }, [editingKeys, registration]);
  useEffect(()=>{if(!groups.some(([id])=>id===section))setSection('appearance');},[registration,section]);
  const chooseSection = (id: string) => {
    setSection(id); if (content.current) content.current.scrollTop = 0;
    preferences.set('studio.preferences.inspector-section', id);
  };
  return <AnimationSettingsProvider settings={settings} address={address}>
    <div className="inspector-header"><div className="properties-title"><div className="module-icon"><Icon size={18}/></div><div><h3>{m.name}</h3><span>{tr('ui:s-3a9cc53c6375',"MODULE PROPERTIES")}</span></div><IconButton title={tr('ui:s-227c50e4a884',"Duplicate module")} onClick={duplicate}><Copy size={15}/></IconButton></div><div className="inspector-tabs" role="group" aria-label={tr('ui:s-98f65497b737',"Property sections")}>{groups.map(([id, label]) => <button key={id} aria-pressed={section === id} onClick={() => chooseSection(id)}>{trText(label)}</button>)}</div></div>
    <div ref={content} className="property-scroll" aria-label={tr('ui:s-a10fc3596edd',"Module properties")}>
    {m.extension&&<section className="property-section"><Toggle label={tr('ui:s-937e3aa091a3',"Module enabled")} value={m.extension.enabled} onChange={enabled=>change(decodeModule({...encodeModule(m),enabled},id=>makeModule('distance',0,id)))}/>{!moduleAvailable(m)&&<p role="status" className="hint">{tr('ui:s-809c552ad1b6',"This module is unavailable or disabled. Its configuration and resources are preserved.")}</p>}</section>}
    {panels.filter(panel=>panel.placement==='before-common').map(panel=><RegisteredModulePanel key={`${panel.id}:${registry.getSnapshot()}`} panel={panel} hidden={!shown(panel.id)} props={props}/>)}
    <section className="property-section transform-panel" hidden={!shown('layout')}><h4>{tr('ui:s-87bd760c484e',"POSITION & SIZE")}<Square size={12}/></h4><p className="hint">{tr('ui:s-c15c20dd9597',"Canvas units: 1920 × 1080. X moves right; Y moves down. Higher layer numbers appear above lower ones.")}</p><div className="field-grid"><NumberField settingId="overlay.instance.x" disabled={m.locked} label="X" value={m.x} max={1920 - m.w} onChange={x => change({ x })}/><NumberField settingId="overlay.instance.y" disabled={m.locked} label="Y" value={m.y} max={1080 - m.h} onChange={y => change({ y })}/><NumberField settingId="overlay.instance.width" disabled={m.locked} label={tr('ui:s-3019947b6daf',"Width")} value={m.w} min={40} max={1920 - m.x} onChange={w => change({ w })}/><NumberField settingId="overlay.instance.height" disabled={m.locked} label={tr('ui:s-bfe2eca40179',"Height")} value={m.h} min={30} max={1080 - m.y} onChange={h => change({ h })}/></div><div className="field-grid"><NumberField settingId="overlay.instance.layer" label={tr('ui:s-ac9ffcb2bf47',"Layer")} value={m.z} max={1000} onChange={z => change({ z: Math.round(z) })}/>{!m.extension&&<NumberField settingId="overlay.surface.radius" label={tr('ui:s-6fe0661c82d1',"Radius")} value={m.radius} max={100} onChange={radius => change({ radius })}/>}</div><div className="alignment-controls" role="group" aria-label={tr('ui:s-164be01022cc',"Align module to canvas")}>{([['left', 'Left'], ['center', 'Center X'], ['right', 'Right'], ['top', 'Top'], ['middle', 'Center Y'], ['bottom', 'Bottom']] as [Alignment, string][]).map(([value, label]) => <button key={value} className="secondary small" disabled={m.locked} onClick={() => change(alignModule(m, value))} aria-label={tr('ui:s-c3fd5b1d43bc',"Align {{p0}}",{p0:trText(label)})}>{trText(label)}</button>)}</div><button className="text-button" disabled={m.locked} onClick={() => change(resetModulePosition(m))}><RotateCcw size={12}/>{tr('ui:s-8cebff871182',"Reset position")}</button><Toggle settingId="overlay.instance.locked" label={tr('ui:s-20cd3751f574',"Lock position")} value={m.locked} onChange={locked => change({ locked })}/><Toggle settingId="overlay.instance.visible" label={tr('ui:s-b3fc808506ff',"Visible in OBS")} value={m.visible} onChange={visible => change({ visible })}/></section>
    <section className="property-section appearance-panel" hidden={!shown('appearance')}><h4>{tr('ui:s-a69553c0352c',"APPEARANCE")}</h4>{field('overlay.instance.name',<label className="field"><span>{tr('ui:s-b820b16ca1e6',"Module name")}</span><UnicodeInput value={m.name} maxLength={100} onChange={e => change({ name: e.target.value })}/></label>)}{!m.extension&&<ModuleAppearance module={m} change={change} settingField={field}/>}{field('overlay.instance.opacity',<VRange label={tr('ui:s-6062652e10dd',"Opacity")} value={m.opacity} change={opacity => change({ opacity })}/>)}</section>
    {panels.filter(panel=>panel.placement!=='before-common').sort((a,b)=>(a.order??2)-(b.order??2)).map(panel=><RegisteredModulePanel key={`${panel.id}:${registry.getSnapshot()}`} panel={panel} hidden={!shown(panel.id)} props={props}/>)}
    <section className="property-section module-danger" hidden={!shown('layout')}><button className="text-button danger" disabled={m.locked} onClick={remove}><Trash2 size={14}/>{tr('ui:s-e52e882147b0',"Delete module")}</button></section>
    </div>
  </AnimationSettingsProvider>;
}
