import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {X} from 'lucide-react';
import {loadBuiltinLanguage} from './core/localization/load-language';
import type {PreferenceSettings} from './core/settings/preferences';
import type {LocalePack} from './core/localization/registry';
import {LanguageLibrary} from './core/localization/library';
import {languageTemplate} from './core/localization/builtins';
import {languageChoices} from './core/localization/runtime';
import {useSettingsText,useLocalizationRegistry} from './settings-localization';

function download(pack:LocalePack,name:string){
 const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'})),a=document.createElement('a');
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function DeleteLanguage({pack,close,remove}:{pack:LocalePack;close:()=>void;remove:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),t=useSettingsText();
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,element=dialog.current!;element.showModal();element.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();return()=>{element.close();if(previous?.isConnected)previous.focus();};},[]);
 return <dialog ref={dialog} className="language-dialog" aria-labelledby="delete-language-title" aria-describedby="delete-language-message" onCancel={close}>
  <h3 id="delete-language-title">{t('language:deleteTitle')}</h3>
  <p id="delete-language-message">{t('language:deleteMessage','Delete {{name}}?',{name:pack.name??pack.locale})}</p>
  <p className="hint" dir="auto">{pack.locale} · {pack.author??t('language:custom')} · {pack.id?.slice(0,8)}</p>
  <footer><button data-cancel className="secondary" onClick={close}>{t('language:cancel')}</button><button className="secondary danger" onClick={remove}>{t('language:delete')}</button></footer>
 </dialog>;
}
export function LanguageSettings({preferences,notify}:{preferences:PreferenceSettings;notify:(message:string)=>void}){
 const state=useSyncExternalStore(preferences.subscribe,preferences.getSnapshot),file=useRef<HTMLInputElement>(null),t=useSettingsText(),registry=useLocalizationRegistry();
 const library=useMemo(()=>new LanguageLibrary(preferences,registry),[preferences,registry]),[switching,setSwitching]=useState(false),[deleting,setDeleting]=useState<LocalePack|null>(null);
 const choices=languageChoices(state.languagePacks),selected=state.localePackageId??state.locale;
 const error=(value:unknown)=>notify(t(value instanceof Error&&value.message==='language-storage'?'language:storage':'language:invalid'));
 return <section className="settings-section language-settings"><h3>{t('language:title')}</h3>
  <label className="field"><span className="language-selector-label">{t('language:studio')} <small className="experimental-badge">{t('language:experimental')}</small></span>
   <select aria-label={t('language:studio')} aria-describedby="language-experimental-help" value={selected} disabled={switching} aria-busy={switching} onChange={async e=>{const id=e.target.value,choice=choices.find(p=>p.id===id);if(!choice)return;setSwitching(true);try{await loadBuiltinLanguage(choice.locale,registry);library.select(id);}catch(e){notify(t(e instanceof Error&&e.message==='language-storage'?'language:storage':'language:loadError'));}finally{setSwitching(false);}}}>
    {!choices.some(p=>p.id===selected)&&<option value={selected}>{state.locale} · {t('language:fallback')}</option>}
    {choices.map(p=><option key={p.id} value={p.id}>{p.name}{p.origin==='custom'?` · ${t('language:custom')} · ${p.author??p.locale} · ${p.id.slice(0,8)}`:''}</option>)}
   </select>
  </label>
  <p className="hint" id="language-experimental-help">{t('language:experimentalHelp')}</p>
  <p className="hint">{t('language:help')}</p><p className="hint">{t('language:unicode')}</p>{state.locale==='sjn-teng-x-art'&&<p className="hint">{t('language:artistic')}</p>}
  <div className="language-actions">
   <button className="secondary" disabled={switching} onClick={()=>file.current?.click()}>{t('language:import')}</button>
   <button className="secondary" disabled={switching||!choices.some(p=>p.id===selected)} onClick={async()=>{setSwitching(true);try{await loadBuiltinLanguage(state.locale,registry);download(library.export(selected),'input-overlay-translation.json');}catch(e){error(e);}finally{setSwitching(false);}}}>{t('language:exportSelected')}</button>
   <button className="text-button" onClick={()=>download(languageTemplate(),'input-overlay-language.json')}>{t('language:export')}</button>
  </div>
  <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e=>{const input=e.currentTarget,f=input.files?.[0];input.value='';if(!f)return;try{if(f.size>1_000_000)throw Error();library.import(JSON.parse(await f.text()));notify(t('language:saved'));}catch(e){error(e);}}}/>
  {state.languagePacks.map(pack=><div className="language-package" key={pack.id}><div><b dir="auto">{pack.name??pack.locale}</b><small>{t('language:custom')} · {pack.locale} · {pack.translationVersion??'1.0'} · {pack.id?.slice(0,8)}</small>{pack.author&&<small dir="auto">{pack.author}</small>}</div><button className="text-button danger" aria-label={t('language:removeNamed','Remove {{name}}',{name:pack.name??pack.locale})} title={t('language:remove')} onClick={()=>setDeleting(pack)}><X size={18}/></button></div>)}
  {deleting&&<DeleteLanguage pack={deleting} close={()=>setDeleting(null)} remove={()=>{try{library.remove(deleting.id!);setDeleting(null);}catch(e){error(e);}}}/>}
 </section>;
}
