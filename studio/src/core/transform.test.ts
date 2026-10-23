import { describe, expect, it } from 'vitest';
import { resizeBox, resizeDirections, keyLimits } from './transform';
const box = { x: 300, y: 200, w: 400, h: 200 };
describe('canvas resizing', () => {
  it('keeps the opposite edges anchored for all eight directions', () => {
    for (const d of resizeDirections) {
      const r = resizeBox(box, d, 20, 30);
      expect(r.x + r.w).toBe(d.includes('e') ? 720 : 700);
      expect(r.y + r.h).toBe(d.includes('s') ? 430 : 400);
      expect(r.x).toBe(d.includes('w') ? 320 : 300);
      expect(r.y).toBe(d.includes('n') ? 230 : 200);
    }
  });
  it('resizes proportionally with corners anchored and edges centered', () => {
    expect(resizeBox(box, 'nw', -40, -20, undefined, true)).toEqual({ x: 260, y: 180, w: 440, h: 220 });
    expect(resizeBox(box, 'e', 40, 0, undefined, true)).toEqual({ x: 300, y: 190, w: 440, h: 220 });
    expect(resizeBox(box, 's', 0, 20, undefined, true)).toEqual({ x: 280, y: 200, w: 440, h: 220 });
  });
  it('clamps every direction at canvas and minimum bounds without flipping', () => {
    for (const ratio of [false, true]) for (const direction of resizeDirections) for (const delta of [-10000, 10000]) {
      const r = resizeBox(box, direction, delta, delta, undefined, ratio);
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1920.000001); expect(r.y + r.h).toBeLessThanOrEqual(1080.000001);
      expect(r.w).toBeGreaterThanOrEqual(40); expect(r.h).toBeGreaterThanOrEqual(30);
      if (ratio) expect(r.w / r.h).toBeCloseTo(2, 5);
    }
  });
  it('snaps the moving edges and preserves the opposite anchors', () => {
    expect(resizeBox(box, 'nw', 13, 9, undefined, false, 8)).toEqual({ x: 312, y: 208, w: 388, h: 192 });
  });
  it('respects independent key position and size limits', () => {
    const key = { x: 990, y: 990, w: 100, h: 100 };
    for (const ratio of [false, true]) for (const direction of resizeDirections) for (const delta of [-10000, 10000]) {
      const r = resizeBox(key, direction, delta, delta, keyLimits, ratio);
      for (const axis of ['x', 'y'] as const) { expect(r[axis]).toBeGreaterThanOrEqual(0); expect(r[axis]).toBeLessThanOrEqual(1000); }
      for (const axis of ['w', 'h'] as const) { expect(r[axis]).toBeGreaterThanOrEqual(1); expect(r[axis]).toBeLessThanOrEqual(1000); }
    }
  });
});
