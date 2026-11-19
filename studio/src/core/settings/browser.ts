import {localEndpoint} from '../address';
import type { ConnectionOptions } from '../connection';
import { SettingsEvents } from './events';
import { NativeSettings, type NativeBridge } from './native';
import { PreferenceSettings } from './preferences';
import { SettingsService, type SettingsTransport } from './service';
import {SupportSettings} from '../support/service';
import {bindDocumentLifecycle} from './lifecycle';
import {builtinCatalog} from '../architecture/builtins';
import {moduleConfigurations} from '../module-format';
import {createBrowserDrafts} from './browser-drafts';

export function createBrowserSettings(transport:SettingsTransport,bridge:()=>NativeBridge,catalog=builtinCatalog,configurations=moduleConfigurations) {
  const events=new SettingsEvents();
  const preferences=new PreferenceSettings({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},events);
  const drafts=createBrowserDrafts();
  const settings=new SettingsService(drafts.storage,transport,preferences.getSnapshot().connection.url,events,catalog,configurations);
  const unbindLifecycle=bindDocumentLifecycle(settings);
  const native=new NativeSettings(bridge,events);
  const support=new SupportSettings({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},events);
  return {settings,preferences,native,support,drafts,dispose:()=>{unbindLifecycle();support.dispose();native.dispose();preferences.dispose();settings.dispose();}};
}
export function nativeConnection(config:{host:string;port:number;auth_token:string}):ConnectionOptions {
  return {url:localEndpoint('ws',config.host,config.port),token:config.auth_token};
}
