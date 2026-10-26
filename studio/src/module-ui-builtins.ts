import { Activity,Keyboard,Mouse,MoveUpRight,Target } from 'lucide-react';
import {CompiledModuleHost,type CompiledModuleManifest} from './core/architecture/manifest';
import {builtinManifests} from './core/architecture/builtin-manifests';
import {builtinVisualFactories} from './renderer/modules/factories';
import type {ModuleUI} from './core/architecture/module-ui';
import { makeModule } from './core/config';
import { KeyCanvas } from './key-canvas';
import { ArtworkEditor,DistanceEditor,InputPreviewEditor,KeyboardEditor,MouseEditor,SensitivityEditor,TrailEditor } from './module-editors';

export function createStudioModuleEnvironment(extra:readonly CompiledModuleManifest[]=[]){
 const ui:Record<string,ModuleUI>={};
 const preview={id:'preview',label:'Preview',component:InputPreviewEditor,order:0},artwork={id:'artwork',label:'Artwork',component:ArtworkEditor,order:1};
 ui['overlay.keyboard']={icon:Keyboard,create:index=>makeModule('keyboard',index),selection:'keys',canvasEditor:KeyCanvas,preview:true,sections:[{id:'keys',label:'Keys',component:KeyboardEditor,placement:'before-common'},artwork,preview]};
 ui['overlay.mouse']={icon:Mouse,create:index=>makeModule('mouse',index),selection:'buttons',preview:true,sections:[artwork,preview,{id:'specific',label:'Mouse Buttons',component:MouseEditor}]};
 ui['overlay.trail']={icon:Activity,create:index=>makeModule('trail',index),lineColor:true,preferred:true,sections:[{id:'specific',label:'Mouse Trail',component:TrailEditor}]};
 ui['overlay.distance']={icon:MoveUpRight,create:index=>makeModule('distance',index),sections:[{id:'specific',label:'Distance',component:DistanceEditor}]};
 ui['overlay.sensitivity']={icon:Target,create:index=>makeModule('sensitivity',index),sections:[{id:'specific',label:'Sensitivity',component:SensitivityEditor}]};
 return new CompiledModuleHost('studio').install(...builtinManifests(builtinVisualFactories,ui),...extra);
}
export function createModuleUIRegistry(){return createStudioModuleEnvironment().ui;}
export const studioModuleEnvironment=createStudioModuleEnvironment();
export const moduleUIRegistry=studioModuleEnvironment.ui;
