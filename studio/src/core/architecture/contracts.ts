import type { z } from 'zod';

// Definition IDs are stable, namespaced identifiers, never instance UUIDs or labels.
export type DefinitionId = `${string}.${string}`;
export type Scope = 'global' | 'capture' | 'game-profile' | 'overlay-profile' | 'module' | 'runtime';
export type Store = 'document' | 'preferences' | 'native' | 'transient';
export type Target = 'studio' | 'obs' | 'native';
export type LocalizedText = Readonly<{ key: `${string}:${string}`; fallback: string }>;
export type SettingsAddress =
  | Readonly<{ scope: 'global' | 'capture' | 'runtime' }>
  | Readonly<{ scope: 'game-profile' | 'overlay-profile'; profileId: string }>
  | Readonly<{ scope: 'module'; profileId: string; moduleId: string; element?: { kind: 'key'; keyId: string } | { kind: 'mouse-button'; button: number } }>;

export interface ScopeContract {
  readonly stores: readonly Store[];
  readonly identity: readonly string[];
  readonly inheritance: 'none' | 'module-to-element';
}
// A scope describes ownership. Game and overlay profiles have separate identities
// connected by gameProfileId; neither implicitly inherits another profile.
export const scopes = Object.freeze({
  global: { stores: ['document', 'preferences', 'native'], identity: [], inheritance: 'none' },
  capture: { stores: ['native'], identity: [], inheritance: 'none' },
  'game-profile': { stores: ['document'], identity: ['profileId'], inheritance: 'none' },
  'overlay-profile': { stores: ['document'], identity: ['profileId'], inheritance: 'none' },
  module: { stores: ['document'], identity: ['profileId', 'moduleId'], inheritance: 'module-to-element' },
  runtime: { stores: ['transient'], identity: [], inheritance: 'none' },
} as const satisfies Record<Scope, ScopeContract>);
for (const scope of Object.values(scopes)) { Object.freeze(scope.stores); Object.freeze(scope.identity); Object.freeze(scope); }

export interface Binding {
  readonly scope: Scope;
  readonly store: Store;
  readonly root: 'document' | 'profile' | 'module' | 'preferences' | 'native' | 'runtime';
  readonly path: readonly string[];
  // Paths are relative to the selected Key and ElementStyle, respectively.
  // Keys and mouse buttons inherit from their module, never from each other.
  readonly overrides?: Readonly<{ key: readonly string[]; mouseButton: readonly string[] }>;
}
export type Condition =
  | Readonly<{ setting: DefinitionId; test: 'equals' | 'not-equals'; value: string | number | boolean | null }>
  | Readonly<{ setting: DefinitionId; test: 'defined' }>
  | Readonly<{ setting: DefinitionId; test: 'empty' }>
  | Readonly<{ setting: DefinitionId; test: 'one-of'; values: readonly (string | number | boolean | null)[] }>
  | Readonly<{ capability: DefinitionId; test: 'available' | 'unavailable' }>;
export type Control = 'number' | 'range' | 'checkbox' | 'select' | 'text' | 'color' | 'custom';
export interface SettingUI {
  readonly control: Control;
  readonly group: DefinitionId;
  readonly unit?: 'px' | 'ms' | 'degrees' | 'cm' | 'dpi' | 'ratio';
  readonly component?: DefinitionId;
  // Interaction increment, not another validation bound. Bounds come from schema.
  readonly step?: number;
  readonly firstOption?: string;
  readonly section?: DefinitionId;
  readonly order?: number;
}
export interface DefaultContext { readonly moduleType?: string }
export interface SettingDefinition<S extends z.ZodType = z.ZodType> {
  readonly id: DefinitionId;
  readonly schemaVersion: number;
  readonly schema: S;
  readonly binding: Binding;
  readonly label: LocalizedText;
  readonly help?: LocalizedText;
  readonly ui: SettingUI;
  readonly targets: readonly Target[];
  readonly apply: 'live' | 'reconnect' | 'restart' | 'explicit';
  readonly platforms?: readonly ('windows' | 'linux' | 'macos')[];
  readonly sensitive?: boolean;
  readonly dependencies?: readonly DefinitionId[];
  readonly visibleWhen?: readonly Condition[];
  readonly enabledWhen?: readonly Condition[];
  readonly disabledReason?: LocalizedText;
  // Lazy, trusted adapter to the existing factory. Registration never calls it.
  // Undefined optional defaults remain absent in old documents.
  readonly defaultValue: (context: DefaultContext) => z.input<S>;
}
export function defineSetting<S extends z.ZodType>(definition: SettingDefinition<S>): SettingDefinition<S> { return definition; }

export interface ModuleDefinition {
  readonly id: DefinitionId;
  readonly schemaVersion: number;
  readonly kind: 'service' | 'visual';
  readonly label: LocalizedText;
  readonly description: LocalizedText;
  readonly dependencies: readonly DefinitionId[];
  readonly capabilities: readonly DefinitionId[];
  readonly requires: readonly DefinitionId[];
  readonly settings: readonly DefinitionId[];
  readonly targets: readonly Target[];
  readonly builtinType?: string;
  readonly configuration?: z.ZodType;
  readonly renderer?: DefinitionId;
  readonly inspector?: DefinitionId;
}
export interface RegistryView<T> {
  get(id: DefinitionId): T | undefined;
  all(): readonly T[];
  ordered(): readonly T[];
}
export interface SettingsRegistryView extends RegistryView<SettingDefinition> {
  readDefault(id: DefinitionId, context?: DefaultContext): unknown;
}
export interface Catalog {
  readonly modules: RegistryView<ModuleDefinition>;
  readonly settings: SettingsRegistryView;
}
