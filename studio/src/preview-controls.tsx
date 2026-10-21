import { previewModes, type PreviewState } from './core/preview';
import { VRange, VSelect } from './visual-fields';
export function PreviewControls({ value, change, isolated = false }: { value: PreviewState; change: (value: PreviewState) => void; isolated?: boolean }) {
  return <div className="preview-state-controls"><VSelect label="Preview key state" value={value.mode} options={isolated ? previewModes.filter(mode => mode !== 'Input') : previewModes} change={mode => change({ ...value, mode })}/>
    {value.mode === 'Analog' && <VRange label="Preview analog depth" value={value.depth} change={depth => change({ ...value, depth })}/>}
    <p className="hint">{isolated ? 'Preview only. Settings are applied when you confirm the image.' : 'Preview only in this editor. Input restores Live or Demo; OBS keeps receiving real input.'}</p>
  </div>;
}
