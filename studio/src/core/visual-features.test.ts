import { describe, expect, it } from 'vitest';
import { artworkBounds, linkArtwork, setModuleImage } from './artwork-groups';
import { documentSchema, factoryModules, initialDocument, themeNames } from './config';
import { exportPreset, importPreset } from './presets';
import { previewDepth } from './preview';
import { tilePlane } from './skins';
describe('visual features', () => {
  it('computes group coverage from painted surfaces at different module scales', () => {
    const d = initialDocument(), p = d.profiles[0], [keyboard, mouse] = p.modules;
    keyboard.keys = [{ id: 'one', code: 65, label: 'A', x: 0, y: 0, w: 50, h: 50 }]; Object.assign(keyboard, { x: 100, y: 200, w: 100, h: 100 }); Object.assign(mouse, { x: 500, y: 220, w: 300, h: 110 });
    linkArtwork(p, keyboard.id, mouse.id, true); expect(artworkBounds(keyboard, p.modules)).toEqual({ x: 100, y: 200, w: 700, h: 130 });
    mouse.visible = false; expect(artworkBounds(keyboard, p.modules)).toEqual({ x: 100, y: 200, w: 700, h: 130 });
  });
  it('ignores empty modules when finding the artwork region', () => {
    const p = initialDocument().profiles[0], [a, b] = p.modules; a.keys = []; Object.assign(b, { x: 500, y: 220, w: 300, h: 110 });
    linkArtwork(p, a.id, b.id, true); expect(artworkBounds(a, p.modules)).toEqual({ x: 500, y: 220, w: 300, h: 110 });
    b.buttons = []; expect(artworkBounds(a, p.modules).w).toBe(1);
  });
  it('updates linked settings together and detaches without deleting the picture', () => {
    const p = initialDocument().profiles[0], [a, b] = p.modules; linkArtwork(p, a.id, b.id, true);
    setModuleImage(p.modules, b.id, { ...b.image, flipX: true, x: 12, opacity: .6 }); expect(a.image).toEqual(b.image); expect(a.image).not.toBe(b.image);
    linkArtwork(p, a.id, b.id, false); expect(b.image.groupId).toBeUndefined(); expect(b.image.flipX).toBe(true); expect(b.image.x).toBe(12);
    setModuleImage(p.modules, a.id, { ...a.image, x: 40 }); expect(b.image.x).toBe(12);
  });
  it('rejects inconsistent groups and grouping non-interactive modules', () => {
    const d = initialDocument(), p = d.profiles[0], [a, b, trail] = p.modules; linkArtwork(p, a.id, b.id, true); expect(documentSchema.safeParse(d).success).toBe(true);
    b.image.scale = 2; expect(documentSchema.safeParse(d).success).toBe(false); b.image = structuredClone(a.image);
    trail.image = structuredClone(a.image); expect(documentSchema.safeParse(d).success).toBe(false);
  });
  it('remaps exported group identities while retaining shared transforms and legacy v2 support', () => {
    const d = initialDocument(), p = d.profiles[0], [a, b] = p.modules; expect(documentSchema.safeParse(d).success).toBe(true);
    linkArtwork(p, a.id, b.id, true); setModuleImage(p.modules, a.id, { ...a.image, flipY: true });
    d.presets.push({ id: 'saved', name: 'Linked', theme: p.theme, modules: structuredClone(p.modules) });
    const imported = importPreset(exportPreset(d, 'saved')).preset; expect(imported.modules[0].image.groupId).not.toBe(a.image.groupId); expect(imported.modules[0].image).toEqual(imported.modules[1].image); expect(imported.modules[0].image.flipY).toBe(true);
  });
  it('has seven valid factory compositions with different geometry and visibility', () => {
    const signatures = new Set<string>();
    for (const theme of themeNames) { const d = initialDocument(), modules = factoryModules(theme); d.profiles[0].modules = modules; expect(documentSchema.safeParse(d).success).toBe(true); signatures.add(JSON.stringify(modules.map(m => [m.x, m.y, m.w, m.h, m.visible, m.layout, m.mouseMode]))); }
    expect(signatures.size).toBe(7);
  });
  it('separates idle, physical buttons, analog depth and wheel directions in previews', () => {
    expect(previewDepth({ mode: 'Input', depth: .5 }, false, 65)).toBeUndefined(); expect(previewDepth({ mode: 'Idle', depth: .5 }, false, 65)).toBe(0);
    expect(previewDepth({ mode: 'Pressed', depth: .5 }, true, 1)).toBe(1); expect(previewDepth({ mode: 'Pressed', depth: .5 }, true, 6)).toBe(0);
    expect(previewDepth({ mode: 'Analog', depth: .37 }, false, 65)).toBe(.37); expect(previewDepth({ mode: 'Analog', depth: .37 }, true, 1)).toBe(0);
    expect(previewDepth({ mode: 'Scroll up', depth: .5 }, true, 6)).toBe(1); expect(previewDepth({ mode: 'Scroll down', depth: .5 }, true, 6)).toBe(0); expect(previewDepth({ mode: 'Scroll down', depth: .5 }, true, 7)).toBe(1);
  });
  it.each([[1000, 20], [20, 1000], [320, 240]])('covers corners of a %s × %s tiled layout at all rotations', (w, h) => {
    const t = tilePlane(w, h, 0, 0);
    for (let degrees = -180; degrees <= 180; degrees += 15) for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) {
      const radians = degrees * Math.PI / 180, a = x * Math.cos(radians) + y * Math.sin(radians), b = -x * Math.sin(radians) + y * Math.cos(radians);
      expect(Math.abs(a)).toBeLessThan(t.size / 2); expect(Math.abs(b)).toBeLessThan(t.size / 2);
    }
  });
});
