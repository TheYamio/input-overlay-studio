import type { OverlayModule,StudioDocument } from '../../core/config';
import { shapeUrl } from '../../core/shapes';
import { artworkBounds } from '../../core/artwork-groups';

export class SceneResources {
 private document?:StudioDocument;private shapeSignature='';shapeVersion=0;
 private assets=new Map<string,{data:string;url:string;owners:Set<ModuleResources>}>();
 private shapes=new Map<string,string>();
 private artworkModules:OverlayModule[]=[];private regions=new Map<string,ReturnType<typeof artworkBounds>>();
 readonly measure=document.createElement('canvas').getContext('2d')!;
 update(document:StudioDocument,artworkModules:OverlayModule[]=[]){
  this.artworkModules=artworkModules;this.regions.clear();
  this.document=document;const signature=JSON.stringify(document.shapes);
  if(signature!==this.shapeSignature){this.shapes.clear();this.shapeVersion++;this.shapeSignature=signature;}
  for(const [id,asset] of this.assets)if(!document.assets[id]||document.assets[id].data!==asset.data){URL.revokeObjectURL(asset.url);this.assets.delete(id);}
 }
 asset(id:string,owner:ModuleResources){
  const asset=this.document?.assets[id];if(!asset)return '';
  let entry=this.assets.get(id);
  if(!entry){const [header,encoded]=asset.data.split(','),bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));entry={data:asset.data,url:URL.createObjectURL(new Blob([bytes],{type:header.slice(5,header.indexOf(';'))})),owners:new Set()};this.assets.set(id,entry);}
  entry.owners.add(owner);return entry.url;
 }
 release(owner:ModuleResources,keep:ReadonlySet<string>=new Set()){
  for(const [id,asset] of this.assets)if(!keep.has(id)){asset.owners.delete(owner);if(!asset.owners.size){URL.revokeObjectURL(asset.url);this.assets.delete(id);}}
 }
 shape(id:string,border?:{width:number;height:number;thickness:number}){
  const key=JSON.stringify([id,border]);let url=this.shapes.get(key);
  if(!url){if(!this.document)throw Error('Scene resources are disposed.');url=shapeUrl(this.document.shapes[id],border);if(this.shapes.size>=128)this.shapes.delete(this.shapes.keys().next().value!);this.shapes.set(key,url);}return url;
 }
 region(module:OverlayModule){const id=module.image.groupId!;let region=this.regions.get(id);if(!region){region=artworkBounds(module,this.artworkModules);this.regions.set(id,region);}return region;}
 dispose(){this.assets.forEach(asset=>URL.revokeObjectURL(asset.url));this.assets.clear();this.shapes.clear();this.regions.clear();this.artworkModules=[];this.document=undefined;this.measure.canvas.width=this.measure.canvas.height=0;}
}
export class ModuleResources {
 private cleanups=new Set<()=>void>();private disposed=false;private used=new Set<string>();
 constructor(private readonly pool:SceneResources,private readonly onError:(error:unknown)=>void=()=>{}){}
 get active(){return !this.disposed;}
 get shapeVersion(){return this.pool.shapeVersion;}
 get measure(){return this.pool.measure;}
 begin(){this.used.clear();}
 assetUrl(id:string){if(this.disposed)throw Error('Module resources are disposed.');this.used.add(id);return this.pool.asset(id,this);}
 end(){this.pool.release(this,this.used);}
 shapeMask(id:string,border?:{width:number;height:number;thickness:number}){if(this.disposed)throw Error('Module resources are disposed.');return this.pool.shape(id,border);}
 artworkRegion(module:OverlayModule){if(this.disposed)throw Error('Module resources are disposed.');return this.pool.region(module);}
 use(cleanup:()=>void){if(this.disposed){cleanup();return ()=>{};}this.cleanups.add(cleanup);return ()=>{if(this.cleanups.delete(cleanup))cleanup();};}
 listen(target:EventTarget,event:string,listener:EventListener){const guarded:EventListener=event=>{if(this.disposed)return;try{listener(event);}catch(error){this.onError(error);}};target.addEventListener(event,guarded);return this.use(()=>target.removeEventListener(event,guarded));}
 timeout(callback:()=>void,ms:number){let cancel=()=>{};const timer=window.setTimeout(()=>{this.cleanups.delete(cancel);if(!this.disposed){try{callback();}catch(error){this.onError(error);}}},ms);cancel=()=>clearTimeout(timer);this.use(cancel);return ()=>{if(this.cleanups.delete(cancel))cancel();};}
 dispose(){if(this.disposed)return;this.disposed=true;for(const cleanup of this.cleanups){try{cleanup();}catch{/* Always release the rest. */}}this.cleanups.clear();this.pool.release(this);this.used.clear();}
}
