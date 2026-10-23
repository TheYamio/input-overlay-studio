import {LocalizationRegistry} from '../../src/core/localization/registry';
// Test-only extension and instrumented preview lifecycle; not a production entry.
import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { initialDocument } from '../../src/core/config';
import { createCatalog } from '../../src/core/architecture/registry';
import { builtinCatalog } from '../../src/core/architecture/builtins';
import { appearanceSchema } from '../../src/core/visual';
import { SettingsService, type SettingsTransport } from '../../src/core/settings/service';
import { createStudioLocalization } from '../../src/core/localization/builtins';
import { SettingsLocalization } from '../../src/settings-localization';
import { SchemaAnimationControls, animationViews } from '../../src/schema-animation-controls';
import { VisualPreviewSettings } from '../../src/animation-sample';
import type { AnimationAddress } from '../../src/core/settings-ui/animation';
import { ShapeLibrary } from '../../src/shape-controls';
import { Scene } from '../../src/renderer/scene';
import { parseSvgShape } from '../../src/core/svg-import';
import '../../src/style.css';
import '../../src/midnight.css';

const doc=initialDocument();doc.profiles[0].modules[0].effect='Instant';
const base=builtinCatalog.settings.get('overlay.animation.press-delay')!;
const extra={...base,id:'overlay.animation.probe-width' as const,schema:appearanceSchema.shape.borderWidth,binding:{...base.binding,path:['appearance','borderWidth'],overrides:{key:['style','borderWidth'],mouseButton:['borderWidth']}},label:{key:'settings:probe.width.label' as const,fallback:'Extension probe'},ui:{group:'overlay.animation' as const,control:'number' as const,step:.5},defaultValue:()=>1};
const catalog=createCatalog(builtinCatalog.modules.all().map(module=>module.id==='overlay.keyboard'?{...module,settings:[...module.settings,extra.id]}:module),[...builtinCatalog.settings.all(),extra]);
const transport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false} as SettingsTransport;
let writes=0,frames=0,disposed=0,dirtyDisposals=0;
const service=new SettingsService({load:()=>({document:doc,warning:''}),save:()=>{writes++;},backup:()=>doc},transport,'ws://probe',undefined,catalog);
const registry=new LocalizationRegistry();registry.register(createStudioLocalization().exportPack('en'));registry.register({version:1,locale:'ru',namespaces:{settings:{'overlay.animation.press-delay.label':'Задержка нажатия','overlay.animation.motion.label':'Движение'},animation:{play:'Проверить анимацию'}}});
const address:AnimationAddress={scope:'module',profileId:doc.activeProfileId,moduleId:doc.profiles[0].modules[0].id};
const active=new Set<Scene>(),update=Scene.prototype.update,dispose=Scene.prototype.dispose;
Scene.prototype.update=function(...args){if(!active.has(this)){active.add(this);this.onFrame=()=>{frames++;};}return update.apply(this,args);};
Scene.prototype.dispose=function(){dispose.call(this);active.delete(this);disposed++;if(this.root.childElementCount || this.engine.listeners.size)dirtyDisposals++;};
let target=(value:'module'|'key'|'mouse')=>{};
const probe={service,registry,document:()=>structuredClone(service.document),writes:()=>writes,frames:()=>frames,active:()=>active.size,disposed:()=>disposed,dirty:()=>dirtyDisposals,previewRegistered:()=>!!animationViews.get('animation.preview'),target:(value:'module'|'key'|'mouse')=>target(value),
  svg:()=>service.transaction(doc=>{doc.shapes.ring=parseSvgShape('<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="M5 5H95V95H5Z M30 30H70V70H30Z"/></svg>','Ring');doc.profiles[0].modules[0].appearance.shapeId='ring';}),
};
Object.assign(window,{animationSchemaProbe:probe});
function Probe(){
 const [selection,setSelection]=useState<'module'|'key'|'mouse'>('module');target=setSelection;
 const view=useSyncExternalStore(service.subscribe,service.getSnapshot),mouse=doc.profiles[0].modules.find(module=>module.type==='mouse')!;
 const current:AnimationAddress=selection==='key'?{...address,element:{kind:'key',keyId:doc.profiles[0].modules[0].keys[0].id}}:selection==='mouse'?{...address,moduleId:mouse.id,element:{kind:'mouse-button',button:6}}:address;
 return <SettingsLocalization registry={registry}><ShapeLibrary.Provider value={{shapes:view.document.shapes}}><VisualPreviewSettings.Provider value={view.document.performance}>
 <div style={{margin:24,maxWidth:700}} onFocusCapture={event=>{if(event.target instanceof HTMLInputElement)service.beginGesture(event.target);}} onBlurCapture={()=>service.endGesture()}>
 <SchemaAnimationControls settings={service} address={current} prefix={selection==='key'?'Key ':selection==='mouse'?'Button ':''} mouse={selection==='mouse'} catalog={catalog}/>
 </div></VisualPreviewSettings.Provider></ShapeLibrary.Provider></SettingsLocalization>;
}
createRoot(document.getElementById('root')!).render(<Probe/>);
