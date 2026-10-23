import {tr} from './core/localization/messages.ts';
import { previewModes, type PreviewState } from './core/preview';
import { VRange, VSelect } from './visual-fields';
export function PreviewControls({ value, change, isolated = false }: { value: PreviewState; change: (value: PreviewState) => void; isolated?: boolean }) {
  return <div className="preview-state-controls"><VSelect label={tr('ui:s-d799b6fe4170',"Preview key state")} value={value.mode} options={isolated ? previewModes.filter(mode => mode !== 'Input') : previewModes} change={mode => change({ ...value, mode })}/>
    {value.mode === 'Analog' && <VRange label={tr('ui:s-d425718e56e0',"Preview analog depth")} value={value.depth} change={depth => change({ ...value, depth })}/>}
    <p className="hint">{isolated ? tr('ui:s-0db0c354e0c0',"Preview only. Settings are applied when you confirm the image.") : tr('ui:s-974c3bd96417',"Preview only in this editor. Input restores Live or Demo; OBS keeps receiving real input.")}</p>
  </div>;
}
