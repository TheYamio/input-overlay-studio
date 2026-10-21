import type { OverlayModule, StudioDocument } from './config';
import type { ElementStyle, ImageAsset, ImageSettings } from './visual';

export interface Cap { id: string; code: number; label: string; x: number; y: number; w: number; h: number; style?: ElementStyle; imageEnabled?: boolean }
export function capsFor(m: OverlayModule): { caps: Cap[]; w: number; h: number } {
  if (m.type === 'keyboard') {
    return { caps: m.keys.map(k => ({ ...k, w: Math.max(10, k.w + 8 - m.gap), h: Math.max(10, k.h + 8 - m.gap) })), w: Math.max(1, ...m.keys.map(k => k.x + k.w)), h: Math.max(1, ...m.keys.map(k => k.y + k.h)) };
  }
  const diagram = m.mouseMode === 'Mouse Diagram';
  const boxes = diagram ? [[18, 22, 74, 108], [128, 22, 74, 108], [96, 48, 28, 66], [12, 146, 40, 44], [12, 198, 40, 44], [86, 152, 48, 38], [86, 198, 48, 38]] : [[0, 0, 94, 62], [102, 0, 94, 62], [204, 0, 94, 62], [0, 70, 68, 40], [76, 70, 68, 40], [152, 70, 68, 40], [228, 70, 68, 40]];
  const allCaps = [1, 2, 3, 4, 5, 6, 7].map(code => {
    const [x, y, w, h] = boxes[code - 1];
    return { id: `mouse-${code}`, code, label: m.buttonLabels[code - 1], x, y, w, h, ...m.buttonGeometry[code], style: m.buttonStyles[code], imageEnabled: m.buttonImages[code] };
  });
  return { caps: allCaps.filter(k => m.buttons.includes(k.code)), w: Math.max(diagram ? 220 : 300, ...allCaps.map(k => k.x + k.w)), h: Math.max(diagram ? 300 : 110, ...allCaps.map(k => k.y + k.h)) };
}
export function resolvedStyle(m: OverlayModule, override?: ElementStyle) {
  return { ...m.appearance, accent: m.accent, background: m.background, radius: m.radius, effect: m.effect, ...override };
}
export function rgba(hex: string, alpha: number) { return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`; }
export function imagePlacement(image: ImageSettings, asset: Pick<ImageAsset, 'width' | 'height'>, w: number, h: number) {
  const base = image.fit === 'Contain' ? Math.min(w / asset.width, h / asset.height) : image.fit === 'Cover' ? Math.max(w / asset.width, h / asset.height) : 1;
  const width = asset.width * base * image.scale, height = asset.height * base * image.scale;
  return { width, height, x: (w - width) / 2 + image.x, y: (h - height) / 2 + image.y };
}
export function pruneAssets(d: StudioDocument) {
  const used = new Set([...d.profiles, ...d.presets].flatMap(p => p.modules.map(m => m.image.assetId)));
  d.assets = Object.fromEntries(Object.entries(d.assets).filter(([id]) => used.has(id)));
}
export async function readImageAsset(file: File): Promise<ImageAsset> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 8_000_000) throw Error('Choose an image smaller than 8 MB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    if (image.naturalWidth * image.naturalHeight > 24_000_000) throw Error('Image exceeds 24 megapixels.');
    const scale = Math.min(1, 2048 / image.naturalWidth, 2048 / image.naturalHeight);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/webp', .9);
    for (const quality of [.75, .55, .35]) { if (data.length <= 400_000) break; data = canvas.toDataURL('image/webp', quality); }
    if (data.length > 400_000) {
      const reduced = document.createElement('canvas'); reduced.width = Math.max(1, Math.round(canvas.width / 2)); reduced.height = Math.max(1, Math.round(canvas.height / 2));
      reduced.getContext('2d')!.drawImage(canvas, 0, 0, reduced.width, reduced.height); data = reduced.toDataURL('image/webp', .7);
      if (data.length > 400_000) throw Error('Image is too detailed. Choose a smaller image.');
      return { name: file.name.slice(0, 100), data, width: reduced.width, height: reduced.height };
    }
    return { name: file.name.slice(0, 100), data, width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}
