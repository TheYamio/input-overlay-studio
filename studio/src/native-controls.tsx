import {tr} from './core/localization/messages.ts';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { SettingsComponentRegistry } from './settings-components';
import type { SpecializedSettingProps } from './settings-renderer';

export function NativeList({label,values,validToken,change,hint}:{label:string;values:string[];validToken:(token:string)=>boolean;change:(values:string[])=>void;hint:string}){
 const [text,setText]=useState(values.join(', ')),focused=useRef(false),saved=values.join(', ');
 useEffect(()=>{if(!focused.current)setText(saved);},[saved]);
 const valid=text.split(/[\s,]+/).filter(Boolean).every(validToken);
 return <label className="field"><span>{label}</span><input value={text} maxLength={4096} aria-label={label} aria-invalid={!valid}
  onFocus={()=>{focused.current=true;}} onBlur={()=>{focused.current=false;setText(saved);}}
  onChange={event=>{const next=event.target.value;setText(next);const tokens=next.split(/[\s,]+/).filter(Boolean);if(tokens.every(validToken))change([...new Set(tokens)]);}}/>
  <small className="hint">{!valid?tr('ui:s-26a892299039',"Invalid entry; the last valid list will be kept. "):''}{hint}</small></label>;
}
function ListControl({definition,value,change,label}:SpecializedSettingProps){
 const cores=definition.binding.path[0]==='cpu_affinity';
 const accept=(values:string[])=>{const next=cores?values.map(Number):values;if(definition.schema.safeParse(next).success)change(next);};
 return <NativeList label={label} values={(value as (string|number)[]).map(String)} validToken={token=>cores?/^\d+$/.test(token)&&Number(token)<=63:/^[a-z0-9_]+$/.test(token)} change={accept} hint={cores?tr('ui:s-839660172f54',"Windows: core numbers 0–63. Empty lets Windows choose."):tr('ui:s-a9781b37ddd2',"Comma-separated names, for example key_w, key_space, mouse_left. Empty allows all inputs.")}/>;
}
export const NativeDevices=createContext<{keyboards:[string,string][];mice:[string,string][]}>({keyboards:[],mice:[]});
function DeviceControl({definition,value,change,label}:SpecializedSettingProps){
 const devices=useContext(NativeDevices),choices=definition.binding.path[0]==='linux_evdev_keyboard_device'?devices.keyboards:devices.mice;
 return <label className="field"><span>{label}</span><select aria-label={label} value={value as string} onChange={event=>change(event.target.value)}><option value="">{tr('ui:s-d461a493a375',"Automatic")}</option>{!!value&&!choices.some(([path])=>path===value)&&<option value={value as string}>{String(value)}{tr('ui:s-db4a103d0d02',"(unavailable)")}</option>}{choices.map(([path,name])=><option key={path} value={path}>{name} · {path}</option>)}</select></label>;
}
export const nativeComponents=new SettingsComponentRegistry();
nativeComponents.register('editor.native-list',ListControl);
nativeComponents.register('editor.native-devices',DeviceControl);
