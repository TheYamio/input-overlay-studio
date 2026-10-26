import {it,expect,vi,afterEach} from 'vitest';
import {initialDocument,encodeDocument} from './config';
import {loadDocument,saveDocument,saveDraftDocument,restoreBackup} from './storage';
import {draftStamp} from './draft-journal';
const key='input-overlay-studio.document',draft=key+'.draft';
afterEach(()=>vi.unstubAllGlobals());
function store(){
 const data=new Map<string,string>(),writes:string[]=[];let fail='';
 vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{if(k===fail)throw Error('quota');writes.push(k);data.set(k,v);},removeItem:(k:string)=>{if(k===fail)throw Error('denied');data.delete(k);}});
 const original=initialDocument();saveDocument(original,{pending:false,baseRevision:'r1',endpoint:'ws://fixture'});writes.length=0;
 return {data,writes,original,fail:(key:string)=>{fail=key;}};
}
it('recovers every accepted gesture update before a full checkpoint',()=>{
 const f=store(),primary=f.data.get(key),document=structuredClone(f.original);
 for(let i=0;i<25;i++){document.profiles[0].name=`Draft ${i}`;saveDraftDocument(document,{pending:true,baseRevision:'r1',endpoint:'ws://fixture'});expect(loadDocument().document.profiles[0].name).toBe(`Draft ${i}`);}
 expect(f.data.get(key)).toBe(primary);expect(f.writes.filter(k=>k===draft)).toHaveLength(25);expect(f.writes.filter(k=>k===key)).toHaveLength(0);
 expect(loadDocument().sync).toMatchObject({pending:true,baseRevision:'r1',endpoint:'ws://fixture'});
 saveDocument(document,{pending:true,baseRevision:'r1'});expect(f.data.has(draft)).toBe(false);expect(JSON.parse(f.data.get(key+'.backup')!).__studioSync.baseRevision).toBe('r1');
});
it('keeps the last durable journal when a primary checkpoint fails',()=>{
 const f=store(),document=structuredClone(f.original);document.profiles[0].name='Durable journal';saveDraftDocument(document,{pending:true,baseRevision:'r1'});f.fail(key);
 expect(()=>saveDocument(document,{pending:true,baseRevision:'r1'})).toThrow('quota');expect(loadDocument().document.profiles[0].name).toBe('Durable journal');expect(loadDocument().warning).toBe('');
});
it('leaves the preceding durable draft readable after a failed journal update',()=>{
 const f=store(),document=structuredClone(f.original);document.profiles[0].name='First';saveDraftDocument(document,{pending:true});f.fail(draft);document.profiles[0].name='Failed';
 expect(()=>saveDraftDocument(document,{pending:true})).toThrow('quota');expect(loadDocument().document.profiles[0].name).toBe('First');
});
it('never revives an abandoned gesture if journal cleanup fails during Undo',()=>{
 const f=store(),document=structuredClone(f.original);document.profiles[0].name='Abandoned';saveDraftDocument(document,{pending:true});const old=f.data.get(key);f.fail(draft);
 saveDocument(f.original,{pending:false,baseRevision:'r1',endpoint:'ws://fixture'});expect(f.data.has(draft)).toBe(true);expect(f.data.get(key)).not.toBe(old);expect(encodeDocument(loadDocument().document)).toEqual(encodeDocument(f.original));expect(restoreBackup().profiles[0].name).toBe('Abandoned');
});
it('preserves future journals and refuses both primary and draft downgrades',()=>{
 const f=store(),raw=' {"version":99,"future":true}\n';f.data.set(draft,raw);const before=f.data.get(key);
 expect(loadDocument().unsupported?.text).toBe(raw);expect(()=>saveDocument(f.original)).toThrow('newer');expect(()=>saveDraftDocument(f.original,{pending:true})).toThrow('newer');expect(f.data.get(draft)).toBe(raw);expect(f.data.get(key)).toBe(before);
});
it('rejects invalid paths without modifying prototypes and preserves the original journal',()=>{
 const f=store(),raw=JSON.stringify({version:1,base:draftStamp(f.data.get(key)!),sync:{pending:true},patches:[{path:['__proto__','polluted'],value:true}]});f.data.set(draft,raw);
 expect(loadDocument().warning).toContain('preserved');expect(({} as {polluted?:boolean}).polluted).toBeUndefined();expect(f.data.get(draft)).toBe(raw);
 saveDocument(f.original);expect(f.data.get(draft+'.invalid')).toBe(raw);
});
it('does not replay a journal onto a primary document edited outside the service',()=>{
 const f=store(),document=structuredClone(f.original);document.profiles[0].name='Pending';saveDraftDocument(document,{pending:true});const changed=encodeDocument(f.original);changed.gameProfiles[0].dpi=1600;f.data.set(key,JSON.stringify(changed));
 expect(loadDocument().document.profiles[0].name).toBe(f.original.profiles[0].name);expect(loadDocument().document.gameProfiles[0].dpi).toBe(1600);
});
