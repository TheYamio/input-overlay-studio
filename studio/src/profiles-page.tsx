import {UnicodeInput} from './unicode-input';
import {useSyncExternalStore} from 'react';
import {languageChoices} from './core/localization/runtime';
import {studioLocalization} from './core/localization/builtins';
import {tr,trError,trText} from './core/localization/messages.ts';
import {copyName} from './core/editing';
import { useRef,useState,type ReactNode } from 'react';
import { activeProfile,gameForProfile,initialDocument,uid,type GameProfile,type StudioDocument } from './core/config';
import { activateGame,duplicateOverlay,removeOverlay,removeGame,linkGame,exportOverlay,exportGame,importGame } from './core/profiles';
import type { SettingsService } from './core/settings/service';
import './profiles.css';
function download(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ProfilesPage({settings,document:d,notify,renderGame,languagePacks=[]}:{settings:SettingsService;document:StudioDocument;notify:(message:string)=>void;renderGame:(game:GameProfile)=>ReactNode;languagePacks?:StudioDocument['languagePacks']}){
 useSyncExternalStore(studioLocalization.subscribe,studioLocalization.getSnapshot);
 const availablePacks=[...d.languagePacks,...languagePacks.filter(p=>!d.languagePacks.some(existing=>(existing.id??existing.locale)===(p.id??p.locale)))];
 const active=activeProfile(d),liveGameId=gameForProfile(d).id,[selected,setSelected]=useState(liveGameId),[replacement,setReplacement]=useState(''),file=useRef<HTMLInputElement>(null);
 const game=d.gameProfiles.find(g=>g.id===selected)??gameForProfile(d),linked=d.profiles.filter(p=>p.gameProfileId===game.id),other=d.gameProfiles.filter(g=>g.id!==game.id);
 const run=(operation:(doc:StudioDocument)=>void)=>{try{settings.transaction(operation,{source:'profiles',scopes:['game-profile','overlay-profile']});}catch(error){notify(error instanceof Error?trError(error):tr('ui:s-635b1cb207b5',"Could not change profiles."));}};
 const addGame=(copy:boolean)=>{const next={...structuredClone(copy?game:{...initialDocument().gameProfiles[0],game:'Custom' as const,scale:'Custom yaw' as const}),id:uid(),name:copy?copyName(game.name):'New game'};run(doc=>{doc.gameProfiles.push(next);});if(settings.document.gameProfiles.some(g=>g.id===next.id))setSelected(next.id);};
 return <div className="content-page workbench-page profile-workspace">
    <header className="workbench-heading"><h1>{trText('Profiles')}</h1></header>
    <section className="profile-game-column">
      <aside className="profile-list workbench-panel">
        <div className="page-section-heading"><h2>{tr('ui:s-e1b94928719a',"GAME PROFILES")}</h2></div>
        <p className="hint">{tr('ui:s-d48035ddb3f8',"Select to edit. Activate to switch the live overlay.")}</p>
        <div className="profile-actions profile-library-actions"><button className="secondary" disabled={d.gameProfiles.length>=50} onClick={()=>addGame(false)}>{tr('ui:s-946ed70539f0',"New game")}</button><button className="secondary" disabled={d.gameProfiles.length>=50} onClick={()=>file.current?.click()}>{tr('ui:s-692bcb83a04e',"Import game")}</button></div>
 {d.gameProfiles.map(g=><button key={g.id} className={g.id===game.id?'active':''} aria-pressed={g.id===game.id} onClick={()=>{setSelected(g.id);setReplacement('');}}><div><bdi>{g.name}</bdi><span>{g.name !== g.game && `${g.game} · `}{d.profiles.filter(p=>p.gameProfileId===g.id).length}{' '}{tr('ui:s-4992854f5d6b',"overlays")}</span></div>{liveGameId===g.id&&<small className="live-profile">{tr('ui:s-35e0d0360a0a',"LIVE")}</small>}</button>)}
 <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e=>{const input=e.currentTarget,f=input.files?.[0];input.value='';if(!f)return;try{const next=importGame(await f.text());run(doc=>{doc.gameProfiles.push(next);});if(settings.document.gameProfiles.some(g=>g.id===next.id))setSelected(next.id);}catch(error){notify(trError(error));}}}/>
      </aside>
      <div className="profile-game-detail workbench-panel">
        {renderGame(game)}
        <div className="profile-actions profile-detail-actions"><button className="primary" onClick={()=>run(doc=>activateGame(doc,game.id))}>{tr('ui:s-db302e05d8aa',"Activate game")}</button><button className="secondary" disabled={d.gameProfiles.length>=50} onClick={()=>addGame(true)}>{tr('ui:s-c427bd6935ec',"Duplicate game")}</button><button className="secondary" onClick={()=>download('game-profile.json',exportGame(d,game.id))}>{tr('ui:s-4223058fabbe',"Export game")}</button></div>
         {other.length>0&&<div className="profile-delete"><label className="field"><span>{tr('ui:s-4bae288a8437',"Move linked overlays to")}</span><select aria-label={tr('ui:s-f02e34fd5489',"Replacement game")} value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">{tr('ui:s-a0efab0d7c04',"Choose a game…")}</option>{other.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><button className="text-button danger" disabled={linked.length>0&&!replacement} onClick={()=>run(doc=>removeGame(doc,game.id,replacement||undefined))}>{tr('ui:s-f821dd741294',"Delete game")}{linked.length?tr('ui:s-52b5c6132be0'," and relink {{p0}} overlays",{p0:String(linked.length)}):''}</button></div>}
      </div>
    </section>
    <section className="overlay-profile-list">
      <div className="page-section-heading overlay-list-heading">
        <div><h2>{tr('ui:s-247615ad483d',"OVERLAY PROFILES")}</h2><p>{tr('ui:s-038915725a6e',"The active overlay uses its linked game’s sensitivity. Colors, buttons and captions belong to each overlay.")}</p></div>
        <button className="secondary" disabled={d.profiles.length>=50} onClick={()=>run(doc=>{const copy=duplicateOverlay(doc,active.id);copy.name='New overlay';})}>{tr('ui:s-be4c6dcbba9b',"New overlay from current")}</button>
      </div>
 {d.profiles.map(p=><article key={p.id} className={`overlay-profile-card workbench-panel ${p.id===active.id?'active':''}`}><div className="profile-card-heading"><h3><bdi>{p.name}</bdi></h3>{p.id===active.id&&<span className="live-profile">{tr('ui:s-35e0d0360a0a',"LIVE")}</span>}</div>
      <div className="overlay-profile-fields">
 <label className="field"><span>{tr('ui:s-cfe16d374838',"Overlay name")}</span><UnicodeInput aria-label={tr('ui:s-e4fade55ed38',"Overlay name {{p0}}",{p0:String(p.id)})} value={p.name} maxLength={100} onChange={e=>{if(e.target.value.trim())run(doc=>{doc.profiles.find(v=>v.id===p.id)!.name=e.target.value;});}}/></label>
 <label className="field"><span>{tr('ui:s-13b48228ac17',"Linked game")}</span><select aria-label={tr('ui:s-f630a55452af',"Linked game {{p0}}",{p0:String(p.name)})} value={p.gameProfileId} onChange={e=>run(doc=>linkGame(doc,p.id,e.target.value))}>{d.gameProfiles.map(g=><option key={g.id} value={g.id}>{g.name} · {g.dpi}{tr('ui:s-d47282e6d6c4',"DPI")}</option>)}</select></label>
 <label className="field"><span>{tr('ui:s-7d717ad33daf',"Overlay caption")}</span><UnicodeInput aria-label={tr('ui:s-ede687a6762e',"Caption {{p0}}",{p0:String(p.name)})} value={p.caption} maxLength={100} onChange={e=>run(doc=>{doc.profiles.find(v=>v.id===p.id)!.caption=e.target.value;})}/></label>
 <label className="field"><span>{studioLocalization.text('language:overlay')}</span><select aria-label={studioLocalization.text('language:overlay')} value={p.localePackageId??p.locale} onChange={e=>run(doc=>{const choice=languageChoices(availablePacks).find(v=>v.id===e.target.value);if(!choice)return;const profile=doc.profiles.find(v=>v.id===p.id)!;profile.locale=choice.locale;if(choice.origin==='custom'&&choice.id!==choice.locale)profile.localePackageId=choice.id;else delete profile.localePackageId;doc.languagePacks=availablePacks.filter(pack=>pack.id?doc.profiles.some(profile=>profile.localePackageId===pack.id):Object.keys(pack.namespaces.overlay??{}).length).map(pack=>({...pack,namespaces:{overlay:pack.namespaces.overlay??{}}}));})}>{!languageChoices(availablePacks).some(l=>l.id===(p.localePackageId??p.locale))&&<option value={p.locale}>{p.locale}</option>}{languageChoices(availablePacks).map(l=><option key={l.id} value={l.id}>{l.name}{l.origin==='custom'?` · ${studioLocalization.text('language:custom')} · ${l.author??l.locale} · ${l.id.slice(0,8)}`:''}</option>)}</select></label>
      </div>
 <div className="profile-actions"><button className={p.id===active.id?"secondary":"primary"} disabled={p.id===active.id} onClick={()=>run(doc=>{doc.activeProfileId=p.id;})}>{tr('ui:s-239ed657ea88',"Activate overlay")}</button><button className="secondary" disabled={d.profiles.length>=50} onClick={()=>run(doc=>{duplicateOverlay(doc,p.id);})}>{tr('ui:s-cf7964e895ca',"Duplicate overlay")}</button><button className="secondary" onClick={()=>download('overlay-profile.json',exportOverlay(d,p.id))}>{tr('ui:s-81b53846d3d9',"Export overlay")}</button><button className="text-button danger" disabled={d.profiles.length<=1} onClick={()=>run(doc=>removeOverlay(doc,p.id))}>{tr('ui:s-ecafa9efa867',"Delete overlay")}</button></div></article>)}
 </section></div>;
}
