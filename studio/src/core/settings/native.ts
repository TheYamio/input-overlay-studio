import { SettingsError, SettingsEvents } from './events';
import { externalDefinition } from '../architecture/external';

export interface NativeConfig {
  host: string; port: number; auth_token: string; http_enabled: boolean; http_port: number;
  analog_keyboard: string; capture_enabled: boolean; key_whitelist: string[];
  raw_mouse_min_delta: number; send_mouse_move: boolean; cpu_affinity: number[];
  linux_evdev_keyboard_device: string; linux_raw_mouse_device: string;
}
export interface NativeBridge { invoke<T>(command: string,args?: Record<string,unknown>): Promise<T> }
export class NativeSettings {
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private readonly bridge: () => NativeBridge, private readonly events: SettingsEvents) {}
  private assertActive() {if(this.disposed)throw new SettingsError('disposed','Native settings have been disposed.');}
  async read() {this.assertActive();return structuredClone(await this.bridge().invoke<NativeConfig>('get_config')); }
  readAutostart() {this.assertActive();return this.bridge().invoke<boolean>('get_autostart'); }
  private enqueue<T>(task: () => Promise<T>) {
    this.events.assertWritable();
    this.assertActive();
    const run=()=>{this.assertActive();return task();};
    const result=this.queue.then(run,run); this.queue=result.catch(()=>{}); return result;
  }
  save(config: NativeConfig) {
    const snapshot=structuredClone(config), operationId=this.events.operation();
    return this.enqueue(async ()=>{
      // Existing native validation/persistence remains authoritative. A failure
      // rejects this operation; no success notification or connection switch.
      await this.bridge().invoke('save_config',{newCfg:snapshot});
      if (!this.disposed) this.events.emit({operationId,scopes:['capture'],store:'native',source:'capture.apply'});
      return structuredClone(snapshot);
    });
  }
  setAutostart(enabled: boolean) {
    externalDefinition('capture.system.autostart','native').schema.parse(enabled);
    const operationId=this.events.operation();
    return this.enqueue(async ()=>{
      const ok=await this.bridge().invoke<boolean>('set_autostart',{enabled}); if (!ok) throw Error('Startup preference could not be changed.');
      if (!this.disposed) this.events.emit({operationId,scopes:['global'],store:'native',source:'preferences.autostart'});
      return enabled;
    });
  }
  dispose() { this.disposed=true; }
}
