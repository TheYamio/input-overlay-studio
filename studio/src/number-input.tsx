import { useEffect, useId, useRef, useState } from 'react';
import { useSettingsText } from './settings-localization';

type Props = { label: string; value: number; change: (value: number) => void; min?: number; max?: number; step?: number; disabled?: boolean; unit?: string; validate?: (value:number)=>boolean; integer?:boolean; exclusiveMinimum?:boolean };
const parse = (text: string) => /^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(',', '.')) : NaN;

// A draft preserves commas, trailing decimal separators and the caret while
// valid values continue to update the preview. External changes still win.
export function NumberInput({ label, value, change, min = 0, max = 1000, step = 1, disabled = false, unit, validate, integer=false,exclusiveMinimum=false }: Props) {
  const t=useSettingsText();
  const [text, setText] = useState(String(value)), [message, setMessage] = useState(false);
  const focused = useRef(false), startValue = useRef(value), draft = useRef(text), cancelled = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!focused.current || parse(draft.current) !== value) { draft.current = String(value); setText(String(value)); }
  }, [value]);
  const accepts = (next:number) => Number.isFinite(next) && (exclusiveMinimum?next>min:next>=min) && next <= max && (!validate || validate(next));
  const number = parse(text), valid = accepts(number);
  const limits = `${exclusiveMinimum?`${min} < x ≤ ${max}`:`${min}–${max}`}${unit ? ` ${unit}` : ''}${integer ? ` · ${t('controls:number.integer')}` : ''}`;
  const show = (next: string) => { draft.current = next; setText(next); };
  return <>
    <input aria-label={label} inputMode="decimal" value={text} disabled={disabled} aria-invalid={!valid}
      aria-describedby={id} title={t('controls:number.instructions',undefined,{limits,step})}
      onFocus={() => { focused.current = true; startValue.current = value; setMessage(false); }}
      onChange={event => { const raw = event.target.value; show(raw); setMessage(false); const next = parse(raw); if (accepts(next)) change(next); }}
      onBlur={() => { focused.current = false; if (cancelled.current) { cancelled.current = false; return; } if (!valid) setMessage(true); show(String(value)); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; change(startValue.current); show(String(startValue.current)); setMessage(false); event.currentTarget.blur(); }
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault(); const next = Math.max(min, Math.min(max, Number(((valid ? number : value) + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)).toPrecision(12))));
          show(String(next)); setMessage(false); if(accepts(next))change(next);
        }
      }}/>
    <small id={id} className={`numeric-feedback ${!valid || message ? 'invalid' : ''}`}>{message ? t('controls:number.restored',undefined,{limits}) : !valid ? t('controls:number.invalid',undefined,{limits}) : limits}</small>
  </>;
}
