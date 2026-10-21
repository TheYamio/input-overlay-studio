import { useEffect, useState } from 'react';
import { Inheritance } from './style-tools';

export function VNumber({ label, value, min = 0, max = 1000, step = 1, disabled = false, change }: { label: string; value: number; min?: number; max?: number; step?: number; disabled?: boolean; change: (n: number) => void }) {
  const [text, setText] = useState(String(value)); useEffect(() => setText(String(value)), [value]);
  return <label className="field"><span>{label}</span><input disabled={disabled} aria-label={label} value={text} inputMode="decimal" onChange={e => { const s = e.target.value; setText(s); const n = Number(s.replace(',', '.')); if (/^-?\d+(?:[.,]\d+)?$/.test(s) && Number.isFinite(n) && n >= min && n <= max) change(n); }} onBlur={() => setText(String(value))} step={step}/><Inheritance label={label}/></label>;
}
export function VSelect<T extends string>({ label, value, options, change }: { label: string; value: T; options: readonly T[]; change: (s: T) => void }) {
  return <label className="field"><span>{label}</span><select aria-label={label} value={value} onChange={e => change(e.target.value as T)}>{options.map(v => <option key={v}>{v}</option>)}</select><Inheritance label={label}/></label>;
}
export function VRange({ label, value, min = 0, max = 1, step = .01, change }: { label: string; value: number; min?: number; max?: number; step?: number; change: (n: number) => void }) {
  return <label className="range-field"><span>{label}<b>{Number(value.toFixed(2))}</b></span><input type="range" aria-label={label} value={value} min={min} max={max} step={step} onChange={e => change(+e.target.value)}/><Inheritance label={label}/></label>;
}
export function Color({ label, value, change }: { label: string; value: string; change: (s: string) => void }) {
  return <label className="visual-color"><input type="color" aria-label={label} value={value} onChange={e => change(e.target.value)}/><span>{label}</span><code>{value}</code><Inheritance label={label}/></label>;
}
