import {truncateText} from './unicode';
import {copyName} from './editing';
import { activeProfile, gameForProfile, encodeDocument, initialDocument, uid, gameProfileSchema, type StudioDocument } from './config';
import { moduleReferences } from './module-envelope';
import { z } from 'zod';
import { MAX_IMPORT_BYTES,utf8Bytes } from './limits';
export function duplicateOverlay(d:StudioDocument,id:string){
 if(d.profiles.length>=50)throw Error('At most 50 overlay profiles.');
 const source=d.profiles.find(p=>p.id===id);if(!source)throw Error('Overlay profile does not exist.');
 const copy={...structuredClone(source),id:uid(),name:copyName(source.name)};d.profiles.push(copy);d.activeProfileId=copy.id;return copy;
}
export function removeOverlay(d:StudioDocument,id:string){
 if(d.profiles.length<=1)throw Error('Keep at least one overlay profile.');
 const p=d.profiles.find(p=>p.id===id);if(!p)throw Error('Overlay profile does not exist.');
 d.profiles=d.profiles.filter(p=>p.id!==id);
 if(d.activeProfileId===id)d.activeProfileId=(d.profiles.find(v=>v.gameProfileId===p.gameProfileId)??d.profiles[0]).id;
}
export function linkGame(d:StudioDocument,overlayId:string,gameId:string){
 const overlay=d.profiles.find(p=>p.id===overlayId);if(!overlay||!d.gameProfiles.some(g=>g.id===gameId))throw Error('Profile does not exist.');
 overlay.gameProfileId=gameId;
}
export function activateGame(d:StudioDocument,gameId:string){
 if(!d.gameProfiles.some(g=>g.id===gameId))throw Error('Game profile does not exist.');
 if(gameForProfile(d).id===gameId)return;
 let overlay=d.profiles.find(p=>p.gameProfileId===gameId);
 if(!overlay){overlay=duplicateOverlay(d,activeProfile(d).id);overlay.gameProfileId=gameId;overlay.name=`${truncateText(d.gameProfiles.find(g=>g.id===gameId)!.name,85)} overlay`;}
 d.activeProfileId=overlay.id;
}
export function removeGame(d:StudioDocument,id:string,replacement?:string){
 if(d.gameProfiles.length<=1)throw Error('Keep at least one game profile.');
 if(!d.gameProfiles.some(g=>g.id===id))throw Error('Game profile does not exist.');
 const linked=d.profiles.filter(p=>p.gameProfileId===id);
 if(linked.length&&(!replacement||replacement===id||!d.gameProfiles.some(g=>g.id===replacement)))throw Error('Choose a replacement game for linked overlays.');
 for(const overlay of linked)overlay.gameProfileId=replacement!;
 d.gameProfiles=d.gameProfiles.filter(g=>g.id!==id);
}
export function exportOverlay(d:StudioDocument,id:string){
 const overlay=d.profiles.find(p=>p.id===id);if(!overlay)throw Error('Overlay profile does not exist.');
 const refs=overlay.modules.map(moduleReferences),assets=new Set(refs.flatMap(r=>r.assets)),shapes=new Set(refs.flatMap(r=>r.shapes));
 const isolated={...initialDocument(),languagePacks:d.languagePacks,activeProfileId:id,profiles:[overlay],gameProfiles:[gameForProfile(d,overlay)],assets:Object.fromEntries(Object.entries(d.assets).filter(([id])=>assets.has(id))),shapes:Object.fromEntries(Object.entries(d.shapes).filter(([id])=>shapes.has(id)))};
 return JSON.stringify(encodeDocument(isolated));
}
const gameBundle=z.strictObject({format:z.literal('input-overlay-studio-game'),version:z.literal(1),game:gameProfileSchema});
export function exportGame(d:StudioDocument,id:string){const game=d.gameProfiles.find(g=>g.id===id);if(!game)throw Error('Game profile does not exist.');return JSON.stringify(gameBundle.parse({format:'input-overlay-studio-game',version:1,game}),null,2);}
export function importGame(text:string){if(utf8Bytes(text)>MAX_IMPORT_BYTES)throw Error('File exceeds 2 MB.');return {...gameBundle.parse(JSON.parse(text)).game,id:uid()};}
