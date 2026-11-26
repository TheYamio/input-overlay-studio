import {useEffect,useRef,useState} from 'react';
import {tr} from './core/localization/messages';
import {bindingFromCode,bindingFromVK} from './core/key-binding';
import type {InputEngine} from './core/input';

export function CounterKeyRecorder({engine,value,assign,label}:{engine:InputEngine;value:number;assign:(code:number)=>void;label:string}){
 const [waiting,setWaiting]=useState(false),[message,setMessage]=useState('');const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!waiting)return;let active=true;const finish=(code:number|null)=>{if(!active)return;active=false;setWaiting(false);if(code===null)setMessage(tr('ui:counter.captureCancelled','Key assignment cancelled.'));else{assign(code);setMessage(tr('ui:counter.assigned','Key assigned.'));}};
  const keyboard=(event:KeyboardEvent)=>{event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape'){finish(null);return;}if(event.repeat||event.isComposing)return;const key=bindingFromCode(event.code);if(key)finish(key.code);};
  const native=(event:import('./core/input').InputEvent)=>{if(document.visibilityState==='visible'&&event.event_type==='key_pressed')finish(event.rawcode);};
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))finish(null);};const blur=()=>finish(null);
  window.addEventListener('keydown',keyboard,true);window.addEventListener('pointerdown',outside,true);window.addEventListener('blur',blur);engine.listeners.add(native);const timer=setTimeout(()=>finish(null),15000);
  return()=>{active=false;clearTimeout(timer);window.removeEventListener('keydown',keyboard,true);window.removeEventListener('pointerdown',outside,true);window.removeEventListener('blur',blur);engine.listeners.delete(native);};
 },[waiting,engine,assign]);
 const binding=bindingFromVK(value);
 return <div ref={root} className="key-recorder"><span>{label}</span><button className="secondary small" aria-label={`${label}: ${binding?.label??`VK ${value}`}`} aria-pressed={waiting} onClick={()=>{setMessage('');setWaiting(v=>!v);}}>{waiting?tr('ui:counter.cancel','Cancel'):tr('ui:counter.assign','Assign key')} · {binding?.label??`VK ${value}`}</button><small className="hint" role="status">{waiting?tr('ui:counter.pressKey','Press a key. Esc cancels.'):message}</small></div>;
}
