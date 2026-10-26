import type {ConnectionState} from './connection';
export type ConnectionNoticeCode='lost'|'unavailable'|'authentication'|'restored';
export interface ConnectionNotice {readonly id:number;readonly code:ConnectionNoticeCode}

// A retry loop is one incident. Dismissal survives repeated retry attempts,
// but a later independent outage may notify again. Nothing is persisted.
export class ConnectionNotices {
 private endpoint?:string;private connected=false;private attempted=false;private issue?:ConnectionNoticeCode;private serial=0;
 private notice:ConnectionNotice|null=null;
 update(state:ConnectionState,endpoint:string){
  if(endpoint!==this.endpoint){this.endpoint=endpoint;this.connected=false;this.attempted=false;this.issue=undefined;this.notice=null;}
  const show=(code:ConnectionNoticeCode)=>{if(this.issue!==code){this.issue=code;this.notice=Object.freeze({id:++this.serial,code});}};
  if(state==='Paused'){this.connected=false;this.attempted=false;this.issue=undefined;this.notice=null;}
  else if(state==='Connected'){if(this.issue&&this.issue!=='restored')show('restored');this.connected=true;this.attempted=true;}
  else if(state==='Authentication failed'){show('authentication');this.attempted=true;}
  else if(state==='Offline'&&this.attempted)show(this.connected?'lost':'unavailable');
  else if(state==='Connecting'||state==='Authenticating')this.attempted=true;
  return this.notice;
 }
 dismiss(id:number){if(this.notice?.id===id)this.notice=null;return this.notice;}
}
