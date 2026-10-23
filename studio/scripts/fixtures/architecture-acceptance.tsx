// Trusted compiled extension for acceptance only. Never imported by production.
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {z} from 'zod';
import {initialDocument,makeModule,encodeDocument} from '../../src/core/config';
import {moduleConfigurations,decodeModule} from '../../src/core/module-format';
import {builtinCatalog} from '../../src/core/architecture/builtins';
import {createCatalog} from '../../src/core/architecture/registry';
import {createVisualRuntimeRegistry} from '../../src/renderer/modules/builtins';
import {VisualRuntimeRegistry} from '../../src/renderer/modules/registry';
import {Scene} from '../../src/renderer/scene';
import {InputEngine} from '../../src/core/input';
import {InputConnection} from '../../src/core/connection';
import {SettingsService} from '../../src/core/settings/service';
import {PreferenceSettings} from '../../src/core/settings/preferences';
import {SettingsEvents} from '../../src/core/settings/events';
import {loadDocument,saveDocument,restoreBackup} from '../../src/core/storage';
import {SettingsFields} from '../../src/settings-renderer';
import {SettingsLocalization} from '../../src/settings-localization';
import {createStudioLocalization} from '../../src/core/localization/builtins';
import {overlayText} from '../../src/core/localization/runtime';
import {fontStack} from '../../src/core/unicode';
import {LanguageSettings} from '../../src/language-settings';
import '../../src/fonts.css';import '../../src/style.css';import '../../src/midnight.css';

const type='acceptance.counter',schema=z.strictObject({caption:z.string().max(100),gain:z.number().int().min(1).max(9)});
const definition={id:type,schemaVersion:1,kind:'visual',label:{key:'counter:title',fallback:'Counter'},description:{key:'counter:description',fallback:'Compiled acceptance counter'},dependencies:[],capabilities:[],requires:[],settings:['acceptance.counter.caption','acceptance.counter.gain'],targets:['studio','obs'],configuration:schema,renderer:'acceptance.renderer',inspector:'acceptance.inspector'} as const;
const common={schemaVersion:1,binding:{scope:'module',store:'document',root:'module'},ui:{group:type},targets:['studio','obs'],apply:'live'} as const;
const settings=[{...common,id:'acceptance.counter.caption',schema:schema.shape.caption,binding:{...common.binding,path:['extension','config','caption']},label:{key:'counter:caption',fallback:'Counter caption'},ui:{...common.ui,control:'text'},defaultValue:()=>''},{...common,id:'acceptance.counter.gain',schema:schema.shape.gain,binding:{...common.binding,path:['extension','config','gain']},label:{key:'counter:gain',fallback:'Counter gain'},ui:{...common.ui,control:'number',step:1},defaultValue:()=>2}] as const;
const catalog=createCatalog([...builtinCatalog.modules.all(),definition],[...builtinCatalog.settings.all(),...settings]);
const removeConfig=moduleConfigurations.register({type,schemaVersion:1,schema});
const runtime=new VisualRuntimeRegistry(catalog);for(const entry of createVisualRuntimeRegistry().all())runtime.register(entry.definition.id,entry.factory);
let created=0,disposed=0,frames=0;
runtime.register(type,{create:({element})=>{created++;element.style.color='#fff';element.style.fontFamily=fontStack('Unicode');element.dir='auto';return {update:state=>{element.textContent=overlayText(state.document.languagePacks,state.profile.locale,'acceptance.counter.title','Counter')+': '+state.module.extension!.config.caption;element.dataset.gain=String(state.module.extension!.config.gain);},dispose:()=>{disposed++;element.replaceChildren();}};}});
const engine=new InputEngine(),connection=new InputConnection(engine,'studio');
const service=new SettingsService({load:loadDocument,save:saveDocument,backup:restoreBackup},connection,'acceptance',new SettingsEvents(),catalog);
const preferences=new PreferenceSettings(localStorage,new SettingsEvents()),localization=createStudioLocalization();
const params=new URLSearchParams(location.hash.slice(1)),endpoint=params.get('ws');if(!endpoint)throw Error('Acceptance endpoint required');service.connect({url:endpoint,token:params.get('token')||''});
let togglePanel=()=>{};
function View(){
 const snapshot=useSyncExternalStore(service.subscribe,service.getSnapshot),prefs=useSyncExternalStore(preferences.subscribe,preferences.getSnapshot),root=useRef<HTMLDivElement>(null),[panel,setPanel]=useState(true),[message,setMessage]=useState('');togglePanel=()=>setPanel(value=>!value);
 useEffect(()=>{const off=prefs.languagePacks.map(pack=>localization.register(pack));return()=>off.forEach(dispose=>dispose());},[prefs.languagePacks]);
 useEffect(()=>localization.setLocale(prefs.locale),[prefs.locale]);
 const scene=useRef<Scene|null>(null);
 useEffect(()=>{scene.current=new Scene(root.current!,engine,{registry:runtime});scene.current.onFrame=()=>frames++;return()=>scene.current?.dispose();},[]);
 useEffect(()=>{scene.current?.update(snapshot.document,snapshot.document.profiles[0]);},[snapshot.document]);
 const module=snapshot.document.profiles[0].modules.find(module=>module.extension?.type===type);
 return <SettingsLocalization registry={localization}><section style={{padding:20,maxWidth:620}}><LanguageSettings preferences={preferences} notify={setMessage}/><span role="status">{snapshot.saveStatus}</span><span role="alert">{message}</span>{panel&&module&&<SettingsFields settings={service} group={type} catalog={catalog} address={{scope:'module',profileId:snapshot.document.activeProfileId,moduleId:module.id}}/>}</section><div ref={root} data-testid="output" style={{transform:'scale(.35)',transformOrigin:'top left'}}/></SettingsLocalization>;
}
const root=createRoot(document.getElementById('root')!);root.render(<View/>);
function counter(){return service.document.profiles[0].modules.find(module=>module.extension?.type===type)!;}
Object.assign(window,{architectureAcceptance:{
 add:()=>service.transaction(document=>document.profiles[0].modules.push(decodeModule({id:'acceptance-instance',type,schemaVersion:1,enabled:true,common:{name:'Counter',x:20,y:20,w:340,h:80,z:20,opacity:1,visible:true,locked:false},config:{caption:'日本語 العربية 👩🏽‍💻',gain:2},resources:{assets:[],shapes:[]}},id=>makeModule('distance',0,id)))),
 document:()=>encodeDocument(service.document),undo:()=>service.undo(),redo:()=>service.redo(),
 enabled:(enabled:boolean)=>service.transaction(document=>{document.profiles[0].modules.find(module=>module.id===counter().id)!.extension!.enabled=enabled;}),
 overlayLocale:()=>service.transaction(document=>{document.profiles[0].locale=preferences.getSnapshot().locale;document.languagePacks=preferences.getSnapshot().languagePacks.map(pack=>({...pack,namespaces:{overlay:pack.namespaces.overlay??{}}}));}),
 panel:()=>togglePanel(),flush:()=>service.flush(),state:()=>({created,disposed,frames,listeners:engine.listeners.size}),
 restore:()=>service.restoreBackup(),
 reset:()=>service.replace(initialDocument(),{allowOverwrite:true}),
 dispose:()=>{root.unmount();service.dispose();preferences.dispose();removeConfig();},
}});
