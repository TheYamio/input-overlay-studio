import { documentKey, documentStorage, type SyncMetadata } from '../storage';
import type { StudioDocument } from '../config';
import { randomId } from '../uuid';

const prefix = documentKey + '.editor.';
const tabKey = documentKey + '.tab';
const resumeKey = documentKey + '.resume';
const branchPattern = /^[0-9]{13}-[a-f0-9-]{36}$/;

function remember(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Durable drafts remain discoverable from localStorage without tab storage.
  }
}

function remembered(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function availableDrafts() {
  const drafts: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (branchPattern.test(id)) drafts.push(id);
    }
  } catch { /* The shared storage adapter reports inaccessible storage. */ }
  return drafts.sort().reverse();
}

function removeDraft(id: string) {
  const key = prefix + id;
  localStorage.removeItem(key);
  for (const extension of ['.draft', '.backup', '.invalid', '.draft.invalid']) {
    localStorage.removeItem(key + extension);
  }
}

export function createBrowserDrafts() {
  const shared = documentStorage(documentKey);
  const id = Date.now() + '-' + randomId();
  const owned = documentStorage(prefix + id);
  const drafts = availableDrafts();
  const requested = remembered(resumeKey);
  const tab = remembered(tabKey);
  remember(resumeKey, null);
  const inherited = [requested, tab, tab === 'shared' ? null : drafts[0]]
    .find(candidate => candidate && drafts.includes(candidate));
  const source = inherited ? documentStorage(prefix + inherited) : shared;
  let opened = source.load();
  let ownsDraft = false;
  let active = inherited;
  if (inherited) remember(tabKey, inherited);

  function claim() {
    if (ownsDraft) return;
    ownsDraft = true;
    active = id;
    remember(tabKey, id);
  }

  return {
    storage: {
      load: () => opened,
      save(document: StudioDocument, sync: SyncMetadata) {
        if (sync.pending) {
          owned.save(document, sync);
          claim();
        } else {
          shared.save(document, sync);
          if (ownsDraft) removeDraft(id);
          ownsDraft = false;
          active = undefined;
          remember(tabKey, 'shared');
          opened = { document, sync, warning: '' };
        }
      },
      saveDraft(document: StudioDocument, sync: SyncMetadata) {
        if (!ownsDraft) {
          owned.save(opened.document, sync);
          claim();
        }
        owned.saveDraft(document, sync);
      },
      backup() {
        if (ownsDraft && localStorage.getItem(prefix + id + '.backup')) return owned.backup();
        if (ownsDraft && !opened.warning) return opened.document;
        if (inherited && localStorage.getItem(prefix + inherited + '.backup')) return source.backup();
        return shared.backup();
      },
    },
    alternatives() {
      return availableDrafts().filter(candidate => candidate !== active).map(candidate => ({
        id: candidate,
        time: new Date(Number(candidate.slice(0, 13))),
      }));
    },
    open(candidate: string) {
      if (!availableDrafts().includes(candidate)) return false;
      sessionStorage.setItem(resumeKey, candidate);
      return true;
    },
    discard(candidate: string) {
      if (!availableDrafts().includes(candidate) || candidate === active) return false;
      removeDraft(candidate);
      return true;
    },
  };
}
