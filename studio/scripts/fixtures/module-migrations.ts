import {parseDocument,type StudioDocument} from '../../src/core/config';
import {Scene} from '../../src/renderer/scene';
import {InputEngine} from '../../src/core/input';
import type {PreviewMode} from '../../src/core/preview';
import '../../src/fonts.css';import '../../src/renderer/overlay.css';

const nativeRAF=window.requestAnimationFrame.bind(window);let sequence=0,frames=new Map<number,FrameRequestCallback>();
window.requestAnimationFrame=callback=>{const id=++sequence;frames.set(id,callback);return id;};window.cancelAnimationFrame=id=>{frames.delete(id);};
let scene:Scene|undefined,engine:InputEngine;const failures:string[]=[];
const root=document.createElement('div');root.id='migration-scene';root.style.cssText='position:fixed;left:0;top:0;width:1920px;height:1080px;transform:scale(.5);transform-origin:top left';document.body.append(root);
const tick=(now:number)=>{const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);};
async function render(source:{legacy:unknown;model:StudioDocument},converted:boolean,mode:PreviewMode){
 scene?.dispose();frames.clear();failures.length=0;engine=new InputEngine();
 const doc=converted?parseDocument(JSON.stringify(source.legacy)):structuredClone(source.model);
 for(const asset of Object.values(doc.assets)){const image=new Image();image.src=asset.data;await image.decode();}
 scene=new Scene(root,engine,{onModuleError:failure=>failures.push(`${failure.type}: ${failure.phase}`)});scene.update(doc,doc.profiles[0]);tick(1000);
 engine.ingest({event_type:'distance_changed',cm:47.75},1000);engine.ingest({event_type:'mouse_moved',dx:40,dy:15,distance_counts:43},1020);tick(1040);engine.ingest({event_type:'mouse_moved',dx:-12,dy:29,distance_counts:31},1060);tick(1080);
 scene.setPreview({mode,depth:.65});await document.fonts.ready;await new Promise<void>(resolve=>nativeRAF(()=>nativeRAF(()=>resolve())));tick(1200);tick(1240);
 return {failures:[...failures],visible:[...root.children].filter(node=>(node as HTMLElement).style.display!=='none').length,canvases:[...root.querySelectorAll('canvas')].map(canvas=>({width:canvas.width,height:canvas.height})),text:root.textContent};
}
Object.assign(window,{migrationProbe:{render,dispose:()=>scene?.dispose()}});
