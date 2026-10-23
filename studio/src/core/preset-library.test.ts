import { describe, expect, it } from 'vitest';
import { documentSchema, initialDocument, presetSchema } from './config';
import { factoryPresets } from './factory-presets';
import { applyPresetColors, presetPalette } from './preset-colors';
import { exportPreset, importPreset, serializePresetBundle } from './presets';

describe('preset library', () => {
  it.each(factoryPresets.map(bundle => [bundle.preset.name, bundle] as const))('%s is a complete, valid and portable composition', (_, bundle) => {
    const d = initialDocument(); d.profiles[0].modules = bundle.preset.modules; d.shapes = bundle.shapes;
    expect(documentSchema.safeParse(d).success).toBe(true);
    expect(bundle.preset.description.length).toBeGreaterThan(40);
    expect(presetPalette(bundle.preset.modules).length).toBeGreaterThanOrEqual(3);
    const imported = importPreset(serializePresetBundle(bundle));
    d.profiles[0].modules = imported.preset.modules; d.shapes = imported.shapes;
    expect(documentSchema.safeParse(d).success).toBe(true);
    for (const m of d.profiles[0].modules) { expect(m.x + m.w).toBeLessThanOrEqual(1920); expect(m.y + m.h).toBeLessThanOrEqual(1080); }
    const visible = d.profiles[0].modules.filter(m => m.visible);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.name} overlaps ${b.name}`).toBe(true);
    }
  });
  it('Yamio uses a neutral Space label and enables all three setup statistics', () => {
    const preset = factoryPresets[0].preset;
    expect(preset.name).toBe('Yamio preset');
    expect(preset.modules.find(m => m.type === 'keyboard')?.keys.find(k => k.code === 32)?.label).toBe('SPACE');
    expect(preset.modules.find(m => m.type === 'sensitivity')).toMatchObject({ showDpi: true, showSens: true, showCm: true, w: 350 });
    expect(JSON.stringify(preset.modules)).not.toMatch(/Zhaoyun|VK75|Z H A O Y U N/);
  });
  it('transfers colors without changing geometry, resources, labels or motion', () => {
    const target = initialDocument().profiles[0].modules, keyboard = target[0], mouse = target[1];
    keyboard.keys[0].style = { shapeId: 'my-shape', radius: 31, showLabels: false, background: '#123456', fontSize: 31, pressDuration: 321 };
    keyboard.appearance.shapeId = 'custom'; keyboard.image.assetId = 'picture'; keyboard.image.groupId = 'shared';
    mouse.buttonStyles['1'] = { shapeId: 'mouse', showLabels: false, radius: 12, textColor: '#111111', effect: 'Pulse' };
    const original = structuredClone(target), colors = applyPresetColors(target, factoryPresets[0].preset.modules);
    expect(target).toEqual(original); expect(colors[0].background).toBe('#7255a4');
    const styleFields = new Set(['accent','background','backgroundOpacity','textColor','activeTextColor','borderColor','activeBorderColor','borderOpacity']);
    const stripStyle = (style: object = {}) => Object.fromEntries(Object.entries(style).filter(([key]) => !styleFields.has(key)));
    const strip = (modules: typeof target) => modules.map(m => ({ ...m, accent: '', background: '', appearance: stripStyle(m.appearance), keys: m.keys.map(k => ({ ...k, style: stripStyle(k.style) })), buttonStyles: Object.fromEntries(Object.entries(m.buttonStyles).map(([code, style]) => [code, stripStyle(style)]).filter(([, style]) => Object.keys(style).length)), trailAppearance: Object.fromEntries(Object.entries(m.trailAppearance).filter(([key]) => !key.endsWith('Color'))) }));
    expect(strip(colors)).toEqual(strip(original));
    expect(colors[0].keys[0].style?.background).not.toBe('#123456');
  });
  it('keeps unmatched module types and exposes colors from key overrides', () => {
    const modules = initialDocument().profiles[0].modules, source = structuredClone(modules[0]);
    source.keys.forEach(k => k.style = { background: '#abcdef' });
    expect(applyPresetColors(modules, [source])[1]).toEqual(modules[1]);
    expect(presetPalette([source])).toContain('#abcdef');
  });
  it('roundtrips descriptions and palette semantics while accepting older presets', () => {
    const d = initialDocument(), p = d.profiles[0];
    d.presets.push({ id: 'saved', name: 'Моя палитра', description: 'Фиолетовый и лайм\nДля стрима', kind: 'style', theme: p.theme, modules: p.modules });
    const imported = importPreset(exportPreset(d, 'saved'));
    expect(imported.preset).toMatchObject({ description: d.presets[0].description, kind: 'style' });
    const legacy = { ...d.presets[0] }; delete legacy.description; delete legacy.kind;
    expect(presetSchema.safeParse(legacy).success).toBe(true);
    expect(presetSchema.safeParse({ ...legacy, description: 'x'.repeat(501) }).success).toBe(false);
    expect(presetSchema.safeParse({ ...legacy, kind: 'unknown' }).success).toBe(false);
  });
});
