import type { OverlayModule,StudioDocument } from './core/config';
import type { PreferenceSettings } from './core/settings/preferences';
import type { SettingsService } from './core/settings/service';
import type { InputEngine } from './core/input';
import type { PreviewState } from './core/preview';
import type { ImageAsset } from './core/visual';
export interface ModuleEditorProps {
 settings:SettingsService;preferences:PreferenceSettings;
 editingButtons:boolean;setEditingButtons:(value:boolean)=>void;selectedButton:number;selectButton:(value:number)=>void;
 linkImage:(targetId:string,join:boolean)=>void;previewState:PreviewState;previewChange:(state:PreviewState)=>void;
 assignKey:(id:string,patch:{code:number;label?:string})=>void;bindingEngine:InputEngine;
 editingKeys:boolean;setEditingKeys:(value:boolean)=>void;selectedKey:string|null;selectKey:(id:string)=>void;
 document:StudioDocument;upload:(asset:ImageAsset)=>void;module:OverlayModule;change:(patch:Partial<OverlayModule>)=>void;
 remove:()=>void;duplicate:()=>void;engine:InputEngine;resetDistance:()=>void;
}
