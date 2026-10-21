import { useEffect, useRef, useState } from 'react';
import { VNumber } from './visual-fields';

export type NativeConfig = {
  host: string; port: number; auth_token: string; http_enabled: boolean; http_port: number;
  analog_keyboard: string; capture_enabled: boolean; key_whitelist: string[];
  raw_mouse_min_delta: number; send_mouse_move: boolean; cpu_affinity: number[];
  linux_evdev_keyboard_device: string; linux_raw_mouse_device: string;
};

function ListField({ label, values, validToken, change, hint }: { label: string; values: string[]; validToken: (token: string) => boolean; change: (values: string[]) => void; hint: string }) {
  const [text, setText] = useState(values.join(', ')); const focused = useRef(false);
  const saved = values.join(', ');
  useEffect(() => { if (!focused.current) setText(saved); }, [saved]);
  const tokens = text.split(/[\s,]+/).filter(Boolean), valid = tokens.every(validToken);
  return <label className="field"><span>{label}</span><input value={text} maxLength={4096} aria-label={label} aria-invalid={!valid}
    onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(saved); }}
    onChange={event => { const next = event.target.value; setText(next); const tokens = next.split(/[\s,]+/).filter(Boolean); if (tokens.every(validToken)) change([...new Set(tokens)]); }}/>
    <small className="hint">{!valid ? 'Invalid entry; the last valid list will be kept. ' : ''}{hint}</small></label>;
}

export function NativeAdvanced({ config, change }: { config: NativeConfig; change: (value: NativeConfig) => void }) {
  const [autostart, setAutostart] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [linux, setLinux] = useState<{ keyboards: [string, string][]; mice: [string, string][]; permissions: string[] } | null>(null);
  useEffect(() => {
    const api = window.__TAURI__?.core; if (!api) return; let active = true;
    void api.invoke<boolean>('get_autostart').then(value => { if (active) setAutostart(value); }).catch(() => {});
    void Promise.all([api.invoke<[string, string][]>('enum_keyboards'), api.invoke<[string, string][]>('enum_mice'), api.invoke<string[]>('check_linux_perms')])
      .then(([keyboards, mice, permissions]) => { if (active) setLinux({ keyboards, mice, permissions }); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <details className="visual-details native-advanced"><summary>Advanced capture settings</summary>
    <label className="visual-check"><input type="checkbox" checked={config.send_mouse_move} onChange={e => change({ ...config, send_mouse_move: e.target.checked })}/>Broadcast mouse movement</label>
    <div><VNumber label="Raw mouse minimum delta" value={config.raw_mouse_min_delta} min={0} max={10000} change={raw_mouse_min_delta => change({ ...config, raw_mouse_min_delta: Math.round(raw_mouse_min_delta) })}/><p className="hint">0 keeps every movement. A threshold filters small visual movements.</p></div>
    <ListField label="Allowed input names" values={config.key_whitelist} validToken={token => /^[a-z0-9_]+$/.test(token)} change={key_whitelist => change({ ...config, key_whitelist })} hint="Comma-separated names, for example key_w, key_space, mouse_left. Empty allows all inputs."/>
    <ListField label="CPU affinity cores" values={config.cpu_affinity.map(String)} validToken={token => /^\d+$/.test(token) && Number(token) <= 63} change={cores => change({ ...config, cpu_affinity: cores.map(Number) })} hint="Windows: core numbers 0–63. Empty lets Windows choose. Takes effect after restarting capture."/>
    <label className="field"><span>Capture server token</span><input type="password" autoComplete="off" maxLength={256} value={config.auth_token} onChange={e => change({ ...config, auth_token: e.target.value })}/></label>
    {linux && <><h4>Linux input devices</h4>{([['linux_evdev_keyboard_device', 'Keyboard device', linux.keyboards], ['linux_raw_mouse_device', 'Mouse device', linux.mice]] as const).map(([key, label, devices]) => <label key={key} className="field"><span>{label}</span><select aria-label={label} value={config[key]} onChange={e => change({ ...config, [key]: e.target.value })}><option value="">Automatic</option>{config[key] && !devices.some(([path]) => path === config[key]) && <option value={config[key]}>{config[key]} (unavailable)</option>}{devices.map(([path, name]) => <option key={path} value={path}>{name} · {path}</option>)}</select></label>)}{linux.permissions.map((message, index) => <p key={index} className="hint">{message}</p>)}</>}
    <p className="hint">Use Apply server settings below to activate the capture changes.</p>
    {autostart !== null && <label className="visual-check"><input type="checkbox" checked={autostart} disabled={busy} onChange={async e => {
      const enabled = e.target.checked; setBusy(true); setError('');
      try { const ok = await window.__TAURI__!.core.invoke<boolean>('set_autostart', { enabled }); if (!ok) throw Error(); setAutostart(enabled); }
      catch { setError('Startup preference could not be changed. Check application permissions.'); }
      finally { setBusy(false); }
    }}/>Start capture on login (saved immediately)</label>}
    {error && <p role="alert" className="hint">{error}</p>}
  </details>;
}
