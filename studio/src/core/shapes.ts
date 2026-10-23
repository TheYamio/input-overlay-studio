import { z } from 'zod';

const coordinate = z.number().min(-1_000_000).max(1_000_000);
const size = z.number().positive().max(1_000_000);
export const pathNumberPattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
export function boundedPath(d: string) {
  const numbers = d.match(pathNumberPattern) || [];
  return /[Mm]/.test(d) && numbers.length <= 4096 && numbers.every(n => Number.isFinite(+n) && Math.abs(+n) <= 1_000_000);
}
export const shapeSchema = z.object({
  name: z.string().min(1).max(100), viewBox: z.tuple([coordinate, coordinate, size, size]),
  paths: z.array(z.object({
    d: z.string().min(1).max(8000).regex(/^[MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]+$/).refine(boundedPath),
    matrix: z.tuple([coordinate, coordinate, coordinate, coordinate, coordinate, coordinate]),
    fill: z.boolean(), fillRule: z.enum(['nonzero', 'evenodd']), strokeWidth: z.number().min(0).max(10000),
    linecap: z.enum(['butt', 'round', 'square']), linejoin: z.enum(['miter', 'round', 'bevel']), opacity: z.number().min(0).max(1),
  })).min(1).max(64),
});
export type VectorShape = z.infer<typeof shapeSchema>;
export function shapeSvg(shape: VectorShape, border?: { width: number; height: number; thickness: number }) {
  const [x, y, w, h] = shape.viewBox;
  const paths = shape.paths.map(p => `<path d="${p.d}" transform="matrix(${p.matrix.join(' ')})" fill="${p.fill ? 'white' : 'none'}" fill-rule="${p.fillRule}" stroke="${p.strokeWidth ? 'white' : 'none'}" stroke-width="${p.strokeWidth}" stroke-linecap="${p.linecap}" stroke-linejoin="${p.linejoin}" opacity="${p.opacity}"/>`).join('');
  const edge = border ? `<defs><filter id="edge" x="${x}" y="${y}" width="${w}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feMorphology in="SourceGraphic" operator="erode" radius="${w * border.thickness / border.width} ${h * border.thickness / border.height}" result="inside"/><feComposite in="SourceGraphic" in2="inside" operator="out"/></filter></defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${shape.viewBox.join(' ')}" width="512" height="512" preserveAspectRatio="none">${edge}<g${border ? ' filter="url(#edge)"' : ''}>${paths}</g></svg>`;
}
export function shapeUrl(shape: VectorShape, border?: { width: number; height: number; thickness: number }) {
  return `url("data:image/svg+xml,${encodeURIComponent(shapeSvg(shape, border))}")`;
}
