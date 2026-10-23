import {LocalizationRegistry} from '../../src/core/localization/registry';
// Test-only mount; excluded from the production entry graph.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initialDocument } from '../../src/core/config';
import { builtinCatalog } from '../../src/core/architecture/builtins';
import { createCatalog } from '../../src/core/architecture/registry';
import { SettingsService, type SettingsTransport } from '../../src/core/settings/service';
import { createStudioLocalization } from '../../src/core/localization/builtins';
import { SettingsLocalization } from '../../src/settings-localization';
import { SettingsField, SettingsComponentRegistry } from '../../src/settings-renderer';
import '../../src/style.css';
import '../../src/midnight.css';

const document=initialDocument(),registry=new LocalizationRegistry(),specialized=new SettingsComponentRegistry();
const transport={onStatus:()=>{},onError:()=>{},onDocument:()=>{},onConflict:()=>{},onRecovery:()=>{},onSaved:()=>{},connect:()=>{},stop:()=>{},publish:()=>false} as SettingsTransport;
const writes:unknown[]=[],service=new SettingsService({load:()=>({document,warning:''}),save:doc=>writes.push(doc),backup:()=>document},transport,'ws://probe');
const address={scope:'module' as const,profileId:document.profiles[0].id,moduleId:document.profiles[0].modules[0].id};
const key={...address,element:{kind:'key' as const,keyId:document.profiles[0].modules[0].keys[0].id}};
const catalog=createCatalog(builtinCatalog.modules.all(),builtinCatalog.settings.all().map(setting=>setting.id==='overlay.instance.name' ? {...setting,ui:{...setting.ui,control:'custom',component:'probe.name'}} : setting.id==='overlay.instance.opacity' ? {...setting,enabledWhen:[{capability:'render.scene',test:'available'}],disabledReason:{key:'probe:capability',fallback:'Renderer capability is required.'}} : setting));
registry.register(createStudioLocalization().exportPack('en'));registry.register({version:1,locale:'ru',namespaces:{settings:{'overlay.surface.radius.label':'Радиус углов','overlay.surface.accent.label':'Акцент','overlay.instance.name.label':'Имя модуля','render.performance.fps.label':'Частота анимации','render.performance.fps.option.41-75-74-6f':'Авто'},controls:{'number.invalid':'Допустимо {{limits}}. Значение не применено.','number.restored':'Допустимо {{limits}}. Восстановлено предыдущее значение.','reset.label':'Сбросить {{label}} к модулю',reset:'Сбросить ↶',inherited:'Унаследовано'}}});
let remove=()=>{};
const probe={
  service,registry,writes,
  locale:(locale:string)=>registry.setLocale(locale),
  register:()=>{remove=specialized.register('probe.name',({value,change,label})=><label>{label}<input aria-label="Specialized name" value={value as string} onChange={event=>change(event.target.value)}/></label>);},
  unregister:()=>remove(),
  snapshot:()=>structuredClone(service.document),
  shape:()=>service.transaction(doc=>{doc.shapes.probe={name:'Box',viewBox:[0,0,10,10],paths:[{d:'M0 0H10V10H0Z',matrix:[1,0,0,1,0,0],fill:true,fillRule:'nonzero',strokeWidth:0,linecap:'butt',linejoin:'miter',opacity:1}]};doc.profiles[0].modules[0].appearance.shapeId='probe';}),
};
Object.assign(window,{settingsProbe:probe});
function Probe(){
  const [available,setAvailable]=useState(true);
  return <SettingsLocalization registry={registry}><div style={{maxWidth:740,margin:24}} onFocusCapture={event=>{if(event.target instanceof HTMLInputElement)service.beginGesture(event.target);}} onBlurCapture={()=>service.endGesture()}>
    <button onClick={()=>setAvailable(!available)}>Toggle capability</button>
    <section data-testid="module" className="property-section">
      {(['overlay.instance.name','overlay.surface.accent','overlay.surface.radius','overlay.instance.layer','overlay.instance.opacity','overlay.instance.visible'] as const).map(id=><SettingsField key={id} settings={service} id={id} address={address}/>)}
      <SettingsField settings={service} id="render.performance.fps" address={{scope:'global'}}/>
      <SettingsField settings={service} id="overlay.animation.secondary-color" address={address}/>
    </section>
    <section data-testid="key" className="property-section"><SettingsField settings={service} id="overlay.surface.accent" address={key}/></section>
    <section data-testid="custom" className="property-section"><SettingsField settings={service} id="overlay.instance.name" address={address} catalog={catalog} specialized={specialized}/></section>
    <section data-testid="capability" className="property-section"><SettingsField settings={service} id="overlay.instance.opacity" address={address} catalog={catalog} available={new Set(available?['render.scene']:[])}/></section>
  </div></SettingsLocalization>;
}
createRoot(window.document.getElementById('root')!).render(<Probe/>);
