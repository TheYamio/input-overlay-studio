import { describe, expect, it } from 'vitest';
import { initialDocument, documentSchema, makeModule } from './config';
import { copyObject, deleteObject, pasteObject } from './object-clipboard';
import { pruneAssets } from './skins';
import artwork from '../../../ws-server/src-tauri/schema/test-artwork.json';
const shape = { name:'Contour',viewBox:[0,0,100,100] as [number,number,number,number],paths:[{d:'M0 0H100V100H0Z',matrix:[1,0,0,1,0,0] as [number,number,number,number,number,number],fill:true,fillRule:'nonzero' as const,strokeWidth:0,linecap:'butt' as const,linejoin:'miter' as const,opacity:1}] };
describe('object clipboard', () => {
  it('creates independent module/key identities without joining the source image group', () => {
    const d=initialDocument(), m=d.profiles[0].modules[0]; m.image.groupId='group';
    const clip=copyObject(d,{moduleId:m.id}), selection=pasteObject(d,clip,null), copy=d.profiles[0].modules.find(m=>m.id===selection.moduleId)!;
    expect(copy.keys.map(k=>k.id).some(id=>m.keys.some(k=>k.id===id))).toBe(false); expect(copy.image.groupId).toBeUndefined(); expect(copy.x).toBe(m.x+24); expect(documentSchema.safeParse(d).success).toBe(true);
  });
  it('retains images and SVG data through cut, resource pruning and pasting', () => {
    const d=initialDocument(),m=d.profiles[0].modules[0]; d.assets.art=artwork; d.shapes.contour=shape; m.image.assetId='art'; m.appearance.shapeId='contour';
    const clip=copyObject(d,{moduleId:m.id}); deleteObject(d,{moduleId:m.id}); pruneAssets(d); d.shapes={}; expect(d.assets).toEqual({});
    const result=pasteObject(d,clip,null,0), restored=d.profiles[0].modules.find(m=>m.id===result.moduleId)!;
    expect(restored.x).toBe(m.x); expect(d.assets[restored.image.assetId]).toEqual(artwork); expect(d.shapes[restored.appearance.shapeId!]).toEqual(shape); expect(documentSchema.safeParse(d).success).toBe(true);
  });
  it('remaps colliding shape IDs instead of overwriting other objects', () => {
    const d=initialDocument(),m=d.profiles[0].modules[0]; d.shapes.contour=shape; m.appearance.shapeId='contour'; const clip=copyObject(d,{moduleId:m.id});
    const different={...shape,name:'Other contour'}; d.shapes.contour=different; const result=pasteObject(d,clip,null), restored=d.profiles[0].modules.find(m=>m.id===result.moduleId)!;
    expect(d.shapes.contour).toEqual(different); expect(restored.appearance.shapeId).not.toBe('contour'); expect(d.shapes[restored.appearance.shapeId!]).toEqual(shape);
  });
  it('copies resolved key styles into another keyboard without changing its physical binding', () => {
    const d=initialDocument(),m=d.profiles[0].modules[0], target=makeModule('keyboard'); d.profiles[0].modules.push(target); m.accent='#ff0088';
    const k=m.keys[0],clip=copyObject(d,{moduleId:m.id,keyId:k.id}), result=pasteObject(d,clip,{moduleId:target.id}), copy=target.keys.find(k=>k.id===result.keyId)!;
    expect(copy.code).toBe(k.code); expect(copy.label).toBe(k.label); expect(copy.style?.accent).toBe('#ff0088'); expect(copy.id).not.toBe(k.id);
  });
  it('blocks destructive actions and individual pastes on locked modules, but allows copying', () => {
    const d=initialDocument(),m=d.profiles[0].modules[0]; m.locked=true; const target={moduleId:m.id,keyId:m.keys[0].id};
    expect(()=>copyObject(d,target)).not.toThrow(); expect(()=>deleteObject(d,target)).toThrow('Unlock'); expect(()=>pasteObject(d,copyObject(d,target),target)).toThrow('Unlock'); expect(()=>deleteObject(d,{moduleId:m.id})).toThrow('Unlock');
  });
  it('duplicate retains inherited key fields and a cut module keeps its name on first paste', () => {
    const d=initialDocument(),m=d.profiles[0].modules[0],k=m.keys[0]; k.style={textColor:'#ffffff'};
    const clip=copyObject(d,{moduleId:m.id,keyId:k.id},false), result=pasteObject(d,clip,{moduleId:m.id},24,true);
    expect(m.keys.find(k=>k.id===result.keyId)?.style).toEqual(k.style);
    const moduleClip=copyObject(d,{moduleId:m.id}); deleteObject(d,{moduleId:m.id}); const moved=pasteObject(d,moduleClip,null,0,false,true);
    expect(d.profiles[0].modules.find(v=>v.id===moved.moduleId)?.name).toBe(m.name);
  });
  it('protects limits and cannot delete a whole block when its key selection is empty', () => {
    const d=initialDocument(),m=d.profiles[0].modules[0],clip=copyObject(d,{moduleId:m.id}); d.profiles[0].modules=Array.from({length:32},()=>makeModule('keyboard'));
    expect(()=>pasteObject(d,clip,null)).toThrow('32 modules'); const target=d.profiles[0].modules[0]; expect(()=>deleteObject(d,{moduleId:target.id,keyId:''})).toThrow('Select a key'); expect(d.profiles[0].modules).toHaveLength(32);
  });
  it('mouse button copy/paste keeps the target input identity and Delete only hides it', () => {
    const d=initialDocument(),m=d.profiles[0].modules.find(m=>m.type==='mouse')!,clip=copyObject(d,{moduleId:m.id,button:1});
    pasteObject(d,clip,{moduleId:m.id,button:2}); expect(m.buttons).toContain(2); expect(m.buttonLabels[1]).toBe(m.buttonLabels[0]); deleteObject(d,{moduleId:m.id,button:2}); expect(m.buttons).not.toContain(2);
    const result=pasteObject(d,clip,{moduleId:m.id,button:1},24,true); expect(result.button).toBe(2); expect(m.buttons).toContain(2); expect(documentSchema.safeParse(d).success).toBe(true);
  });
});
