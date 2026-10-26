import {localEndpoint} from '../address';
import { loadDocument, restoreBackup, saveDocument,saveDraftDocument } from '../storage';
import type { ConnectionOptions } from '../connection';
import { SettingsEvents } from './events';
import { NativeSettings, type NativeBridge } from './native';
import { PreferenceSettings } from './preferences';
import { SettingsService, type DocumentStorage, type SettingsTransport } from './service';
import {SupportSettings} from '../support/service';
import {bindDocumentLifecycle} from './lifecycle';
import {builtinCatalog} from '../architecture/builtins';
import {moduleConfigurations} from '../module-format';

const browserDocumentStorage:DocumentStorage={
  load:loadDocument,
  save:saveDocument,
  saveDraft:saveDraftDocument,
  backup:restoreBackup,
};
export function createBrowserSettings(transport:SettingsTransport,bridge:()=>NativeBridge,catalog=builtinCatalog,configurations=moduleConfigurations) {
  const events=new SettingsEvents();
  const preferences=new PreferenceSettings({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},events);
  const settings=new SettingsService(browserDocumentStorage,transport,preferences.getSnapshot().connection.url,events,catalog,configurations);
  const unbindLifecycle=bindDocumentLifecycle(settings);
  const native=new NativeSettings(bridge,events);
  const support=new SupportSettings({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},events);
  return {settings,preferences,native,support,dispose:()=>{unbindLifecycle();support.dispose();native.dispose();preferences.dispose();settings.dispose();}};
}
export function nativeConnection(config:{host:string;port:number;auth_token:string}):ConnectionOptions {
  return {url:localEndpoint('ws',config.host,config.port),token:config.auth_token};
}
