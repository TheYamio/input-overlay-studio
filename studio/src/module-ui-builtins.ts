import { Activity,Keyboard,Mouse,MoveUpRight,Target } from 'lucide-react';
import { builtinCatalog } from './core/architecture/builtins';
import { ModuleUIRegistry } from './core/architecture/module-ui';
import { makeModule } from './core/config';
import { KeyCanvas } from './key-canvas';
import { ArtworkEditor,DistanceEditor,InputPreviewEditor,KeyboardEditor,MouseEditor,SensitivityEditor,TrailEditor } from './module-editors';

export function createModuleUIRegistry(){
 const registry=new ModuleUIRegistry(builtinCatalog);
 const preview={id:'preview',label:'Preview',component:InputPreviewEditor,order:0},artwork={id:'artwork',label:'Artwork',component:ArtworkEditor,order:1};
 registry.register('overlay.keyboard',{icon:Keyboard,create:index=>makeModule('keyboard',index),selection:'keys',canvasEditor:KeyCanvas,preview:true,sections:[{id:'keys',label:'Keys',component:KeyboardEditor,placement:'before-common'},artwork,preview]});
 registry.register('overlay.mouse',{icon:Mouse,create:index=>makeModule('mouse',index),selection:'buttons',preview:true,sections:[artwork,preview,{id:'specific',label:'Mouse Buttons',component:MouseEditor}]});
 registry.register('overlay.trail',{icon:Activity,create:index=>makeModule('trail',index),lineColor:true,preferred:true,sections:[{id:'specific',label:'Mouse Trail',component:TrailEditor}]});
 registry.register('overlay.distance',{icon:MoveUpRight,create:index=>makeModule('distance',index),sections:[{id:'specific',label:'Distance',component:DistanceEditor}]});
 registry.register('overlay.sensitivity',{icon:Target,create:index=>makeModule('sensitivity',index),sections:[{id:'specific',label:'Sensitivity',component:SensitivityEditor}]});
 return registry;
}
export const moduleUIRegistry=createModuleUIRegistry();
