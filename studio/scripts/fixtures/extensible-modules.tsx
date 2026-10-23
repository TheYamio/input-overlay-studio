import { SettingsEvents } from '../../src/core/settings/events';
// Compiled test extension. This entry never belongs to the production graph.
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { initialDocument,makeModule,encodeDocument,parseDocument } from '../../src/core/config';
import { moduleConfigurations,decodeModule } from '../../src/core/module-format';
import { moduleKind } from '../../src/core/module-envelope';
import { builtinCatalog } from '../../src/core/architecture/builtins';
import { createCatalog } from '../../src/core/architecture/registry';
import { ModuleUIRegistry } from '../../src/core/architecture/module-ui';
import { VisualRuntimeRegistry } from '../../src/renderer/modules/registry';
import { createVisualRuntimeRegistry } from '../../src/renderer/modules/builtins';
import { Scene } from '../../src/renderer/scene';
import { InputEngine } from '../../src/core/input';
import { SettingsService,type SettingsTransport } from '../../src/core/settings/service';
import { loadDocument,saveDocument,restoreBackup } from '../../src/core/storage';
import { PreferenceSettings } from '../../src/core/settings/preferences';
import { ModuleProperties } from '../../src/module-inspector';
import { ModuleUIProvider } from '../../src/module-ui-context';
import { SettingsFields } from '../../src/settings-renderer';
import { parseSvgShape } from '../../src/core/svg-import';
import { usedShapes,exportPreset,importPreset } from '../../src/core/presets';
import '../../src/style.css';import '../../src/midnight.css';

const type='test.badge',schema=z.strictObject({caption:z.string().max(80)});
const definition={id:type,schemaVersion:1,kind:'visual',label:{key:'test:badge',fallback:'Test badge'},description:{key:'test:description',fallback:'Compiled test extension'},dependencies:[],capabilities:[],requires:[],settings:['test.badge.caption'],targets:['studio','obs'],configuration:schema,renderer:'test.renderer',inspector:'test.inspector'} as const;
const setting={id:'test.badge.caption',schemaVersion:1,schema:schema.shape.caption,binding:{scope:'module',store:'document',root:'module',path:['extension','config','caption']},label:{key:'test:caption',fallback:'Badge caption'},ui:{group:'test.badge',control:'text'},targets:['studio','obs'],apply:'live',defaultValue:()=> 'Extension'} as const;
const catalog=createCatalog([...builtinCatalog.modules.all(),definition],[...builtinCatalog.settings.all(),setting]);
const ui=new ModuleUIRegistry(catalog),runtime=new VisualRuntimeRegistry(catalog),builtins=createVisualRuntimeRegistry();for(const entry of builtins.all())runtime.register(entry.definition.id,entry.factory);
let frames=0,created=0,disposed=0,removeConfig:(()=>void)|undefined;
function connect(){if(!removeConfig)removeConfig=moduleConfigurations.register({type,schemaVersion:1,schema});}
connect();
function createModule(){return decodeModule({id:'test-instance',type,schemaVersion:1,enabled:true,common:{name:'Extension badge',x:40,y:40,w:300,h:90,z:20,opacity:1,visible:true,locked:false},config:{caption:'Extension'},resources:{assets:['test-image'],shapes:['test-shape']}},id=>makeModule('distance',0,id));}
const canvas=document.createElement('canvas');canvas.width=canvas.height=8;canvas.getContext('2d')!.fillRect(0,0,8,8);const image={name:'Synthetic image',width:8,height:8,data:canvas.toDataURL()};
const shape=parseSvgShape('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10H0Z"/></svg>','Synthetic shape');
if(!localStorage.getItem('input-overlay-studio.document')){const document=initialDocument();document.assets['test-image']=image;document.shapes['test-shape']=shape;document.profiles[0].modules.push(createModule());saveDocument(document);}
const transport:SettingsTransport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false};
const service=new SettingsService({load:loadDocument,save:saveDocument,backup:restoreBackup},transport,'synthetic://modules',undefined,catalog);
const preferences=new PreferenceSettings({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},new SettingsEvents()),engine=new InputEngine();
function Panel(props:Parameters<typeof ModuleProperties>[0]){return <section className="property-section"><SettingsFields group="test.badge" settings={props.settings} address={{scope:'module',profileId:props.document.activeProfileId,moduleId:props.module.id}} catalog={catalog}/></section>;}
ui.register(type,{icon:()=>null,create:createModule,sections:[{id:'test.badge',label:'Badge settings',component:Panel}]});
runtime.register(type,{create:({element,resources})=>{created++;return {update:({module})=>{resources.begin();const url=resources.assetUrl(module.extension!.resources.assets[0]);resources.end();element.dataset.asset=url;element.textContent=`Badge: ${module.extension!.config.caption}`;},frame:()=>{frames++;},dispose:()=>{disposed++;element.replaceChildren();}};}});
const output=document.createElement('div');output.dataset.testid='output';output.style.cssText='position:relative;width:1920px;height:1080px;transform:scale(.3);transform-origin:top left';document.body.append(output);const scene=new Scene(output,engine,{registry:runtime});
let selected='test-instance';
const root=createRoot(document.getElementById('root')!);
function View(){const snapshot=useSyncExternalStore(service.subscribe,service.getSnapshot),document=snapshot.document,module=document.profiles[0].modules.find(module=>module.id===selected)!,no=()=>{};
 scene.update(document,document.profiles[0]);
 return <ModuleUIProvider registry={ui}><div className="properties-panel" style={{width:400,height:880}}><ModuleProperties settings={service} preferences={preferences} module={module} document={document} change={patch=>service.transaction(document=>Object.assign(document.profiles[0].modules.find(module=>module.id===selected)!,patch))} remove={no} duplicate={no} engine={engine} resetDistance={no} bindingEngine={engine} editingKeys={false} setEditingKeys={no} selectedKey={null} selectKey={no} editingButtons={false} setEditingButtons={no} selectedButton={1} selectButton={no} assignKey={no} linkImage={no} upload={no} previewState={{mode:'Input',depth:1}} previewChange={no}/></div></ModuleUIProvider>;
}
const render=()=>root.render(<View/>);render();
Object.assign(window,{extensibleModuleProbe:{
 mismatch:()=>{const catalog2=createCatalog([...builtinCatalog.modules.all(),{...definition,schemaVersion:2}],[...builtinCatalog.settings.all(),setting]);const runtime2=new VisualRuntimeRegistry(catalog2);let invoked=0;runtime2.register(type,{create:()=>{invoked++;return {update:()=>{},dispose:()=>{}};}});const element=document.createElement('div'),engine2=new InputEngine(),other=new Scene(element,engine2,{registry:runtime2});other.update(service.document,service.document.profiles[0]);other.dispose();return {invoked,listeners:engine2.listeners.size};},
 document:()=>encodeDocument(service.document),state:()=>({frames,created,disposed,listeners:engine.listeners.size,configurationListeners:moduleConfigurations.getSnapshot()}),
 disconnect:()=>{removeConfig?.();removeConfig=undefined;render();},connect:()=>{connect();render();},
 select:(id:string)=>{selected=id;render();},
 prune:()=>service.transaction(document=>{const used=usedShapes(document.profiles.flatMap(profile=>profile.modules));document.shapes=Object.fromEntries(Object.entries(document.shapes).filter(([id])=>used.has(id)));}),
 export:()=>JSON.stringify(encodeDocument(service.document)),
 import:(text:string)=>service.replace(parseDocument(text)),
 preset:()=>{service.transaction(document=>{document.presets=[{id:'saved',name:'Extension preset',theme:'Obsidian',modules:[document.profiles[0].modules.find(module=>moduleKind(module)===type)!]}];});return exportPreset(service.document,'saved');},
 importPreset:(text:string)=>importPreset(text,service.document),
 dispose:()=>{root.unmount();scene.dispose();service.dispose();preferences.dispose();removeConfig?.();removeConfig=undefined;},
}});
