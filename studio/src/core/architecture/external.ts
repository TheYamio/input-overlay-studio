import {localePackagesSchema} from '../localization/pack-schema';
import { z } from 'zod';
import { defaultShortcuts } from '../shortcuts';
import type { Control, DefinitionId, SettingDefinition } from './contracts';

// Adapters to the existing local keys and native config. These definitions never
// become part of the exported visual document, its migrations or OBS protocol.
const nativeRows = [
 ['host','host','Bind host (loopback by default)',z.string().min(1).max(253),'text','127.0.0.1','reconnect'],
 ['port','port','WebSocket port',z.number().int().min(1).max(65535),'number',4455,'reconnect'],
 ['http_enabled','http-enabled','Local HTTP server',z.boolean(),'checkbox',true,'reconnect'],
 ['http_port','http-port','HTTP port',z.number().int().min(1).max(65535),'number',4456,'reconnect'],
 ['auth_token','token','Capture server token',z.string().max(256),'text','','reconnect'],
 ['analog_keyboard','analog-keyboard','Analog keyboard',z.enum(['','auto','wooting','razer','nuphy','drunkdeer','keychron','madlions','bytech']),'select','','explicit'],
 ['capture_enabled','enabled','Broadcast device input',z.boolean(),'checkbox',true,'explicit'],
 ['key_whitelist','allowed-inputs','Allowed input names',z.array(z.string().regex(/^[a-z0-9_]+$/)).max(512),'custom',[],'explicit'],
 ['raw_mouse_min_delta','minimum-delta','Raw mouse minimum delta',z.number().int().min(0).max(10000),'number',0,'explicit'],
 ['send_mouse_move','mouse-movement','Broadcast mouse movement',z.boolean(),'checkbox',true,'explicit'],
 ['cpu_affinity','cpu-affinity','CPU affinity cores',z.array(z.number().int().min(0).max(63)).max(64),'custom',[0,1],'restart'],
 ['linux_evdev_keyboard_device','linux-keyboard','Keyboard device',z.string().max(4096),'custom','','explicit'],
 ['linux_raw_mouse_device','linux-mouse','Mouse device',z.string().max(4096),'custom','','explicit'],
] as const;
export const externalDefinitions: readonly SettingDefinition[] = [
 {id:'capture.system.autostart',schemaVersion:1,schema:z.boolean(),binding:{scope:'global',store:'native',root:'native',path:['autostart']},label:{key:'settings:capture.system.autostart.label',fallback:'Start capture on login'},ui:{control:'custom',component:'editor.autostart',group:'capture.system'},targets:['studio','native'],apply:'live',defaultValue:()=>false},
 ...nativeRows.map(([field,name,label,schema,control,value,apply]):SettingDefinition=>({
  id:`capture.server.${name}`,schemaVersion:1,schema,
  binding:{scope:'capture',store:'native',root:'native',path:[field]},
  label:{key:`settings:capture.server.${name}.label`,fallback:label},
  ui:{control,group:'capture.server',...(control==='custom'?{component:field.startsWith('linux_')?'editor.native-devices' as const:'editor.native-list' as const}:{})},
  targets:['studio','native'],apply,defaultValue:()=>structuredClone(value),
  ...(field==='auth_token'?{sensitive:true}:{}),
  ...(field.startsWith('linux_')?{platforms:['linux'] as const}:field==='cpu_affinity'?{platforms:['windows'] as const}:{}),
  help:{key:`settings:capture.server.${name}.help`,fallback:apply==='restart'?'Saved with Apply server settings. Takes effect after restarting capture.':apply==='reconnect'?'Applied with Apply server settings; clients may need to reconnect.':'Applied with Apply server settings.'},
 })),
 ...([
  ['languagePacks','language-packs','Language packages',localePackagesSchema,'custom',[]],
  ['locale','locale','Studio language',z.string().max(64).regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/),'text','en'],
  ['inspectorWidth','inspector-width','Properties width',z.number().min(320).max(560),'number',360],
  ['inspectorSection','inspector-section','Properties section',z.string().max(160).regex(/^(?:appearance|layout|keys|artwork|preview|specific|all|[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)$/),'custom','appearance'],
  ['shortcuts','shortcuts','Keyboard shortcuts',z.record(z.string(),z.array(z.string())),'custom',defaultShortcuts()],
  ['connection','connection','WebSocket connection',z.object({url:z.string(),token:z.string()}),'custom',{url:'ws://127.0.0.1:4455',token:''}],
 ] as const).map(([field,name,label,schema,control,value]):SettingDefinition=>({
  id:`studio.preferences.${name}`,schemaVersion:1,schema,binding:{scope:'global',store:'preferences',root:'preferences',path:[field]},
  label:{key:`settings:studio.preferences.${name}.label`,fallback:label},
  ui:{control:control as Control,group:'studio.preferences',...(control==='custom'?{component:`editor.${name}` as DefinitionId}:{})},
  targets:['studio'],apply:field==='connection'?'reconnect':'live',defaultValue:()=>structuredClone(value),...(field==='connection'?{sensitive:true}:{}),
 })),
];
export function externalDefinition(id:DefinitionId,store:'native'|'preferences') {
 const definition=externalDefinitions.find(definition=>definition.id===id&&definition.binding.store===store);
 if(!definition)throw Error(`Unknown ${store} setting: ${id}`);
 return definition;
}
export function settingPlatform(): 'windows'|'linux'|'macos' {
 const platform=typeof navigator==='undefined'?'':navigator.platform.toLowerCase();
 return platform.includes('mac')?'macos':platform.includes('linux')?'linux':'windows';
}
