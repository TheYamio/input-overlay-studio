import { decodeDocument, projectDocument, encodeDocument, persistedDocumentSchema, validateModuleExtensions } from './module-format.ts';
export { encodeDocument, persistedDocumentSchema };
import { z } from 'zod';
import { applyPresetColors } from './preset-colors.ts';
import { checkDocumentVersion, documentFormats } from './document-version.ts';
import { MigrationError } from './migrations/engine.ts';
import { MAX_IMPORT_BYTES, utf8Bytes } from './limits.ts';
import { defaultAppearance, defaultImageSettings, defaultTrailAppearance } from './visual.ts';

import { games, yaws, keySchema, moduleSchema, themeNames, gameProfileSchema, profileSchema, presetSchema, currentDocumentSchema } from './config-schema.ts';
export { games, yaws, keySchema, moduleSchema, themeNames, gameProfileSchema, profileSchema, presetSchema, currentDocumentSchema };
export type { Key, OverlayModule, Profile, OverlayProfile, GameProfile } from './config-schema.ts';
import type { Key, OverlayModule, Profile, OverlayProfile, GameProfile } from './config-schema.ts';
// Only the current generation is accepted. Flat editing views are private to
// Studio; file and transport entry points use strict module envelopes.
export const documentSchema = z.preprocess((input, ctx) => {
  try {
    checkDocumentVersion(input);
    const source=input as {profiles?:{modules?:unknown[]}[];presets?:{modules?:unknown[]}[]};
    const first=[...(source.profiles??[]),...(source.presets??[])].flatMap(p=>p.modules??[])[0] as {common?:unknown}|undefined;
    if(first && 'common' in first)return projectDocument(input,id=>makeModule('distance',0,id));
    return input;
  } catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid configuration.'});return z.NEVER;}
}, currentDocumentSchema).superRefine((document,ctx)=>{try{validateModuleExtensions([...document.profiles,...document.presets].flatMap(profile=>profile.modules));}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid module configuration.'});}});
export function planDocumentMigration(input:unknown){
 const source=input&&typeof input==='object'?{...input as Record<string,unknown>}:input;if(source&&typeof source==='object')delete (source as Record<string,unknown>).__studioSync;
 const plan=documentFormats.prepare(source,value=>persistedDocumentSchema.parse(value));
 return {...plan,value:decodeDocument(plan.value,id=>makeModule('distance',0,id))};
}
export { MigrationError };
export type StudioDocument = z.infer<typeof documentSchema>;
export const uid = () => crypto.randomUUID();
export function layoutKeys(layout: OverlayModule['layout']): Key[] {
  const k = (code: number, label: string, x: number, y: number, w = 54): Key => ({ id: `${code}`, code, label, x, y, w, h: 54 });
  const keys = [k(87, 'W', 62, 0), k(65, 'A', 0, 62), k(83, 'S', 62, 62), k(68, 'D', 124, 62)];
  if (layout !== 'WASD') keys.push(k(160, 'SHIFT', 0, 124, 84), k(162, 'CTRL', 0, 186, 54), k(32, 'SPACE', 62, 186, 116));
  if (layout === 'FPS Extended') keys.push(k(81, 'Q', 0, 0), k(69, 'E', 124, 0), k(82, 'R', 186, 0), k(70, 'F', 186, 62), k(161, 'R SHIFT', 92, 124, 148));
  return keys;
}
export function makeModule(type: OverlayModule['type'], index = 0, instanceId:string=uid()): OverlayModule {
  return {
    id: instanceId, type, name: { keyboard: 'Keyboard', mouse: 'Mouse Buttons', trail: 'Mouse Trail', distance: 'Distance', sensitivity: 'Sensitivity' }[type],
    x: 120 + index * 24, y: Math.min(type === 'trail' ? 740 : type === 'keyboard' ? 780 : 970, 160 + index * 24), w: type === 'trail' ? 470 : type === 'sensitivity' ? 650 : 300, h: type === 'trail' ? 340 : type === 'keyboard' ? 300 : 110,
    appearance: { ...defaultAppearance(), ...(type === 'distance' || type === 'sensitivity' ? { backgroundOpacity: 0, borderWidth: 0 } : {}) }, image: defaultImageSettings(), buttonStyles: {}, buttonGeometry: {}, buttonImages: {}, trailAppearance: defaultTrailAppearance(), wheelDuration: 110, textLayout: 'Horizontal',
    visible: true, locked: false, z: index, accent: '#a5ef6b', background: '#161b20', opacity: 1, radius: 12, effect: 'Soft Press',
    keys: layoutKeys('WASD + modifiers'), layout: 'WASD + modifiers', gap: 8, mouseMode: 'Compact Buttons', buttons: [1, 2, 3, 4, 5, 6, 7], buttonLabels: ['M1', 'M2', 'M3', 'M4', 'M5', '↑', '↓'],
    trailStyle: 'Fade Trail', position: 'Follow / Recenter', scaleMode: 'DPI Normalized Scale', scale: .65, duration: 1200, thickness: 2, glow: 10, grid: true, center: true, marker: 'Dot', clickEffects: 'Ripple', originX: .5, originY: .5,
    unit: 'Auto', decimals: 1, caption: 'DISTANCE', sensitivityStyle: 'Standard', showGame: true, showDpi: true, showSens: true, showEdpi: true, showCm: true,
  };
}
export function factoryModules(theme: Profile['theme'] = 'Obsidian'): OverlayModule[] {
  const modules = [makeModule('keyboard'), makeModule('mouse'), makeModule('trail'), makeModule('distance'), makeModule('sensitivity')];
  Object.assign(modules[0], { x: 440, y: 400, w: 290, h: 310 });
  Object.assign(modules[1], { x: 440, y: 735, w: 290, h: 100 });
  Object.assign(modules[2], { x: 790, y: 400, w: 550, h: 430 });
  Object.assign(modules[3], { x: 1400, y: 510, w: 300, h: 100 });
  Object.assign(modules[4], { x: 440, y: 890, w: 980, h: 65 });
  const place = (index: number, x: number, y: number, w: number, h: number) => Object.assign(modules[index], { x, y, w, h });
  if (theme === 'Essential') {
    place(0, 80, 850, 180, 150); modules[0].keys = layoutKeys('WASD'); modules[0].layout = 'WASD';
    place(1, 285, 850, 250, 95); modules[2].visible = false; modules[3].visible = false; place(4, 80, 1010, 500, 50);
  } else if (theme === 'Competitive') {
    place(0, 80, 680, 330, 330); modules[0].keys = layoutKeys('FPS Extended'); modules[0].layout = 'FPS Extended';
    place(1, 440, 800, 300, 110); place(2, 800, 760, 330, 250); place(3, 1180, 920, 240, 70); place(4, 440, 930, 330, 65);
  } else if (theme === 'Neon') {
    place(0, 150, 640, 380, 320); place(1, 570, 700, 220, 270); modules[1].mouseMode = 'Mouse Diagram';
    place(2, 900, 600, 720, 420); place(3, 1640, 820, 240, 90); place(4, 150, 990, 650, 60);
  } else if (theme === 'Glass') {
    place(0, 1620, 260, 220, 300); place(1, 1620, 590, 220, 300); modules[1].mouseMode = 'Mouse Diagram';
    place(2, 1220, 600, 340, 260); place(3, 1620, 930, 220, 70); place(4, 1260, 930, 310, 100); modules[4].textLayout = 'Vertical';
  } else if (theme === 'Clean Recording') {
    place(0, 630, 900, 160, 125); modules[0].keys = layoutKeys('WASD'); modules[0].layout = 'WASD';
    place(1, 820, 900, 270, 100); modules[2].visible = false; modules[3].visible = false; place(4, 1120, 900, 330, 60); modules[4].sensitivityStyle = 'Minimal';
  } else if (theme === 'Classic Input') {
    place(0, 70, 340, 300, 405); place(1, 70, 780, 300, 110); place(2, 440, 560, 400, 330); place(3, 70, 920, 300, 60); place(4, 70, 1000, 850, 50);
    modules.forEach(m => m.appearance.fontFamily = 'Consolas');
  }
  const [accent, surface, ink] = themePalettes[theme];
  modules.forEach(m => {
    m.accent = accent; m.background = surface;
    Object.assign(m.appearance, { textColor: ink, activeTextColor: theme === 'Essential' ? '#ffffff' : '#10151c', borderColor: ink, activeBorderColor: accent, borderOpacity: theme === 'Clean Recording' ? .55 : .18, borderWidth: 1.2, fontWeight: 650, backgroundOpacity: m.type === 'distance' || m.type === 'sensitivity' ? 0 : theme === 'Glass' ? .35 : 1 });
    m.radius = theme === 'Classic Input' ? 2 : theme === 'Glass' ? 30 : theme === 'Essential' ? 18 : theme === 'Competitive' ? 6 : 12;
    m.effect = theme === 'Neon' ? 'Glow' : theme === 'Clean Recording' || theme === 'Essential' ? 'Instant' : 'Soft Press';
    m.trailStyle = theme === 'Neon' ? 'Neon Trail' : theme === 'Classic Input' ? 'Segmented Trail' : theme === 'Competitive' ? 'Clean Line' : 'Fade Trail';
    Object.assign(m.trailAppearance, { markerColor: accent, leftClickColor: accent, rightClickColor: theme === 'Neon' ? '#65e8ed' : ink, slowColor: ink, fastColor: accent });
  });
  const keyboard = modules[0];
  const secondary = theme === 'Neon' ? '#65e8ed' : theme === 'Competitive' ? '#c4f46d' : theme === 'Obsidian' ? '#b4a7dd' : theme === 'Glass' ? '#bddfff' : theme === 'Classic Input' ? '#efb574' : theme === 'Essential' ? '#d8d5f2' : '#262d38';
  keyboard.keys = keyboard.keys.map(k => ({ ...k, style: [160, 161, 162, 32].includes(k.code) ? { background: secondary, textColor: theme === 'Clean Recording' ? '#ffffff' : '#1b2030', activeTextColor: '#10151c', radius: k.code === 32 ? 26 : keyboard.radius } : theme === 'Neon' && [87,65,83,68].includes(k.code) ? { borderColor: '#65e8ed', borderOpacity: .65 } : undefined }));
  keyboard.keys.forEach(k => { if (!k.style) delete k.style; });
  if (theme === 'Obsidian') { place(0, 180, 570, 300, 360); place(1, 520, 645, 270, 100); place(2, 840, 570, 660, 370); place(3, 1540, 800, 230, 75); place(4, 180, 970, 1000, 65); }
  if (theme === 'Essential') modules[1].buttons = [1,2,3];
  if (theme === 'Clean Recording') { modules[0].appearance.backgroundOpacity = .35; modules[1].buttons = [1,2,3,6,7]; modules[4].showGame = false; }
  if (theme === 'Glass') modules[0].appearance.borderOpacity = .55;
  modules[4].showEdpi = false;
  return modules;
}
export const themePalettes: Record<Profile['theme'], [string,string,string]> = {
  Essential: ['#8171d9','#f2f0f8','#29273b'], Competitive: ['#b6ef63','#161d23','#e4ebdf'],
  Obsidian: ['#b4a7dd','#262833','#e4e4ed'], Neon: ['#c299ff','#221b38','#f1e9ff'],
  Glass: ['#95d7ff','#344e68','#edf7ff'], 'Clean Recording': ['#ffffff','#11161d','#f5f7fa'], 'Classic Input': ['#efb574','#26221c','#eee5d4'],
};
export const themeColors = Object.fromEntries(Object.entries(themePalettes).map(([name, colors]) => [name, colors[0]])) as Record<Profile['theme'], string>;
export function applyTheme(modules: OverlayModule[], theme: Profile['theme']): OverlayModule[] {
  return applyPresetColors(modules, factoryModules(theme));
}
export function initialDocument(): StudioDocument {
  const game:GameProfile={id:uid(),name:'Counter-Strike 2',game:'Counter-Strike 2',dpi:800,sensitivity:1.3,yaw:.022,scale:'Source',manualCm:40};
  const p:OverlayProfile={id:uid(),name:'CS2 · Main',gameProfileId:game.id,locale:'en',caption:'',theme:'Obsidian',modules:factoryModules()};
  return { version:4,languagePacks:[],shapes:{},assets:{},activeProfileId:p.id,gameProfiles:[game],profiles:[p],presets:[],performance:{fps:'60',quality:'High',glowQuality:'Low',reducedMotion:false},distance:{persist:false,resetOnStart:true} };
}
export function activeProfile(d:StudioDocument):OverlayProfile{return d.profiles.find(p=>p.id===d.activeProfileId)!;}
export function gameForProfile(d:StudioDocument,p:OverlayProfile=activeProfile(d)):GameProfile{return d.gameProfiles.find(g=>g.id===p.gameProfileId)!;}
export function resolvedProfile(d:StudioDocument,p:OverlayProfile=activeProfile(d)):Profile{const {id:_id,name:_name,...game}=gameForProfile(d,p);return {...game,...p};}
export function cm360(p: Pick<Profile, 'game' | 'scale' | 'dpi' | 'sensitivity' | 'yaw' | 'manualCm'>): number | null {
  if (![p.dpi, p.sensitivity, p.yaw, p.manualCm].every(v => Number.isFinite(v) && v > 0)) return null;
  if (p.game === 'KovaaK’s' && p.scale === 'Unknown') return null;
  if (p.game === 'KovaaK’s' && p.scale === 'Manual cm/360') return p.manualCm;
  const yaw = p.game === 'KovaaK’s' && p.scale !== 'Custom yaw' ? yaws[p.scale] : p.yaw;
  return yaw ? 914.4 / (p.dpi * p.sensitivity * yaw) : null;
}
export function parseDecimal(value: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const n = Number(value.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function parseDocument(text: string): StudioDocument {
  if (utf8Bytes(text) > MAX_IMPORT_BYTES) throw new Error('File exceeds 2 MB.');
  return planDocumentMigration(JSON.parse(text)).value;
}
