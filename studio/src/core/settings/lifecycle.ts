import type {SettingsService} from './service';

export function bindDocumentLifecycle(settings:Pick<SettingsService,'checkpoint'>,page:EventTarget|undefined=typeof window==='undefined'?undefined:window,visibility:Document|undefined=typeof document==='undefined'?undefined:document){
 if(!page||!visibility)return ()=>{};
 const checkpoint=()=>{settings.checkpoint();};
 const hidden=()=>{if(visibility.visibilityState==='hidden')checkpoint();};
 page.addEventListener('pagehide',checkpoint);page.addEventListener('beforeunload',checkpoint);visibility.addEventListener('visibilitychange',hidden);
 return ()=>{page.removeEventListener('pagehide',checkpoint);page.removeEventListener('beforeunload',checkpoint);visibility.removeEventListener('visibilitychange',hidden);};
}
