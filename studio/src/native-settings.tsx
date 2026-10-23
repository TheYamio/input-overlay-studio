import {tr} from './core/localization/messages.ts';
import { NativeList as ListField, NativeDevices } from './native-controls';
import { RegisteredField } from './registered-field';
import { registerSettingsView } from './settings-views';
import { useEffect, useState } from 'react';
import { NumberInput } from './number-input';
import type { NativeConfig, NativeSettings } from './core/settings/native';
export type { NativeConfig } from './core/settings/native';

function LegacyNativeAdvanced({ config, change, settings }: { config: NativeConfig; change: (value: NativeConfig) => void; settings: NativeSettings }) {
  const [autostart, setAutostart] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [linux, setLinux] = useState<{ keyboards: [string, string][]; mice: [string, string][]; permissions: string[] } | null>(null);
  useEffect(() => {
    const api = window.__TAURI__?.core; if (!api) return; let active = true;
    void settings.readAutostart().then(value => { if (active) setAutostart(value); }).catch(() => {});
    void Promise.all([api.invoke<[string, string][]>('enum_keyboards'), api.invoke<[string, string][]>('enum_mice'), api.invoke<string[]>('check_linux_perms')])
      .then(([keyboards, mice, permissions]) => { if (active) setLinux({ keyboards, mice, permissions }); }).catch(() => {});
    return () => { active = false; };
  }, [settings]);
  return <details className="visual-details native-advanced"><summary>{tr('ui:s-69e02190945f',"Advanced capture settings")}</summary>
    <RegisteredField id="capture.server.mouse-movement" label={tr('ui:s-5949a75fba3c',"Broadcast mouse movement")} fallback={<label className="visual-check"><input type="checkbox" checked={config.send_mouse_move} onChange={e => change({ ...config, send_mouse_move: e.target.checked })}/>{tr('ui:s-5949a75fba3c',"Broadcast mouse movement")}</label>}/>
    <RegisteredField id="capture.server.minimum-delta" label={tr('ui:s-432c39eaa2cf',"Raw mouse minimum delta")} fallback={<label className="field numeric-control"><span>{tr('ui:s-432c39eaa2cf',"Raw mouse minimum delta")}</span><NumberInput label={tr('ui:s-432c39eaa2cf',"Raw mouse minimum delta")} value={config.raw_mouse_min_delta} min={0} max={10000} change={raw_mouse_min_delta => change({ ...config, raw_mouse_min_delta: Math.round(raw_mouse_min_delta) })}/><small className="hint">{tr('ui:s-61133cc81d94',"0 keeps every movement. A threshold filters small visual movements.")}</small></label>}/>
    <RegisteredField id="capture.server.allowed-inputs" label={tr('ui:s-eacf81f184f3',"Allowed input names")} fallback={<ListField label={tr('ui:s-eacf81f184f3',"Allowed input names")} values={config.key_whitelist} validToken={token => /^[a-z0-9_]+$/.test(token)} change={key_whitelist => change({ ...config, key_whitelist })} hint={tr('ui:s-a9781b37ddd2',"Comma-separated names, for example key_w, key_space, mouse_left. Empty allows all inputs.")}/>}/>
    <RegisteredField id="capture.server.cpu-affinity" label={tr('ui:s-65c038c231e1',"CPU affinity cores")} fallback={<ListField label={tr('ui:s-65c038c231e1',"CPU affinity cores")} values={config.cpu_affinity.map(String)} validToken={token => /^\d+$/.test(token) && Number(token) <= 63} change={cores => change({ ...config, cpu_affinity: cores.map(Number) })} hint={tr('ui:s-27521e434db2',"Windows: core numbers 0–63. Empty lets Windows choose. Takes effect after restarting capture.")}/>}/>
    <RegisteredField id="capture.server.token" label={tr('ui:s-4e024957e006',"Capture server token")} fallback={<label className="field"><span>{tr('ui:s-4e024957e006',"Capture server token")}</span><input type="password" autoComplete="off" maxLength={256} value={config.auth_token} onChange={e => change({ ...config, auth_token: e.target.value })}/></label>}/>
    {linux && <NativeDevices.Provider value={linux}><h4>{tr('ui:s-1e247fa5b061',"Linux input devices")}</h4>{([['linux_evdev_keyboard_device','Keyboard device','capture.server.linux-keyboard',linux.keyboards],['linux_raw_mouse_device','Mouse device','capture.server.linux-mouse',linux.mice]] as const).map(([key,label,id,devices])=><RegisteredField key={id} id={id} label={label} fallback={<label className="field"><span>{label}</span><select aria-label={label} value={config[key]} onChange={event=>change({...config,[key]:event.target.value})}><option value="">{tr('ui:s-d461a493a375',"Automatic")}</option>{config[key]&&!devices.some(([path])=>path===config[key])&&<option value={config[key]}>{config[key]}{tr('ui:s-db4a103d0d02',"(unavailable)")}</option>}{devices.map(([path,name])=><option key={path} value={path}>{name} · {path}</option>)}</select></label>}/>)}{linux.permissions.map((message,index)=><p key={index} className="hint">{message}</p>)}</NativeDevices.Provider>}
    <p className="hint">{tr('ui:s-54c99f509ddb',"Use Apply server settings below to activate the capture changes.")}</p>
    {autostart !== null && <AutostartControl value={autostart} busy={busy} change={async enabled=>{
      setBusy(true);setError('');
      try { await settings.setAutostart(enabled); setAutostart(enabled); }
      catch { setError('Startup preference could not be changed. Check application permissions.'); }
      finally { setBusy(false); }
    }}/>}
    {error && <p role="alert" className="hint">{error}</p>}
  </details>;
}

export const NativeAdvanced=registerSettingsView('editor.native-advanced',LegacyNativeAdvanced);

function AutostartView({value,busy,change}:{value:boolean;busy:boolean;change:(value:boolean)=>void}){
 return <label className="visual-check"><input type="checkbox" checked={value} disabled={busy} onChange={event=>change(event.target.checked)}/>{tr('ui:s-5cbbc6825031',"Start capture on login (saved immediately)")}</label>;
}
const AutostartControl=registerSettingsView('editor.autostart',AutostartView);
