import {trText} from './core/localization/messages';
import { RegisteredField } from './registered-field';
import type { DefinitionId } from './core/architecture/contracts';
import { useEffect, useState } from 'react';
import { Inheritance } from './style-tools';
import { NumberInput } from './number-input';
import { useSettingsText } from './settings-localization';

function LegacyVNumber({ label, value, min = 0, max = 1000, step = 1, disabled = false, inheritance = true, unit, validate, integer,exclusiveMinimum, change }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; inheritance?:boolean; unit?:string; validate?:(value:number)=>boolean; integer?:boolean;exclusiveMinimum?:boolean; change: (n: number) => void }) {
  return <label className="field numeric-control"><span>{label}</span><NumberInput label={label} value={value} min={min} max={max} step={step} unit={unit} validate={validate} integer={integer} exclusiveMinimum={exclusiveMinimum} disabled={disabled} change={change}/>{inheritance && <Inheritance label={label}/>}</label>;
}
function LegacyVSelect<T extends string>({ label, value, options, change }: { label: string; value: T; options: readonly T[]; change: (s: T) => void }) {
  return <label className="field"><span>{label}</span><select aria-label={label} value={value} onChange={e => change(e.target.value as T)}>{options.map(v => <option key={v} value={v}>{trText(v)}</option>)}</select><Inheritance label={label}/></label>;
}
function LegacyVRange({ label, value, min = 0, max = 1, step = .01, disabled = false, inheritance = true, validate, change }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?:boolean; inheritance?:boolean; validate?:(value:number)=>boolean; change: (n: number) => void }) {
  const t=useSettingsText();
  const percent = min === 0 && max === 1;
  return <div className="range-field"><div className="range-heading"><span>{label}</span><label className="range-value"><NumberInput label={t('controls:range.value',undefined,{label})} value={percent ? Math.round(value * 10000) / 100 : value} min={min} max={percent ? 100 : max} step={percent ? step * 100 : step} unit={percent ? '%' : undefined} validate={validate ? next=>validate(percent ? next/100:next) : undefined} disabled={disabled} change={next => change(percent ? next / 100 : next)}/>{percent && <span aria-hidden="true">%</span>}</label></div><input type="range" disabled={disabled} aria-label={label} aria-valuetext={percent ? `${Math.round(value * 10000) / 100}%` : String(value)} value={value} min={min} max={max} step="any" onChange={e => change(+e.target.value)} onKeyDown={e => { if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(e.key)) { e.preventDefault(); change(Math.max(min, Math.min(max, Number((value + (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1) * step * (e.shiftKey ? 10 : 1)).toPrecision(12))))); } }}/>{inheritance && <Inheritance label={label}/>}</div>;
}
function LegacyColor({ label, value, disabled = false, inheritance = true, change }: { label: string; value: string; disabled?:boolean; inheritance?:boolean; change: (s: string) => void }) {
  const t=useSettingsText();
  const [hex, setHex] = useState(value); useEffect(() => setHex(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  return <div className="visual-color"><input type="color" disabled={disabled} aria-label={label} value={value} onChange={e => change(e.target.value)}/><span>{label}</span><input className="hex-input" disabled={disabled} aria-label={t('controls:color.hex',undefined,{label})} aria-invalid={!valid} title={t('controls:color.help')} value={hex} maxLength={7} spellCheck={false} onChange={e => { const next = e.target.value; setHex(next); if (/^#[0-9a-f]{6}$/i.test(next)) change(next); }} onBlur={() => setHex(value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setHex(value); e.currentTarget.blur(); } }}/>{inheritance && <Inheritance label={label}/>}</div>;
}

export function VNumber({settingId,...props}:Parameters<typeof LegacyVNumber>[0]&{settingId?:DefinitionId}) { return settingId ? <RegisteredField id={settingId} label={trText(props.label)} fallback={<LegacyVNumber {...props} label={trText(props.label)}/>}/> : <LegacyVNumber {...props} label={trText(props.label)}/>; }
export function VRange({settingId,...props}:Parameters<typeof LegacyVRange>[0]&{settingId?:DefinitionId}) { return settingId ? <RegisteredField id={settingId} label={trText(props.label)} fallback={<LegacyVRange {...props} label={trText(props.label)}/>}/> : <LegacyVRange {...props} label={trText(props.label)}/>; }
export function Color({settingId,...props}:Parameters<typeof LegacyColor>[0]&{settingId?:DefinitionId}) { return settingId ? <RegisteredField id={settingId} label={trText(props.label)} fallback={<LegacyColor {...props} label={trText(props.label)}/>}/> : <LegacyColor {...props} label={trText(props.label)}/>; }
export function VSelect<T extends string>({settingId,...props}:{label:string;value:T;options:readonly T[];change:(value:T)=>void;settingId?:DefinitionId}) { return settingId ? <RegisteredField id={settingId} label={trText(props.label)} fallback={<LegacyVSelect {...props} label={trText(props.label)}/>}/> : <LegacyVSelect {...props} label={trText(props.label)}/>; }
