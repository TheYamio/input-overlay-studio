import type { OverlayModule, Profile } from './config';
import type { ImageSettings } from './visual';
import { capsFor } from './skins.ts';

export function paintedBounds(m: OverlayModule) {
  const { w, h } = capsFor(m), scale = Math.min(m.w / w, m.h / h);
  return { x: m.x, y: m.y, w: w * scale, h: h * scale, scale };
}
export function artworkMembers(m: OverlayModule, modules: OverlayModule[]) {
  return m.image.groupId ? modules.filter(other => (other.type === 'keyboard' || other.type === 'mouse') && other.image.groupId === m.image.groupId) : [m];
}
export function artworkBounds(m: OverlayModule, modules: OverlayModule[]) {
  const boxes = artworkMembers(m, modules).filter(member => capsFor(member).caps.length > 0).map(paintedBounds);
  if (!boxes.length) return { x: m.x, y: m.y, w: 1, h: 1 };
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}
/** Group settings are duplicated deliberately so a detached module keeps its artwork. */
export function setModuleImage(modules: OverlayModule[], id: string, image: ImageSettings) {
  const source = modules.find(m => m.id === id); if (!source) return;
  for (const m of modules) if (m.id === id || image.groupId && m.image.groupId === image.groupId) m.image = structuredClone(image);
}
export function linkArtwork(profile: Pick<Profile, 'modules'>, sourceId: string, targetId: string, join: boolean) {
  const source = profile.modules.find(m => m.id === sourceId), target = profile.modules.find(m => m.id === targetId);
  if (!source || !target || source === target || !['keyboard', 'mouse'].includes(source.type) || !['keyboard', 'mouse'].includes(target.type)) return;
  if (join) {
    source.image.groupId ||= crypto.randomUUID(); target.image = structuredClone(source.image);
  } else if (source.image.groupId && target.image.groupId === source.image.groupId) delete target.image.groupId;
}
export function consistentArtworkGroups(modules: OverlayModule[]) {
  const groups = new Map<string, string>();
  for (const m of modules) if (m.image.groupId) {
    if (m.type !== 'keyboard' && m.type !== 'mouse') return false;
    const signature = JSON.stringify(m.image), previous = groups.get(m.image.groupId);
    if (previous && previous !== signature) return false;
    groups.set(m.image.groupId, signature);
  }
  return true;
}
