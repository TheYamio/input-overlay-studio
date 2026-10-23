import { loadDocument, restoreBackup, saveDocument } from '../storage';
import type { ConnectionOptions } from '../connection';
import { SettingsEvents } from './events';
import { NativeSettings, type NativeBridge } from './native';
import { PreferenceSettings } from './preferences';
import { SettingsService, type DocumentStorage, type SettingsTransport } from './service';

const browserDocumentStorage:DocumentStorage={
  load:loadDocument,
  save:saveDocument,
  backup:restoreBackup,
};
export function createBrowserSettings(transport:SettingsTransport,bridge:()=>NativeBridge) {
  const events=new SettingsEvents();
  const preferences=new PreferenceSettings({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},events);
  const settings=new SettingsService(browserDocumentStorage,transport,preferences.getSnapshot().connection.url,events);
  const native=new NativeSettings(bridge,events);
  return {settings,preferences,native,dispose:()=>{native.dispose();preferences.dispose();settings.dispose();}};
}
export function nativeConnection(config:{host:string;port:number;auth_token:string}):ConnectionOptions {
  return {url:`ws://${config.host==='0.0.0.0'?'127.0.0.1':config.host}:${config.port}`,token:config.auth_token};
}
