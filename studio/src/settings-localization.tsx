import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { studioLocalization } from './core/localization/builtins';
import type { LocalizationRegistry } from './core/localization/registry';

const Localization=createContext(studioLocalization);
export function SettingsLocalization({ registry, children }: {registry:LocalizationRegistry;children:ReactNode}) {
  return <Localization.Provider value={registry}>{children}</Localization.Provider>;
}
export function useSettingsText() {
  const registry=useLocalizationRegistry();
  useSyncExternalStore(registry.subscribe,registry.getSnapshot);
  return registry.text.bind(registry);
}
export function useLocalizationRegistry(){return useContext(Localization);}
