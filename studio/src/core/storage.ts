import { initialDocument, MigrationError, parseDocument, type StudioDocument } from './config';
import type { PreservedConfiguration } from './compatibility/preserved';
import { checkDocumentVersion } from './document-version.ts';
import {serializeDocument} from './document-serialization';
import {draftStamp,encodeDraft,readDraft,replayDraft} from './draft-journal';
import {documentSnapshot} from './document-snapshot';
const key = 'input-overlay-studio.document';
const journalKey=key+'.draft';
export interface SyncMetadata { pending: boolean; baseRevision?: string; endpoint?: string }
let committed:{raw:string;json:string}|undefined;
let journalBase:{raw:string;document:StudioDocument;stamp:string}|undefined;
let knownJournal:string|undefined;
let journalSnapshot:{raw:string;base:string;document:StudioDocument;sync:SyncMetadata}|undefined;
export function loadDocument(): { document: StudioDocument; warning: string; sync?: SyncMetadata; unsupported?:PreservedConfiguration } {
  let raw:string|null=null,protectedText='';let fallback:StudioDocument|undefined;
  try {
    raw = localStorage.getItem(key);protectedText=raw??'';const source=raw?JSON.parse(raw):undefined;
    // Inspect the version before import-size validation. A large future file is
    // still a future file, never a corrupt source that defaults may overwrite.
    if(raw)checkDocumentVersion(source);
    const metadata = source?.__studioSync;
    let sync: SyncMetadata | undefined = metadata && typeof metadata.pending === 'boolean' ? {
      pending: metadata.pending,
      baseRevision: typeof metadata.baseRevision === 'string' ? metadata.baseRevision : undefined,
      endpoint: typeof metadata.endpoint === 'string' ? metadata.endpoint : undefined,
    } : undefined;
    let document=raw?parseDocument(raw):initialDocument();fallback=document;
    if(raw)committed={raw,json:JSON.stringify(document)};
    const draft=localStorage.getItem(journalKey);
    journalSnapshot=undefined;
    if(draft){protectedText=draft;const journal=readDraft(draft);if(raw&&journal.base===draftStamp(raw)){document=replayDraft(document,journal);sync=journal.sync;knownJournal=draft;journalSnapshot={raw:draft,base:raw,document,sync};}}
    return { document, warning: '', sync };
  }
  catch(error) {
    if(error instanceof MigrationError && error.code==='future-version')return {document:fallback??initialDocument(),warning:error.message,unsupported:{source:'local',version:error.sourceVersion!,reason:error.message,text:protectedText}};
    return { document: fallback??initialDocument(), warning: 'Saved settings could not be read. Original data is preserved. Restore backup or explicitly save defaults.' };
  }
}
function verifiedBackup(destination:string,original:string) {
  localStorage.setItem(destination,original);
  if(localStorage.getItem(destination)!==original)throw Error('Backup verification failed. The original configuration is unchanged.');
}
function preserveUnknownJournal(raw:string|null){
  if(!raw||raw===knownJournal)return;
  try{readDraft(raw);}catch(error){if(error instanceof MigrationError)throw error;}
  // A journal changed by another context is preserved before an explicit save.
  verifiedBackup(journalKey+'.invalid',raw);
}
export function saveDraftDocument(document:StudioDocument,sync:SyncMetadata){
  const raw=localStorage.getItem(key);if(!raw){saveDocument(document,sync);return;}
  preserveUnknownJournal(localStorage.getItem(journalKey));
  if(journalBase?.raw!==raw){
    const base=committed?.raw===raw?JSON.parse(committed.json) as StudioDocument:parseDocument(raw);
    journalBase={raw,document:base,stamp:draftStamp(raw)};
  }
  const snapshot=documentSnapshot(document),text=encodeDraft(journalBase.document,snapshot,journalBase.stamp,sync);
  if(text===null){saveDocument(document,sync);return;}
  localStorage.setItem(journalKey,text);knownJournal=text;journalSnapshot={raw:text,base:raw,document:snapshot,sync:{...sync}};
}
export function saveDocument(d: StudioDocument, sync?: SyncMetadata) {
  const prepared=serializeDocument(d);
  const previous = localStorage.getItem(key);
  const draft=localStorage.getItem(journalKey);preserveUnknownJournal(draft);
  let validPrevious = false;
  let previousJson:string|undefined;
  if(previous&&previous===committed?.raw){validPrevious=true;previousJson=committed.json;}
  else if (previous) { try { checkDocumentVersion(JSON.parse(previous));previousJson = JSON.stringify(parseDocument(previous)); validPrevious = true; } catch(error) {
    // A newer format is not a damaged file and may never be downgraded here.
    if(error instanceof MigrationError && error.code==='future-version')throw error;
  } }
  if (previous && validPrevious) {
    // Undo or replacement before the checkpoint must back up the most recent
    // durable draft, rather than an older primary file from before the gesture.
    let backup=previous;
    if(journalSnapshot?.base===previous&&journalSnapshot.raw===draft&&journalSnapshot.document!==d){
      const latest=serializeDocument(journalSnapshot.document);
      if(latest.normalizedJson!==prepared.normalizedJson){previousJson=latest.normalizedJson;backup=latest.wireJson.slice(0,-1)+',"__studioSync":'+JSON.stringify(journalSnapshot.sync)+'}';}
    }
    // Acknowledgements change metadata only: keep the last actual document backup.
    if (previousJson !== prepared.normalizedJson) verifiedBackup(`${key}.backup`, backup);
  } else if (previous) verifiedBackup(`${key}.invalid`, previous);
  // Document and the revision it was edited against commit together.
  // A new checkpoint invalidates the previous journal even if cleanup fails or
  // Undo happens to produce the same document bytes as the earlier checkpoint.
  const metadata={...sync,checkpoint:crypto.randomUUID()};
  const raw=prepared.wireJson.slice(0,-1)+',"__studioSync":'+JSON.stringify(metadata)+'}';
  localStorage.setItem(key,raw);
  committed={raw,json:prepared.normalizedJson};
  journalBase=undefined;knownJournal=undefined;journalSnapshot=undefined;
  try{localStorage.removeItem?.(journalKey);}catch{/* Old journal has a different base and is harmless. */}
}
export function restoreBackup(): StudioDocument {
  const text = localStorage.getItem(`${key}.backup`);
  if (!text) throw new Error('No backup is available.');
  return parseDocument(text);
}
