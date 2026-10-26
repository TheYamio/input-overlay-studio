import {tr} from './core/localization/messages.ts';
import type { ConnectionOptions } from './core/connection';
import { RotateCcw } from 'lucide-react';
import { registerSettingsView } from './settings-views';

function ConnectionEditor({value,change,apply,error=false}:{value:ConnectionOptions;change:(value:ConnectionOptions)=>void;apply:()=>void;error?:boolean}){
 return <><label className="field"><span>{tr('ui:s-8be89710b2f1',"Server address")}</span><input aria-label={tr('ui:s-8be89710b2f1',"Server address")} value={value.url} onChange={event=>change({...value,url:event.target.value})}/></label><label className="field"><span>{tr('ui:s-8e795a2f5a9d',"Authentication token")}</span><input type="password" autoComplete="off" value={value.token} onChange={event=>change({...value,token:event.target.value})}/></label><button className="secondary" onClick={apply}><RotateCcw size={14}/>{tr('ui:s-ad9bf09fcecd',"Save & reconnect")}</button>{error&&<p role="alert" className="warning connection-settings-error">{tr('ui:s-a397b75da545',"Connection storage is unavailable")}</p>}</>;
}
export const ConnectionSettings=registerSettingsView('editor.connection',ConnectionEditor);
