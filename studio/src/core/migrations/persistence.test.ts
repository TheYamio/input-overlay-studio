import {afterEach,describe,it,expect,vi} from 'vitest';
import {initialDocument,encodeDocument} from '../config';
import {loadDocument,saveDocument} from '../storage';
const key='input-overlay-studio.document';
afterEach(()=>vi.unstubAllGlobals());
function local(text:string){const data=new Map([[key,text]]);vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});return data;}
describe('current persistence boundaries',()=>{
 it('preserves exact future bytes and refuses explicit downgrades',()=>{const raw=' {"version":99,"future":[1,2]}\n';const data=local(raw);expect(loadDocument().unsupported?.text).toBe(raw);expect(()=>saveDocument(initialDocument())).toThrow('version 99');expect(data.get(key)).toBe(raw);});
 it('recognizes future files before current size limits',()=>{const raw=JSON.stringify({version:5,payload:'a'.repeat(2100000)});local(raw);expect(loadDocument().unsupported?.version).toBe(5);});
 it('backs up the exact current bytes before an actual edit',()=>{const wire=encodeDocument(initialDocument()),raw=JSON.stringify(wire,null,2),data=local(raw),document=loadDocument().document;document.profiles[0].name='Edited';saveDocument(document);expect(data.get(key+'.backup')).toBe(raw);expect([...data.keys()].some(k=>k.includes('original-v'))).toBe(false);});
 it('verifies backup readback before replacing a file',()=>{const raw=JSON.stringify(encodeDocument(initialDocument())),data=local(raw);vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,k.endsWith('.backup')?'corrupt':v)});const document=loadDocument().document;document.profiles[0].name='Edited';expect(()=>saveDocument(document)).toThrow('verification');expect(data.get(key)).toBe(raw);});
});
