import { describe,expect,it,vi } from 'vitest';
import { SettingsComponentRegistry } from './settings-renderer';
const component=()=>null;
describe('trusted specialized settings components',()=>{
  it('registers compiled components by stable ID and refuses duplicates',()=>{
    const registry=new SettingsComponentRegistry();registry.register('test.custom',component);expect(registry.get('test.custom')).toBe(component);expect(()=>registry.register('test.custom',()=>null)).toThrow('already registered');expect(registry.get('test.custom')).toBe(component);
  });
  it('rejects invalid IDs and declarative strings instead of executing them',()=>{
    const registry=new SettingsComponentRegistry();expect(()=>registry.register('test.custom','alert(1)' as never)).toThrow('Invalid specialized editor');expect(()=>registry.register('invalid' as never,component)).toThrow('Invalid specialized editor');
  });
  it('unregisters idempotently, cleans observers and isolates their failures',()=>{
    const registry=new SettingsComponentRegistry(),listener=vi.fn();const unsubscribe=registry.subscribe(listener);registry.subscribe(()=>{throw Error('observer');});const remove=registry.register('test.custom',component);expect(listener).toHaveBeenCalledTimes(1);remove();remove();expect(registry.get('test.custom')).toBeUndefined();expect(listener).toHaveBeenCalledTimes(2);unsubscribe();registry.register('test.custom',component);expect(listener).toHaveBeenCalledTimes(2);
  });
});
