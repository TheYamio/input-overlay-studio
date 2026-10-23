import { factoryModules, type Key } from './config.ts';
import type { VectorShape } from './shapes';

function shape(name: string, d: string, viewBox: VectorShape['viewBox'] = [0, 0, 100, 100], mirror = false): VectorShape {
  return { name, viewBox, paths: [{ d, matrix: mirror ? [-1, 0, 0, 1, 100, 0] : [1, 0, 0, 1, 0, 0], fill: true, fillRule: 'evenodd', strokeWidth: 0, linecap: 'round', linejoin: 'round', opacity: 1 }] };
}
const plate = 'M14 0H82L100 18V109Q100 120 89 120H12Q0 120 0 108V25Q0 11 14 0Z M15 87L33 112H14Z';
export const signatureShapes: Record<string, VectorShape> = {
  'sig-chamfer': shape('Yamio · cut glass', 'M12 0H88L100 12V88L88 100H12L0 88V12Z'),
  'sig-left': shape('Yamio · left click', plate, [0, 0, 100, 120]),
  'sig-right': shape('Yamio · right click', plate, [0, 0, 100, 120], true),
  'sig-wheel': shape('Yamio · wheel / side', 'M25 0H75Q100 0 100 25V75Q100 100 75 100H25Q0 100 0 75V25Q0 0 25 0Z'),
  'sig-up': shape('Scroll · up', 'M50 8L96 72L79 90L50 49L21 90L4 72Z'),
  'sig-down': shape('Scroll · down', 'M50 92L96 28L79 10L50 51L21 10L4 28Z'),
  'sig-body': shape('Yamio · skeleton', 'M110 4C48 4 12 43 8 102L8 210C8 263 43 296 110 296C177 296 212 263 212 210L212 102C208 43 172 4 110 4Z M28 140Q47 152 91 155L91 174Q48 171 28 156Z M129 155Q173 152 192 140V156Q172 171 129 174Z M29 181Q53 193 91 193V214Q49 209 29 197Z M129 193Q167 193 191 181V197Q171 209 129 214Z M34 224Q56 236 91 235L87 254Q56 251 34 237Z M129 235Q164 236 186 224V237Q164 251 133 254Z M58 265L93 268L86 279Q69 276 58 265Z M127 268L162 265Q151 276 134 279Z M103 146H117V165H103Z M103 184H117V208H103Z M99 232H121L110 251Z', [0, 0, 220, 300]),
};
function yamioKeys(): Key[] {
  const keys: Key[] = [];
  const add = (code: number, label: string, x: number, y: number, w = 1, green = false) => keys.push({ id: `vk-${code}`, code, label, x: x * 54, y, w: w * 54 - 4, h: 48, ...(green ? { style: { background: '#b6ce7b', textColor: '#352840', borderColor: '#e1edb5', activeTextColor: '#191221' } } : {}) });
  add(27, 'ESC', 0, 0); keys[0].style = { background: '#b33365', accent: '#f15ba4', borderColor: '#ec82ae' };
  for (let i = 0; i < 12; i++) add(112 + i, `F${i + 1}`, 1.25 + i * 1.08, 0, 1, i >= 4 && i <= 7);
  const row = (items: [number, string, number?, boolean?][], y: number) => { let x = 0; for (const [code, label, width = 1, green = false] of items) { add(code, label, x, y, width, green); x += width; } };
  row([[192, '`'], ...Array.from({ length: 10 }, (_, i): [number, string] => [i === 9 ? 48 : 49 + i, String((i + 1) % 10)]), [189, '−'], [187, '+'], [8, 'BACK', 2, true], [46, 'DEL', 1, true]], 60);
  row([[9, 'TAB', 1.5, true], ...'QWERTYUIOP'.split('').map((s): [number, string] => [s.charCodeAt(0), s]), [219, '['], [221, ']'], [220, '\\', 1.5], [33, 'PGUP', 1, true]], 116);
  row([[20, 'CAPS', 1.75], ...'ASDFGHJKL'.split('').map((s): [number, string] => [s.charCodeAt(0), s]), [186, ';'], [222, "'"], [13, 'ENTER', 2.25, true], [34, 'PGDN', 1, true]], 172);
  row([[160, 'SHIFT', 2.25], ...'ZXCVBNM'.split('').map((s): [number, string] => [s.charCodeAt(0), s]), [188, ','], [190, '.'], [191, '/'], [161, 'SHIFT', 1.75, true], [38, '↑'], [35, 'END']], 228);
  row([[162, 'CTRL', 1.25], [91, 'WIN', 1.25], [164, 'ALT', 1.25], [32, 'SPACE', 6.25, true], [165, 'ALT'], [93, 'MENU'], [163, 'CTRL'], [37, '←'], [40, '↓'], [39, '→']], 284);
  return keys;
}
export function signaturePreset() {
  const modules = factoryModules('Neon'), [keyboard, mouse, trail, distance, sensitivity] = modules;
  Object.assign(keyboard, { name: 'Keyboard', x: 90, y: 700, w: 920, h: 350, layout: 'Custom', keys: yamioKeys(), gap: 8, background: '#7255a4', accent: '#c9e693', radius: 5 });
  Object.assign(keyboard.appearance, { shapeId: 'sig-chamfer', showLabels: true, backgroundOpacity: .94, textColor: '#eee7bd', activeTextColor: '#261c38', borderColor: '#c9b2ed', activeBorderColor: '#edffd0', borderOpacity: .68, borderWidth: 1, fontFamily: 'Consolas', fontSize: 13, letterSpacing: 0, glowStrength: 12, pressTravel: 1 });
  Object.assign(mouse, { name: 'Mouse', x: 1080, y: 665, w: 225, h: 350, mouseMode: 'Mouse Diagram', mouseBodyShapeId: 'sig-body', background: '#27252c', accent: '#f229a0', buttons: [1, 2, 3, 4, 5, 6, 7] });
  Object.assign(mouse.appearance, { showLabels: false, borderColor: '#84758b', borderOpacity: .8, activeBorderColor: '#ff98d6', borderWidth: 1.2, glowStrength: 15, pressTravel: 1 });
  mouse.buttonGeometry = { '1': { x: 23, y: 16, w: 76, h: 112 }, '2': { x: 121, y: 16, w: 76, h: 112 }, '3': { x: 100, y: 34, w: 20, h: 61 }, '4': { x: 3, y: 149, w: 16, h: 35 }, '5': { x: 3, y: 193, w: 16, h: 35 }, '6': { x: 91, y: 154, w: 38, h: 25 }, '7': { x: 91, y: 197, w: 38, h: 25 } };
  mouse.buttonStyles = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(code => [code, { shapeId: ['sig-left', 'sig-right', 'sig-wheel', 'sig-wheel', 'sig-wheel', 'sig-up', 'sig-down'][code - 1], background: code >= 3 ? '#da288f' : '#35313d', borderColor: code >= 3 ? '#ff9fdc' : '#887992' }]));
  Object.assign(trail, { name: 'Glass trace', x: 1370, y: 710, w: 380, h: 270, background: '#141318', accent: '#d7e9f5', trailStyle: 'Speed Gradient', thickness: 2, glow: 5, grid: false, center: true, marker: 'Crosshair', clickEffects: 'Ripple' });
  Object.assign(trail.appearance, { backgroundOpacity: .08, borderColor: '#c9d5e4', borderOpacity: .25, borderWidth: 1 });
  Object.assign(trail.trailAppearance, { slowColor: '#d8e8f4', fastColor: '#f229a0', markerColor: '#c9e693', centerColor: '#776987', centerSize: 10, leftClickColor: '#f229a0', rightClickColor: '#c9e693', clickSize: 20 });
  Object.assign(distance, { x: 1375, y: 1000, w: 150, h: 55, accent: '#dceaf4', caption: 'DISTANCE' });
  Object.assign(sensitivity, { x: 1545, y: 990, w: 350, h: 60, accent: '#c9e693', sensitivityStyle: 'Standard', showGame: false, showDpi: true, showSens: true, showEdpi: false, showCm: true });
  Object.assign(sensitivity.appearance, { fontFamily: 'Consolas', fontSize: 16, letterSpacing: 0, autoFitText: true, textColor: '#d7e9f5', borderWidth: 0 });
  return { preset: { id: 'sora-miao-zhaoyun', name: 'Yamio preset', description: 'Yamio’s personal preset: violet & lime keycaps, a graphite skeleton mouse with pink accents, and a silver-to-pink glass trace.', theme: 'Neon' as const, modules }, assets: {}, shapes: signatureShapes };
}
