import {externalDefinitions} from '../architecture/external';
import {SettingsError} from '../settings/events';
import english from './catalogs/ui.en.json';
import { studioLocalization } from './builtins';
const keys = new Map(Object.entries(english).map(([key,value])=>[value,`ui:${key}`]));
export const tr=(key:string,fallback:string,params:Readonly<Record<string,string|number>>={})=>studioLocalization.text(key,fallback,params);
// Use only for application-owned messages, never user labels or stored enum values.
const templates=Object.entries(english).filter(([,text])=>text.includes('{{p0}}')&&text.length>14).map(([key,text])=>{const names=[...text.matchAll(/\{\{(p\d+)\}\}/g)].map(m=>m[1]);const parts=text.split(/\{\{p\d+\}\}/g).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));return {key,names,pattern:new RegExp('^'+parts.join('([\\s\\S]{0,500}?)')+'$')};});
export function trText(englishText:string) {
 const key=keys.get(englishText);if(key)return studioLocalization.text(key,englishText);
 if(englishText.length<=2000)for(const item of templates){const match=item.pattern.exec(englishText);if(match)return tr(`ui:${item.key}`,englishText,Object.fromEntries(item.names.map((name,index)=>[name,match[index+1]])));}
 return englishText;
}

export function trError(error:unknown,fallback='The command could not be completed.'){
 const message=error instanceof Error?error.message:fallback;
 if(error instanceof SettingsError){
  const definition=error.code==='native-invalid-field'?externalDefinitions.find(d=>d.binding.store==='native'&&d.binding.path[0]===error.params.field):undefined;
  const params=definition?{...error.params,field:studioLocalization.text(definition.label.key,definition.label.fallback)}:error.params;
  return studioLocalization.text(`errors:settings.${error.code}`,trText(message),params);
 }
 return trText(message);
}
