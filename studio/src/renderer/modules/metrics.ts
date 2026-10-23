import {numberLocale} from '../../core/unicode';
import {overlayText} from '../../core/localization/runtime';
import { cm360 } from '../../core/config';
import type { ModuleContext,ModuleUpdate,VisualFactory,VisualInstance,ModuleFrame } from './contracts';
import { fitTextModule } from './surface';

class DistanceRuntime implements VisualInstance {
 private state!:ModuleUpdate;private caption?:string;
 private value=document.createElement('strong');private formats=new Map<string,Intl.NumberFormat>();
 constructor(private context:ModuleContext){}
 update(state:ModuleUpdate){
  this.state=state;const {element}=this.context,m=state.module;element.classList.add('metric');
  if(this.caption!==m.caption){const caption=document.createElement('span');caption.className='metric-caption';caption.dir='auto';caption.textContent=m.caption;const content=document.createElement('div');content.className='module-text-content metric-content';content.append(caption,this.value);element.replaceChildren(content);this.caption=m.caption;}
  fitTextModule(element,m);
 }
 frame({dirty,distanceChanged}:ModuleFrame){
  if(!dirty&&!distanceChanged)return;const m=this.state.module,cm=this.context.engine.distanceCm,meters=m.unit==='m'||m.unit==='Auto'&&cm>=100;
  const locale=this.state.profile.locale,formatKey=`${locale}:${m.decimals}`;let format=this.formats.get(formatKey);if(!format){format=new Intl.NumberFormat(numberLocale(locale),{minimumFractionDigits:m.decimals,maximumFractionDigits:m.decimals});this.formats.clear();this.formats.set(formatKey,format);}
  const text=`${format.format(cm/(meters?100:1))} ${overlayText(this.state.document.languagePacks,locale,meters?'m':'cm',meters?'m':'cm')}`;
  if(this.value.textContent!==text){this.value.textContent=text;fitTextModule(this.context.element,m);}
 }
 resize(){fitTextModule(this.context.element,this.state.module);}
 dispose(){this.formats.clear();this.context.element.replaceChildren();}
}
class SensitivityRuntime implements VisualInstance {
 private state!:ModuleUpdate;private signature='';
 constructor(private context:ModuleContext){}
 update(state:ModuleUpdate){
  this.state=state;const p=state.profile,m=state.module,el=this.context.element,cm=cm360(p);el.classList.add('sensitivity-strip');
  const t=(key:string,fallback:string)=>overlayText(state.document.languagePacks,p.locale,key,fallback);
  const signature=JSON.stringify([p.locale,t('game','GAME'),t('sensitivity','SENS'),t('unknown','Unknown scale'),t('turn','CM / 360°'),p.game,p.caption,p.dpi,p.sensitivity,p.yaw,p.scale,p.manualCm,m.sensitivityStyle,m.showGame,m.showDpi,m.showSens,m.showEdpi,m.showCm]);
  if(signature!==this.signature){
   const number=(value:number,digits:number)=>new Intl.NumberFormat(numberLocale(p.locale),{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
   const content=document.createElement('div');content.className='module-text-content sensitivity-content';el.replaceChildren(content);
   const add=(text:string,caption:string)=>{const item=document.createElement('div'),value=document.createElement('strong'),sub=document.createElement('span');value.dir='auto';sub.dir='auto';value.textContent=text;sub.textContent=caption;item.append(value,sub);content.append(item);};
   if(m.sensitivityStyle==='Detailed'&&m.showGame)add(p.game,p.caption||t('game','GAME'));
   if(m.sensitivityStyle!=='Minimal'&&m.showDpi)add(number(p.dpi,0),'DPI');
   if(m.sensitivityStyle!=='Minimal'&&m.showSens)add(number(p.sensitivity,2),t('sensitivity','SENS'));
   if(m.sensitivityStyle==='Detailed'&&m.showEdpi)add(number(p.dpi*p.sensitivity,0),'eDPI');
   if(m.showCm)add(cm===null?t('unknown','Unknown scale'):number(cm,2),t('turn','CM / 360°'));this.signature=signature;
  }
  fitTextModule(el,m);
 }
 resize(){fitTextModule(this.context.element,this.state.module);}
 dispose(){this.context.element.replaceChildren();this.signature='';}
}
export const distanceFactory:VisualFactory={create:context=>new DistanceRuntime(context)};
export const sensitivityFactory:VisualFactory={create:context=>new SensitivityRuntime(context)};
