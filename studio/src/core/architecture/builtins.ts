import type { z } from 'zod';
import { currentDocumentSchema, initialDocument, makeModule, moduleSchema, gameProfileSchema, profileSchema, type OverlayModule } from '../config';
import { appearanceSchema, imageSettingsSchema, trailAppearanceSchema } from '../visual';
import type { Binding, Control, DefaultContext, DefinitionId, ModuleDefinition, SettingDefinition, SettingUI } from './contracts';
import { createCatalog } from './registry';
import { configureAnimationDefinitions } from './animation';
import { externalDefinitions } from './external';
import { configureDocumentPresentation } from './presentation';

type ModuleType = OverlayModule['type'];
type Row<S> = readonly [field: keyof S & string, stableName: string, label: string, control: Control, unit?: SettingUI['unit'], component?: DefinitionId];
const allTypes: readonly ModuleType[] = ['keyboard','mouse','trail','distance','sensitivity'];
const interactive: readonly ModuleType[] = ['keyboard','mouse'];
const textTypes: readonly ModuleType[] = ['keyboard','mouse','distance','sensitivity'];
const visualInfo = [
  ['keyboard','Keyboard','Every press, perfectly clear',['input.keyboard']],
  ['mouse','Mouse Buttons','Clicks, scroll & side buttons',['input.mouse-buttons']],
  ['trail','Mouse Trail','Make your movement visible',['input.mouse-motion']],
  ['distance','Distance','Physical movement, in cm or m',['input.distance']],
  ['sensitivity','Sensitivity','Your setup at a glance',['profiles.game']],
] as const;

function at(value: unknown, path: readonly string[]): unknown {
  for (const part of path) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  return value;
}
function moduleDefault(context: DefaultContext, path: readonly string[]) {
  const type = moduleSchema.shape.type.parse(context.moduleType);
  return at(makeModule(type), path);
}
// Metadata adapts the existing schemas/factories. No new persisted defaults,
// validation bounds, type enum, migration, input handling or renderer is introduced.
export function createBuiltinDefinitions() {
  const settings: SettingDefinition[] = [], byType = new Map(allTypes.map(type => [type, [] as DefinitionId[]]));
  const profileIds: DefinitionId[] = [], globalIds: DefinitionId[] = [];
  function fields<S extends Record<string, z.ZodType>>(shape: S, rows: readonly Row<S>[], group: DefinitionId, binding: Omit<Binding, 'path' | 'overrides'>, prefix: readonly string[], types: readonly ModuleType[] = allTypes, inherited = false) {
    for (const [field, stableName, label, control, unit, component] of rows) {
      const id: DefinitionId = `${group}.${stableName}`, path = [...prefix, field];
      const schema = shape[field]; if (!schema) throw Error(`Missing existing schema for ${id}`);
      settings.push({ id, schemaVersion: 1, schema, binding: { ...binding, path, ...(inherited ? { overrides: { key: ['style',field], mouseButton: [field] } } : {}) },
        label: { key: `settings:${id}.label`, fallback: label }, ui: { control, group, ...(unit ? {unit} : {}), ...(component ? {component} : {}) },
        targets: ['studio','obs'], apply: 'live', defaultValue: context => binding.scope === 'module' ? moduleDefault(context, path) : at(binding.scope==='game-profile'?initialDocument().gameProfiles[0]:binding.root==='profile'?initialDocument().profiles[0]:initialDocument(),path),
      });
      if (binding.scope === 'module') for (const type of types) byType.get(type)!.push(id);
      else if (binding.root === 'profile') profileIds.push(id); else globalIds.push(id);
    }
  }
  const instance = { scope: 'module', store: 'document', root: 'module' } as const;
  fields(moduleSchema.shape, [
    ['name','name','Module name','text'], ['x','x','X','number','px'], ['y','y','Y','number','px'], ['w','width','Width','number','px'], ['h','height','Height','number','px'],
    ['visible','visible','Visible in OBS','checkbox'], ['locked','locked','Lock position','checkbox'], ['z','layer','Layer','number'], ['opacity','opacity','Opacity','range'],
  ], 'overlay.instance', instance, []);
  fields(moduleSchema.shape, [
    ['accent','accent','Accent color','color'], ['background','surface','Surface color','color'], ['radius','radius','Corner radius','number','px'],
  ], 'overlay.surface', instance, [], allTypes, true);
  fields(moduleSchema.shape, [['effect','effect-preset','Press effect','select']], 'overlay.surface', instance, [], interactive, true);

  fields(appearanceSchema.shape, [
    ['backgroundOpacity','background-opacity','Background opacity','range'], ['borderColor','border-color','Border color','color'],
    ['borderOpacity','border-opacity','Border opacity','range'], ['borderWidth','border-width','Border width','number','px'],
  ], 'overlay.appearance', instance, ['appearance'], allTypes, true);
  fields(appearanceSchema.shape, [
    ['textColor','text-color','Text color','color'], ['autoFitText','auto-fit-text','Fit text','checkbox'], ['fontFamily','font-family','Font family','select'],
    ['fontSize','font-size','Font size','number','px'], ['fontWeight','font-weight','Font weight','number'], ['letterSpacing','letter-spacing','Letter spacing','number','px'],
    ['textOutline','text-outline','Text outline','number','px'], ['textShadow','text-shadow','Text shadow','number','px'],
  ], 'overlay.appearance', instance, ['appearance'], textTypes, true);
  fields(appearanceSchema.shape, [
    ['showLabels','show-labels','Show labels','checkbox'], ['shapeId','shape','Button shape','custom',undefined,'editor.shape-library'],
    ['activeTextColor','active-text-color','Pressed text color','color'], ['activeBorderColor','active-border-color','Pressed border color','color'],
  ], 'overlay.appearance', instance, ['appearance'], interactive, true);
  fields(appearanceSchema.shape, [
    ['lighting','lighting','Lighting mode','select'], ['motion','motion','Button motion','select'], ['easing','easing','Motion easing','select'],
    ['pressDelay','press-delay','Press delay','number','ms'], ['releaseDelay','release-delay','Release delay','number','ms'],
    ['lightingOpacity','lighting-opacity','Light intensity','range'], ['secondaryColor','secondary-color','Secondary light color','color'],
    ['gradientAngle','gradient-angle','Gradient angle','number','degrees'], ['motionScale','motion-scale','Scale while pressed','number','ratio'],
    ['pressDuration','press-duration','Press duration','number','ms'], ['releaseDuration','release-duration','Release duration','number','ms'],
    ['pressTravel','press-travel','Press travel','number','px'], ['glowStrength','glow-strength','Glow strength','number','px'],
  ], 'overlay.animation', instance, ['appearance'], interactive, true);
  fields(imageSettingsSchema.shape, [
    ['enabled','enabled','Enable keycap image','checkbox'], ['assetId','asset','Image','custom',undefined,'editor.image-library'],
    ['groupId','group','Shared artwork','custom',undefined,'editor.artwork-groups'], ['flipX','flip-x','Flip horizontally','checkbox'], ['flipY','flip-y','Flip vertically','checkbox'],
    ['fit','fit','Image fit','select'], ['scale','scale','Image scale','number','ratio'], ['x','x','Image X','number','px'], ['y','y','Image Y','number','px'],
    ['rotation','rotation','Image rotation','number','degrees'], ['opacity','opacity','Image opacity','range'], ['blend','blend','Image blend','select'],
    ['brightness','brightness','Brightness','number'], ['contrast','contrast','Contrast','number'], ['saturation','saturation','Saturation','number'],
    ['tint','tint','Image tint','color'], ['tintOpacity','tint-opacity','Tint opacity','range'], ['press','press','Image while pressed','select'], ['pressTint','press-tint','Press tint strength','range'],
  ], 'overlay.artwork', instance, ['image'], interactive);
  fields(moduleSchema.shape, [
    ['keys','keys','Key layout','custom',undefined,'editor.key-layout'], ['layout','layout','Layout','select'], ['gap','gap','Key gap','number','px'],
  ], 'overlay.keyboard', instance, [], ['keyboard']);
  fields(moduleSchema.shape, [
    ['mouseMode','mode','Display','select'], ['buttons','buttons','Visible mouse buttons','custom',undefined,'editor.mouse-buttons'],
    ['buttonLabels','labels','Button labels','custom',undefined,'editor.mouse-buttons'], ['buttonStyles','styles','Button styles','custom',undefined,'editor.mouse-buttons'],
    ['buttonGeometry','geometry','Button geometry','custom',undefined,'editor.mouse-buttons'], ['buttonImages','images','Button image visibility','custom',undefined,'editor.mouse-buttons'],
    ['wheelDuration','wheel-duration','Scroll highlight','number','ms'], ['mouseBodyShapeId','body-shape','Mouse body shape','custom',undefined,'editor.shape-library'],
  ], 'overlay.mouse', instance, [], ['mouse']);
  fields(moduleSchema.shape, [
    ['trailStyle','style','Trail style','select'], ['position','position','Position','select'], ['scaleMode','scale-mode','Scale mode','select'], ['scale','scale','Trail scale','number','ratio'],
    ['duration','duration','Trail duration','number','ms'], ['thickness','thickness','Line thickness','number','px'], ['glow','glow','Trail glow','number','px'],
    ['grid','grid','Show grid','checkbox'], ['center','center','Show center','checkbox'], ['marker','marker','Marker','select'], ['clickEffects','click-effects','Click effects','select'],
    ['originX','origin-x','Origin X','range'], ['originY','origin-y','Origin Y','range'],
  ], 'overlay.trail', instance, [], ['trail']);
  fields(trailAppearanceSchema.shape, [
    ['gridColor','grid-color','Grid color','color'], ['gridOpacity','grid-opacity','Grid opacity','range'], ['gridSpacing','grid-spacing','Grid spacing','number','px'],
    ['centerColor','center-color','Center color','color'], ['centerSize','center-size','Center size','number','px'], ['markerColor','marker-color','Marker color','color'], ['markerSize','marker-size','Marker size','number','px'],
    ['slowColor','slow-color','Slow color','color'], ['fastColor','fast-color','Fast color','color'], ['speedRange','speed-range','Speed color range','number'],
    ['leftClickColor','left-click-color','M1 click color','color'], ['rightClickColor','right-click-color','M2 click color','color'], ['clickDuration','click-duration','Click duration','number','ms'], ['clickSize','click-size','Click size','number','px'], ['followMs','follow-time','Follow time','number','ms'],
  ], 'overlay.trail-appearance', instance, ['trailAppearance'], ['trail']);
  fields(moduleSchema.shape, [
    ['textLayout','text-layout','Text layout','select'],
  ], 'overlay.text', instance, [], ['distance','sensitivity']);
  fields(moduleSchema.shape, [
    ['unit','unit','Distance unit','select'], ['decimals','decimals','Decimal places','number'], ['caption','caption','Caption','text'],
  ], 'overlay.distance', instance, [], ['distance']);
  fields(moduleSchema.shape, [
    ['sensitivityStyle','style','Format','select'], ['showGame','show-game','Show game','checkbox'], ['showDpi','show-dpi','Show DPI','checkbox'], ['showSens','show-sensitivity','Show sensitivity','checkbox'], ['showEdpi','show-edpi','Show eDPI','checkbox'], ['showCm','show-cm','Show cm/360','checkbox'],
  ], 'overlay.sensitivity', instance, [], ['sensitivity']);

  fields(gameProfileSchema.shape, [
    ['name','name','Profile name','text'], ['game','game','Game','select'], ['dpi','dpi','Mouse DPI','number','dpi'], ['sensitivity','sensitivity','In-game sensitivity','number'],
    ['yaw','yaw','Yaw factor','number'], ['scale','scale','Sensitivity scale','select'], ['manualCm','manual-cm','Manual cm/360','number','cm'],
  ], 'profiles.game', {scope:'game-profile',store:'document',root:'profile'}, []);
  fields(profileSchema.shape, [
    ['name','name','Overlay name','text'], ['gameProfileId','game-profile','Linked game','custom',undefined,'editor.game-profile-picker'],
    ['caption','caption','Profile caption','text'], ['theme','theme','Theme','select'], ['modules','modules','Modules','custom',undefined,'editor.module-list'],
  ], 'profiles.overlay', {scope:'overlay-profile',store:'document',root:'profile'}, []);
  const global = {scope:'global',store:'document',root:'document'} as const;
  fields(currentDocumentSchema.shape.performance.shape, [
    ['fps','fps','Animation FPS','select'], ['quality','quality','Trail quality','select'], ['glowQuality','glow-quality','Glow quality','select'], ['reducedMotion','reduced-motion','Reduced motion','checkbox'],
  ], 'render.performance', global, ['performance']);
  fields(currentDocumentSchema.shape.distance.shape, [
    ['persist','persist','Keep total between launches','checkbox'], ['resetOnStart','reset-on-start','Reset when capture starts','checkbox'],
  ], 'capture.distance', global, ['distance']);
  fields(currentDocumentSchema.shape, [
    ['activeProfileId','active-profile','Active profile','custom',undefined,'editor.profile-picker'], ['presets','presets','Saved presets','custom',undefined,'editor.preset-library'],
    ['assets','assets','Image library','custom',undefined,'editor.image-library'], ['shapes','shapes','Shape library','custom',undefined,'editor.shape-library'],
  ], 'studio.document', global, []);

  // Conditions reference stable IDs, never translated labels or executable strings.
  const depends = (id: DefinitionId, setting: DefinitionId, value: string) => {
    const index = settings.findIndex(s => s.id === id); settings[index] = {...settings[index], visibleWhen:[{setting,test:'equals',value}]};
  };
  depends('overlay.animation.secondary-color','overlay.animation.lighting','Gradient');
  depends('overlay.animation.gradient-angle','overlay.animation.lighting','Gradient');
  depends('overlay.animation.motion-scale','overlay.animation.motion','Scale');
  configureAnimationDefinitions(settings);
  configureDocumentPresentation(settings);
  const radius=settings.findIndex(setting=>setting.id==='overlay.surface.radius');
  settings[radius]={...settings[radius],enabledWhen:[{setting:'overlay.appearance.shape',test:'empty'}],disabledReason:{key:'settings:overlay.surface.radius.disabled',fallback:'Clear the custom button shape to edit corner radius.'}};
  const fps=settings.findIndex(setting=>setting.id==='render.performance.fps');
  settings[fps]={...settings[fps],ui:{...settings[fps].ui,firstOption:'Auto'}};

  // StudioStore consumes these document values too. Reset-on-start is persisted
  // now, but its effect is intentionally deferred until the next capture launch.
  for (const [id,apply] of [
    ['profiles.game.dpi','live'], ['profiles.overlay.game-profile','live'], ['studio.document.active-profile','live'],
    ['capture.distance.persist','live'], ['capture.distance.reset-on-start','restart'],
  ] as const) {
    const index = settings.findIndex(s => s.id === id);
    settings[index] = {...settings[index],targets:['studio','obs','native'],apply};
  }

  const service = (id: DefinitionId, name: string, capabilities: readonly DefinitionId[], dependencies: readonly DefinitionId[], owned: readonly DefinitionId[], targets: ModuleDefinition['targets']): ModuleDefinition => ({
    id, schemaVersion:1, kind:'service', label:{key:`modules:${id}.label`,fallback:name}, description:{key:`modules:${id}.description`,fallback:`Existing ${name.toLowerCase()} adapter`}, dependencies, capabilities, requires:[], settings:owned, targets,
  });
  const modules: ModuleDefinition[] = [
    service('core.capture','Capture',['capture.native'],[],externalDefinitions.filter(s=>s.binding.store==='native').map(s=>s.id),['studio','native']),
    service('core.input','Input',['input.keyboard','input.mouse-buttons','input.mouse-motion','input.distance'],['core.capture'],globalIds.filter(id => id.startsWith('capture.')),['studio','obs','native']),
    service('core.profiles','Profiles',['profiles.game','profiles.overlay'],[],profileIds.concat(globalIds.filter(id => id.startsWith('studio.')),externalDefinitions.filter(s=>s.binding.store==='preferences').map(s=>s.id)),['studio','obs','native']),
    service('core.renderer','Renderer',['render.scene'],['core.input','core.profiles'],globalIds.filter(id => id.startsWith('render.')),['studio','obs']),
    ...visualInfo.map(([type,name,description,requires]): ModuleDefinition => ({
      id:`overlay.${type}`, schemaVersion:1, kind:'visual', label:{key:`modules:overlay.${type}.label`,fallback:name}, description:{key:`modules:overlay.${type}.description`,fallback:description},
      builtinType:type, configuration:moduleSchema, renderer:`editor.scene.${type}`, inspector:`editor.inspector.${type}`,
      dependencies:['core.renderer'], capabilities:[`overlay.${type}`], requires, settings:byType.get(type)!, targets:['studio','obs'],
    })),
  ];
  return {modules,settings:[...settings,...externalDefinitions]};
}
export function createBuiltinCatalog() { const {modules,settings} = createBuiltinDefinitions(); return createCatalog(modules,settings); }
export const builtinCatalog = createBuiltinCatalog();
export const builtinVisualModules = Object.freeze(visualInfo.map(([type]) => {
  const definition = builtinCatalog.modules.get(`overlay.${type}`)!;
  return Object.freeze({type,definition});
}));
export function createBuiltinModule(type: ModuleType, index = 0): OverlayModule {
  const definition = builtinCatalog.modules.get(`overlay.${type}`);
  if (definition?.builtinType !== type) throw Error(`Unregistered visual module: ${type}`);
  return makeModule(type,index);
}
