import {forwardRef,useEffect,useRef,useState,type InputHTMLAttributes,type TextareaHTMLAttributes} from 'react';
import {truncateText,validUnicode} from './core/unicode';
// Composition is a draft: do not validate, save or truncate half an IME session.
export const UnicodeInput=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function UnicodeInput({value,onChange,onCompositionStart,onCompositionEnd,onBlur,maxLength,...props},ref){
 const composing=useRef(false),[draft,setDraft]=useState(String(value??''));
 useEffect(()=>{if(!composing.current)setDraft(String(value??''));},[value]);
 const publish=(event:React.ChangeEvent<HTMLInputElement>)=>{const text=maxLength===undefined?event.currentTarget.value:truncateText(event.currentTarget.value,maxLength);if(!validUnicode(text)){setDraft(String(value??''));return;}event.currentTarget.value=text;setDraft(text);onChange?.(event);};
 return <input {...props} ref={ref} dir="auto" value={draft} onBlur={event=>{if(!composing.current)setDraft(String(value??''));onBlur?.(event);}} onChange={event=>{setDraft(event.currentTarget.value);if(!composing.current)publish(event);}} onCompositionStart={event=>{composing.current=true;onCompositionStart?.(event);}} onCompositionEnd={event=>{composing.current=false;publish(event as unknown as React.ChangeEvent<HTMLInputElement>);onCompositionEnd?.(event);}}/>;
});
export function UnicodeTextarea({value,onChange,onCompositionStart,onCompositionEnd,maxLength,...props}:TextareaHTMLAttributes<HTMLTextAreaElement>){
 const composing=useRef(false),[draft,setDraft]=useState(String(value??''));
 useEffect(()=>{if(!composing.current)setDraft(String(value??''));},[value]);
 const publish=(event:React.ChangeEvent<HTMLTextAreaElement>)=>{const text=maxLength===undefined?event.currentTarget.value:truncateText(event.currentTarget.value,maxLength);if(!validUnicode(text)){setDraft(String(value??''));return;}event.currentTarget.value=text;setDraft(text);onChange?.(event);};
 return <textarea {...props} dir="auto" value={draft} onChange={event=>{setDraft(event.currentTarget.value);if(!composing.current)publish(event);}} onCompositionStart={event=>{composing.current=true;onCompositionStart?.(event);}} onCompositionEnd={event=>{composing.current=false;publish(event as unknown as React.ChangeEvent<HTMLTextAreaElement>);onCompositionEnd?.(event);}}/>;
}
