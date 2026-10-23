import {UnicodeInput} from './unicode-input';
import {tr} from './core/localization/messages.ts';
import { useId, useState, useSyncExternalStore } from 'react';
import { SettingsComponentRegistry } from './settings-components';
import { builtinCatalog } from './core/architecture/builtins';
import type { Catalog, DefinitionId, LocalizedText, SettingDefinition, SettingsAddress } from './core/architecture/contracts';
import type { SettingsService } from './core/settings/service';
import { fieldModel, groupSettings, isInherited, optionTranslationKey, type SettingsFieldAdapter } from './core/settings-ui/model';
import { Color, VNumber, VRange } from './visual-fields';
import { useSettingsText } from './settings-localization';

export interface SpecializedSettingProps {
  definition:SettingDefinition; address:SettingsAddress; value:unknown; disabled:boolean;
  change:(value:unknown)=>void; reset:()=>void; label:string;
}
export { SettingsComponentRegistry } from './settings-components';
const components=new SettingsComponentRegistry();
const capabilities=new Set(builtinCatalog.modules.all().flatMap(module=>[...module.capabilities]));

type FieldProps={settings:SettingsService;id:DefinitionId;address:SettingsAddress;catalog?:Catalog;available?:ReadonlySet<DefinitionId>;specialized?:SettingsComponentRegistry;showReset?:boolean;labelPrefix?:string;adapter?:SettingsFieldAdapter;caption?:LocalizedText};
export function SettingsFields({group,section,defaultSection,...props}:Omit<FieldProps,'id'>&{group:DefinitionId;section?:DefinitionId;defaultSection?:DefinitionId}) {
  useSyncExternalStore(props.settings.subscribe,props.settings.getSnapshot);
  return <>{groupSettings(props.catalog??builtinCatalog,props.settings,group,props.address).filter(definition=>!section||(definition.ui.section??defaultSection)===section).sort((a,b)=>(a.ui.order??Infinity)-(b.ui.order??Infinity)).map(definition=><SettingsField key={definition.id} {...props} id={definition.id}/>)}</>;
}

export function SettingsField(props:FieldProps) {
  const {id,address}=props;
  const identity=JSON.stringify([id,address.scope,'profileId' in address?address.profileId:null,address.scope==='module'?address.moduleId:null,address.scope==='module'?address.element:null]);
  return <BoundSettingsField key={identity} {...props}/>;
}
function BoundSettingsField({settings,id,address,catalog=builtinCatalog,available=capabilities,specialized=components,showReset=false,labelPrefix='',adapter,caption}:FieldProps) {
  const snapshot=useSyncExternalStore(settings.subscribe,settings.getSnapshot);
  useSyncExternalStore(specialized.subscribe,specialized.getSnapshot);
  const t=useSettingsText(),description=useId(),[failed,setFailed]=useState(false);
  const {definition:d,constraints:c,value,visible,enabled}=fieldModel(catalog,settings,id,address,available,adapter);
  if(!visible)return null;
  const labelText=caption??d.label;
  const label=labelPrefix+t(labelText.key,labelText.fallback), Custom=d.ui.component && specialized.get(d.ui.component);
  const missing=d.ui.control==='custom' && !Custom;
  const reason=d.binding.store==='document' && snapshot.unsupported ? t('controls:readonly') : adapter?.unavailable?.(d) || (missing ? t('controls:component') : !enabled ? d.disabledReason ? t(d.disabledReason.key,d.disabledReason.fallback) : t('controls:dependency') : '');
  const disabled=!!reason, inherited=isInherited(settings,catalog,id,address);
  const accepts=(next:unknown)=>d.schema.safeParse(next).success;
  const change=(next:unknown)=>{if(disabled)return;try{setFailed(!accepts(next)||!(adapter?.write ? adapter.write(settings,d,address,next) : settings.set(id,address,next)));}catch{setFailed(true);}};
  const reset=()=>{if(disabled)return;try{setFailed(!(adapter?.reset ? adapter.reset(settings,d,address) : settings.reset(id,address)));}catch{setFailed(true);}};
  const min=typeof c.minimum==='number' ? c.minimum : typeof c.exclusiveMinimum==='number' ? c.exclusiveMinimum : -Number.MAX_SAFE_INTEGER;
  const max=typeof c.maximum==='number' ? c.maximum : Number.MAX_SAFE_INTEGER;
  const step=typeof c.multipleOf==='number' ? c.multipleOf : d.ui.step??(d.ui.control==='range' ? .01 : 1);
  const options=d.ui.control==='select' ? (c.enum as string[]) : [];
  const orderedOptions=d.ui.firstOption ? [d.ui.firstOption,...options.filter(option=>option!==d.ui.firstOption)] : options;
  return <fieldset className="schema-field" data-setting-id={id} data-setting-source={address.scope==='module' && address.element ? inherited?'inherited':'overridden':undefined} disabled={disabled} aria-describedby={reason||d.help||failed ? description:undefined}>
    {d.ui.control==='number' && <VNumber label={label} value={value as number} min={min} max={max} step={step} unit={d.ui.unit} integer={c.type==='integer'} exclusiveMinimum={typeof c.exclusiveMinimum==='number'&&c.minimum===undefined} validate={accepts} inheritance={false} disabled={disabled} change={change}/>}
    {d.ui.control==='range' && <VRange label={label} value={value as number} min={min} max={max} step={step} validate={accepts} inheritance={false} disabled={disabled} change={change}/>}
    {d.ui.control==='color' && <Color label={label} value={value as string} inheritance={false} disabled={disabled} change={change}/>}
    {d.ui.control==='text' && <label className="field"><span>{label}</span><UnicodeInput aria-label={label} type={d.sensitive?'password':'text'} autoComplete={d.sensitive?'off':undefined} value={value as string??''} maxLength={c.maxLength} onChange={event=>change(event.target.value)}/></label>}
    {d.ui.control==='checkbox' && <label className="toggle-row"><span>{label}</span><input aria-label={label} type="checkbox" checked={!!value} onChange={event=>change(event.target.checked)}/><span className="toggle-track"/></label>}
    {d.ui.control==='select' && <label className="field"><span>{label}</span><select aria-label={label} value={value as string} onChange={event=>change(event.target.value)}>{!orderedOptions.includes(value as string) && <option value={value as string}>{String(value)}{tr('ui:s-db4a103d0d02',"(unavailable)")}</option>}{orderedOptions.map(option=><option key={option} value={option}>{t(optionTranslationKey(id,option),option)}</option>)}</select></label>}
    {d.ui.control==='custom' && (Custom ? <Custom definition={d} address={address} value={value} disabled={disabled} change={change} reset={reset} label={label}/> : <span>{label}</span>)}
    {(showReset || address.scope==='module' && address.element && d.binding.overrides) && <span className="inheritance" data-style-source={address.scope==='module'&&address.element?inherited?'inherited':'overridden':undefined}>{inherited ? <small>{t('controls:inherited')}</small> : <button type="button" aria-label={t(address.scope==='module' && address.element ? 'controls:reset.label':'controls:reset.default',undefined,{label})} onClick={reset}>{t('controls:reset')}</button>}</span>}
    {(reason||d.help||failed) && <small id={description} className={failed?'warning':'hint'} role={failed?'alert':undefined}>{failed?t('controls:rejected'):reason || (d.help && t(d.help.key,d.help.fallback))}</small>}
  </fieldset>;
}
