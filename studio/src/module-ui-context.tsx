import { moduleConfigurations } from './core/module-format';
import { createContext,useContext,useSyncExternalStore,type ReactNode } from 'react';
import type { ModuleUIRegistry } from './core/architecture/module-ui';
import { moduleUIRegistry } from './module-ui-builtins';

const ModuleUIContext=createContext(moduleUIRegistry);
export function ModuleUIProvider({registry,children}:{registry:ModuleUIRegistry;children:ReactNode}){return <ModuleUIContext.Provider value={registry}>{children}</ModuleUIContext.Provider>;}
export function useModuleUIRegistry(){const registry=useContext(ModuleUIContext);useSyncExternalStore(registry.subscribe,registry.getSnapshot);useSyncExternalStore(moduleConfigurations.subscribe,moduleConfigurations.getSnapshot);return registry;}
