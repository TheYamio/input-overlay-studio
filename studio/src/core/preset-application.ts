import {activeProfile,type StudioDocument} from './config';
import type {PresetBundle} from './factory-presets';
import {applyPresetColors} from './preset-colors';
import {importPreset,serializePresetBundle,usedShapes} from './presets';

// The caller owns the SettingsService transaction, validation and Undo entry.
export function applyPresetToDocument(doc:StudioDocument,preset:StudioDocument['presets'][number],colors:boolean,source?:PresetBundle){
 const bundle=!colors&&source?importPreset(serializePresetBundle(source),doc):undefined;
 const previousShapes=usedShapes([...doc.profiles,...doc.presets].flatMap(p=>p.modules));
 const profile=activeProfile(doc);profile.theme=preset.theme;
 profile.modules=colors?applyPresetColors(profile.modules,preset.modules):structuredClone(bundle?.preset.modules||preset.modules);
 if(bundle){Object.assign(doc.assets,bundle.assets);Object.assign(doc.shapes,bundle.shapes);}
 const used=usedShapes([...doc.profiles,...doc.presets].flatMap(p=>p.modules));
 doc.shapes=Object.fromEntries(Object.entries(doc.shapes).filter(([id])=>!previousShapes.has(id)||used.has(id)));
}
