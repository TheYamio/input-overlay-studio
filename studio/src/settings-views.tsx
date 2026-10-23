import { useSyncExternalStore, type ComponentType } from 'react';
import type { DefinitionId } from './core/architecture/contracts';
import { SettingsComponentRegistry } from './settings-components';

// A view has its own typed props/commit contract (canvas transactions, image
// Apply/Cancel, physical-key assignment...). Only compiled code registers views.
const views=new Map<DefinitionId,unknown>();
export function registerSettingsView<Props extends object>(id:DefinitionId,component:ComponentType<Props>) {
 if(views.has(id))throw Error(`Settings view already registered: ${id}`);
 const registry=new SettingsComponentRegistry<Props>();registry.register(id,component);views.set(id,registry);
 return function RegisteredSettingsView(props:Props){
  useSyncExternalStore(registry.subscribe,registry.getSnapshot);
  const View=registry.get(id)??component;
  return <View {...props}/>;
 };
}
export function registeredSettingsViews(){return Object.freeze([...views.keys()]);}
