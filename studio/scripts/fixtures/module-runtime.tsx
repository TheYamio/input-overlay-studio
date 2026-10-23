// Test-only lifecycle and compiled module extension. Never imported by a production entry.
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { initialDocument,makeModule,moduleSchema,type OverlayModule,type StudioDocument } from '../../src/core/config';
import { builtinCatalog } from '../../src/core/architecture/builtins';
import { createCatalog } from '../../src/core/architecture/registry';
import { ModuleUIRegistry } from '../../src/core/architecture/module-ui';
import { createVisualRuntimeRegistry } from '../../src/renderer/modules/builtins';
import { VisualRuntimeRegistry } from '../../src/renderer/modules/registry';
import { Scene,type ModuleFailure } from '../../src/renderer/scene';
import { InputEngine,type InputEvent } from '../../src/core/input';
import { parseSvgShape } from '../../src/core/svg-import';
import { SettingsService,type SettingsTransport } from '../../src/core/settings/service';
import { PreferenceSettings } from '../../src/core/settings/preferences';
import { SettingsEvents } from '../../src/core/settings/events';
import { ModuleUIProvider } from '../../src/module-ui-context';
import { ModuleProperties } from '../../src/module-inspector';
import { RegisteredCanvasEditor } from '../../src/module-panel';
import { SettingsField } from '../../src/settings-renderer';
import type { ModuleEditorProps } from '../../src/module-editor-contracts';
import '../../src/style.css';import '../../src/midnight.css';

let clock=1000,sequence=0,frames=new Map<number,FrameRequestCallback>();
window.requestAnimationFrame=callback=>{const id=++sequence;frames.set(id,callback);return id;};
window.cancelAnimationFrame=id=>{frames.delete(id);};
const tick=(now=clock+20)=>{clock=now;const pending=[...frames.values()];frames.clear();for(const frame of pending)frame(now);};
const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);let created=0,revoked=0;
URL.createObjectURL=blob=>{created++;return createURL(blob);};URL.revokeObjectURL=url=>{revoked++;revokeURL(url);};
let scenes:Scene[]=[],roots:HTMLElement[]=[],engine=new InputEngine(),source=initialDocument();
let registry=createVisualRuntimeRegistry(),failures:ModuleFailure[]=[],events=0,timers=0,disposals=0,renderFrames=0;
const surface=(label:string)=>{const root=document.createElement('div');root.dataset.testScene=label;root.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(root);roots.push(root);return root;};
const clear=()=>{for(const scene of scenes)scene.dispose();scenes=[];for(const root of roots)root.remove();roots=[];frames.clear();};
const input=(event:InputEvent)=>{engine.ingest(event,clock);};
const svg=parseSvgShape('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M50 0L100 50L50 100L0 50Z M40 40H60V60H40Z"/></svg>','Probe diamond');
const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const painter=canvas.getContext('2d')!;painter.fillStyle='#f04ba5';painter.fillRect(0,0,8,8);
const image={name:'Synthetic pink',mime:'image/png' as const,width:8,height:8,data:canvas.toDataURL()};
painter.fillStyle='#38bdf8';painter.fillRect(0,0,8,8);const replacement={...image,data:canvas.toDataURL()};
function snapshotNode(node:Node):unknown{
 if(node.nodeType===Node.TEXT_NODE)return node.textContent;
 const el=node as HTMLElement;
 const normalize=(value:string)=>value.replaceAll(/blob:https?:\/\/[^/]+\/[a-f0-9-]+/gi,'blob:synthetic');
 return {tag:el.tagName,attributes:Object.fromEntries([...el.attributes].filter(attribute=>attribute.name!=='style').sort((a,b)=>a.name.localeCompare(b.name)).map(attribute=>[attribute.name,attribute.name==='class'?attribute.value.split(' ').sort().join(' '):normalize(attribute.value)])),style:Object.fromEntries([...el.style].sort().map(name=>[name,normalize(el.style.getPropertyValue(name))])),children:[...el.childNodes].map(snapshotNode)};
}
const api={
 setup(doc:StudioDocument=initialDocument()){clear();source=structuredClone(doc);engine=new InputEngine();failures=[];registry=createVisualRuntimeRegistry();const root=surface('new');const scene=new Scene(root,engine,{registry,onModuleError:failure=>failures.push(failure)});scene.onFrame=()=>{renderFrames++;};scenes=[scene];scene.update(source,source.profiles[0]);tick();},
 pair(doc:StudioDocument=initialDocument()){api.setup(doc);},
 update(){for(const scene of scenes)scene.update(source,source.profiles[0]);tick();},
 tick,input,clear,document:()=>source,
 svg:()=>structuredClone(svg),image:(replace=false)=>({...replace?replacement:image}),
 preview:(state:Parameters<Scene['setPreview']>[0],id?:string)=>{for(const scene of scenes)scene.setPreview(state,id);tick();},
 mutate:(change:(document:StudioDocument)=>void)=>{change(source);api.update();},
 snapshot:()=>roots.map(root=>{const visible=[...root.querySelectorAll<HTMLElement>('.overlay-module')].filter(module=>module.style.display!=='none');return {nodes:visible.map(snapshotNode),pixels:visible.flatMap(module=>[...module.querySelectorAll('canvas')].map(canvas=>canvas.toDataURL()))};}),
 state:()=>({listeners:engine.listeners.size,pendingFrames:frames.size,created,revoked,events,timers,disposals,renderFrames,failures:failures.map(failure=>({type:failure.type,phase:failure.phase})),distance:engine.distanceCm}),
 enable:(id:Parameters<VisualRuntimeRegistry['setEnabled']>[0],enabled:boolean)=>{registry.setEnabled(id,enabled);tick();},
 fault(phase:string){
  clear();source=initialDocument();source.assets.synthetic=image;engine=new InputEngine();failures=[];events=timers=disposals=0;
  registry=new VisualRuntimeRegistry(builtinCatalog);const builtins=createVisualRuntimeRegistry();for(const entry of builtins.all())if(entry.definition.id!=='overlay.distance')registry.register(entry.definition.id,entry.factory);
  registry.register('overlay.distance',{create:context=>{
   context.resources.assetUrl('synthetic');context.resources.listen(window,'probe-event',()=>{events++;if(phase==='resource-event')throw Error('Synthetic event fault');});context.resources.timeout(()=>{timers++;if(phase==='resource-timer')throw Error('Synthetic timer fault');},40);
   if(phase==='create')throw Error('Synthetic create fault');
   const fail=(name:string)=>{if(phase===name)throw Error(`Synthetic ${name} fault`);};
   return {update:()=>fail('update'),input:()=>fail('input'),frame:()=>{fail('frame');return {};},preview:()=>fail('preview'),resize:()=>fail('resize'),dispose:()=>{disposals++;fail('dispose');}};
  }});
  const scene=new Scene(surface('fault'),engine,{registry,onModuleError:failure=>failures.push(failure)});scenes=[scene];scene.update(source,source.profiles[0]);tick();
 },
 resize:()=>{for(const scene of scenes)scene.resizeOutput();tick();},
 event:()=>window.dispatchEvent(new Event('probe-event')),
 // Prototype type uses a projection of a valid distance instance. v2 files still
 // contain only supported types; arbitrary persisted modules belong to stage 8.
 probe(){clear();source=initialDocument();probeService.replace(source);probeRuntime=undefined;showProbe=true;renderProbe();},
 probeDisable(){probeRuntime?.setEnabled('probe.visual',false);tick();},
 probeEnable(){probeRuntime?.setEnabled('probe.visual',true);tick();},
 probePanelError(value:boolean){panelError=value;probeService.transaction(doc=>{doc.profiles[0].caption=value?'Panel fault':'Panel recovered';});},
 probeCanvasError(value:boolean){canvasError=value;probeService.transaction(doc=>{doc.profiles[0].caption=value?'Canvas fault':'Canvas recovered';});},
};
Object.assign(window,{moduleRuntimeProbe:api});

const transport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false} as SettingsTransport;
const eventsBus=new SettingsEvents(),probeService=new SettingsService({load:()=>({document:initialDocument(),warning:''}),save:()=>{},backup:()=>initialDocument()},transport,'ws://fixture');
const preferences=new PreferenceSettings({getItem:()=>null,setItem:()=>{}},eventsBus);
const definition={...builtinCatalog.modules.get('overlay.distance')!,id:'probe.visual' as const,builtinType:'probe',renderer:'probe.runtime' as const,inspector:'probe.inspector' as const,configuration:z.object({...moduleSchema.shape,type:z.literal('probe')})};
const catalog=createCatalog([...builtinCatalog.modules.all(),definition],builtinCatalog.settings.all()),ui=new ModuleUIRegistry(catalog);
let showProbe=false,panelError=false,canvasError=false,probeRuntime:VisualRuntimeRegistry|undefined,probeScene:Scene|undefined;
function ProbeEditor(props:ModuleEditorProps){if(panelError)throw Error('Synthetic inspector failure');return <section className="property-section"><h4>Probe registered settings</h4><SettingsField settings={props.settings} id="overlay.distance.caption" address={{scope:'module',profileId:props.document.profiles[0].id,moduleId:props.module.id}}/></section>;}
function ProbeCanvas(){if(canvasError)throw Error('Synthetic canvas editor failure');return <span>Registered canvas editor ready</span>;}
ui.register('probe.visual',{icon:()=>null,create:()=>({...makeModule('distance'),type:'probe'} as unknown as OverlayModule),canvasEditor:ProbeCanvas,sections:[{id:'probe.settings',label:'Probe settings',component:ProbeEditor}]});
function ProbeView(){
 const snapshot=useSyncExternalStore(probeService.subscribe,probeService.getSnapshot),document=snapshot.document,backing=document.profiles[0].modules.find(module=>module.type==='distance')!,module={...backing,type:'probe'} as unknown as OverlayModule;
 const no=()=>{};const props:ModuleEditorProps={settings:probeService,preferences,module,document,editingKeys:false,setEditingKeys:no,editingButtons:false,setEditingButtons:no,selectedKey:null,selectKey:no,selectedButton:1,selectButton:no,linkImage:no,previewState:{mode:'Input',depth:.5},previewChange:no,assignKey:no,bindingEngine:engine,upload:no,change:patch=>probeService.transaction(doc=>Object.assign(doc.profiles[0].modules.find(module=>module.id===backing.id)!,patch)),remove:no,duplicate:no,engine,resetDistance:no};
 if(showProbe){
  if(!probeRuntime){probeRuntime=new VisualRuntimeRegistry(catalog);probeRuntime.register('probe.visual',{create:({element})=>({update:({module})=>{element.textContent=`Registered output: ${module.caption}`;},dispose:()=>{element.replaceChildren();}})});probeScene=new Scene(surface('probe'),engine,{registry:probeRuntime});scenes.push(probeScene);}
  probeScene!.update(document,{...document.profiles[0],modules:[module]});tick();
 }
 return showProbe?<ModuleUIProvider registry={ui}><div style={{width:380,height:850}} className="properties-panel"><ModuleProperties {...props}/></div><div data-testid="canvas-probe"><RegisteredCanvasEditor editor={ui.resolve('probe')!.canvasEditor!} module={module} undoShortcuts={[]} scale={1} selected={null} select={no} preview={no} commit={no} snap={false}/></div></ModuleUIProvider>:null;
}
const react=createRoot(document.getElementById('root')!);function renderProbe(){react.render(<ProbeView/>);}renderProbe();
