import { describe, expect, it } from 'vitest';
import { documentSchema, initialDocument, parseDocument, makeModule } from './config';
import { capsFor, imagePlacement, pruneAssets, resolvedStyle } from './skins';
import { defaultImageSettings } from './visual';
import { exportPreset, importPreset } from './presets';

import asset from '../../../ws-server/src-tauri/schema/test-artwork.json';
describe('visual schema and portable artwork', () => {
  it('upgrades v1 profiles and saved layouts without changing geometry or labels', () => {
    const d = initialDocument(), legacy = JSON.parse(JSON.stringify(d)); legacy.version = 1; delete legacy.assets;
    legacy.presets = [{ id: 'preset', name: 'old layout', theme: 'Obsidian', modules: structuredClone(legacy.profiles[0].modules) }];
    for (const p of [...legacy.profiles, ...legacy.presets]) for (const m of p.modules) for (const key of ['appearance', 'image', 'buttonStyles', 'buttonGeometry', 'buttonImages', 'trailAppearance', 'wheelDuration', 'textLayout']) delete m[key];
    const upgraded = parseDocument(JSON.stringify(legacy));
    expect(upgraded.version).toBe(2); expect(upgraded.profiles[0].modules[0].keys).toEqual(d.profiles[0].modules[0].keys);
    expect(upgraded.presets[0].modules[0].image.enabled).toBe(false); expect(upgraded.profiles[0].modules[0].appearance.backgroundOpacity).toBe(1);
  });
  it('validates embedded raster sources, references and bounded effects', () => {
    const d = initialDocument(); d.assets.a = { ...asset }; d.profiles[0].modules[0].image.assetId = 'a'; expect(documentSchema.safeParse(d).success).toBe(true);
    d.assets.a.data = 'https://example.test/image.png'; expect(documentSchema.safeParse(d).success).toBe(false);
    d.assets.a.data = 'data:image/svg+xml;base64,aGVsbG8='; expect(documentSchema.safeParse(d).success).toBe(false);
    d.assets.a = { ...asset }; delete d.assets.a; expect(documentSchema.safeParse(d).success).toBe(false);
  });
  it('sparse key overrides inherit later module changes', () => {
    const m = makeModule('keyboard'); m.keys[0].style = { accent: '#ff2200' }; m.appearance.fontSize = 24;
    expect(resolvedStyle(m, m.keys[0].style)).toMatchObject({ accent: '#ff2200', fontSize: 24, background: m.background });
  });
  it('exports only referenced artwork and remaps imported asset IDs without collisions', () => {
    const d = initialDocument(), m = makeModule('keyboard'); m.image.assetId = 'a'; m.image.enabled = true; d.assets = { a: asset, unused: asset };
    d.presets.push({ id: 'p', name: 'Painted', theme: 'Neon', modules: [m] });
    const text = exportPreset(d, 'p'); expect(JSON.parse(text).assets).toEqual({ a: asset });
    const bundle = importPreset(text), other = importPreset(text);
    expect(bundle.preset.modules[0].image.assetId).not.toBe('a'); expect(bundle.assets[bundle.preset.modules[0].image.assetId]).toEqual(asset);
    expect(bundle.preset.id).not.toBe(other.preset.id); expect(bundle.preset.modules[0].image.assetId).not.toBe(other.preset.modules[0].image.assetId);
  });
  it('rejects presets with missing artwork and prunes only truly unused images', () => {
    const d = initialDocument(); d.assets = { a: asset, unused: asset }; d.profiles[0].modules[0].image.assetId = 'a'; pruneAssets(d); expect(Object.keys(d.assets)).toEqual(['a']);
    d.presets.push({ id: 'p', name: 'missing', theme: 'Neon', modules: [d.profiles[0].modules[0]] });
    const bundle = JSON.parse(exportPreset(d, 'p')); bundle.assets = {}; expect(() => importPreset(JSON.stringify(bundle))).toThrow();
  });
});
describe('continuous image coordinates and stable mouse geometry', () => {
  it('cover and contain preserve aspect ratio with centered placement', () => {
    const settings = defaultImageSettings(); expect(imagePlacement(settings, asset, 300, 200)).toEqual({ width: 300, height: 600, x: 0, y: -200 });
    settings.fit = 'Contain'; expect(imagePlacement(settings, asset, 300, 200)).toEqual({ width: 100, height: 200, x: 100, y: 0 });
    settings.scale = 2; settings.x = 12; settings.y = -20; expect(imagePlacement(settings, asset, 300, 200)).toEqual({ width: 200, height: 400, x: 62, y: -120 });
  });
  it.each(['Compact Buttons', 'Mouse Diagram'] as const)('hiding M1 does not move or reshape M2 in %s', mouseMode => {
    const m = makeModule('mouse'); m.mouseMode = mouseMode; const before = capsFor(m).caps.find(k => k.code === 2);
    m.buttons = [2, 3, 4, 5, 6, 7]; expect(capsFor(m).caps.find(k => k.code === 2)).toEqual(before);
    m.buttonGeometry['2'] = { x: 500, w: 88 }; expect(capsFor(m).caps.find(k => k.code === 2)).toMatchObject({ x: 500, w: 88 });
    const bounds = capsFor(m); m.buttons = m.buttons.filter(b => b !== 2); expect(capsFor(m).w).toBe(bounds.w); expect(capsFor(m).h).toBe(bounds.h);
  });
});
