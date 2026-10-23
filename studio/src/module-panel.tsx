import {tr} from './core/localization/messages.ts';
import { Component,type ReactNode,type ComponentType,type ComponentProps } from 'react';
import type { ModulePanel } from './core/architecture/module-ui';
import type { ModuleEditorProps } from './module-editor-contracts';
import type { KeyCanvas } from './key-canvas';

class PanelBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<section className="property-section" role="alert" onPointerDown={event=>event.stopPropagation()}><p>{tr('ui:s-5bbdcb2c13ff',"This module editor could not be displayed. Other modules remain available.")}</p><button className="secondary" onClick={()=>this.setState({failed:false})}>{tr('ui:s-17b02c91abd5',"Retry module editor")}</button></section>:this.props.children;}
}
export function RegisteredCanvasEditor({editor:Editor,...props}:ComponentProps<typeof KeyCanvas>&{editor:ComponentType<ComponentProps<typeof KeyCanvas>>}){
 return <PanelBoundary key={props.module.id}><Editor {...props}/></PanelBoundary>;
}
export function RegisteredModulePanel({panel,props,hidden}:{panel:ModulePanel;props:ModuleEditorProps;hidden:boolean}){
 const Editor=panel.component;
 return <div className="property-group" hidden={hidden}><PanelBoundary key={`${props.module.id}:${panel.id}`}><Editor {...props}/></PanelBoundary></div>;
}
