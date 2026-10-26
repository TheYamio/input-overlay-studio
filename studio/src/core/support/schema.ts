import {z} from 'zod';
import type {SettingDefinition} from '../architecture/contracts';
import {createCatalog} from '../architecture/registry';

export function paymentUrl(input:string):string|null {
 try {
  const url=new URL(input),host=url.hostname.toLowerCase();
  if(input.length>2048||/[\u0000-\u0020\u007f]/.test(input)||url.protocol!=='https:'||url.username||url.password||url.port||!host.includes('.')||host.endsWith('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.includes(':')||/^\d+(?:\.\d+){3}$/.test(host))return null;
  return url.href;
 }catch{return null;}
}
export const providerSchema=z.strictObject({id:z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),name:z.string().trim().min(1).max(80),url:z.string().max(2048).refine(value=>paymentUrl(value)!==null)});
export type SupportProvider=z.infer<typeof providerSchema>;
export const promptSchema=z.strictObject({enabled:z.boolean(),dismissed:z.boolean(),shownAt:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()});
export const supportRecordSchema=z.strictObject({version:z.literal(1),prompt:promptSchema});
export const supportDefinitions:readonly SettingDefinition[]=[
 ['support.enabled',z.boolean(),'checkbox',true],
 ['support.providers',z.array(providerSchema).max(12),'custom',[]],
 ['support.prompt.enabled',z.boolean(),'checkbox',true],
 ['support.prompt.dismissed',z.boolean(),'checkbox',false],
 ['support.prompt.shown-at',z.number().int().min(0).nullable(),'custom',null],
].map(([id,schema,control,value])=>({id:id as SettingDefinition['id'],schemaVersion:1,schema:schema as z.ZodType,binding:{scope:'global',store:'preferences',root:'preferences',path:(id as string).split('.').map(part=>part==='shown-at'?'shownAt':part)},label:{key:`settings:${id}.label`,fallback:({'support.enabled':'Author support','support.providers':'Support services','support.prompt.enabled':'Allow a one-time support invitation','support.prompt.dismissed':'Support invitation dismissed','support.prompt.shown-at':'Support invitation shown at'} as Record<string,string>)[id as string]},ui:{control:control as 'checkbox'|'custom',group:'support.settings',...(control==='custom'?{component:'editor.support'}:{})},targets:['studio'],apply:'live',defaultValue:()=>structuredClone(value)}));
export const supportCatalog=createCatalog([{id:'core.support',schemaVersion:1,kind:'service',label:{key:'support:title',fallback:'Support Development'},description:{key:'support:intro',fallback:'Voluntary support for a free app.'},dependencies:[],capabilities:['studio.support'],requires:[],settings:supportDefinitions.map(d=>d.id),targets:['studio']}],supportDefinitions);
