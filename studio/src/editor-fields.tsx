import {trText} from './core/localization/messages';
import type React from 'react';
import type { DefinitionId } from './core/architecture/contracts';
import { RegisteredField } from './registered-field';
import { NumberInput } from './number-input';
import { ChevronDown } from 'lucide-react';
function LegacyNumberField({ label, value, onChange, min = 0, max = 1e9, step = 1, disabled = false }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  return <label className="number-field numeric-control"><span>{label}</span><NumberInput label={label} value={value} change={onChange} min={min} max={max} step={step} disabled={disabled}/></label>;
}
function LegacySelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return <label className="field"><span>{label}</span><div className="select-wrap"><select aria-label={label} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o} value={o}>{trText(o)}</option>)}</select><ChevronDown size={13}/></div></label>;
}
function LegacyToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) { return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)}/><span className="toggle-track"/></label>; }
export function NumberField({settingId,...props}:Parameters<typeof LegacyNumberField>[0]&{settingId?:DefinitionId}) {return settingId ? <RegisteredField id={settingId} label={props.label} fallback={<LegacyNumberField {...props}/>}/> : <LegacyNumberField {...props}/>;}
export function Toggle({settingId,...props}:Parameters<typeof LegacyToggle>[0]&{settingId?:DefinitionId}) {return settingId ? <RegisteredField id={settingId} label={props.label} fallback={<LegacyToggle {...props}/>}/> : <LegacyToggle {...props}/>;}
export function Select<T extends string>({settingId,...props}:{label:string;value:T;options:readonly T[];onChange:(value:T)=>void;settingId?:DefinitionId}) {return settingId ? <RegisteredField id={settingId} label={props.label} fallback={<LegacySelect {...props}/>}/> : <LegacySelect {...props}/>;}
export function IconButton({ title, children, onClick, disabled = false }: { title: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) { return <button className="icon-button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>; }
