import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialDocument, makeModule, type OverlayModule } from '../../core/config';
import { InputEngine } from '../../core/input';
import { Trail } from './trail-drawing';

afterEach(() => vi.unstubAllGlobals());

function setup(patch: Partial<OverlayModule> = {}) {
  let tx = 0, ty = 0, path: number[][] = [];
  const strokes: { path: number[][]; alpha: number }[] = [], markers: number[][] = [];
  const ctx = {
    globalAlpha: 1,
    setTransform() { tx = ty = 0; },
    clearRect() { strokes.length = markers.length = 0; },
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push([x + tx, y + ty]); },
    lineTo(x: number, y: number) { path.push([x + tx, y + ty]); },
    arc(x: number, y: number) { markers.push([x + tx, y + ty]); },
    stroke() { strokes.push({ path, alpha: this.globalAlpha }); },
    fill() {}, save() {}, restore() {},
    translate(x: number, y: number) { tx += x; ty += y; },
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
  const module = { ...makeModule('trail'), position: 'Always-Centered' as const, w: 400, h: 300,
    scaleMode: 'Manual Scale' as const, scale: 1, center: false, clickEffects: 'Off' as const, ...patch };
  const engine = new InputEngine(), trail = new Trail(module, engine), document = initialDocument();
  return { trail, engine, module, strokes, markers,
    draw: (now: number) => trail.draw(now, document),
    move: (dx: number, dy: number, now: number) => trail.input({ event_type: 'mouse_moved', dx, dy }, now),
  };
}

describe('Always-Centered trail rendering', () => {
  it('centers immediately despite a custom origin, follow delay, or multiple inputs per frame', () => {
    const { trail, module, draw, move, markers, strokes } = setup({ originX: .1, originY: .9 });
    module.trailAppearance.followMs = 2000;
    draw(100);
    expect(markers).toEqual([[200, 150]]);
    const grid = structuredClone(strokes[0]);
    move(0, 0, 100); draw(100);
    move(10, -5, 200); move(10, -5, 200); draw(200);
    expect([trail.cameraX, trail.cameraY]).toEqual([20, -10]);
    expect(markers).toEqual([[200, 150]]);
    expect(strokes[1].path).toEqual([[180, 160], [200, 150]]);
    expect(strokes[0]).toEqual(grid);
    draw(700);
    expect(markers).toEqual([[200, 150]]);
    expect(strokes[1].alpha).toBeCloseTo(1 - 500 / module.duration);
    draw(1401);
    expect(strokes).toEqual([grid]);
    expect(trail.points.length).toBe(0);
  });

  it('scrolls the optional grid opposite to motion and wraps in either direction', () => {
    const { module, draw, move, strokes, markers } = setup({ moveGrid: true });
    module.trailAppearance.gridSpacing = 40;
    move(5, -7, 100); draw(100);
    expect(strokes[0].path[0]).toEqual([35, 0]);
    expect(strokes[0].path).toContainEqual([0, 7]);
    move(-50, 90, 200); draw(200);
    expect(strokes[0].path[0]).toEqual([5, 0]);
    expect(strokes[0].path).toContainEqual([0, 37]);
    expect(markers).toEqual([[200, 150]]);
    module.moveGrid = false; draw(200);
    expect(strokes[0].path[0]).toEqual([0, 0]);
    module.grid = false; draw(200);
    expect(strokes).toHaveLength(1);
  });

  it('honors DPI scaling and centers on mode changes, resize and input reset', () => {
    const { trail, module, engine, draw, move, markers, strokes } = setup({ position: 'Fixed Field', scaleMode: 'DPI Normalized Scale', scale: .5 });
    engine.dpi = 1600;
    move(0, 0, 100); draw(100);
    move(80, 40, 200); draw(200);
    expect(markers).toEqual([[220, 160]]);
    module.position = 'Always-Centered'; draw(200);
    expect(markers).toEqual([[200, 150]]);
    expect(strokes[1].path).toEqual([[180, 140], [200, 150]]);
    module.w = 600; module.h = 200; draw(200);
    expect(markers).toEqual([[300, 100]]);
    trail.input({ event_type: 'input_reset' }, 300); draw(300);
    expect(markers).toEqual([[300, 100]]);
    expect([trail.cameraX, trail.cameraY]).toEqual([0, 0]);
  });

  it.each(['Fixed Field', 'Follow / Recenter'] as const)('preserves %s behavior with the grid option retained', position => {
    const { trail, draw, move, markers, strokes } = setup({ position, moveGrid: true });
    draw(100); move(20, 10, 200); draw(200);
    expect(trail.cameraX).toBeLessThan(20);
    expect(markers[0][0]).toBeGreaterThan(200);
    expect(strokes[0].path[0]).toEqual([0, 0]);
  });
});
