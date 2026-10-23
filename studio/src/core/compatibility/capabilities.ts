import contract from './contract.json' with { type: 'json' };
import type { StudioDocument } from '../config';

export type ClientRole='studio'|'runtime';
export interface Capabilities {
  readonly role:'studio'|'runtime'|'capture';
  readonly contractVersion:number;
  readonly protocolVersion:number;
  readonly document:{readonly read:readonly number[];readonly write:readonly number[]};
  readonly moduleSchemas:Readonly<Record<string,number>>;
  readonly features:Readonly<Record<string,number>>;
}
export function localCapabilities(role:ClientRole):Capabilities {
  return {...structuredClone(contract),role,document:{read:[...contract.document.read],write:role==='studio'?[...contract.document.write]:[]}};
}
export interface Negotiation {readonly remote:Capabilities|null;readonly features:Readonly<Record<string,number>>;readonly issue:string;readonly heartbeat:boolean;readonly snapshot:boolean;}
function object(value:unknown):value is Record<string,unknown> {return !!value&&typeof value==='object'&&!Array.isArray(value);}
function positive(value:unknown):value is number {return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;}
export function negotiate(packet:Record<string,unknown>):Negotiation {
  if(packet.studio_capabilities===undefined)return {remote:null,features:{},issue:'Capture requires the current capability contract. Update both applications.',heartbeat:false,snapshot:false};
  const value=packet.studio_capabilities;
  const versions=(v:unknown):v is number[]=>Array.isArray(v)&&v.length<=32&&v.every(positive)&&new Set(v).size===v.length;
  const table=(v:unknown):v is Record<string,number>=>object(v)&&Object.keys(v).length<=256&&Object.entries(v).every(([id,version])=>/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(id)&&id.length<=100&&positive(version));
  if(!object(value)||value.role!=='capture'||!positive(value.contractVersion)||!positive(value.protocolVersion)||!object(value.document)||!versions(value.document.read)||!versions(value.document.write)||!table(value.moduleSchemas)||!table(value.features))return {remote:null,features:{},issue:'Capture sent an invalid capability contract. Update the capture app before saving.',heartbeat:false,snapshot:false};
  const remote=structuredClone(value) as unknown as Capabilities;
  const issue=remote.contractVersion!==contract.contractVersion?'Capture uses an unsupported capability contract. Update Input Overlay Studio.':remote.protocolVersion!==contract.protocolVersion||packet.protocol!==undefined&&packet.protocol!==remote.protocolVersion?'Studio and Capture protocol versions are incompatible. Update both applications.':'';
  return {remote,features:remote.features,issue,heartbeat:remote.features['input.heartbeat']===1,snapshot:remote.features['input.snapshot']===1};
}
export function readIssue(negotiation:Negotiation,source:unknown):string {
  if(negotiation.issue)return negotiation.issue;
  if(!negotiation.remote)return '';
  if(!object(source))return '';
  if(!contract.document.read.includes(source.version as number)||!negotiation.remote.document.write.includes(source.version as number))return 'This configuration version is not supported by Studio and Capture together. The original is preserved.';
  if(negotiation.features['config.module-envelope']!==1||negotiation.features['profiles.game-links']!==1||negotiation.features['visual.localization']!==1)return 'Capture cannot preserve the current profile format.';
  return '';
}
export function writeIssue(negotiation:Negotiation,_document:StudioDocument,role:ClientRole):string {
  if(role==='runtime')return 'The OBS runtime is read-only.';
  if(negotiation.issue)return negotiation.issue;
  if(!negotiation.remote?.document.read.includes(4))return 'Capture cannot save this configuration version. Your local draft is kept.';
  for(const feature of ['config.revisions','config.module-envelope','profiles.game-links','visual.localization'])if(negotiation.features[feature]!==1)return `Capture requires ${feature} to save safely. Your local draft is kept.`;
  return '';
}
