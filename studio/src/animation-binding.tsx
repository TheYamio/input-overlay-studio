import { createContext, useContext, type ReactNode } from 'react';
import type { SettingsService } from './core/settings/service';
import type { AnimationAddress } from './core/settings-ui/animation';
import { DocumentSettingsProvider } from './settings-scope';

export const AnimationBinding=createContext<{settings:SettingsService;address:AnimationAddress}|null>(null);
export function AnimationSettingsProvider({settings,address,children}:{settings:SettingsService;address:AnimationAddress;children:ReactNode}) {
  return <DocumentSettingsProvider settings={settings} address={address}><AnimationBinding.Provider value={{settings,address}}>{children}</AnimationBinding.Provider></DocumentSettingsProvider>;
}
export function AnimationElement({element,children}:{element:NonNullable<AnimationAddress['element']>;children:ReactNode}) {
  const binding=useContext(AnimationBinding);
  return binding ? <AnimationSettingsProvider settings={binding.settings} address={{...binding.address,element}}>{children}</AnimationSettingsProvider> : children;
}
