import {MigrationError,type StudioDocument} from './config';
import {MAX_IMPORT_BYTES,utf8Bytes} from './limits';
import {documentSnapshot} from './document-snapshot';
import type {SyncMetadata} from './storage';

type Patch={path:string[];value?:unknown;remove?:true};
interface Journal {version:1;base:string;patches:Patch[];sync:SyncMetadata}
// An integrity stamp, not a security credential. The checkpoint also contains
// a fresh UUID so stale journals cannot revive an abandoned Undo target.
export function draftStamp(raw:string){let a=2166136261,b=5381;for(let i=0;i<raw.length;i++){const code=raw.charCodeAt(i);a=Math.imul(a^code,16777619);b=Math.imul(b,33)^code;}return `${raw.length}:${a>>>0}:${b>>>0}`;}
function changes(before:unknown,after:unknown,path:string[],out:Patch[]){
 if(Object.is(before,after))return;
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)&&(!Array.isArray(before)||before.length===(after as unknown[]).length)){
  const left=before as Record<string,unknown>,right=after as Record<string,unknown>;
  for(const key of new Set([...Object.keys(left),...Object.keys(right)])){
   if(right[key]===undefined){if(left[key]!==undefined)out.push({path:[...path,key],remove:true});}
   else if(!Object.hasOwn(left,key))out.push({path:[...path,key],value:right[key]});
   else changes(left[key],right[key],[...path,key],out);
  }
 }else out.push({path,value:after});
}
export function encodeDraft(base:StudioDocument,document:StudioDocument,stamp:string,sync:SyncMetadata){
 const snapshot=documentSnapshot(document),patches:Patch[]=[];changes(base,snapshot,[],patches);
 if(patches.some(patch=>!patch.path.length||patch.path.length>64||patch.path.some(part=>part.length>256)))return null;
 const text=JSON.stringify({version:1,base:stamp,patches,sync} satisfies Journal);
 return patches.length<=20000&&utf8Bytes(text)<=MAX_IMPORT_BYTES?text:null;
}
export function readDraft(raw:string):Journal {
 const value=JSON.parse(raw);
 if(Number.isSafeInteger(value?.version)&&value.version>1)throw new MigrationError('future-version','This local draft requires a newer Input Overlay Studio. The original is preserved.',value.version);
 if(utf8Bytes(raw)>MAX_IMPORT_BYTES||value?.version!==1||typeof value.base!=='string'||value.base.length>128||!Array.isArray(value.patches)||value.patches.length>20000||typeof value.sync?.pending!=='boolean')throw Error('Invalid local draft journal.');
 for(const patch of value.patches)if(!patch||!Array.isArray(patch.path)||!patch.path.length||patch.path.length>64||patch.path.some((part:unknown)=>typeof part!=='string'||part.length>256)||patch.remove!==true&&!Object.hasOwn(patch,'value'))throw Error('Invalid draft operation.');
 return value;
}
export function replayDraft(base:StudioDocument,journal:Journal){
 const result=structuredClone(base) as unknown as Record<string,unknown>;
 for(const patch of journal.patches){
  let parent=result;for(const key of patch.path.slice(0,-1)){if(!Object.hasOwn(parent,key)||!parent[key]||typeof parent[key]!=='object')throw Error('Invalid draft path.');parent=parent[key] as Record<string,unknown>;}
  const field=patch.path.at(-1)!;if(Array.isArray(parent)&&(!/^(0|[1-9][0-9]*)$/.test(field)||Number(field)>=parent.length||patch.remove))throw Error('Invalid draft array index.');
  if(patch.remove)delete parent[field];else Object.defineProperty(parent,field,{value:patch.value,writable:true,enumerable:true,configurable:true});
 }
 return documentSnapshot(result as unknown as StudioDocument);
}
