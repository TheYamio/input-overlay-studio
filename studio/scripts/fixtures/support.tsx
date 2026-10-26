// Trusted test fixture. Never imported by Studio or OBS Runtime.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SupportPage,SupportPrompt,SupportEntry} from '../../src/support';
import {SupportSettings,type ActivityContext} from '../../src/core/support/service';
import {SettingsEvents} from '../../src/core/settings/events';
import {studioLocalization} from '../../src/core/localization/builtins';
import {loadBuiltinLanguage} from '../../src/core/localization/load-language';
import '../../src/fonts.css';import '../../src/style.css';import '../../src/midnight.css';
let activity:ActivityContext={firstLaunchedAt:Date.now()-8*86400000,overlayConnections:3,runtimesActive:0,obsRunning:false,storageAvailable:true},failOpen=false,activityReads=0;
const opened:string[]=[],configuration={enabled:true,prompt:{enabled:true},providers:[{id:'one',name:'Service One',url:'https://example.org/support'},{id:'two',name:'Service Two',url:'https://example.com/author'},{id:'empty',name:'Do not show',url:''}]};
window.__TAURI__={core:{invoke:async<T,>(name:string,args?:Record<string,unknown>)=>{if(name==='get_support_context'){activityReads++;return {...activity} as T;}if(name==='open_external_link'){if(failOpen)throw Error('Synthetic browser error');opened.push(String(args?.url));return undefined as T;}throw Error('Unknown test command');}}};
const service=new SupportSettings(localStorage,new SettingsEvents(),configuration);
let allow=(value:boolean)=>{},openPage=()=>{};
function Fixture(){const [page,setPage]=useState(false),[allowed,setAllowed]=useState(true),[message,setMessage]=useState('');allow=setAllowed;openPage=()=>setPage(true);return <div className="app-shell"><SupportEntry open={()=>setPage(true)}/><main className="main-shell">{page&&<SupportPage support={service} notify={setMessage}/>}<span role="status">{message}</span><SupportPrompt support={service} allowed={allowed&&!page} open={()=>setPage(true)}/></main></div>;}
Object.assign(window,{supportAcceptance:{activity:(value:Partial<ActivityContext>)=>{activity={...activity,...value};},activityReads:()=>activityReads,allow:(value:boolean)=>allow(value),open:()=>openPage(),opened,failOpen:(value:boolean)=>{failOpen=value;},locale:async(locale:string)=>{await loadBuiltinLanguage(locale);studioLocalization.setLocale(locale);},snapshot:()=>service.getSnapshot()}});
createRoot(document.getElementById('root')!).render(<Fixture/>);
