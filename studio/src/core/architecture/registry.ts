import { z } from 'zod';
import { scopes, type Catalog, type Condition, type DefaultContext, type DefinitionId, type LocalizedText, type ModuleDefinition, type RegistryView, type SettingDefinition, type SettingsRegistryView } from './contracts';

export class RegistryError extends Error {
  constructor(readonly code: RegistryErrorCode, readonly definitionId: string, detail: string) { super(`${code}: ${definitionId}: ${detail}`); this.name = 'RegistryError'; }
}
export type RegistryErrorCode = 'invalid-id' | 'invalid-definition' | 'duplicate-id' | 'dependency-cycle' | 'missing-dependency' | 'invalid-condition' | 'missing-setting' | 'invalid-default' | 'duplicate-builtin-type' | 'missing-capability';
function fail(code: RegistryErrorCode, id: string, detail: string): never { throw new RegistryError(code, id, detail); }
const validId = (id: string) => /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id) && id.length <= 160;
function assertId(id: string) { if (!validId(id)) fail('invalid-id', id, 'Use a stable namespaced identifier'); }
function text(id: string, value: LocalizedText) {
  if (!/^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9.-]*$/.test(value.key) || !value.fallback.trim()) fail('invalid-definition', id, 'A namespace key and English fallback are required');
}
// Copy/freeze plain metadata, but retain the actual authoritative Zod schema and
// trusted function references. Never alter schemas shared with the persisted document validator.
function immutable<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, immutable(child)]))) as T;
  return value;
}
interface Node { readonly id: DefinitionId; readonly schemaVersion: number }
function order<T extends Node>(map: ReadonlyMap<DefinitionId, T>, dependencies: (node: T) => readonly DefinitionId[]) {
  const state = new Map<DefinitionId, number>(), result: T[] = [], stack: DefinitionId[] = [];
  const visit = (node: T) => {
    if (state.get(node.id) === 2) return;
    if (state.get(node.id) === 1) fail('dependency-cycle', node.id, [...stack, node.id].join(' → '));
    state.set(node.id, 1); stack.push(node.id);
    for (const id of dependencies(node)) {
      const dependency = map.get(id); if (!dependency) fail('missing-dependency', node.id, id);
      visit(dependency);
    }
    stack.pop(); state.set(node.id, 2); result.push(node);
  };
  for (const node of map.values()) visit(node);
  return Object.freeze(result);
}
class Registry<T extends Node> implements RegistryView<T> {
  private entries = new Map<DefinitionId, T>();
  constructor(private readonly dependencies: (node: T) => readonly DefinitionId[], private readonly validate: (node: T, all: ReadonlyMap<DefinitionId, T>) => void) {}
  register(...definitions: readonly T[]) {
    const candidate = new Map(this.entries);
    for (const definition of definitions) {
      assertId(definition.id);
      if (candidate.has(definition.id)) fail('duplicate-id', definition.id, 'Already registered');
      if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion < 1) fail('invalid-definition', definition.id, 'Positive schemaVersion required');
      candidate.set(definition.id, immutable(definition));
    }
    for (const entry of candidate.values()) this.validate(entry, candidate);
    order(candidate, this.dependencies);
    this.entries = candidate; // Batch succeeds completely or leaves the registry unchanged.
    return this;
  }
  get(id: DefinitionId) { return this.entries.get(id); }
  all() { return Object.freeze([...this.entries.values()]); }
  ordered() { return order(this.entries, this.dependencies); }
  view(): RegistryView<T> { return Object.freeze({ get: (id: DefinitionId) => this.get(id), all: () => this.all(), ordered: () => this.ordered() }); }
}
function targets(id: string, values: readonly string[]) {
  if (!values.length || values.some(v => !['studio', 'obs', 'native'].includes(v)) || new Set(values).size !== values.length) fail('invalid-definition', id, 'Invalid targets');
}
function uniqueIds(id: string, values: readonly DefinitionId[]) {
  values.forEach(assertId);
  if (new Set(values).size !== values.length) fail('invalid-definition', id, 'Duplicate reference');
}
export class ModuleRegistry extends Registry<ModuleDefinition> {
  constructor() {
    super(node => node.dependencies, node => {
      text(node.id, node.label); text(node.id, node.description); targets(node.id, node.targets);
      for (const refs of [node.dependencies, node.capabilities, node.requires, node.settings]) uniqueIds(node.id, refs);
      if (node.kind !== 'visual' && node.kind !== 'service') fail('invalid-definition', node.id, 'Invalid module kind');
      if (node.kind === 'visual' && (!(node.configuration instanceof z.ZodType) || !node.renderer || !node.inspector)) fail('invalid-definition', node.id, 'Visual schema and adapter IDs required');
      if (node.renderer) assertId(node.renderer); if (node.inspector) assertId(node.inspector);
    });
  }
}
function conditions(node: SettingDefinition) { return [...node.visibleWhen ?? [], ...node.enabledWhen ?? []]; }
function baseSchema(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault || schema instanceof z.ZodNullable || schema instanceof z.ZodReadonly) return baseSchema(schema.unwrap() as z.ZodType);
  return schema;
}
export class SettingsSchemaRegistry extends Registry<SettingDefinition> {
  constructor() {
    super(node => [...new Set([...node.dependencies ?? [], ...conditions(node).flatMap(c => 'setting' in c ? [c.setting] : [])])], (node, all) => {
      text(node.id, node.label); if (node.help) text(node.id, node.help); if (node.disabledReason) text(node.id,node.disabledReason); targets(node.id, node.targets);
      if (!(node.schema instanceof z.ZodType) || typeof node.defaultValue !== 'function') fail('invalid-definition', node.id, 'Schema and lazy default adapter required');
      const { binding } = node;
      if (!Object.hasOwn(scopes,binding.scope)) fail('invalid-definition', node.id, 'Unknown configuration scope');
      const scope = scopes[binding.scope];
      if (!(scope.stores as readonly string[]).includes(binding.store)) fail('invalid-definition', node.id, 'Store does not belong to this scope');
      const roots = { global: ['document','preferences','native'], capture: ['native'], 'game-profile': ['profile'], 'overlay-profile': ['profile'], module: ['module'], runtime: ['runtime'] };
      const rootStore = { document:'document', profile:'document', module:'document', preferences:'preferences', native:'native', runtime:'transient' };
      const safePath = (path: readonly string[]) => path.length > 0 && path.every(p => !!p && !['__proto__','constructor','prototype'].includes(p));
      if (!roots[binding.scope].includes(binding.root) || rootStore[binding.root] !== binding.store || !safePath(binding.path)) fail('invalid-definition', node.id, 'Invalid binding path/root');
      if (binding.overrides && (binding.scope !== 'module' || !safePath(binding.overrides.key) || !safePath(binding.overrides.mouseButton))) fail('invalid-definition', node.id, 'Invalid element inheritance');
      assertId(node.ui.group); if (node.ui.component) assertId(node.ui.component);
      if (node.ui.section) assertId(node.ui.section);
      if (node.ui.order!==undefined && !Number.isFinite(node.ui.order)) fail('invalid-definition',node.id,'Invalid field order');
      if (node.ui.step !== undefined && (!['number','range'].includes(node.ui.control) || !Number.isFinite(node.ui.step) || node.ui.step <= 0)) fail('invalid-definition',node.id,'Invalid interaction step');
      if (node.ui.control === 'custom' && !node.ui.component) fail('invalid-definition', node.id, 'Specialized control ID required');
      const schema = baseSchema(node.schema), control = node.ui.control;
      if (node.ui.firstOption !== undefined && (!(schema instanceof z.ZodEnum) || !schema.options.includes(node.ui.firstOption))) fail('invalid-definition',node.id,'First option is not in the enum');
      const appropriate = control === 'custom' || (['number','range'].includes(control) && schema instanceof z.ZodNumber) || (control === 'checkbox' && schema instanceof z.ZodBoolean) || (control === 'select' && schema instanceof z.ZodEnum) || (['text','color'].includes(control) && schema instanceof z.ZodString);
      if (!appropriate) fail('invalid-definition', node.id, 'Control is incompatible with its schema');
      if (!['live','reconnect','restart','explicit'].includes(node.apply)) fail('invalid-definition', node.id, 'Invalid application policy');
      if(node.sensitive!==undefined&&typeof node.sensitive!=='boolean')fail('invalid-definition',node.id,'Invalid sensitivity metadata');
      if(node.platforms&&(!node.platforms.length||new Set(node.platforms).size!==node.platforms.length||node.platforms.some(platform=>!['windows','linux','macos'].includes(platform))))fail('invalid-definition',node.id,'Invalid platform metadata');
      uniqueIds(node.id, node.dependencies ?? []);
      for (const rule of conditions(node)) {
        if ('capability' in rule) { assertId(rule.capability); if (!['available','unavailable'].includes(rule.test)) fail('invalid-condition',node.id,'Invalid capability condition'); continue; }
        assertId(rule.setting);
        const source = all.get(rule.setting); if (!source) fail('missing-dependency', node.id, rule.setting);
        if (source.binding.scope !== binding.scope || source.binding.store !== binding.store || source.binding.root !== binding.root) fail('invalid-condition', node.id, 'Cross-scope conditions require an explicit future resolver');
        if (rule.test==='one-of') {
          if (!Array.isArray(rule.values) || !rule.values.length || rule.values.length>64 || rule.values.some(value=>value!==null && !['string','number','boolean'].includes(typeof value) || !source.schema.safeParse(value).success)) fail('invalid-condition',node.id,'Condition values do not match the referenced scalar schema');
        } else if (!['equals','not-equals','defined','empty'].includes(rule.test) || ['equals','not-equals'].includes(rule.test) && !('value' in rule) || 'value' in rule && (rule.value !== null && !['string','number','boolean'].includes(typeof rule.value) || !source.schema.safeParse(rule.value).success)) fail('invalid-condition', node.id, 'Condition value does not match the referenced scalar schema');
        if (node.targets.some(t => !source.targets.includes(t))) fail('invalid-condition', node.id, 'Condition source is unavailable on a target');
      }
    });
  }
  readDefault(id: DefinitionId, context: DefaultContext = {}): unknown {
    const definition = this.get(id); if (!definition) return fail('missing-setting', id, 'Not registered');
    const value = definition.schema.safeParse(definition.defaultValue(context));
    if (!value.success) return fail('invalid-default', id, value.error.message);
    return structuredClone(value.data);
  }
  override view(): SettingsRegistryView { return Object.freeze({ ...super.view(), readDefault: (id: DefinitionId, context?: DefaultContext) => this.readDefault(id,context) }); }
}
// UI constraints are derived on request from the original schema, never copied
// into registry metadata or into the native wire schema.
export function settingConstraints(definition: SettingDefinition) { return z.toJSONSchema(definition.schema, { io: 'input' }); }

export function createCatalog(modules: readonly ModuleDefinition[], settings: readonly SettingDefinition[]): Catalog {
  const moduleRegistry = new ModuleRegistry().register(...modules), settingsRegistry = new SettingsSchemaRegistry().register(...settings);
  const capabilities = new Set(moduleRegistry.all().flatMap(m => [...m.capabilities]));
  for (const setting of settingsRegistry.all()) for (const rule of conditions(setting)) if ('capability' in rule && !capabilities.has(rule.capability)) fail('missing-capability',setting.id,rule.capability);
  const builtinTypes = new Set<string>();
  for (const module of moduleRegistry.all()) {
    if (module.builtinType) { if (builtinTypes.has(module.builtinType)) fail('duplicate-builtin-type', module.id, module.builtinType); builtinTypes.add(module.builtinType); }
    for (const id of module.settings) if (!settingsRegistry.get(id)) fail('missing-setting', module.id, id);
    for (const id of module.requires) if (!capabilities.has(id)) fail('missing-capability', module.id, id);
  }
  return Object.freeze({ modules: moduleRegistry.view(), settings: settingsRegistry.view() });
}

// Evaluation consumes an explicit snapshot supplied by a future settings service.
// No storage reads, writes, listeners, timers, module activation or arbitrary code.
export function conditionsMatch(rules: readonly Condition[], values: ReadonlyMap<DefinitionId, unknown>, capabilities: ReadonlySet<DefinitionId> = new Set()) {
  return rules.every(rule => {
    if ('capability' in rule) return rule.test === 'available' ? capabilities.has(rule.capability) : !capabilities.has(rule.capability);
    if (!values.has(rule.setting)) return false;
    const value = values.get(rule.setting);
    if (rule.test==='empty') return value===undefined || value===null || value==='';
    if (rule.test==='one-of') return rule.values.some(candidate=>Object.is(value,candidate));
    return rule.test === 'defined' ? value !== undefined : rule.test === 'equals' ? Object.is(value, rule.value) : !Object.is(value, rule.value);
  });
}
