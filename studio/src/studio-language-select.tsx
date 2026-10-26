import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {PreferenceSettings} from './core/settings/preferences';
import {LanguageLibrary} from './core/localization/library';
import {languageChoices} from './core/localization/runtime';
import {loadBuiltinLanguage} from './core/localization/load-language';
import {useLocalizationRegistry,useSettingsText} from './settings-localization';

// Shared by Settings and first-run setup. Selection always uses the same atomic
// preference API and preloads a catalog before changing the active language.
export function StudioLanguageSelect({preferences,disabled=false,onBusyChange,notify}:{preferences:PreferenceSettings;disabled?:boolean;onBusyChange?:(busy:boolean)=>void;notify?:(message:string)=>void}){
 const state=useSyncExternalStore(preferences.subscribe,preferences.getSnapshot),registry=useLocalizationRegistry(),t=useSettingsText(),description=useId(),errorId=useId(),alive=useRef(true);
 const library=useMemo(()=>new LanguageLibrary(preferences,registry),[preferences,registry]),[switching,setSwitching]=useState(false),[error,setError]=useState('');
 const choices=languageChoices(state.languagePacks),selected=state.localePackageId??state.locale;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 return <div className="studio-language-selector"><label className="field"><span className="language-selector-label">{t('language:studio')} <small className="experimental-badge">{t('language:experimental')}</small></span>
  <select data-studio-language aria-label={t('language:studio')} aria-describedby={`${description}${error?` ${errorId}`:''}`} value={selected} disabled={disabled||switching} aria-busy={switching} onChange={async event=>{
   const id=event.target.value,choice=choices.find(p=>p.id===id);if(!choice)return;
   setError('');setSwitching(true);onBusyChange?.(true);
   try{await loadBuiltinLanguage(choice.locale,registry);library.select(id);}catch(value){if(alive.current){const key=value instanceof Error&&value.message==='language-storage'?'language:storage':'language:loadError';setError(key);notify?.(t(key));}}
   finally{if(alive.current){setSwitching(false);onBusyChange?.(false);}}
  }}>
   {!choices.some(p=>p.id===selected)&&<option value={selected}>{state.locale} · {t('language:fallback')}</option>}
   {choices.map(p=><option key={p.id} value={p.id}>{p.name}{p.origin==='custom'?` · ${t('language:custom')} · ${p.author??p.locale} · ${p.id.slice(0,8)}`:''}</option>)}
  </select>
 </label><p className="hint" id={description}>{t('language:experimentalHelp')}</p>{error&&<p className="hint warning" role="alert" id={errorId}>{t(error)}</p>}</div>;
}
