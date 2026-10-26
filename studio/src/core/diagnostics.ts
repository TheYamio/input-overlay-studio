import {version} from '../../package.json';
import contract from './compatibility/contract.json';
import type {SettingsSnapshot} from './settings/service';
import type {HttpStatus} from './obs';
import {connectionIndicators} from './connection-status';

const states=['Offline','Connecting','Authenticating','Connected','Authentication failed','Paused'] as const;
const bounded=(value:unknown,max:number,decimals=0)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?Math.round(value*10**decimals)/10**decimals:null;
export function diagnosticPlatform(platform:string){const p=platform.toLowerCase();return p.startsWith('win')?'windows':p.includes('mac')||p.includes('darwin')?'macos':p.includes('linux')?'linux':'unknown';}
export interface DiagnosticEnvironment {platform:string;native:boolean;width:number;height:number;scale:number}

// Construct every field explicitly. Never spread/serialize a document, config,
// URL, capabilities object, raw error, platform string or user-authored text.
export function diagnosticReport(view:SettingsSnapshot,environment:DiagnosticEnvironment,http:HttpStatus|null){
 const {capture,source}=connectionIndicators(view),counts=view.connectionState==='Connected'?view.connectionStatus?.runtimes:undefined;
 const save=view.unsupported?'read-only':view.protected?'protected':/failed/i.test(view.saveStatus)?'error':view.pending?'pending':view.saveStatus==='Saved to capture server'?'capture-server':view.saveStatus==='Saved locally'?'local':'unknown';
 return {
  format:'input-overlay-studio-diagnostics',version:1,application:{version,host:environment.native?'desktop':'browser',platform:diagnosticPlatform(environment.platform)},
  contracts:{protocol:contract.protocolVersion,document:contract.document.write[0]},
  connection:{state:states.includes(view.connectionState)?view.connectionState:'Unknown',capture,source,save,pending:!!view.pending,conflict:!!view.conflict,readOnly:!!view.unsupported,recoveryRequired:!!view.protected,statusReportAvailable:!!view.connectionStatus,
   sources:counts?{connected:bounded(counts.connected,1_000_000),ready:bounded(counts.ready,1_000_000),failed:bounded(counts.failed,1_000_000),unresponsive:bounded(counts.unresponsive,1_000_000)}:null},
  http:!environment.native||!http?null:{running:!!http.running,overlayAvailable:!!http.overlay_available,bindError:http.bind_error===null?null:['inuse','denied'].includes(http.bind_error)?http.bind_error:'other'},
  window:{width:bounded(environment.width,100_000),height:bounded(environment.height,100_000),scale:bounded(environment.scale,16,2)},
 };
}
export const formatDiagnostics=(...args:Parameters<typeof diagnosticReport>)=>JSON.stringify(diagnosticReport(...args),null,2);
