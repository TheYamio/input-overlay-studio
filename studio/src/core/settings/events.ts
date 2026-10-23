import type { Scope, Store } from '../architecture/contracts';

export interface SettingsChange {
  readonly operationId: string;
  readonly version: number;
  readonly scopes: readonly Scope[];
  readonly store: Store;
  readonly source: string;
}
export class SettingsError extends Error {
  readonly params:Readonly<Record<string,string|number>>;
  constructor(readonly code: string, message: string,params:Readonly<Record<string,string|number>>={}) { super(message);this.name='SettingsError';this.params=Object.freeze({...params}); }
}
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

// Notifications never write to storage or echo themselves into the transport.
// Synchronous writes from listeners are rejected rather than recursively applied.
export class SettingsEvents {
  private listeners = new Set<{ scopes: readonly Scope[]; callback: (event: SettingsChange) => void }>();
  private notifying = false;
  private version = 0;
  private sequence = 0;
  private readonly origin = crypto.randomUUID();
  constructor(private readonly listenerError: (error: unknown) => void = () => {}) {}
  operation() { return `${this.origin}:${++this.sequence}`; }
  assertWritable() { if (this.notifying) throw new SettingsError('reentrant-write','Settings cannot be changed from a change notification.'); }
  notify(callbacks: Iterable<() => void>) {
    const previous = this.notifying; this.notifying = true;
    try { for (const callback of [...callbacks]) { try { callback(); } catch (error) { try { this.listenerError(error); } catch { /* One observer cannot prevent other observers. */ } } } }
    finally { this.notifying = previous; }
  }
  emit(event: Omit<SettingsChange,'version'>) {
    const change = immutable({...event,scopes:[...new Set(event.scopes)],version:++this.version});
    this.notify([...this.listeners].filter(l=>l.scopes.some(scope=>change.scopes.includes(scope))).map(l=>()=>l.callback(change)));
    return change;
  }
  subscribe(scopes: Scope | readonly Scope[], callback: (event: SettingsChange) => void) {
    const listener = {scopes:typeof scopes==='string' ? [scopes] : [...scopes],callback};
    this.listeners.add(listener); return ()=>{ this.listeners.delete(listener); };
  }
  clear() { this.listeners.clear(); }
}
