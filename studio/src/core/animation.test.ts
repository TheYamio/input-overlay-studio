import { describe, expect, it } from 'vitest';
import { animationSettings, PressTimeline } from './animation';
import { documentSchema, initialDocument } from './config';
import { resolvedStyle } from './skins';
import { applyPresetColors } from './preset-colors';

describe('animation timing', () => {
  it('retains legacy effects without adding new fields to older documents', () => {
    expect(animationSettings({ effect: 'Instant' })).toMatchObject({ motion: 'None', lighting: 'Fill', pressMs: 0, releaseMs: 0 });
    expect(animationSettings({ effect: 'Glow' })).toMatchObject({ motion: 'Press', lighting: 'Fill + glow' });
    expect(animationSettings({ effect: 'Analog Fill' }).lighting).toBe('Analog Fill');
    expect(animationSettings({ effect: 'Instant', motion: 'Scale', pressDuration: 300 }).pressMs).toBe(300);
    expect(animationSettings({ effect: 'Instant', secondaryColor: '#ff0000' }).pressMs).toBe(0);
    const d = initialDocument(); expect(documentSchema.parse(d).profiles[0].modules[0].appearance.motion).toBeUndefined();
  });
  it('separates onset delay from delayed release', () => {
    const t = new PressTimeline(); t.input(1, 0, 200, 300);
    expect(t.advance(199)).toBe(0); expect(t.advance(200)).toBe(1);
    t.input(0, 400, 200, 300); expect(t.advance(699)).toBe(1); expect(t.advance(700)).toBe(0); expect(t.deadline).toBe(Infinity);
  });
  it('preserves a tap shorter than its onset delay', () => {
    const t = new PressTimeline(); t.input(1, 0, 900, 0); t.input(0, 5, 900, 0);
    expect(t.advance(899)).toBe(0); expect(t.advance(900)).toBe(1); expect(t.advance(964)).toBe(1); expect(t.advance(965)).toBe(0);
  });
  it('keeps short taps visible when a backgrounded frame arrives late', () => {
    const t = new PressTimeline(); t.input(1, 0, 100, 0); t.input(0, 2, 100, 0);
    expect(t.advance(3000)).toBe(1); expect(t.advance(3065)).toBe(0);
  });
  it('cancels a scheduled release on re-press without accumulating timers', () => {
    const t = new PressTimeline(); t.input(1, 0, 0, 300); t.advance(0); t.input(0, 100, 0, 300); t.input(1, 200, 0, 300);
    expect(t.advance(401)).toBe(1); expect(t.deadline).toBe(Infinity);
    for (let i = 0; i < 1000; i++) { t.input(0, 500 + i * 2, 0, 300); t.input(1, 501 + i * 2, 0, 300); }
    expect(t.advance(5000)).toBe(1); expect(t.deadline).toBe(Infinity);
  });
  it('updates analog depth without restarting a held key', () => {
    const t = new PressTimeline(); t.input(.2, 0, 100, 0); t.input(.7, 50, 100, 0);
    expect(t.advance(100)).toBe(.7); t.input(.35, 150, 100, 0); expect(t.advance(150)).toBe(.35);
  });
  it('resets every pending transition on disconnect and restores held snapshots immediately', () => {
    const t = new PressTimeline(); t.input(1, 0, 1000, 0); t.reset(); expect(t.advance(5000)).toBe(0); expect(t.deadline).toBe(Infinity);
    t.reset(.6); expect(t.advance(6000)).toBe(.6); expect(t.logical).toBe(.6);
  });
  it('resolves individual overrides and preserves motion when transferring palettes', () => {
    const d = initialDocument(), m = d.profiles[0].modules[0];
    Object.assign(m.appearance, { motion: 'Bounce', lighting: 'Gradient', secondaryColor: '#abcdef', pressDelay: 150 });
    m.keys[0].style = { releaseDelay: 700, motion: 'Lift' };
    expect(animationSettings(resolvedStyle(m, m.keys[0].style))).toMatchObject({ motion: 'Lift', lighting: 'Gradient', pressDelay: 150, releaseDelay: 700 });
    const recolored = applyPresetColors([m], initialDocument().profiles[0].modules)[0];
    expect(animationSettings(resolvedStyle(recolored, recolored.keys[0].style))).toMatchObject({ motion: 'Lift', lighting: 'Gradient', pressDelay: 150, releaseDelay: 700 });
  });
  it('validates bounded timings, enums and per-button overrides', () => {
    const d = initialDocument(), m = d.profiles[0].modules[0];
    Object.assign(m.appearance, { lighting: 'Ripple', motion: 'Bounce', easing: 'Spring', pressDelay: 1000, releaseDelay: 2000, lightingOpacity: .4, motionScale: .8 });
    expect(documentSchema.safeParse(d).success).toBe(true);
    for (const [field, value] of [['pressDelay', 1001], ['releaseDelay', -1], ['motionScale', 2], ['lighting', 'Unknown'], ['lightingOpacity', 1.1]]) {
      const bad = structuredClone(d); Object.assign(bad.profiles[0].modules[0].appearance, { [field]: value }); expect(documentSchema.safeParse(bad).success).toBe(false);
    }
  });
});
