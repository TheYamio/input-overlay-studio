import type { ImageAsset } from './visual';
import { rasterDimensions } from './raster';

const verified = new Map<string, { width: number; height: number }>();
export function importError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message.startsWith('Image ')) return error.message;
  const issues = (error as Error & { issues?: { message: string }[] }).issues;
  return issues?.find(issue => issue.message.startsWith('Image '))?.message || fallback;
}
/** Shared by file import, presets and received configurations. */
export async function validateArtwork(assets: Record<string, ImageAsset>): Promise<void> {
  for (const [id, asset] of Object.entries(assets)) {
    const cached = verified.get(asset.data);
    if (cached?.width === asset.width && cached.height === asset.height) continue;
    const image = new Image();
    try {
      const size = rasterDimensions(asset.data);
      if (!size || size.width !== asset.width || size.height !== asset.height || size.width > 2048 || size.height > 2048) throw Error();
      image.src = asset.data;
      await image.decode();
      if (image.naturalWidth !== asset.width || image.naturalHeight !== asset.height || !image.naturalWidth || !image.naturalHeight || image.naturalWidth > 2048 || image.naturalHeight > 2048) throw Error();
      if (verified.size >= 16) verified.clear();
      verified.set(asset.data, { width: asset.width, height: asset.height });
    } catch { throw Error(`Image “${asset.name || id}” is damaged or its dimensions do not match. Replace this image and import again.`); }
  }
}
