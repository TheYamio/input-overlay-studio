import type {SettingsSnapshot} from './core/settings/service';
import {connectionIndicators} from './core/connection-status';
import {trText} from './core/localization/messages';
import {useSettingsText} from './settings-localization';
import './connection-status.css';

function useIndicators(view:SettingsSnapshot){
 const t=useSettingsText(),{capture,source}=connectionIndicators(view),r=view.connectionStatus?.runtimes;
 return [
  {id:'capture',state:capture,label:t('connection:label.capture'),text:t(`connection:capture.${capture}`),help:t('connection:capture.help'),tone:capture==='active'?'positive':capture==='unavailable'?'negative':capture==='disabled'||capture==='connecting'?'warning':'muted'},
  {id:'save',state:view.pending?'pending':view.saveStatus,label:t('connection:label.save'),text:trText(view.saveStatus),help:t('connection:save.help'),tone:/failed/i.test(view.saveStatus)?'negative':view.pending||view.conflict?'warning':view.saveStatus==='Saved to capture server'?'positive':'muted'},
  {id:'runtime',state:source,label:t('connection:label.source'),text:t(`connection:source.${source}`)+(r&&r.connected>1?` (${r.ready}/${r.connected})`:''),help:t('connection:source.help'),tone:source==='ready'?'positive':source==='error'||source==='unresponsive'?'negative':source==='loading'||source==='partial'||source==='changes'?'warning':'muted'},
 ];
}
export function ConnectionIndicators({view}:{view:SettingsSnapshot}){
 const parts=useIndicators(view);
 return <div className="connection-indicators" role="status" aria-live="polite" aria-atomic="true">{parts.map(part=><span key={part.id} className="connection-indicator" data-connection-part={part.id} data-connection-state={part.state} data-tone={part.tone} title={part.help} aria-label={`${part.label}: ${part.text}`}><i aria-hidden="true"/>{part.text}</span>)}</div>;
}
export function ConnectionDetails({view}:{view:SettingsSnapshot}){
 const parts=useIndicators(view),t=useSettingsText();
 return <div className="connection-details"><h4>{t('connection:details.title')}</h4><dl>{parts.map(part=><div key={part.id}><dt>{part.label}</dt><dd data-tone={part.tone}>{part.text}</dd><dd className="hint">{part.help}</dd></div>)}</dl></div>;
}
