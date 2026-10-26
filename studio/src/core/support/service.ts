import config from './config.json';
import {paymentUrl,providerSchema,supportDefinitions,supportRecordSchema,type SupportProvider} from './schema';
import {immutable,SettingsEvents} from '../settings/events';
import type {PreferenceStorage} from '../settings/preferences';
import type {DefinitionId} from '../architecture/contracts';
import {z} from 'zod';

export const supportStorageKey='studio.support';
export interface ActivityContext {firstLaunchedAt:number;overlayConnections:number;runtimesActive:number;obsRunning:boolean|null;storageAvailable:boolean;}
export const activitySchema=z.object({firstLaunchedAt:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),overlayConnections:z.number().int().min(0).max(3),runtimesActive:z.number().int().min(0).max(65535),obsRunning:z.boolean().nullable(),storageAvailable:z.boolean()});
export interface SupportState {enabled:boolean;providers:SupportProvider[];prompt:{enabled:boolean;dismissed:boolean;shownAt:number|null};}
export interface PromptContext {now:number;activity:ActivityContext|null;studio:boolean;visible:boolean;safe:boolean;}
export function eligible(state:SupportState,context:PromptContext){
 const {activity,now}=context;
 return state.enabled&&state.providers.length>0&&state.prompt.enabled&&!state.prompt.dismissed&&state.prompt.shownAt===null&&context.studio&&context.visible&&context.safe&&activitySchema.safeParse(activity).success&&!!activity&&activity.storageAvailable&&activity.obsRunning===false&&activity.runtimesActive===0&&activity.overlayConnections>=3&&Number.isSafeInteger(now)&&now>=activity.firstLaunchedAt+7*86400000;
}
export class SupportSettings {
 private listeners=new Set<()=>void>();private protected=false;private disposed=false;
 private state:SupportState;
 readonly projectUrl=paymentUrl(config.projectUrl)!;
 readonly roadmap=config.roadmap.filter(id=>['editor','languages','performance'].includes(id));
 constructor(private storage:PreferenceStorage,private events:SettingsEvents,configuration:unknown=config){
  const c=configuration&&typeof configuration==='object'?configuration as Record<string,unknown>:{};
  const providers:SupportProvider[]=[],ids=new Set<string>();
  for(const item of Array.isArray(c.providers)?c.providers.slice(0,12):[]){const p=providerSchema.safeParse(item);if(p.success&&!ids.has(p.data.id)){ids.add(p.data.id);providers.push({...p.data,url:paymentUrl(p.data.url)!});}}
  this.state=immutable({enabled:c.enabled===true,providers,prompt:{enabled:!!c.prompt&&typeof c.prompt==='object'&&(c.prompt as Record<string,unknown>).enabled===true,dismissed:false,shownAt:null}});
  try{const raw=storage.getItem(supportStorageKey);if(raw){const saved=supportRecordSchema.parse(JSON.parse(raw));this.state=immutable({...this.state,prompt:saved.prompt});}}catch{this.protected=true;}
 }
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 read(id:DefinitionId){if(!supportDefinitions.some(d=>d.id===id))throw Error('Unknown support setting');return id==='support.enabled'?this.state.enabled:id==='support.providers'?this.state.providers:this.state.prompt[(id.split('.')[2]==='shown-at'?'shownAt':id.split('.')[2]) as keyof SupportState['prompt']];}
 set(id:DefinitionId,value:unknown){
  // Dismissal and the show timestamp are irreversible receipts, not user-editable toggles.
  if(id!=='support.prompt.enabled'||!supportDefinitions.find(d=>d.id===id)?.schema.safeParse(value).success)return false;
  return this.save({...this.state.prompt,[id.split('.')[2]==='shown-at'?'shownAt':id.split('.')[2]]:value});
 }
 private save(prompt:SupportState['prompt']){
  this.events.assertWritable();if(this.disposed||this.protected)return false;
  const parsed=supportRecordSchema.safeParse({version:1,prompt});if(!parsed.success)return false;
  try{this.storage.setItem(supportStorageKey,JSON.stringify(parsed.data));}catch{return false;}
  this.state=immutable({...this.state,prompt:parsed.data.prompt});this.events.notify(this.listeners);this.events.emit({operationId:this.events.operation(),scopes:['global'],store:'preferences',source:'support.preferences'});return true;
 }
 claim(context:PromptContext){
  // Re-read before claiming so a second editor cannot display another invitation.
  try{const raw=this.storage.getItem(supportStorageKey);if(raw){const saved=supportRecordSchema.parse(JSON.parse(raw));if(saved.prompt.dismissed||saved.prompt.shownAt!==null)return false;}}catch{return false;}
  return eligible(this.state,context)&&this.save({...this.state.prompt,shownAt:context.now});
 }
 dismiss(){return this.save({...this.state.prompt,dismissed:true});}
 refresh(){try{const raw=this.storage.getItem(supportStorageKey);if(!raw)return;const parsed=supportRecordSchema.parse(JSON.parse(raw));this.state=immutable({...this.state,prompt:parsed.prompt});this.events.notify(this.listeners);}catch{this.protected=true;}}
 dispose(){this.disposed=true;this.listeners.clear();}
}
