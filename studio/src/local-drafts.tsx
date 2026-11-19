import { useEffect, useState } from 'react';
import type { createBrowserDrafts } from './core/settings/browser-drafts';
import { trText } from './core/localization/messages';

export function LocalDrafts({ drafts, checkpoint }: {
  drafts: ReturnType<typeof createBrowserDrafts>;
  checkpoint: () => boolean;
}) {
  const [available, setAvailable] = useState(drafts.alternatives);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => setAvailable(drafts.alternatives());
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [drafts]);

  if (!available.length) return null;
  const selectedId = available.some(draft => draft.id === selected) ? selected : available[0].id;
  return <div className="settings-section">
    <h3>{trText('Other local drafts')}</h3>
    <label className="field">
      <span>{trText('Saved editor session')}</span>
      <select value={selectedId} onChange={event => setSelected(event.target.value)}>
        {available.map(({ id, time }) => <option key={id} value={id}>{time.toLocaleString()} · {id.slice(-4)}</option>)}
      </select>
    </label>
    <button type="button" className="secondary" onClick={() => {
      try {
        if (!checkpoint() || !drafts.open(selectedId)) throw Error();
        location.reload();
      } catch {
        setError(trText('Could not open the draft. Export your current changes and try again.'));
      }
    }}>{trText('Open local draft')}</button>
    <button type="button" className="text-button" onClick={() => {
      if (!window.confirm(trText('Delete this saved local draft?'))) return;
      try {
        drafts.discard(selectedId);
        setAvailable(drafts.alternatives());
      } catch {
        setError(trText('Could not delete the local draft.'));
      }
    }}>{trText('Delete local draft')}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
