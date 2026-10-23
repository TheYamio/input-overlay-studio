export const resizeDirections = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ResizeDirection = typeof resizeDirections[number];
export interface Box { x: number; y: number; w: number; h: number }
export interface ResizeLimits { left: number; top: number; right: number; bottom: number; minW: number; minH: number; maxW?: number; maxH?: number; maxX?: number; maxY?: number }
export const stageLimits: ResizeLimits = { left: 0, top: 0, right: 1920, bottom: 1080, minW: 40, minH: 30 };
export const keyLimits: ResizeLimits = { left: 0, top: 0, right: 2000, bottom: 2000, minW: 1, minH: 1, maxW: 1000, maxH: 1000, maxX: 1000, maxY: 1000 };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const clean = (n: number) => +n.toFixed(6);
export function resizeBox(box: Box, direction: ResizeDirection, dx: number, dy: number, limits = stageLimits, ratio = false, grid = 1): Box {
  const { x, y, w, h } = box, west = direction.includes('w'), east = direction.includes('e'), north = direction.includes('n'), south = direction.includes('s');
  const quantize = (n: number) => Math.round(n / grid) * grid;
  if (!ratio) {
    let left = x, right = x + w, top = y, bottom = y + h;
    if (west) left = clamp(quantize(x + dx), Math.max(limits.left, right - (limits.maxW ?? Infinity)), Math.min(right - limits.minW, limits.maxX ?? Infinity));
    if (east) right = clamp(quantize(right + dx), left + limits.minW, Math.min(limits.right, left + (limits.maxW ?? Infinity)));
    if (north) top = clamp(quantize(y + dy), Math.max(limits.top, bottom - (limits.maxH ?? Infinity)), Math.min(bottom - limits.minH, limits.maxY ?? Infinity));
    if (south) bottom = clamp(quantize(bottom + dy), top + limits.minH, Math.min(limits.bottom, top + (limits.maxH ?? Infinity)));
    return { x: clean(left), y: clean(top), w: clean(right - left), h: clean(bottom - top) };
  }
  const horizontal = west || east, vertical = north || south;
  const deltaX = (west ? -dx : dx) / w, deltaY = (north ? -dy : dy) / h;
  const fromX = horizontal && (!vertical || Math.abs(deltaX) >= Math.abs(deltaY));
  const requested = fromX ? quantize(w * (1 + deltaX)) / w : quantize(h * (1 + deltaY)) / h;
  const anchorX = west ? x + w : east ? x : x + w / 2, anchorY = north ? y + h : south ? y : y + h / 2;
  const availableW = west ? anchorX - limits.left : east ? limits.right - anchorX : 2 * Math.min(anchorX - limits.left, limits.right - anchorX);
  const availableH = north ? anchorY - limits.top : south ? limits.bottom - anchorY : 2 * Math.min(anchorY - limits.top, limits.bottom - anchorY);
  const minW = Math.max(limits.minW, east ? 0 : (anchorX - (limits.maxX ?? Infinity)) * (west ? 1 : 2));
  const minH = Math.max(limits.minH, south ? 0 : (anchorY - (limits.maxY ?? Infinity)) * (north ? 1 : 2));
  const factor = clamp(requested, Math.max(minW / w, minH / h), Math.min(availableW / w, availableH / h, (limits.maxW ?? Infinity) / w, (limits.maxH ?? Infinity) / h));
  const width = w * factor, height = h * factor;
  return { x: clean(west ? anchorX - width : east ? anchorX : anchorX - width / 2), y: clean(north ? anchorY - height : south ? anchorY : anchorY - height / 2), w: clean(width), h: clean(height) };
}
