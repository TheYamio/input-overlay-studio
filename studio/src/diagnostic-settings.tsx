import {useEffect,useState} from 'react';
import {Copy,Activity} from 'lucide-react';
import type {SettingsSnapshot} from './core/settings/service';
import type {HttpStatus} from './core/obs';
import {formatDiagnostics} from './core/diagnostics';
import {useSettingsText} from './settings-localization';
import './polish.css';
export function DiagnosticSettings({view,http}:{view:SettingsSnapshot;http:HttpStatus|null}){
 const t=useSettingsText(),[message,setMessage]=useState(''),[fallback,setFallback]=useState(''),[size,setSize]=useState(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio}));
 useEffect(()=>{const resize=()=>setSize({width:innerWidth,height:innerHeight,scale:devicePixelRatio});addEventListener('resize',resize);return()=>removeEventListener('resize',resize);},[]);
 const report=()=>formatDiagnostics(view,{...size,platform:navigator.platform,native:!!window.__TAURI__},http);
 const copy=async()=>{const text=report();setFallback('');try{await navigator.clipboard.writeText(text);setMessage('copied');}catch{setFallback(text);setMessage('failed');}};
 return <div className="settings-section diagnostic-settings"><h3><Activity size={18}/>{t('polish:diagnostics.title')}</h3><p className="hint">{t('polish:diagnostics.help')}</p><button className="secondary" onClick={()=>void copy()}><Copy size={15}/>{t('polish:diagnostics.copy')}</button><details className="diagnostic-preview" open={fallback?true:undefined}><summary>{t('polish:diagnostics.preview')}</summary><label className="field"><span>{t('polish:diagnostics.label')}</span><textarea readOnly spellCheck={false} aria-label={t('polish:diagnostics.label')} value={fallback||report()} onFocus={e=>e.currentTarget.select()}/></label></details>{message&&<p className="hint" role="status">{t(`polish:diagnostics.${message}`)}</p>}</div>;
}
