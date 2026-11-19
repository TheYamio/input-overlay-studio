import {encodeDocument,type OverlayModule,type StudioDocument} from './config';
import {documentSnapshot} from './document-snapshot';
import {assembleDocument,encodeModule,moduleConfigurations,type PersistedModule} from './module-format';
import {MAX_DOCUMENT_BYTES,utf8Bytes} from './limits';

interface SerializedDocument {readonly json:string;readonly normalizedJson:string;readonly wireJson:string}
const cache=new WeakMap<StudioDocument,{registry:number;value:SerializedDocument}>();
const checkpointModules = new WeakMap<OverlayModule, {registry: number; value: PersistedModule}>();
let recent:WeakRef<StudioDocument>[]=[];
// Every new document is validated at this boundary. Only deeply immutable
// snapshots can reuse their representation; mutable callers are never cached.
export function serializeDocument(document:StudioDocument):SerializedDocument {
 const registry=moduleConfigurations.getSnapshot(),previous=cache.get(document);
 if(previous?.registry===registry)return previous.value;
 const normalized=documentSnapshot(document),wire=encodeDocument(normalized);
 const value=Object.freeze({json:JSON.stringify(document),normalizedJson:JSON.stringify(normalized),wireJson:JSON.stringify(wire)});
 if(normalized===document){
  cache.set(document,{registry,value});recent=recent.filter(reference=>reference.deref()&&reference.deref()!==document);recent.push(new WeakRef(document));
  // History may retain sixty documents; do not retain sixty wire encodings.
  while(recent.length>2){const old=recent.shift()!.deref();if(old)cache.delete(old);}
 }
 return value;
}

// Local checkpoints already have a validated immutable snapshot. Reuse
// canonical envelopes for untouched modules. The transport still validates
// the complete wire document before sending it.
export function serializeCheckpoint(document: StudioDocument) {
 const snapshot = documentSnapshot(document);
 const registry = moduleConfigurations.getSnapshot();
 const wire = assembleDocument(snapshot, module => {
  const cached = checkpointModules.get(module);
  if (cached?.registry === registry) return cached.value;
  const value = encodeModule(module);
  checkpointModules.set(module, {registry, value});
  return value;
 });
 const wireJson = JSON.stringify(wire);
 if (utf8Bytes(wireJson) > MAX_DOCUMENT_BYTES) throw Error('Configuration exceeds 1.8 MB. Remove unused images.');
 return { normalizedJson: JSON.stringify(snapshot), wireJson };
}
export function withDocument(fields:Record<string,unknown>,wireJson:string){
 return JSON.stringify(fields).slice(0,-1)+',"document":'+wireJson+'}';
}
