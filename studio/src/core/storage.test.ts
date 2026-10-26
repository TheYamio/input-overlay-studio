import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeDocument, initialDocument, documentSchema, makeModule, parseDocument } from './config';
import { loadDocument, saveDocument } from './storage';
import { utf8Bytes } from './limits';

afterEach(() => vi.unstubAllGlobals());
describe('durable local drafts', () => {
  it('commits pending document and its base revision together across reload', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    const d = initialDocument(); saveDocument(d, { pending: true, baseRevision: 'r1', endpoint: 'ws://local' });
    expect(loadDocument()).toMatchObject({ document: parseDocument(JSON.stringify(encodeDocument(d))), sync: { pending: true, baseRevision: 'r1', endpoint: 'ws://local' } });
    expect(JSON.stringify(loadDocument().document)).not.toContain('__studioSync');
  });
  it('does not misclassify a valid original as corrupt when the backup quota fails', () => {
    const d = initialDocument(), raw = JSON.stringify(encodeDocument(d)), written: string[] = [];
    vi.stubGlobal('localStorage', { getItem: (k:string) => k==='input-overlay-studio.document'?raw:null, setItem: (k: string) => { written.push(k); throw Error('quota'); } });
    d.profiles[0].name = 'Changed';
    expect(() => saveDocument(d)).toThrow('quota');
    expect(written).toEqual(['input-overlay-studio.document.backup']);
  });
  it('does not replace the last real backup when only acknowledging a save', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    const first = initialDocument(); saveDocument(first);
    const next = structuredClone(first); next.profiles[0].name = 'Changed'; saveDocument(next, { pending: true, baseRevision: 'r1' });
    saveDocument(next, { pending: false, baseRevision: 'r2' });
    expect(encodeDocument(parseDocument(data.get('input-overlay-studio.document.backup')!))).toEqual(encodeDocument(first));
  });
  it('counts UTF-8 bytes and roundtrips a large Cyrillic configuration', () => {
    const d = initialDocument(); d.profiles[0].modules = [];
    for (let n = 0; n < 32; n++) {
      const m = makeModule('keyboard', n); m.keys = Array.from({ length: 100 }, (_, i) => ({ id: String(i), code: 65, label: 'Ж'.repeat(100), x: 0, y: 0, w: 54, h: 54 })); d.profiles[0].modules.push(m);
    }
    d.profiles.push({ ...structuredClone(d.profiles[0]), id: 'second' });
    expect(utf8Bytes(JSON.stringify(d))).toBeGreaterThan(1_700_000);
    expect(documentSchema.safeParse(d).success).toBe(true);
    expect(parseDocument(JSON.stringify(encodeDocument(d)))).toEqual(d);
    d.profiles.push({ ...structuredClone(d.profiles[0]), id: 'third' });
    expect(documentSchema.safeParse(d).success).toBe(false);
  });
});
