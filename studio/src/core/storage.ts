import { documentSchema, initialDocument, MigrationError, parseDocument, type StudioDocument } from './config';
import type { PreservedConfiguration } from './compatibility/preserved';
import { checkDocumentVersion } from './document-version.ts';
import { encodeDocument } from './config';
const key = 'input-overlay-studio.document';
export interface SyncMetadata { pending: boolean; baseRevision?: string; endpoint?: string }
export function loadDocument(): { document: StudioDocument; warning: string; sync?: SyncMetadata; unsupported?:PreservedConfiguration } {
  let raw:string|null=null;
  try {
    raw = localStorage.getItem(key);const source=raw?JSON.parse(raw):undefined;
    // Inspect the version before import-size validation. A large future file is
    // still a future file, never a corrupt source that defaults may overwrite.
    if(raw)checkDocumentVersion(source);
    const metadata = source?.__studioSync;
    const sync: SyncMetadata | undefined = metadata && typeof metadata.pending === 'boolean' ? {
      pending: metadata.pending,
      baseRevision: typeof metadata.baseRevision === 'string' ? metadata.baseRevision : undefined,
      endpoint: typeof metadata.endpoint === 'string' ? metadata.endpoint : undefined,
    } : undefined;
    return { document: raw ? parseDocument(raw) : initialDocument(), warning: '', sync };
  }
  catch(error) {
    if(error instanceof MigrationError && error.code==='future-version')return {document:initialDocument(),warning:error.message,unsupported:{source:'local',version:error.sourceVersion!,reason:error.message,text:raw!}};
    return { document: initialDocument(), warning: 'Saved settings could not be read. Original data is preserved. Restore backup or explicitly save defaults.' };
  }
}
function verifiedBackup(destination:string,original:string) {
  localStorage.setItem(destination,original);
  if(localStorage.getItem(destination)!==original)throw Error('Backup verification failed. The original configuration is unchanged.');
}
export function saveDocument(d: StudioDocument, sync?: SyncMetadata) {
  const normalized = documentSchema.parse(d);
  const wire=encodeDocument(normalized);
  const previous = localStorage.getItem(key);
  let validPrevious = false;
  let previousDocument: StudioDocument | undefined;
  if (previous) { try { checkDocumentVersion(JSON.parse(previous));previousDocument = parseDocument(previous); validPrevious = true; } catch(error) {
    // A newer format is not a damaged file and may never be downgraded here.
    if(error instanceof MigrationError && error.code==='future-version')throw error;
  } }
  if (previous && validPrevious) {
    // Acknowledgements change metadata only: keep the last actual document backup.
    if (JSON.stringify(previousDocument) !== JSON.stringify(normalized)) verifiedBackup(`${key}.backup`, previous);
  } else if (previous) verifiedBackup(`${key}.invalid`, previous);
  // Document and the revision it was edited against commit together.
  localStorage.setItem(key, JSON.stringify({ ...wire, ...(sync ? { __studioSync: sync } : {}) }));
}
export function restoreBackup(): StudioDocument {
  const text = localStorage.getItem(`${key}.backup`);
  if (!text) throw new Error('No backup is available.');
  return parseDocument(text);
}
