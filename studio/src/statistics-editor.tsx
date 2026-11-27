import {useState, type KeyboardEvent} from 'react';
import {bindingFromCode, bindingFromVK} from './core/key-binding';
import {tr} from './core/localization/messages';
import type {ModuleEditorProps} from './module-editor-contracts';
import type {DefinitionId} from './core/architecture/contracts';
import {RegisteredField} from './registered-field';

function field(id: DefinitionId, label: string) {
  return <RegisteredField id={id} label={label} fallback={null}/>;
}

function CounterKey({label, code, otherCode, optional = false, change}: {
  label: string; code: number; otherCode: number; optional?: boolean; change: (code: number) => void;
}) {
  const [conflict, setConflict] = useState(false);
  const [listening, setListening] = useState(false);
  function record(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Tab') return;
    event.stopPropagation();
    event.preventDefault();
    if (event.key === 'Escape') {event.currentTarget.blur(); return;}
    const binding = bindingFromCode(event.code);
    if (!binding) return;
    if (binding.code === otherCode) {setConflict(true); return;}
    change(binding.code);
    event.currentTarget.blur();
  }
  return <div className="field">
    <label>
      <span>{label}</span>
      <input readOnly value={listening ? tr('statistics:pressKey','Press a key…') : bindingFromVK(code)?.label ?? tr('statistics:unassigned','Unassigned')}
        onKeyDown={record} onFocus={() => setListening(true)} onBlur={() => {setListening(false); setConflict(false);}}
        aria-invalid={conflict || undefined}/>
    </label>
    {conflict && <p role="status" className="hint">{tr('statistics:differentKeys','Choose different keys for increase and decrease.')}</p>}
    {optional && code !== 0 && <button className="secondary small" onClick={() => change(0)}>{tr('statistics:clearDecrease','Clear decrease key')}</button>}
  </div>;
}

export function CounterEditor({module, change}: ModuleEditorProps) {
  return <section className="property-section">
    <h4>{tr('modules:overlay.counter.label','Counter')}</h4>
    {field('overlay.counter.mode','Counter mode')}
    {module.counterMode === 'Custom' ? <>
      <CounterKey label={tr('settings:overlay.counter.increment.label','Increase key')} code={module.counterIncrement}
        otherCode={module.counterDecrement} change={counterIncrement => change({counterIncrement})}/>
      <CounterKey label={tr('settings:overlay.counter.decrement.label','Decrease key')} code={module.counterDecrement}
        otherCode={module.counterIncrement} change={counterDecrement => change({counterDecrement})} optional/>
      {field('overlay.counter.persist','Keep tally between launches')}
    </> : field('overlay.counter.window','Rolling window (s)')}
    {field('overlay.counter.caption','Caption')}
  </section>;
}

export function FlicksEditor() {
  return <section className="property-section">
    <h4>{tr('modules:overlay.flicks.label','Mouse Flick Stats')}</h4>
    {field('overlay.flicks.window','Rolling window (s)')}
    {field('overlay.flicks.threshold','Minimum speed (m/s)')}
    {field('overlay.flicks.minimum-distance','Minimum travel (cm)')}
    {field('overlay.flicks.unit','Distance unit')}
    {field('overlay.flicks.caption','Caption')}
  </section>;
}
