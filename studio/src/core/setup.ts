import {z} from 'zod';
import type {InputEngine,InputEvent} from './input';
import {connectionIndicators} from './connection-status';

export const setupStorageKey='studio.setup';
export const setupStateSchema=z.strictObject({version:z.literal(1),status:z.enum(['new','in-progress','skipped','completed']),step:z.number().int().min(0).max(3)});
export type SetupState=z.infer<typeof setupStateSchema>;
export type SetupInput=Readonly<{keyboard:boolean;movement:boolean;buttons:boolean;wheel:boolean}>;
export const emptySetupInput=():SetupInput=>Object.freeze({keyboard:false,movement:false,buttons:false,wheel:false});
export const setupInputComplete=(input:SetupInput)=>Object.values(input).every(Boolean);

// Observe only the authenticated live engine, once per input category. No key
// codes, pointer coordinates or high-frequency events enter React or storage.
export function watchSetupInput(engine:InputEngine,change:(input:SetupInput)=>void,initial:SetupInput=emptySetupInput()){
 let state=Object.freeze({...initial});change(state);
 const listener=(e:InputEvent)=>{
  const category=e.event_type==='key_pressed'||e.event_type==='analog_depth'&&(e.depth??0)>0?'keyboard':e.event_type==='mouse_pressed'?'buttons':e.event_type==='mouse_moved'&&(e.dx!==0||e.dy!==0)?'movement':e.event_type==='mouse_wheel'&&e.rotation!==0?'wheel':null;
  if(!category||state[category])return;state=Object.freeze({...state,[category]:true});change(state);
 };
 engine.listeners.add(listener);return()=>{engine.listeners.delete(listener);};
}
export function setupCanFinish(view:Parameters<typeof connectionIndicators>[0],input:SetupInput){
 const {capture,source}=connectionIndicators(view);
 return source==='ready'&&(capture==='active'||capture==='unknown'&&setupInputComplete(input));
}
