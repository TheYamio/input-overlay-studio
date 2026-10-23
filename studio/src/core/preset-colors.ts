import type { OverlayModule } from './config';
import type { ElementStyle } from './visual';

const styleColors = ['accent', 'background', 'backgroundOpacity', 'textColor', 'activeTextColor', 'borderColor', 'activeBorderColor', 'borderOpacity', 'secondaryColor'] as const;
const trailColors = ['gridColor', 'centerColor', 'markerColor', 'slowColor', 'fastColor', 'leftClickColor', 'rightClickColor'] as const;
function colors<T extends object>(value: T, fields: readonly string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key)));
}
function recolorStyle(target: ElementStyle | undefined, source: ElementStyle | undefined) {
  const result = Object.fromEntries(Object.entries(target || {}).filter(([key]) => !styleColors.includes(key as typeof styleColors[number])));
  return { ...result, ...colors(source || {}, styleColors) } as ElementStyle;
}
/** Color transfer deliberately leaves geometry, artwork and animation untouched. */
export function applyPresetColors(modules: OverlayModule[], source: OverlayModule[]): OverlayModule[] {
  return modules.map(m => {
    const s = source.find(item => item.type === m.type); if (!s) return structuredClone(m);
    return { ...structuredClone(m), accent: s.accent, background: s.background,
      appearance: { ...m.appearance, ...colors(s.appearance, styleColors) },
      trailAppearance: { ...m.trailAppearance, ...colors(s.trailAppearance, trailColors) },
      keys: m.keys.map(k => ({ ...k, style: recolorStyle(k.style, s.keys.find(item => item.code === k.code)?.style) })),
      buttonStyles: Object.fromEntries([...new Set([...Object.keys(m.buttonStyles), ...Object.keys(s.buttonStyles)])].map(code => [code, recolorStyle(m.buttonStyles[code], s.buttonStyles[code])])),
    };
  });
}
export function presetPalette(modules: OverlayModule[]): string[] {
  const weight = new Map<string, number>();
  const anchors: string[] = [];
  const add = (value: unknown, score = 1) => { if (typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)) { const color = value.toLowerCase(); weight.set(color, (weight.get(color) || 0) + score); } };
  for (const m of modules.filter(m => m.visible)) {
    if (m.type === 'keyboard' || m.type === 'mouse') anchors.push(m.background.toLowerCase(), m.accent.toLowerCase());
    if (m.type === 'trail') anchors.push(m.accent.toLowerCase());
    add(m.accent, 12); add(m.background, 8); add(m.appearance.textColor, 4);
    if (m.type === 'keyboard') for (const color of new Set(m.keys.flatMap(k => [k.style?.background, k.style?.accent]))) add(color, 5);
    for (const style of Object.values(m.buttonStyles)) { add(style.background, 3); add(style.accent, 2); }
    if (m.type === 'trail') for (const field of trailColors) add(m.trailAppearance[field], 2);
  }
  return [...new Set([...anchors, ...[...weight].sort((a, b) => b[1] - a[1]).map(([color]) => color)])].slice(0, 6);
}
