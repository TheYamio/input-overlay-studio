import { useEffect, useRef, useState } from 'react';
import { resolvedProfile } from './core/config';
import { tr } from './core/localization/messages';
import type { PresetApplicationPreview } from './core/preset-application';
import { SceneThumbnail } from './scene-thumbnail';
import { useSettingsText } from './settings-localization';

export function PresetPreviewDialog({ name, preview, stale, close, apply }: {
  name: string; preview: PresetApplicationPreview; stale: boolean;
  close: () => void; apply: (preview: PresetApplicationPreview) => boolean;
}) {
  const t = useSettingsText();
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const { base, result, colors } = preview;
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return <dialog className="preset-dialog preset-preview-dialog studio-dialog" ref={dialog} aria-labelledby="preset-preview-title" aria-describedby="preset-preview-effect"
    onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (stale) return;
      if (apply(preview)) close(); else setFailed(true);
    }}>
      <header className="studio-dialog-header">
        <div><h2 id="preset-preview-title">{t(colors ? 'presets:previewColors' : 'presets:previewLayout')}</h2><bdi>{name}</bdi></div>
      </header>
      <div className="preset-dialog-body">
        <p id="preset-preview-effect" className="preset-preview-effect">{colors ? t('presets:colorsEffect') : t('presets:layoutEffect')}</p>
        <div className="preset-comparison">
          {([['current', base], ['result', result]] as const).map(([side, document]) => {
            const profile = resolvedProfile(document);
            return <section key={side} data-preview-scene={side}>
              <h3>{t(`presets:${side}`)}</h3>
              <div className="preset-preview-frame checker">
                <SceneThumbnail document={document} modules={profile.modules} profile={profile} fullCanvas/>
              </div>
            </section>;
          })}
        </div>
        {stale ? <p className="warning" role="alert">{t('presets:stalePreview')}</p>
          : failed && <p className="warning" role="alert">{tr('ui:s-27683b276ad9', 'Configuration could not be applied.')}</p>}
      </div>
      <footer className="studio-dialog-footer">
        <button type="button" className="secondary" ref={cancel} onClick={close}>{tr('ui:s-19766ed6ccb2', 'Cancel')}</button>
        <button className="primary" disabled={stale}>{colors ? tr('ui:s-4cd7c855742e', 'Apply colors') : tr('ui:s-003857be2479', 'Use full layout')}</button>
      </footer>
    </form>
  </dialog>;
}
