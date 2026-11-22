import {StudioLanguageSelect} from './studio-language-select';
import {registerSettingsView} from './settings-views';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Check,ChevronRight,Keyboard,Mouse,MousePointer2,Radio,Settings2,SlidersHorizontal,X} from 'lucide-react';
import type {PreferenceSettings} from './core/settings/preferences';
import type {SettingsSnapshot} from './core/settings/service';
import type {InputEngine} from './core/input';
import {emptySetupInput,setupCanFinish,setupInputComplete,watchSetupInput,type SetupInput} from './core/setup';
import {resolvedProfile,type StudioDocument} from './core/config';
import {factoryPresets,type PresetBundle} from './core/factory-presets';
import {presetPalette} from './core/preset-colors';
import {connectionIndicators} from './core/connection-status';
import {trText} from './core/localization/messages';
import {useSettingsText} from './settings-localization';
import {ConnectionDetails} from './connection-status';
import {ObsConnectionPanel, type ObsConnectionProps} from './obs-connection-panel';
import {SceneThumbnail} from './scene-thumbnail';
import './setup-guide.css';

type Preset=StudioDocument['presets'][number];
interface Props{
 visible?:boolean;startStep:number;preferences:PreferenceSettings;view:SettingsSnapshot;engine:InputEngine;
 apply:(preset:Preset,colors:boolean,bundle?:PresetBundle)=>boolean;
 obsConnection:ObsConnectionProps;close:()=>void;notify:(text:string)=>void;
}
function SetupGuideView({visible=true,startStep,preferences,view,engine,apply,obsConnection,close,notify}:Props){
 const t=useSettingsText(),dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const {openSettings}=obsConnection;
 const [languageBusy,setLanguageBusy]=useState(false);
 const [step,setStep]=useState(startStep),[choice,setChoice]=useState('current');
 const [input,setInput]=useState(emptySetupInput),[message,setMessage]=useState('');
 const inputRef=useRef(input),resumeFocus=useRef<HTMLElement|null>(null);
 const updateInput=useCallback((value:SetupInput)=>{inputRef.current=value;setInput(value);},[]);
 const persist=(status:'in-progress'|'skipped'|'completed',next=step)=>preferences.set('studio.preferences.setup',{version:1,status,step:next});
 const dismiss=()=>{if(!persist('skipped'))notify(t('setup:storageError'));close();};
 useEffect(()=>{
  if(!preferences.set('studio.preferences.setup',{version:1,status:'in-progress',step:startStep}))setMessage('storageError');
 },[preferences,startStep]);
 useEffect(()=>{
  if(!visible)return;
  const previous=document.activeElement as HTMLElement|null,element=dialog.current!;element.showModal();
  if(resumeFocus.current?.isConnected)resumeFocus.current.focus({preventScroll:true});
  return()=>{resumeFocus.current=element.contains(document.activeElement)?document.activeElement as HTMLElement:null;element.close();if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[visible]);
 useEffect(()=>{if(!visible)return;(step===0?dialog.current?.querySelector<HTMLSelectElement>('[data-studio-language]'):heading.current)?.focus();dialog.current?.querySelector('.setup-body')?.scrollTo(0,0);},[step]);
 const canObserve=view.connectionState==='Connected'&&view.connectionStatus?.captureEnabled!==false&&view.connectionStatus?.captureRunning!==false;
 useEffect(()=>{if(!canObserve)updateInput(emptySetupInput());},[canObserve,updateInput]);
 useEffect(()=>{if(!visible||step!==1||!canObserve)return;return watchSetupInput(engine,updateInput,inputRef.current);},[visible,step,canObserve,engine,updateInput]);
 const go=(next:number)=>{if(!persist('in-progress',next))setMessage('storageError');else setMessage('');setStep(next);};
 const bundle=factoryPresets.find(item=>item.preset.id===choice),preset=bundle?.preset??view.document.presets.find(item=>item.id===choice);
 const profile=resolvedProfile(view.document),modules=preset?.modules??profile.modules;
 const preview=bundle?{...view.document,assets:{...view.document.assets,...bundle.assets},shapes:{...view.document.shapes,...bundle.shapes}}:view.document;
 const advance=()=>{
  if(step===0&&choice!=='current'){
   if(!preset||!apply(preset,false,bundle)){setMessage('applyError');return;}
   setChoice('current');
  }
  if(step<3)go(step+1);
  else if(setupCanFinish(view,input)){if(persist('completed'))close();else setMessage('storageError');}
 };
 const {capture,source}=connectionIndicators(view),canFinish=setupCanFinish(view,input),complete=setupInputComplete(input);
 const blocked=!!view.unsupported||view.protected||view.conflict;
 const steps=['layout','input','obs','ready'];
 let nextLabel='setup:next';
 if(step===0&&choice!=='current')nextLabel='setup:layoutApply';
 if(step===1&&!complete)nextLabel=Object.values(input).some(Boolean)?'setup:continuePartial':'setup:continueUnverified';
 if(step===2)nextLabel='setup:ready';
 if(step===3)nextLabel='setup:finish';
 return <dialog ref={dialog} className="setup-guide" aria-labelledby="setup-title" aria-describedby="setup-intro" onCancel={e=>{e.preventDefault();dismiss();}}>
  <header><div><span className="eyebrow">Input Overlay Studio</span><h2 id="setup-title">{t('setup:title')}</h2><p id="setup-intro">{t('setup:intro')}</p></div><button className="setup-close" aria-label={t('setup:skip')} onClick={dismiss}><X size={20}/></button></header>
  <ol className="setup-steps" aria-label={t('setup:progressLabel')}>{steps.map((label,i)=><li key={label} aria-current={step===i?'step':undefined} className={i<step?(i===1&&!complete?'unverified':'passed'):''}><span>{i<step?(i===1&&!complete?'–':<Check size={15}/>):i+1}</span><b>{t(`setup:${label}`)}</b></li>)}</ol>
  <div className="setup-body" data-setup-step={step}>
   {step===0&&<div className="setup-language-selector"><StudioLanguageSelect preferences={preferences} onBusyChange={setLanguageBusy}/></div>}
   <h3 ref={heading} tabIndex={-1}>{t(`setup:${steps[step]}`)}</h3>
   {step===0&&<><p>{t('setup:layoutHelp')}</p><label className="field"><span>{t('setup:layout')}</span><select data-setup-layout value={choice} onChange={e=>setChoice(e.target.value)}>
    <option value="current">{t('setup:keep')}</option><optgroup label={t('setup:layouts')}>{factoryPresets.map(item=><option key={item.preset.id} value={item.preset.id}>{trText(item.preset.name)}</option>)}</optgroup>
    {!!view.document.presets.filter(p=>p.kind!=='style').length&&<optgroup label={t('setup:savedLayouts')}>{view.document.presets.filter(p=>p.kind!=='style').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
   </select></label><div className="setup-layout-preview" role="img" aria-label={t('setup:preview')}><SceneThumbnail document={preview} modules={modules} profile={profile}/></div>
   {preset?.description&&<p className="hint">{trText(preset.description)}</p>}<div className="setup-palette" aria-hidden="true">{presetPalette(modules).map(color=><i key={color} style={{background:color}}/>)}</div>
   {blocked&&<p className="setup-warning">{view.warning||t('setup:applyError')}</p>}</>}
   {step===1&&<><p>{t('setup:inputHelp')}</p><div className="setup-inputs" role="status" aria-live="polite">{([['keyboard',Keyboard],['movement',MousePointer2],['buttons',Mouse],['wheel',SlidersHorizontal]] as const).map(([kind,Icon])=><div key={kind} data-input-check={kind} data-received={input[kind]}><Icon size={22}/><div><b>{t(`setup:${kind}`)}</b><span>{t(`setup:${input[kind]?'observed':'notObserved'}`)}</span></div>{input[kind]&&<Check size={20}/>}</div>)}</div>
   <p className="setup-connection" data-tone={capture==='active'?'positive':'warning'}>{t(`connection:capture.${capture}`)}</p>{!canObserve&&<p>{t('setup:connectFirst')}</p>}<button className="text-button" onClick={openSettings}><Settings2 size={15}/>{t('setup:openSettings')}</button></>}
   {step===2&&<ObsConnectionPanel {...obsConnection}/>}
   {step===3&&<>
    <div className="setup-source" data-ready={source==='ready'} role="status"><Radio size={30}/><h4>{t(`connection:source.${source}`)}</h4></div>
    {canFinish ? <p>{t('setup:readyHelp')}</p> : source!=='ready'&&<p>{t('setup:waitHelp')}</p>}
    {!complete&&<p className="setup-warning">{t('setup:unverified')}</p>}
    {!canFinish&&<><ConnectionDetails view={view} compact/><button className="text-button" onClick={openSettings}><Settings2 size={15}/>{t('setup:openSettings')}</button></>}
   </>}
   {message&&<p className="setup-message" role="status">{t(`setup:${message}`,message)}</p>}
  </div>
  <footer><div className="setup-footer-meta"><button className="text-button" onClick={dismiss}>{t('setup:skip')}</button><span className="setup-progress">{t('setup:progress',undefined,{current:String(step+1),total:'4'})}</span></div><div className="setup-footer-actions">{step>0&&<button className="secondary" onClick={()=>go(step-1)}>{t('setup:back')}</button>}
   <button className="primary" disabled={languageBusy||step===0&&choice!=='current'&&blocked||step===3&&!canFinish} onClick={advance}>{t(nextLabel)}{step<3&&<ChevronRight size={16}/>}</button></div></footer>
 </dialog>;
}

export const SetupGuide=registerSettingsView('editor.setup',SetupGuideView);
