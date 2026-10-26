import { SettingsError, SettingsEvents } from './events';
import { externalDefinition } from '../architecture/external';

import {parseNativeConfig,nativeSettingsError} from './native-config';
import type {NativeConfig} from '../native-config';
export type {NativeConfig} from '../native-config';

export interface NativeBridge { invoke<T>(command: string,args?: Record<string,unknown>): Promise<T> }
export class NativeSettings {
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private readonly bridge: () => NativeBridge, private readonly events: SettingsEvents) {}
  private assertActive() {if(this.disposed)throw new SettingsError('disposed','Native settings have been disposed.');}
  async read() {this.assertActive();return parseNativeConfig(structuredClone(await this.bridge().invoke<unknown>('get_config'))); }
  readAutostart() {this.assertActive();return this.bridge().invoke<boolean>('get_autostart'); }
  private enqueue<T>(task: () => Promise<T>) {
    this.events.assertWritable();
    this.assertActive();
    const run=()=>{this.assertActive();return task();};
    const result=this.queue.then(run,run); this.queue=result.catch(()=>{}); return result;
  }
  save(config: NativeConfig) {
    this.assertActive();const snapshot=parseNativeConfig(structuredClone(config)), operationId=this.events.operation();
    return this.enqueue(async ()=>{
      // Rust revalidates this complete snapshot before persistence. A failure
      // rejects this operation; no success notification or connection switch.
      try{await this.bridge().invoke('save_config',{newCfg:snapshot});}catch(error){throw nativeSettingsError(error);}
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
