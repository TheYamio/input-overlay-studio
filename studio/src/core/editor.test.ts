import { describe, expect, it } from 'vitest';
import { documentSchema, initialDocument, makeModule, parseDocument } from './config';
import { copyName, patchModule } from './editing';
import { capsFor } from './skins';
import { nativeOverlayBase } from './obs';
import { assetSchema } from './visual';
import artwork from '../../../ws-server/src-tauri/schema/test-artwork.json';

describe('editor geometry and invariants', () => {
  it('duplicates maximum-length names without splitting emoji or exceeding the schema limit', () => {
    expect(copyName('A'.repeat(100))).toHaveLength(100);
    expect(copyName('😀'.repeat(50))).toBe('😀'.repeat(47) + ' copy');
  });
  it.each([0, 8, 30])('painted key bounds match the image plane at gap %s', gap => {
    const m = makeModule('keyboard'); m.gap = gap; m.keys[0].w = 217;
    const layout = capsFor(m);
    expect(layout.w).toBe(Math.max(...layout.caps.map(k => k.x + k.w)));
    expect(layout.h).toBe(Math.max(...layout.caps.map(k => k.y + k.h)));
  });
  it('rejects invalid imported positions without changing the source', () => {
    const d = initialDocument(), m = d.profiles[0].modules[0]; m.x = 1920; m.y = -200; m.keys[0].style = { accent: '#ff0000' };
    d.presets.push({ id: 'preset', name: 'Outside', theme: 'Obsidian', modules: [structuredClone(m)] });
    expect(()=>parseDocument(JSON.stringify(d))).toThrow();
    expect(d.profiles[0].modules[0]).toMatchObject({x:1920,y:-200,keys:m.keys});
  });
  it('rejects duplicate preset and preset-module identities', () => {
    const d = initialDocument(), p = { id: 'preset', name: 'Test', theme: 'Obsidian' as const, modules: [makeModule('keyboard')] };
    d.presets = [p, structuredClone(p)]; expect(documentSchema.safeParse(d).success).toBe(false);
    d.presets = [p]; p.modules.push(structuredClone(p.modules[0])); expect(documentSchema.safeParse(d).success).toBe(false);
  });
  it('protects locked coordinates and size including mode changes', () => {
    const m = makeModule('mouse'); m.locked = true; const before = { x: m.x, y: m.y, w: m.w, h: m.h };
    patchModule(m, { x: 0, y: 0, w: 220, h: 300, mouseMode: 'Mouse Diagram' });
    expect(m).toMatchObject({ ...before, mouseMode: 'Mouse Diagram' });
    patchModule(m, { locked: false, x: 0 }); expect(m.x).toBe(before.x);
    patchModule(m, { x: 0 }); expect(m.x).toBe(0);
  });
});
describe('imported artwork and OBS availability', () => {
  it('rejects ordinary Base64 text and forged raster dimensions', () => {
    expect(assetSchema.safeParse({ ...artwork, data: 'data:image/png;base64,aGVsbG8=' }).success).toBe(false);
    expect(assetSchema.safeParse({ ...artwork, width: 1 }).success).toBe(false);
    expect(assetSchema.safeParse(artwork).success).toBe(true);
  });
  it('does not construct an OBS URL for a disabled, failed or incomplete HTTP server', () => {
    expect(() => nativeOverlayBase(null)).toThrow('disabled');
    const status = { running: false, host: '127.0.0.1', port: 4456, bind_error: 'inuse', overlay_available: true };
    expect(() => nativeOverlayBase(status)).toThrow('already in use');
    expect(() => nativeOverlayBase({ ...status, running: true, overlay_available: false })).toThrow('missing');
    expect(nativeOverlayBase({ ...status, running: true, host: '0.0.0.0' })).toBe('http://127.0.0.1:4456/studio/overlay.html');
  });
});
