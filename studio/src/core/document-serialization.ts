import {encodeDocument,type StudioDocument} from './config';
import {documentSnapshot} from './document-snapshot';
import {moduleConfigurations} from './module-format';

interface SerializedDocument {readonly json:string;readonly normalizedJson:string;readonly wireJson:string}
const cache=new WeakMap<StudioDocument,{registry:number;value:SerializedDocument}>();
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
export function withDocument(fields:Record<string,unknown>,wireJson:string){
 return JSON.stringify(fields).slice(0,-1)+',"document":'+wireJson+'}';
}
