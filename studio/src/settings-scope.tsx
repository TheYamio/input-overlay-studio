import { createContext, type ReactNode } from 'react';
import type { SettingsAddress } from './core/architecture/contracts';
import type { SettingsService } from './core/settings/service';
export const SettingsScope=createContext<{settings:SettingsService;address:SettingsAddress}|null>(null);
export function DocumentSettingsProvider({settings,address,children}:{settings:SettingsService;address:SettingsAddress;children:ReactNode}) {
  return <SettingsScope.Provider value={{settings,address}}>{children}</SettingsScope.Provider>;
}
