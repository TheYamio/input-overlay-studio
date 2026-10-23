import type { OverlayModule,Profile,StudioDocument } from '../../core/config';
import type { InputEngine,InputEvent } from '../../core/input';
import type { PreviewState } from '../../core/preview';
import type { ModuleResources } from './resources';

export interface ModuleUpdate { document:StudioDocument;profile:Profile;module:OverlayModule;artworkModules:OverlayModule[] }
export interface ModuleFrame { now:number;dirty:boolean;inputChanged:boolean;distanceChanged:boolean;wheelActive:boolean }
export interface FrameDemand { animate?:boolean;deadline?:number }
export interface ModuleContext {
 readonly element:HTMLElement;readonly engine:InputEngine;readonly resources:ModuleResources;
 readonly outputBounds:()=>DOMRect;readonly wake:()=>void;
}
export interface VisualInstance {
 update(state:ModuleUpdate):void;
 input?(event:InputEvent,now:number):void;
 frame?(state:ModuleFrame):FrameDemand|void;
 preview?(state:PreviewState,active:boolean):void;
 resize?():void;
 dispose():void;
}
export interface VisualFactory {
 create(context:ModuleContext):VisualInstance;
 wheelDuration?:(module:OverlayModule)=>number;
}
