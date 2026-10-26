import {initialDocument,documentSchema,encodeDocument,parseDocument} from '../../src/core/config';
import {signaturePreset} from '../../src/core/signature-preset';
import {SettingsService,type SettingsTransport} from '../../src/core/settings/service';
import {loadDocument,saveDocument,saveDraftDocument,restoreBackup} from '../../src/core/storage';
import {bindDocumentLifecycle} from '../../src/core/settings/lifecycle';

const transport:SettingsTransport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false};
const key='input-overlay-studio.document';
const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],max:sorted.at(-1)};};
function prepare(real:unknown){
 const small=parseDocument(JSON.stringify(real)),large=initialDocument(),signature=signaturePreset();large.shapes=signature.shapes;
 large.profiles=Array.from({length:50},(_,index)=>({...structuredClone(large.profiles[0]),id:`bench-${index}`,name:`Layout ${index+1}`,modules:structuredClone(signature.preset.modules)}));large.activeProfileId=large.profiles[0].id;
 return {real:encodeDocument(small),large:encodeDocument(documentSchema.parse(large))};
}
async function measure(wire:unknown,gesture:boolean){
 localStorage.clear();localStorage.setItem(key,JSON.stringify(wire));
 const service=new SettingsService({load:loadDocument,save:saveDocument,saveDraft:saveDraftDocument,backup:restoreBackup},transport,'ws://benchmark');
 const nativeStringify=JSON.stringify,nativeSet=Storage.prototype.setItem;let serializations=0,serializedChars=0;const writes:Record<string,number>={};
 JSON.stringify=((...args:Parameters<typeof JSON.stringify>)=>{const text=nativeStringify(...args);serializations++;serializedChars+=text?.length??0;return text;}) as typeof JSON.stringify;
 Storage.prototype.setItem=function(key,value){writes[key]=(writes[key]??0)+1;return nativeSet.call(this,key,value);};
 const samples:number[]=[],start=performance.now();let endMs=0;
 try{
  if(gesture)service.beginGesture('benchmark');
  for(let i=0;i<25;i++){const before=performance.now();if(!service.transaction(d=>{d.profiles[0].modules[0].opacity=.5+i/1000;}))throw Error('Benchmark edit rejected');samples.push(performance.now()-before);}
  const end=performance.now();if(gesture)service.endGesture();endMs=performance.now()-end;
  return {totalMs:performance.now()-start,transactionMs:summary(samples),endMs,serializations,serializedChars,writes,undo:service.getSnapshot().canUndo};
 }finally{JSON.stringify=nativeStringify;Storage.prototype.setItem=nativeSet;service.dispose();}
}
let current:SettingsService|undefined,unbind:(()=>void)|undefined;
function startProbe(wire?:unknown){
 unbind?.();current?.dispose();if(wire){localStorage.clear();localStorage.setItem(key,JSON.stringify(wire));}
 current=new SettingsService({load:loadDocument,save:saveDocument,saveDraft:saveDraftDocument,backup:restoreBackup},transport,'ws://benchmark');unbind=bindDocumentLifecycle(current);
 (window as unknown as {hotProbe:unknown}).hotProbe={settings:current,transport,load:loadDocument,detach:()=>unbind?.()};
}
(window as unknown as {hotPath:unknown}).hotPath={prepare,measure,startProbe};
if(new URL(location.href).searchParams.has('probe'))startProbe();
