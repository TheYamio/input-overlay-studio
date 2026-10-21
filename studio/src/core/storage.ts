import { documentSchema, initialDocument, parseDocument, type StudioDocument } from './config';
const key = 'input-overlay-studio.v1';
export interface SyncMetadata { pending: boolean; baseRevision?: string; endpoint?: string }
export function loadDocument(): { document: StudioDocument; warning: string; sync?: SyncMetadata } {
  try {
    const raw = localStorage.getItem(key), metadata = raw ? JSON.parse(raw).__studioSync : undefined;
    const sync: SyncMetadata | undefined = metadata && typeof metadata.pending === 'boolean' ? {
      pending: metadata.pending,
      baseRevision: typeof metadata.baseRevision === 'string' ? metadata.baseRevision : undefined,
      endpoint: typeof metadata.endpoint === 'string' ? metadata.endpoint : undefined,
    } : undefined;
    return { document: raw ? parseDocument(raw) : initialDocument(), warning: '', sync };
  }
  catch { return { document: initialDocument(), warning: 'Saved settings could not be read. Original data is preserved. Restore backup or explicitly save defaults.' }; }
}
export function saveDocument(d: StudioDocument, sync?: SyncMetadata) {
  const normalized = documentSchema.parse(d);
  const previous = localStorage.getItem(key);
  let validPrevious = false;
  let previousDocument: StudioDocument | undefined;
  if (previous) { try { previousDocument = parseDocument(previous); validPrevious = true; } catch { /* Parse errors alone classify the original as invalid. */ } }
  if (previous && validPrevious) {
    if (JSON.parse(previous).version === 1 && !localStorage.getItem(`${key}.original-v1`)) localStorage.setItem(`${key}.original-v1`, previous);
    // Acknowledgements change metadata only: keep the last actual document backup.
    if (JSON.parse(previous).version === 1 || JSON.stringify(previousDocument) !== JSON.stringify(normalized)) localStorage.setItem(`${key}.backup`, previous);
  } else if (previous) localStorage.setItem(`${key}.invalid`, previous);
  // Document and the revision it was edited against commit together.
  localStorage.setItem(key, JSON.stringify({ ...normalized, ...(sync ? { __studioSync: sync } : {}) }));
}
export function restoreBackup(): StudioDocument {
  const text = localStorage.getItem(`${key}.backup`);
  if (!text) throw new Error('No backup is available.');
  return parseDocument(text);
}
