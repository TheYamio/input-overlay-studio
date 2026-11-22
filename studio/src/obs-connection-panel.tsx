import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Settings2, X } from 'lucide-react';
import type { SettingsSnapshot } from './core/settings/service';
import { trError } from './core/localization/messages';
import { ConnectionDetails } from './connection-status';
import { useSettingsText } from './settings-localization';
import './obs-connection-panel.css';

export interface ObsConnectionProps {
  view: SettingsSnapshot;
  makeUrl: () => Promise<string>;
  endpointKey: string;
  openSettings: () => void;
}

export function ObsConnectionPanel(props: ObsConnectionProps) {
  return <ObsConnectionContent key={props.endpointKey} {...props}/>;
}

function ObsConnectionContent({ view, makeUrl, openSettings }: ObsConnectionProps) {
  const t = useSettingsText();
  const urlId = useId();
  const active = useRef(false);
  const [url, setUrl] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const connected = view.connectionState === 'Connected';
  const blocked = view.protected || view.unsupported || view.conflict;

  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function copy() {
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      const prepared = await makeUrl();
      if (!active.current) return;
      setUrl(prepared);
      try {
        await navigator.clipboard.writeText(prepared);
        if (active.current) setFeedback('copied');
      } catch {
        if (active.current) setFeedback('copyFailed');
      }
    } catch (cause) {
      if (!active.current) return;
      setUrl('');
      setError(trError(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return <div className="obs-connection-panel" data-obs-panel>
    <ol className="obs-connection-steps">
      {[1, 2, 3].map(step => <li key={step}>{t(`setup:obsStep${step}`)}</li>)}
    </ol>
    <div className="obs-connection-address">
      <button className="primary" disabled={busy || !connected || !!blocked} onClick={() => void copy()}>
        <Copy size={16}/>{t('setup:copy')}
      </button>
      {url && <div className="obs-connection-url">
        <label className="field" htmlFor={urlId}>
          <span>{t('setup:url')}</span>
          <input id={urlId} type={showUrl ? 'text' : 'password'} autoComplete="off" spellCheck={false}
            readOnly value={url} onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()}/>
        </label>
        <button className="secondary obs-url-visibility" aria-label={t(showUrl ? 'setup:hideObsUrl' : 'setup:showObsUrl')}
          aria-controls={urlId} title={t(showUrl ? 'setup:hideObsUrl' : 'setup:showObsUrl')} onClick={() => setShowUrl(!showUrl)}>
          {showUrl ? <EyeOff size={16}/> : <Eye size={16}/>}
        </button>
      </div>}
      {feedback && <p className="obs-connection-feedback" role="status">{t(`setup:${feedback}`)}</p>}
      {error && <p className="obs-connection-error" role="alert">{error}</p>}
      {!connected && <p className="obs-connection-error">{t('setup:connectFirst')}</p>}
      {connected && blocked && <p className="obs-connection-error">{t('setup:obsProfileBlocked')}</p>}
    </div>
    <div role="status" aria-live="polite">
      <ConnectionDetails view={view} compact/>
    </div>
    <p className="hint">{t('setup:obsStep4')}</p>
    <button className="text-button obs-connection-settings" disabled={busy} onClick={openSettings}><Settings2 size={15}/>{t('setup:openSettings')}</button>
  </div>;
}

export function ObsConnectionDialog({ close, ...props }: ObsConnectionProps & { close: () => void }) {
  const t = useSettingsText();
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll: true});
    };
  }, []);

  return <dialog ref={dialog} className="obs-connection-dialog" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); close(); }}>
    <header>
      <h2 id={title}>{t('setup:connectOBS')}</h2>
      <button className="setup-close" aria-label={t('setup:closeOBS')} onClick={close}><X size={20}/></button>
    </header>
    <div className="obs-connection-body"><ObsConnectionPanel {...props}/></div>
  </dialog>;
}
