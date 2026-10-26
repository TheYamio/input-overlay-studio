import type {ConnectionState} from './connection';

export interface ConnectionStatus {
 readonly sequence:number;
 readonly captureEnabled:boolean;
 readonly captureRunning:boolean|null;
 readonly runtimes:{readonly connected:number;readonly ready:number;readonly failed:number;readonly unresponsive:number};
}
export function parseConnectionStatus(value:Record<string,unknown>):ConnectionStatus|null{
 const r=value.runtimes as Record<string,unknown>|null;
 const count=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1_000_000;
 if(!Number.isSafeInteger(value.sequence)||(value.sequence as number)<0||typeof value.capture_enabled!=='boolean'||(value.capture_running!==null&&typeof value.capture_running!=='boolean')||!r||typeof r!=='object'||!count(r.connected)||!count(r.ready)||!count(r.failed)||!count(r.unresponsive)||r.ready+r.failed+r.unresponsive>r.connected)return null;
 return Object.freeze({sequence:value.sequence as number,captureEnabled:value.capture_enabled,captureRunning:value.capture_running as boolean|null,runtimes:Object.freeze({connected:r.connected,ready:r.ready,failed:r.failed,unresponsive:r.unresponsive})});
}
export type CaptureStatus='offline'|'connecting'|'active'|'disabled'|'unavailable'|'unknown';
export type SourceStatus='unknown'|'none'|'loading'|'ready'|'partial'|'error'|'changes'|'unresponsive';
export function connectionIndicators(view:{connectionState:ConnectionState;connectionStatus:ConnectionStatus|null;pending:boolean;conflict:boolean;unsupported:unknown}){
 const connected=view.connectionState==='Connected',s=connected?view.connectionStatus:null;
 const capture:CaptureStatus=!connected?(['Connecting','Authenticating'].includes(view.connectionState)?'connecting':'offline'):!s?'unknown':!s.captureEnabled?'disabled':s.captureRunning===true?'active':s.captureRunning===false?'unavailable':'unknown';
 const source:SourceStatus=!s?'unknown':s.runtimes.connected===0?'none':s.runtimes.unresponsive===s.runtimes.connected?'unresponsive':s.runtimes.failed===s.runtimes.connected?'error':view.pending||view.conflict||view.unsupported?'changes':s.runtimes.ready===s.runtimes.connected?'ready':s.runtimes.failed>0||s.runtimes.ready>0||s.runtimes.unresponsive>0?'partial':'loading';
 return {capture,source};
}
