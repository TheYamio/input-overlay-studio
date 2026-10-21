import { describe, expect, it } from 'vitest';
import { fitStage, alignModule, resetModulePosition, snapPosition } from './layout';
import { makeModule } from './config';
import { decodeSnapshot, InputEngine } from './input';

describe('logical scene and layout', () => {
  it.each([[1920, 1080, 1, 0, 0], [2560, 1440, 4 / 3, 0, 0], [1280, 720, 2 / 3, 0, 0], [1920, 1200, 1, 0, 60], [2560, 1080, 1, 320, 0]])('fits %i × %i without stretching', (w, h, scale, x, y) => {
    expect(fitStage(w, h)).toEqual({ scale, x, y });
  });
  it('aligns edges and centers in logical coordinates', () => {
    const m = makeModule('trail');
    expect(alignModule(m, 'right')).toEqual({ x: 1920 - m.w, y: m.y });
    expect(alignModule(m, 'center').x).toBe((1920 - m.w) / 2);
    expect(alignModule(m, 'bottom').y).toBe(1080 - m.h);
    expect(resetModulePosition({ ...m, w: 1920, h: 1080 })).toEqual({ x: 0, y: 0 });
  });
  it('snaps to neighbor edges and provides actual matching guides', () => {
    const m = { ...makeModule('keyboard'), x: 501, y: 100, w: 80, h: 80 };
    const neighbor = { ...makeModule('mouse'), x: 500, y: 300, w: 80, h: 80 };
    const result = snapPosition(m, [m, neighbor], 4);
    expect(result.x).toBe(500); expect(result.guides).toContainEqual({ axis: 'x', value: 580 });
  });
  it('ignores hidden modules and clamps snapped placement to stage bounds', () => {
    const m = { ...makeModule('keyboard'), x: 499, y: 100, w: 80, h: 80 };
    const neighbor = { ...makeModule('mouse'), x: 500, visible: false };
    expect(snapPosition(m, [neighbor], 2).x).toBe(496);
    expect(snapPosition({ ...m, x: 3000, y: -10 }, [], 2)).toMatchObject({ x: 1840, y: 0 });
  });
});
describe('state snapshots', () => {
  it('restores held analog keys and mouse buttons without click/release replay', () => {
    const engine = new InputEngine(); const events: string[] = [];
    engine.listeners.add(e => events.push(e.event_type));
    engine.applySnapshot({ sequence: 1, keys: [{ rawcode: 87, depth: .4 }, { rawcode: 163, depth: 1 }], buttons: [1, 2] });
    expect(engine.keys[87]).toBeCloseTo(.4); expect(engine.keys[163]).toBe(1); expect(engine.buttons[2]).toBe(1);
    expect(events).toEqual(['state_restored']);
    engine.setDistance(42); expect(engine.keys[87]).toBeCloseTo(.4); expect(engine.buttons[1]).toBe(1); expect(engine.distanceCm).toBe(42);
  });
  it('rejects malformed and duplicate snapshot records', () => {
    const good = { sequence: 5, keys: [{ rawcode: 87, depth: .5 }], buttons: [2] };
    expect(decodeSnapshot(good)).toEqual(good);
    for (const value of [{ ...good, sequence: -1 }, { ...good, sequence: Infinity }, { ...good, keys: [null] }, { ...good, keys: [...good.keys, ...good.keys] }, { ...good, buttons: [2, 2] }, { ...good, keys: [{ rawcode: 87, depth: 2 }] }]) expect(decodeSnapshot(value)).toBeNull();
  });
});
