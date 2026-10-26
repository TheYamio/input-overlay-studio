import { describe, expect, it } from 'vitest';
import { applyTheme, cm360, documentSchema, encodeDocument, initialDocument, parseDecimal, parseDocument, themeNames } from './config';
import { decodeInput, InputEngine, PointRing } from './input';
import { obsUrl } from './connection';

describe('sensitivity and profile validation', () => {
  it('CS2 800 DPI / 1.3 / .022 is 39.97 cm/360', () => {
    expect(cm360(initialDocument().gameProfiles[0])).toBeCloseTo(39.965034965, 6);
  });
  it.each([[0, 1, .022], [800, -1, .022], [800, 1, 0], [NaN, 1, .022], [Infinity, 1, .022]])('rejects invalid values %s %s %s', (dpi, sensitivity, yaw) => {
    const d = initialDocument(); Object.assign(d.gameProfiles[0], { dpi, sensitivity, yaw });
    expect(documentSchema.safeParse(d).success).toBe(false); expect(cm360(d.gameProfiles[0])).toBeNull();
  });
  it('does not assume Source scale for KovaaK’s', () => {
    const p = initialDocument().gameProfiles[0]; p.game = 'KovaaK’s'; p.scale = 'Unknown'; expect(cm360(p)).toBeNull();
    p.scale = 'Valorant'; expect(cm360(p)).toBeCloseTo(914.4 / (800 * 1.3 * .07));
    p.scale = 'Manual cm/360'; p.manualCm = 42; expect(cm360(p)).toBe(42);
    p.scale = 'Custom yaw'; p.yaw = .01; expect(cm360(p)).toBeCloseTo(87.9230769);
  });
  it('parses decimal commas while rejecting non-decimal numeric formats', () => {
    expect(parseDecimal(' 1,30 ')).toBe(1.3); expect(parseDecimal('1.3')).toBe(1.3);
    for (const bad of ['0', '-1', 'NaN', 'Infinity', '1e4', '0x20', '', '1,2,3']) expect(parseDecimal(bad)).toBeNull();
  });
  it('validates active profile and module identities', () => {
    const d = initialDocument(); d.activeProfileId = 'missing'; expect(documentSchema.safeParse(d).success).toBe(false);
    d.activeProfileId = d.profiles[0].id; d.profiles[0].modules.push(d.profiles[0].modules[0]); expect(documentSchema.safeParse(d).success).toBe(false);
  });
  it('roundtrips all factory themes through the same schema', () => {
    for (const theme of themeNames) { const d = initialDocument(); d.profiles[0].theme = theme; d.profiles[0].modules = applyTheme(d.profiles[0].modules, theme); expect(encodeDocument(parseDocument(JSON.stringify(encodeDocument(d))))).toEqual(encodeDocument(d)); }
  });
  it('strips credentials and rejects unsupported versions and oversized imports', () => {
    const d = initialDocument(); const text = JSON.stringify({ ...d, token: 'secret' });
    expect(()=>parseDocument(text)).toThrow();
    expect(() => parseDocument(JSON.stringify({ ...d, version: 99 }))).toThrow();
    expect(() => parseDocument(' '.repeat(2_000_001))).toThrow();
  });
});
describe('input reliability and distance', () => {
  it('preserves simultaneous keys and clears them on disconnect', () => {
    const e = new InputEngine(); for (const rawcode of [87, 65, 160, 161, 162, 32]) e.ingest({ event_type: 'key_pressed', rawcode });
    e.ingest({ event_type: 'key_released', rawcode: 65 }); expect(e.keys[87]).toBe(1); expect(e.keys[65]).toBe(0); expect(e.keys[161]).toBe(1);
    e.ingest({ event_type: 'mouse_pressed', button: 1 }); e.ingest({ event_type: 'mouse_pressed', button: 2 }); expect(e.buttons[1] + e.buttons[2]).toBe(2);
    e.reset(); expect(e.keys.some(Boolean)).toBe(false); expect(e.buttons.some(Boolean)).toBe(false);
  });
  it('preserves analog depth and wheel sign', () => {
    const e = new InputEngine(); e.ingest({ event_type: 'analog_depth', rawcode: 87, depth: .4 }); expect(e.keys[87]).toBeCloseTo(.4);
    e.ingest({ event_type: 'mouse_wheel', rotation: -1 }); expect(e.buttons[6]).toBe(1); expect(e.buttons[7]).toBe(0);
  });
  it('integrates original path even when relative vectors cancel', () => {
    const e = new InputEngine(); e.dpi = 800; e.ingest({ event_type: 'mouse_moved', dx: 0, dy: 0, distance_counts: 1600 }); expect(e.distanceCm).toBeCloseTo(5.08);
    e.dpi = 1600; e.ingest({ event_type: 'mouse_moved', dx: 1600, dy: 0, distance_counts: 1600 }); expect(e.distanceCm).toBeCloseTo(7.62);
  });
  it('accepts an authoritative distance without double-counting', () => {
    const e = new InputEngine(); e.ingest({ event_type: 'mouse_moved', dx: 2, dy: 3, distance_counts: 5, distance_cm: 100 }); expect(e.distanceCm).toBe(100);
  });
  it.each([null, [], { event_type: 'key_pressed', rawcode: 999 }, { event_type: 'analog_depth', rawcode: 87, depth: NaN }, { event_type: 'mouse_moved', dx: 0, dy: Infinity }, { event_type: 'mouse_pressed', button: 1.5 }, { event_type: 'mouse_moved', dx: 0, dy: 0, distance_counts: -1 }])('ignores malformed packets %j', value => expect(decodeInput(value)).toBeNull());
  it.each([1000, 2000, 4000, 8000])('processes a synthetic minute at %i Hz with bounded storage', hz => {
    const e = new InputEngine(), ring = new PointRing(512);
    for (let i = 0; i < hz * 60; i++) { const dx = i % 2 ? 3 : -3, dy = i % 2 ? 4 : -4; e.ingest({ event_type: 'mouse_moved', dx, dy, distance_counts: 5 }, i * 1000 / hz); if (i % Math.ceil(hz / 60) === 0) ring.push(dx, dy, i, 5); }
    expect(e.distanceCm).toBeCloseTo(hz * 60 * 5 * 2.54 / 800, 5); expect(ring.length).toBeLessThanOrEqual(512); expect(ring.data.byteLength).toBe(512 * 4 * 8);
  });
  it('ring overwrites the oldest samples without resizing', () => { const ring = new PointRing(3); for (let i = 0; i < 10; i++) ring.push(i, i, i, i); expect(ring.length).toBe(3); expect(ring.data[ring.index(0)]).toBe(7); expect(ring.data[ring.index(2)]).toBe(9); });
  it('keeps credentials out of HTTP query strings', () => { const url = new URL(obsUrl({ url: 'ws://127.0.0.1:4455', token: 'test-token' }, 'http://127.0.0.1:4456/studio/overlay.html')); expect(url.search).toBe(''); expect(url.hash).toContain('test-token'); expect(url.hash).not.toContain('demo'); });
});
