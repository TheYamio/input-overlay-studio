import { factoryModules, themeNames, type Profile } from './config';
import type { VectorShape } from './shapes';
import { signaturePreset } from './signature-preset';
import { usedShapes } from './presets';

const vector = (name: string, d: string): VectorShape => ({ name, viewBox: [0,0,100,100], paths: [{ d, matrix: [1,0,0,1,0,0], fill: true, fillRule: 'nonzero', strokeWidth: 0, linecap: 'round', linejoin: 'round', opacity: 1 }] });
const shapes = {
  'factory-cut': vector('Competition · cut corners', 'M12 0H100V88L88 100H0V12Z'),
  'factory-hex': vector('Neon · hexagon', 'M23 0H77L100 25V75L77 100H23L0 75V25Z'),
  'factory-bevel': vector('Classic · bevel', 'M6 0H94L100 6V94L94 100H6L0 94V6Z'),
};
export const factoryDescriptions: Record<Profile['theme'], string> = {
  Essential: 'Porcelain caps, lavender accents and just the essentials. A quiet corner HUD for everyday play.',
  Competitive: 'Cut-corner FPS controls with lime utility caps. Clear inputs, compact mouse buttons and a focused movement field.',
  Obsidian: 'Graphite keys, soft iris modifiers and compact mouse controls. A balanced composition with room for your movement.',
  Neon: 'Hexagonal movement keys with cyan edges and violet light. A spacious mouse diagram and luminous trace.',
  Glass: 'Frosted blue capsules in a vertical sidebar. Airy surfaces, slim outlines and stacked setup statistics.',
  'Clean Recording': 'A restrained horizontal HUD with white legends and a small footprint. Keeps the recording in focus.',
  'Classic Input': 'Bevelled amber-and-ivory keys with monospace legends. A tall, precise input display with a segmented trace.',
};
export function factoryPreset(theme: Profile['theme']) {
  const modules = factoryModules(theme), keyboard = modules[0];
  if (theme === 'Competitive') keyboard.appearance.shapeId = 'factory-cut';
  if (theme === 'Neon') keyboard.keys.forEach(k => { if ([87,65,83,68].includes(k.code)) k.style = { ...k.style, shapeId: 'factory-hex' }; });
  if (theme === 'Classic Input') keyboard.appearance.shapeId = 'factory-bevel';
  const used = usedShapes(modules);
  return { preset: { id: `factory-${theme.toLowerCase().replaceAll(' ', '-')}`, name: theme, description: factoryDescriptions[theme], theme, modules }, assets: {}, shapes: Object.fromEntries(Object.entries(shapes).filter(([id]) => used.has(id))) };
}
export const factoryPresets = [signaturePreset(), ...themeNames.map(factoryPreset)];
export type PresetBundle = typeof factoryPresets[number];
