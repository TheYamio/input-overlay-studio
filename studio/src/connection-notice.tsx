import {useEffect,useRef,useState} from 'react';
import {Radio,X} from 'lucide-react';
import type {ConnectionState} from './core/connection';
import {ConnectionNotices,type ConnectionNotice} from './core/connection-notice';
import {useSettingsText} from './settings-localization';
import './polish.css';
export function ConnectionNoticeBanner({state,endpointKey,openSettings}:{state:ConnectionState;endpointKey:string;openSettings:()=>void}){
 const tracker=useRef(new ConnectionNotices()),[notice,setNotice]=useState<ConnectionNotice|null>(null),t=useSettingsText();
 useEffect(()=>{setNotice(tracker.current.update(state,endpointKey));},[state,endpointKey]);
 useEffect(()=>{if(notice?.code!=='restored')return;const id=notice.id,timer=setTimeout(()=>setNotice(tracker.current.dismiss(id)),6000);return()=>clearTimeout(timer);},[notice]);
 if(!notice)return null;
 return <div className="connection-notice" data-connection-notice={notice.code} data-tone={notice.code==='restored'?'positive':'warning'} role={notice.code==='restored'?'status':'alert'}><Radio size={18}/><span>{t(`polish:notice.${notice.code}`)}</span><button className="text-button" onClick={openSettings}>{t('polish:settings')}</button><button className="icon-button" aria-label={t('polish:dismiss')} onClick={()=>setNotice(tracker.current.dismiss(notice.id))}><X size={17}/></button></div>;
}
