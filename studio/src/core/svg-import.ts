import {truncateText} from './unicode.ts';
import { shapeSchema, shapeSvg, type VectorShape } from './shapes';

const number = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const numberList = new RegExp(`^\\s*${number}(?:[\\s,]+${number})*\\s*$`);
function numbers(value: string) {
  if (!numberList.test(value)) throw Error('Invalid SVG coordinates.');
  return value.trim().split(/[\s,]+/).map(Number);
}
function transform(value: string) {
  let matrix = new DOMMatrix(), rest = value.trim();
  while (rest) {
    const token = /^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?\s*/.exec(rest);
    if (!token) throw Error('Unsupported SVG transform.');
    const v = numbers(token[2]); let next = new DOMMatrix();
    if (token[1] === 'matrix' && v.length === 6) next = new DOMMatrix(v);
    else if (token[1] === 'translate' && [1, 2].includes(v.length)) next = next.translate(v[0], v[1] || 0);
    else if (token[1] === 'scale' && [1, 2].includes(v.length)) next = next.scale(v[0], v[1] ?? v[0]);
    else if (token[1] === 'rotate' && [1, 3].includes(v.length)) next = next.translate(v[1] || 0, v[2] || 0).rotate(v[0]).translate(-(v[1] || 0), -(v[2] || 0));
    else if (token[1] === 'skewX' && v.length === 1) next = next.skewX(v[0]);
    else if (token[1] === 'skewY' && v.length === 1) next = next.skewY(v[0]);
    else throw Error('Invalid SVG transform arguments.');
    matrix = matrix.multiply(next); rest = rest.slice(token[0].length);
  }
  return matrix;
}
const paintKeys = ['fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility'];
function geometry(el: Element) {
  const n = (key: string, fallback = 0) => { const raw = el.getAttribute(key); const value = raw === null ? fallback : Number(raw); if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) throw Error('Invalid SVG dimensions.'); return value; };
  const tag = el.localName;
  if (tag === 'path') return el.getAttribute('d') || '';
  if (tag === 'rect') {
    const x = n('x'), y = n('y'), w = n('width'), h = n('height');
    if (w <= 0 || h <= 0) return '';
    const rx = Math.min(w / 2, Math.max(0, n('rx', n('ry')))), ry = Math.min(h / 2, Math.max(0, n('ry', rx)));
    if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
    return `M${x + rx} ${y}H${x + w - rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}V${y + h - ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}H${x + rx}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}V${y + ry}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = n('cx'), cy = n('cy'), rx = n(tag === 'circle' ? 'r' : 'rx'), ry = tag === 'circle' ? rx : n('ry');
    if (rx <= 0 || ry <= 0) return '';
    return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
  }
  if (tag === 'line') return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
  const points = numbers(el.getAttribute('points') || '');
  if (points.length < 4 || points.length % 2) throw Error('Invalid SVG polygon.');
  return `M${points.slice(0, 2).join(' ')}L${points.slice(2).join(' ')}${tag === 'polygon' ? 'Z' : ''}`;
}
export function parseSvgShape(text: string, name: string): VectorShape {
  if (new TextEncoder().encode(text).length > 128_000) throw Error('SVG shape must be smaller than 128 KB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('Export the shape as a plain SVG with paths.');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw Error('This file is not a valid SVG.');
  const viewBox = root.hasAttribute('viewBox') ? numbers(root.getAttribute('viewBox')!) : [0, 0, parseFloat(root.getAttribute('width') || ''), parseFloat(root.getAttribute('height') || '')];
  const paths: VectorShape['paths'] = [];
  function walk(el: Element, parent: DOMMatrix, inherited: Record<string, string>, opacity: number, depth: number) {
    if (depth > 24 || paths.length >= 64) throw Error('SVG shape is too complex. Simplify it to at most 64 paths.');
    const tag = el.localName;
    if (['title', 'desc', 'metadata'].includes(tag)) return;
    if (tag === 'defs' && !el.children.length) return;
    if (!['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'].includes(tag) || (tag === 'svg' && el !== root)) throw Error(`Unsupported SVG element: ${tag}. Convert text, effects and references to paths.`);
    const paint = { ...inherited };
    for (const attr of el.attributes) {
      if (/^on/i.test(attr.name) || /href/i.test(attr.name) || /url\s*\(/i.test(attr.value)) throw Error('SVG shape contains unsupported links or effects. Export plain paths.');
      if (['clip-path', 'mask', 'filter'].includes(attr.name)) throw Error('Expand SVG clipping and effects into paths before importing.');
      if (paintKeys.includes(attr.name)) paint[attr.name] = attr.value;
    }
    for (const item of (el.getAttribute('style') || '').split(';').filter(s => s.trim())) {
      const [key, ...v] = item.split(':');
      if (!paintKeys.includes(key.trim())) throw Error(`Unsupported SVG style: ${key.trim()}. Export plain paths.`);
      paint[key.trim()] = v.join(':').trim();
    }
    if (paint.display === 'none' || paint.visibility === 'hidden') return;
    const localOpacity = Number(paint.opacity ?? 1), matrix = parent.multiply(transform(el.getAttribute('transform') || ''));
    delete paint.opacity;
    const alpha = opacity * localOpacity;
    if (tag !== 'g' && tag !== 'svg') {
      const d = geometry(el); if (!d) return;
      try { new Path2D(d); } catch { throw Error('SVG contains an invalid path.'); }
      const fill = paint.fill !== 'none', strokeWidth = paint.stroke && paint.stroke !== 'none' ? Number(paint['stroke-width'] ?? 1) : 0;
      if (Number(paint['fill-opacity'] ?? 1) !== Number(paint['stroke-opacity'] ?? 1) && strokeWidth && fill) throw Error('Use matching fill and stroke opacity for SVG shapes.');
      if (alpha > 0 && (fill || strokeWidth)) paths.push({ d, matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f], fill, fillRule: (paint['fill-rule'] || 'nonzero') as 'nonzero', strokeWidth, linecap: (paint['stroke-linecap'] || 'butt') as 'butt', linejoin: (paint['stroke-linejoin'] || 'miter') as 'miter', opacity: alpha * Number(paint[fill ? 'fill-opacity' : 'stroke-opacity'] ?? 1) });
    }
    for (const child of el.children) walk(child, matrix, paint, alpha, depth + 1);
  }
  walk(root, new DOMMatrix(), {}, 1, 0);
  const parsed = shapeSchema.safeParse({ name: truncateText(name,100) || 'Custom shape', viewBox, paths });
  if (!parsed.success) throw Error('SVG dimensions or paths exceed supported limits. Simplify the shape and check its viewBox.');
  return parsed.data;
}
export async function readSvgShape(file: File) {
  if (file.size > 128_000) throw Error('SVG shape must be smaller than 128 KB.');
  const shape = parseSvgShape(await file.text(), file.name.replace(/\.svg$/i, ''));
  const image = new Image(); image.src = `data:image/svg+xml,${encodeURIComponent(shapeSvg(shape))}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, 128, 128);
  if (!ctx.getImageData(0, 0, 128, 128).data.some((v, i) => i % 4 === 3 && v > 0)) throw Error('The SVG has no visible shape inside its viewBox.');
  return shape;
}
