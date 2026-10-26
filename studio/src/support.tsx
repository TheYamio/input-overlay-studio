import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Heart,ArrowUpRight,Check,ExternalLink} from 'lucide-react';
import {useSettingsText} from './settings-localization';
import {SupportSettings,eligible,type ActivityContext} from './core/support/service';
import {paymentUrl} from './core/support/schema';
import './support.css';

export async function openSupportLink(url:string){
 const safe=paymentUrl(url);if(!safe)throw Error('Invalid external URL');
 if(window.__TAURI__){await window.__TAURI__.core.invoke('open_external_link',{url:safe});return;}
 const link=document.createElement('a');link.href=safe;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.click();
}
export function SupportPage({support,notify}:{support:SupportSettings;notify:(message:string)=>void}){
 const t=useSettingsText(),state=useSyncExternalStore(support.subscribe,support.getSnapshot);
 const open=async(url:string)=>{try{await openSupportLink(url);}catch{notify(t('support:openError'));}};
 return <div className="content-page support-page">
  <section className="support-story"><div className="support-mark" aria-hidden="true"><Heart size={26}/></div><h2>{t('support:intro')}</h2><p>{t('support:author')}</p><p className="support-free"><Check size={18} aria-hidden="true"/>{t('support:free')}</p>
   <h3>{t('support:whyTitle')}</h3><p>{t('support:why')}</p><h3>{t('support:roadmapTitle')}</h3><ul>{support.roadmap.map(id=><li key={id}>{t(`support:${id}`)}</li>)}</ul>
   <button className="secondary support-github" onClick={()=>void open(support.projectUrl)}>{t('support:github')}<ArrowUpRight size={16} aria-hidden="true"/></button>
  </section>
  <section className="support-methods"><h2>{t('support:methods')}</h2>{state.providers.length?<><div className="support-providers">{state.providers.map(provider=><button key={provider.id} className="secondary support-provider" onClick={()=>void open(provider.url)}><span dir="auto">{provider.name}</span><ExternalLink size={17} aria-hidden="true"/></button>)}</div><p className="hint">{t('support:external')}</p></>:<p className="support-empty">{t('support:empty')}</p>}
   <div className="support-preferences"><label><input type="checkbox" checked={state.prompt.enabled&&!state.prompt.dismissed&&state.prompt.shownAt===null} disabled={state.prompt.dismissed||state.prompt.shownAt!==null} onChange={e=>{if(!support.set('support.prompt.enabled',e.target.checked))notify(t('support:storageError'));}}/><span>{t('support:promptSetting')}</span></label><p className="hint">{t('support:promptHelp')}</p></div>
  </section>
 </div>;
}
export function SupportEntry({open,active=false}:{open:()=>void;active?:boolean}){const t=useSettingsText();return <button data-action="support" className={`support-entry ${active?'active':''}`} aria-current={active?'page':undefined} title={t('support:title')} onClick={open}><Heart size={17} aria-hidden="true"/><span>{t('support:title')}</span></button>;}

function safeMoment(){
 const focused=document.activeElement;
 return document.visibilityState==='visible'&&document.hasFocus()&&!document.querySelector('dialog[open],[aria-modal="true"],.warning-banner')&&!(focused instanceof HTMLElement&&focused.matches('input,textarea,select,[contenteditable="true"],[role="slider"],[data-shortcut-recording]'));
}
function validActivity(value:ActivityContext){return value&&Number.isSafeInteger(value.firstLaunchedAt)&&Number.isSafeInteger(value.overlayConnections)&&value.overlayConnections>=0&&Number.isSafeInteger(value.runtimesActive)&&value.runtimesActive>=0&&(typeof value.obsRunning==='boolean'||value.obsRunning===null)&&typeof value.storageAvailable==='boolean';}
export function SupportPrompt({support,allowed,open}:{support:SupportSettings;allowed:boolean;open:()=>void}){
 const t=useSettingsText(),state=useSyncExternalStore(support.subscribe,support.getSnapshot),[visible,setVisible]=useState(false),policy=useRef(allowed);policy.current=allowed;
 const showing=useRef(false);
 useEffect(()=>{
  // Browser Studio cannot reliably detect a running OBS process. Fail closed.
  if(!window.__TAURI__||!state.enabled||!state.providers.length||!state.prompt.enabled||state.prompt.dismissed||state.prompt.shownAt!==null)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>,lastInteraction=Date.now(),pointer=false;
  const hide=()=>{showing.current=false;setVisible(false);};
  const interaction=(event:Event)=>{if((event.target as HTMLElement)?.closest?.('.support-prompt'))return;lastInteraction=Date.now();if(event.type==='pointerdown')pointer=true;if(event.type==='pointerup'||event.type==='pointercancel'||event.type==='blur')pointer=false;if(showing.current)hide();};
  const storage=(event:StorageEvent)=>{if(event.key==='studio.support'){support.refresh();hide();}};
  const poll=async()=>{
   const prompt=support.getSnapshot().prompt;
   if(stopped||!showing.current&&(!prompt.enabled||prompt.dismissed||prompt.shownAt!==null))return;
   let activity:ActivityContext|null=null;
   try{const result=await window.__TAURI__!.core.invoke<ActivityContext>('get_support_context');if(validActivity(result))activity=result;}catch{/* Unknown OBS state never permits an invitation. */}
   if(stopped)return;
   const safe=policy.current&&safeMoment()&&!pointer;
   if(showing.current&&(!safe||!activity||activity.obsRunning!==false||activity.runtimesActive!==0))hide();
   if(!showing.current&&Date.now()-lastInteraction>=30000){
    const context={now:Date.now(),activity,studio:policy.current,visible:document.visibilityState==='visible',safe};
    if(eligible(support.getSnapshot(),context)&&support.claim(context)){showing.current=true;setVisible(true);}
   }
   const oldEnough=activity&&Date.now()>=activity.firstLaunchedAt+7*86400000&&activity.overlayConnections>=3;
   timer=setTimeout(()=>void poll(),oldEnough?2000:30000);
  };
  for(const event of ['pointerdown','pointerup','pointercancel','keydown','focusin','blur','visibilitychange'])window.addEventListener(event,interaction,true);
  window.addEventListener('storage',storage);void poll();
  return()=>{stopped=true;clearTimeout(timer);for(const event of ['pointerdown','pointerup','pointercancel','keydown','focusin','blur','visibilitychange'])window.removeEventListener(event,interaction,true);window.removeEventListener('storage',storage);};
 },[support,state.enabled,state.providers,state.prompt.enabled]);
 // Dialogs cannot be covered even between native status polls.
 useEffect(()=>{if(!visible)return;if(!allowed||!safeMoment()){showing.current=false;setVisible(false);return;}const observer=new MutationObserver(()=>{if(document.querySelector('dialog[open],[aria-modal="true"]')){showing.current=false;setVisible(false);}});observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open','aria-modal'],childList:true});return()=>observer.disconnect();},[visible,allowed]);
 if(!visible||!allowed||!state.enabled)return null;
 const close=()=>{showing.current=false;setVisible(false);support.dismiss();};
 return <aside className="support-prompt" role="region" aria-labelledby="support-prompt-title"><Heart size={18} aria-hidden="true"/><div><b id="support-prompt-title">{t('support:promptTitle')}</b><p>{t('support:promptBody')}</p></div><div className="support-prompt-actions"><button className="secondary small" onClick={()=>{close();open();}}>{t('support:title')}</button><button className="text-button" onClick={close}>{t('support:dismiss')}</button></div></aside>;
}
