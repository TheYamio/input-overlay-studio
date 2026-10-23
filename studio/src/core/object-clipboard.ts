import { moduleReferences } from './module-envelope';
import { activeProfile, uid, type Key, type OverlayModule, type StudioDocument } from './config';
import { capsFor, resolvedStyle } from './skins';
import { copyName } from './editing';
import { usedShapes } from './presets';
import type { ElementStyle } from './visual';

export interface ObjectSelection { moduleId: string; keyId?: string; button?: number }
type Resources = Pick<StudioDocument, 'assets' | 'shapes'>;
export type ObjectClipboard = Resources & ({ kind: 'module'; module: OverlayModule } | { kind: 'key'; key: Key } | { kind: 'button'; button: { label: string; style: ElementStyle; geometry: { x: number; y: number; w: number; h: number }; imageEnabled: boolean } });
export function copyObject(doc: StudioDocument, selection: ObjectSelection, resolve = true): ObjectClipboard {
  const m = activeProfile(doc).modules.find(m => m.id === selection.moduleId); if (!m) throw Error('Select an object first.');
  if (selection.keyId !== undefined) {
    const key = m.type === 'keyboard' && m.keys.find(k => k.id === selection.keyId); if (!key) throw Error('Select a key first.');
    const style = resolve ? resolvedStyle(m,key.style) : key.style, shape = style?.shapeId;
    return structuredClone({kind:'key',key:{...key,style},assets:{},shapes:shape ? {[shape]:doc.shapes[shape]} : {}});
  }
  if (selection.button !== undefined) {
    const code = selection.button; if (m.type !== 'mouse' || !m.buttons.includes(code)) throw Error('Select a visible mouse button first.');
    const style = resolve ? resolvedStyle(m,m.buttonStyles[code]) : m.buttonStyles[code] || {}, shape = style.shapeId, cap = capsFor(m).caps.find(c => c.code === code)!;
    return structuredClone({kind:'button',button:{label:m.buttonLabels[code-1],style,geometry:{x:cap.x,y:cap.y,w:cap.w,h:cap.h},imageEnabled:m.buttonImages[code] !== false},assets:{},shapes:shape ? {[shape]:doc.shapes[shape]} : {}});
  }
  const shapes = usedShapes([m]);
  return structuredClone({kind:'module',module:m,assets:Object.fromEntries(Object.entries(doc.assets).filter(([id]) => moduleReferences(m).assets.includes(id))),shapes:Object.fromEntries(Object.entries(doc.shapes).filter(([id]) => shapes.has(id)))});
}
export function deleteObject(doc: StudioDocument, selection: ObjectSelection): ObjectSelection | null {
  const profile = activeProfile(doc), index = profile.modules.findIndex(m => m.id === selection.moduleId), m = profile.modules[index];
  if (!m) throw Error('Select an object first.'); if (m.locked) throw Error('Unlock this module before removing objects.');
  if (selection.keyId !== undefined) {
    const index = m.keys.findIndex(k => k.id === selection.keyId); if (index < 0) throw Error('Select a key first.');
    m.keys.splice(index,1); m.layout = 'Custom'; return {moduleId:m.id,keyId:m.keys[Math.min(index,m.keys.length-1)]?.id};
  }
  if (selection.button !== undefined) { m.buttons = m.buttons.filter(code => code !== selection.button); return selection; }
  profile.modules.splice(index,1); return null;
}
/** Captured resources survive source deletion and cannot overwrite an unrelated asset with the same ID. */
function restoreResources(doc: StudioDocument, clip: ObjectClipboard) {
  const assets = new Map<string,string>(), shapes = new Map<string,string>();
  if(clip.kind==='module'&&clip.module.extension){
    for(const library of ['assets','shapes'] as const)for(const [id,value] of Object.entries(clip[library]))if(Object.hasOwn(doc[library],id)&&JSON.stringify(doc[library][id])!==JSON.stringify(value))throw Error('A preserved module resource conflicts with an existing resource.');
    for(const [id,value] of Object.entries(clip.assets)){doc.assets[id]=structuredClone(value);assets.set(id,id);}
    for(const [id,value] of Object.entries(clip.shapes)){doc.shapes[id]=structuredClone(value);shapes.set(id,id);}
    return {assets,shapes,style:<T extends {shapeId?:string}>(value:T):T=>({...value})};
  }
  for (const [id,value] of Object.entries(clip.assets)) {
    const existing = Object.entries(doc.assets).find(([,a]) => a.data === value.data)?.[0];
    const target = existing || (Object.hasOwn(doc.assets,id) ? uid() : id); if (!existing) doc.assets[target] = structuredClone(value); assets.set(id,target);
  }
  for (const [id,value] of Object.entries(clip.shapes)) {
    const existing = Object.entries(doc.shapes).find(([,s]) => JSON.stringify(s) === JSON.stringify(value))?.[0];
    const target = existing || (Object.hasOwn(doc.shapes,id) ? uid() : id); doc.shapes[target] = structuredClone(value); shapes.set(id,target);
  }
  const style = <T extends {shapeId?:string}>(value:T):T => ({...value,...(value.shapeId ? {shapeId:shapes.get(value.shapeId) || value.shapeId} : {})});
  return {assets,shapes,style};
}
export function pasteObject(doc: StudioDocument, clip: ObjectClipboard, target: ObjectSelection | null, offset = 24, duplicate = false, moving = false): ObjectSelection {
  const profile = activeProfile(doc), m = profile.modules.find(m => m.id === target?.moduleId);
  if (clip.kind === 'module') {
    if (profile.modules.length >= 32) throw Error('This profile already contains 32 modules. Remove one before pasting.');
    const refs = restoreResources(doc,clip), copy = structuredClone(clip.module); copy.id = uid(); copy.locked = false; copy.name = moving ? copy.name : copyName(copy.name);
    copy.x = Math.max(0,Math.min(1920-copy.w,copy.x+offset)); copy.y = Math.max(0,Math.min(1080-copy.h,copy.y+offset)); copy.z = Math.min(1000,Math.max(0,...profile.modules.map(m => m.z))+1);
    copy.appearance = refs.style(copy.appearance); copy.keys = copy.keys.map(k => ({...k,id:uid(),...(k.style ? {style:refs.style(k.style)} : {})}));
    copy.buttonStyles = Object.fromEntries(Object.entries(copy.buttonStyles).map(([code,style]) => [code,refs.style(style)]));
    if (copy.mouseBodyShapeId) copy.mouseBodyShapeId = refs.shapes.get(copy.mouseBodyShapeId) || copy.mouseBodyShapeId;
    copy.image.assetId = refs.assets.get(copy.image.assetId) || ''; delete copy.image.groupId;
    profile.modules.push(copy); return {moduleId:copy.id};
  }
  if (!m || m.type !== (clip.kind === 'key' ? 'keyboard' : 'mouse')) throw Error(`Select a ${clip.kind === 'key' ? 'keyboard' : 'mouse module'} before pasting this ${clip.kind}.`);
  if (m.locked) throw Error('Unlock this module before pasting individual objects.');
  if (clip.kind === 'key') {
    if (m.keys.length >= 100) throw Error('This keyboard already contains 100 keys. Remove one before pasting.');
    const refs = restoreResources(doc,clip), key = structuredClone(clip.key); key.id = uid(); key.x = Math.min(1000,key.x+offset); key.y = Math.min(1000,key.y+offset); if (duplicate) key.label = copyName(key.label); if (key.style) key.style = refs.style(key.style);
    m.keys.push(key); m.layout = 'Custom'; return {moduleId:m.id,keyId:key.id};
  }
  const code = duplicate ? [1,2,3,4,5,6,7].find(code => !m.buttons.includes(code)) : target?.button;
  if (!code) throw Error(duplicate ? 'All seven physical mouse inputs are shown. Hide one or paste onto another selected button.' : 'Enter mouse button editing and choose a target button.');
  const refs = restoreResources(doc,clip); m.buttonLabels[code-1] = clip.button.label; m.buttonStyles[code] = refs.style(structuredClone(clip.button.style));
  m.buttonGeometry[code] = {...clip.button.geometry,...(duplicate ? {x:Math.min(1000,clip.button.geometry.x+offset),y:Math.min(1000,clip.button.geometry.y+offset)} : {})}; m.buttonImages[code] = clip.button.imageEnabled;
  if (!m.buttons.includes(code)) m.buttons.push(code); m.buttons.sort((a,b)=>a-b); return {moduleId:m.id,button:code};
}
