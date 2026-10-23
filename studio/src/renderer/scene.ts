import { moduleKind } from '../core/module-envelope';
import { moduleAvailable,moduleConfigurations } from '../core/module-format';
import { resolvedProfile, type OverlayProfile, type OverlayModule, type Profile, type StudioDocument } from '../core/config';
import { InputEngine,type InputEvent } from '../core/input';
import { inputPreview,type PreviewState } from '../core/preview';
import { visualRuntimeRegistry } from './modules/builtins';
import type { VisualRuntimeRegistry,VisualRegistration } from './modules/registry';
import type { ModuleContext,VisualFactory,VisualInstance } from './modules/contracts';
import { ModuleResources,SceneResources } from './modules/resources';
import { updateSurface } from './modules/surface';
import '../fonts.css';
import './overlay.css';

interface Entry {element:HTMLElement;module:OverlayModule;registration?:VisualRegistration;factory?:VisualFactory;instance?:VisualInstance;resources?:ModuleResources;failed:boolean}
export interface ModuleFailure {moduleId:string;type:string;phase:string;error:unknown}
export interface SceneOptions {registry?:VisualRuntimeRegistry;onModuleError?:(failure:ModuleFailure)=>void}

// The host owns ordering, shared resources, input delivery and one frame clock.
// Registered implementations own their DOM and module-specific state/lifecycle.
export class Scene {
 private document?:StudioDocument;private profile?:Profile;private artworkModules:OverlayModule[]=[];
 private entries=new Map<string,Entry>();private resources=new SceneResources();
 private registry:VisualRuntimeRegistry;private unsubscribe:()=>void;
 private previewState=inputPreview();private previewModuleId?:string;
 private raf=0;private timer=0;private disposed=false;private dirty=true;private lastFrame=0;private lastRevision=-1;private lastDistance=-1;private wheelDuration=50;
 onFrame?:(ms:number)=>void;
 constructor(private root:HTMLElement,readonly engine:InputEngine,private options:SceneOptions={}){
  this.registry=options.registry??visualRuntimeRegistry;
  root.dir='ltr';root.classList.add('overlay-scene');engine.listeners.add(this.listener);window.addEventListener('resize',this.resizeOutput);window.document.fonts?.addEventListener('loadingdone',this.resizeOutput);
  const refresh=()=>{if(this.document&&this.profile)this.update(this.document,this.profile,this.artworkModules);};
  const offRuntime=this.registry.subscribe(refresh),offConfiguration=moduleConfigurations.subscribe(refresh);this.unsubscribe=()=>{offRuntime();offConfiguration();};
 }
 private stop(entry:Entry){
  const instance=entry.instance;entry.instance=undefined;
  try{instance?.dispose();}catch(error){this.report(entry,'dispose',error);}finally{entry.resources?.dispose();entry.resources=undefined;entry.element.replaceChildren();}
 }
 private report(entry:Entry,phase:string,error:unknown){try{this.options.onModuleError?.({moduleId:entry.module.id,type:entry.module.type,phase,error});}catch{/* Observers cannot break the host. */}}
 private invoke(entry:Entry,phase:string,run:()=>void){try{run();return true;}catch(error){entry.failed=true;this.report(entry,phase,error);this.stop(entry);entry.element.style.display='none';return false;}}
 private listener=(event:InputEvent,now:number)=>{
  if(this.disposed)return;let active=false;
  for(const entry of this.entries.values())if(entry.instance){active=true;this.invoke(entry,'input',()=>entry.instance?.input?.(event,now));}
  if(active)this.wake();
 };
 update(document:StudioDocument,overlay:OverlayProfile,artworkModules=overlay.modules){
  const profile=resolvedProfile(document,overlay);
  if(this.disposed)return;
  if(this.profile&&this.profile.id!==profile.id){for(const entry of this.entries.values())this.stop(entry);this.entries.clear();this.root.replaceChildren();}
  // Even assigning the same lang invalidates inherited language/style across
  // the whole scene in Chromium. A geometry edit must not repeat that work.
  if(this.root.lang!==profile.locale)this.root.lang=profile.locale;
  this.document=document;this.profile=profile;this.artworkModules=artworkModules;this.engine.dpi=profile.dpi;this.resources.update(document,artworkModules);
  this.root.classList.toggle('reduced-motion',document.performance.reducedMotion);
  const ids=new Set(profile.modules.map(module=>module.id));
  for(const [id,entry] of this.entries)if(!ids.has(id)){this.stop(entry);entry.element.remove();this.entries.delete(id);}
  this.wheelDuration=50;let index=0;
  for(const module of [...profile.modules].sort((a,b)=>a.z-b.z)){
   const candidate=moduleAvailable(module)?this.registry.resolve(moduleKind(module)):undefined,registration=candidate?.definition.schemaVersion===(module.extension?.schemaVersion??1)?candidate:undefined,factory=registration?.factory;
   let entry=this.entries.get(module.id);
   if(!entry){entry={element:window.document.createElement('div'),module,failed:false};this.entries.set(module.id,entry);}
   if(entry.factory!==factory||entry.module.type!==module.type||entry.failed){this.stop(entry);entry.element.style.cssText='';entry.failed=false;}
   entry.module=module;entry.registration=registration;entry.factory=factory;
   // Hidden modules keep a cheap positional placeholder, with no module state,
   // timers, input handlers, canvases or image leases until enabled again.
   updateSurface(entry.element,module);
   const at=this.root.children[index++];if(at!==entry.element)this.root.insertBefore(entry.element,at??null);
   const wheelPolicy=registration?.factory.wheelDuration;
   if(wheelPolicy)this.invoke(entry,'policy',()=>{const duration=wheelPolicy(module);if(!Number.isFinite(duration)||duration<0)throw Error('Invalid wheel duration');this.wheelDuration=Math.max(this.wheelDuration,duration);});
   if(!module.visible||!factory||!moduleAvailable(module)){this.stop(entry);entry.element.style.display='none';continue;}
   const current=entry;
   if(!entry.instance&&!entry.failed){
    const resources=new ModuleResources(this.resources,error=>{entry!.failed=true;this.report(entry!,'resource',error);this.stop(entry!);entry!.element.style.display='none';});entry.resources=resources;
    const context:ModuleContext={element:entry.element,engine:this.engine,resources,outputBounds:()=>this.root.getBoundingClientRect(),wake:()=>{if(resources.active)this.wake();}};
    this.invoke(entry,'create',()=>{const instance=factory.create(context);if(!instance||typeof instance.update!=='function'||typeof instance.dispose!=='function')throw Error('Invalid visual instance');current.instance=instance;});
   }
   if(entry.instance&&this.invoke(entry,'update',()=>current.instance!.update({document,profile,module,artworkModules})))this.invoke(entry,'preview',()=>current.instance?.preview?.(this.previewState,!this.previewModuleId||module.id===this.previewModuleId));
  }
  this.dirty=true;this.lastDistance=-1;this.wake();
 }
 setPreview(state:PreviewState,moduleId?:string){if(this.disposed)return;this.previewState=state;this.previewModuleId=moduleId;for(const entry of this.entries.values())if(entry.instance)this.invoke(entry,'preview',()=>entry.instance?.preview?.(state,!moduleId||moduleId===entry.module.id));this.dirty=true;this.wake();}
 resizeOutput=()=>{if(this.disposed)return;for(const entry of this.entries.values())if(entry.instance)this.invoke(entry,'resize',()=>entry.instance?.resize?.());this.dirty=true;this.wake();};
 private wake(){clearTimeout(this.timer);this.timer=0;if(!this.disposed&&!this.raf)this.raf=requestAnimationFrame(this.frame);}
 private frame=(now:number)=>{
  this.raf=0;if(this.disposed||!this.document)return;
  const fps=this.document.performance.fps==='Auto'?120:Number(this.document.performance.fps);if(now-this.lastFrame<1000/fps-1){this.wake();return;}
  const start=performance.now();this.lastFrame=now;
  if(now-this.engine.lastWheel>this.wheelDuration&&(this.engine.buttons[6]||this.engine.buttons[7])){this.engine.buttons[6]=this.engine.buttons[7]=0;this.engine.revision++;}
  const state={now,dirty:this.dirty,inputChanged:this.lastRevision!==this.engine.revision,distanceChanged:this.lastDistance!==this.engine.distanceCm,wheelActive:!!(this.engine.buttons[6]||this.engine.buttons[7])};
  let animate=false,deadline=Infinity;
  for(const entry of this.entries.values())if(entry.instance)this.invoke(entry,'frame',()=>{const demand=entry.instance?.frame?.(state);animate||=!!demand?.animate;if(demand?.deadline!==undefined&&Number.isFinite(demand.deadline))deadline=Math.min(deadline,demand.deadline);});
  this.lastRevision=this.engine.revision;this.lastDistance=this.engine.distanceCm;this.dirty=false;try{this.onFrame?.(performance.now()-start);}catch{/* Isolate diagnostic observers. */}
  if(animate||state.wheelActive)this.wake();else if(Number.isFinite(deadline))this.timer=window.setTimeout(()=>{this.timer=0;this.wake();},Math.max(1,deadline-now));
 };
 resetDistance(){if(this.disposed)return;this.engine.distanceCm=0;this.dirty=true;this.wake();}
 dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.raf);clearTimeout(this.timer);this.unsubscribe();this.engine.listeners.delete(this.listener);window.removeEventListener('resize',this.resizeOutput);window.document.fonts?.removeEventListener('loadingdone',this.resizeOutput);for(const entry of this.entries.values())this.stop(entry);this.entries.clear();this.resources.dispose();this.root.replaceChildren();this.document=undefined;this.profile=undefined;this.artworkModules=[];this.onFrame=undefined;this.options={};}
}
