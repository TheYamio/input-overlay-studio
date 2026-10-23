import { describe, expect, it } from 'vitest';
import { documentSchema, initialDocument } from './config';
import { exportPreset, importPreset, usedShapes } from './presets';
import { boundedPath, shapeSchema, shapeSvg } from './shapes';
import { signaturePreset, signatureShapes } from './signature-preset';
import { resolvedStyle } from './skins';

describe('vector shapes and signature layout', () => {
  it('keeps old v2 documents and partial styles compatible', () => {
    const d = initialDocument(); delete (d as Partial<typeof d>).shapes;
    expect(documentSchema.parse(d).shapes).toEqual({});
    expect(resolvedStyle(d.profiles[0].modules[0], {}).showLabels).toBe(true);
  });
  it('validates the complete signature preset and all device contours', () => {
    const bundle = signaturePreset(), d = initialDocument();
    Object.assign(d, { shapes: bundle.shapes }); d.profiles[0].modules = bundle.preset.modules;
    expect(documentSchema.safeParse(d).success).toBe(true);
    expect(d.profiles[0].modules[0].keys.length).toBeGreaterThan(70);
    expect(usedShapes(d.profiles[0].modules).size).toBe(7);
  });
  it('rejects missing references in modules, keys, mouse buttons and body', () => {
    for (const target of ['module', 'key', 'button', 'body']) {
      const d = initialDocument(), [keyboard, mouse] = d.profiles[0].modules;
      if (target === 'module') keyboard.appearance.shapeId = 'missing';
      if (target === 'key') keyboard.keys[0].style = { shapeId: 'missing' };
      if (target === 'button') mouse.buttonStyles['1'] = { shapeId: 'missing' };
      if (target === 'body') mouse.mouseBodyShapeId = 'missing';
      expect(documentSchema.safeParse(d).success).toBe(false);
    }
  });
  it('exports only referenced shapes and remaps all references when imported', () => {
    const bundle = signaturePreset(), d = initialDocument(); d.presets = [bundle.preset]; d.shapes = { ...bundle.shapes, unused: signatureShapes['sig-up'] };
    const text = exportPreset(d, bundle.preset.id), imported = importPreset(text);
    expect(Object.keys(JSON.parse(text).shapes)).not.toContain('unused');
    expect(Object.keys(imported.shapes)).toHaveLength(7);
    expect([...usedShapes(imported.preset.modules)].every(id => !!imported.shapes[id] && !bundle.shapes[id])).toBe(true);
    d.profiles[0].modules = imported.preset.modules; d.presets = []; d.shapes = imported.shapes;
    expect(documentSchema.safeParse(d).success).toBe(true);
  });
  it('rejects prototype member names as missing shape references', () => {
    const d = initialDocument(); d.profiles[0].modules[0].appearance.shapeId = 'constructor';
    expect(documentSchema.safeParse(d).success).toBe(false);
    delete d.profiles[0].modules[0].appearance.shapeId; d.profiles[0].modules[1].mouseBodyShapeId = 'toString';
    expect(documentSchema.safeParse(d).success).toBe(false);
  });
  it('keeps hidden labels independent of the binding and individual inheritance', () => {
    const d = initialDocument(), keyboard = d.profiles[0].modules[0], key = keyboard.keys[0];
    keyboard.appearance.showLabels = false;
    expect(resolvedStyle(keyboard, key.style).showLabels).toBe(false);
    expect(resolvedStyle(keyboard, { showLabels: true }).showLabels).toBe(true);
    expect(key.code).toBe(87); expect(key.label).toBe('W');
  });
  it.each(['M0 0L1e999 5Z', 'M0 0L1000001 5Z', 'Z', 'M' + '1 '.repeat(4097)])('rejects unbounded or non-geometric paths: %s', d => {
    expect(boundedPath(d)).toBe(false);
  });
  it.each(['M0 0" onload="alert(1)', 'M0 0<script/>', 'url(https://example.com/a.svg)'])('rejects active markup in stored geometry', d => {
    const shape = structuredClone(signatureShapes['sig-up']); shape.paths[0].d = d;
    expect(shapeSchema.safeParse(shape).success).toBe(false);
  });
  it('serializes vector holes, mirrored paths and contour borders', () => {
    expect(shapeSvg(signatureShapes['sig-body'])).toContain('fill-rule="evenodd"');
    expect(shapeSvg(signatureShapes['sig-right'])).toContain('matrix(-1 0 0 1 100 0)');
    expect(shapeSvg(signatureShapes['sig-up'], { width: 100, height: 50, thickness: 2 })).toContain('radius="2 4"');
  });
});
