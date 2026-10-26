import {it,expect} from 'vitest';
import {z} from 'zod';
import {initialDocument} from './config';
import {serializeDocument,withDocument} from './document-serialization';
import {documentSnapshot} from './document-snapshot';
import {moduleConfigurations} from './module-format';

it('reuses a validated immutable snapshot for storage and network encoding',()=>{
 const document=documentSnapshot(initialDocument()),prepared=serializeDocument(document);expect(serializeDocument(document)).toBe(prepared);
 expect(JSON.parse(withDocument({type:'studio_set',origin:'"\\\n'},prepared.wireJson))).toMatchObject({type:'studio_set',origin:'"\\\n',document:{version:4}});
 expect(prepared.json).toBe(JSON.stringify(document));
});
it('never trusts cached serialization for mutable or shallow-frozen documents',()=>{
 for(const document of [initialDocument(),Object.freeze(initialDocument())]){serializeDocument(document);document.gameProfiles[0].dpi=0;expect(()=>serializeDocument(document)).toThrow();}
});
it('invalidates immutable representations when trusted module schemas change',()=>{
 const document=documentSnapshot(initialDocument()),before=serializeDocument(document);const unregister=moduleConfigurations.register({type:'test.serialization',schemaVersion:1,schema:z.object({})});
 try{expect(serializeDocument(document)).not.toBe(before);}finally{unregister();}
});
it('bounds retained serializations independently of the Undo history size',()=>{
 const first=documentSnapshot(initialDocument()),prepared=serializeDocument(first);serializeDocument(documentSnapshot(initialDocument()));serializeDocument(documentSnapshot(initialDocument()));expect(serializeDocument(first)).not.toBe(prepared);
});
