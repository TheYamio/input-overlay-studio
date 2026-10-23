import { afterEach,describe,expect,it,vi } from 'vitest';
import { z } from 'zod';
import { initialDocument,makeModule,documentSchema,encodeDocument,parseDocument } from './config';
import { decodeModule,encodeModule,moduleAvailable,moduleConfigurations,persistedDocumentSchema } from './module-format';
import { boundedModuleJSON,moduleKind,ModuleConfigurationRegistry } from './module-envelope';
import { loadDocument,saveDocument } from './storage';
import { pruneAssets } from './skins';
import { exportPreset,importPreset,usedShapes } from './presets';
import { copyObject,pasteObject } from './object-clipboard';
import { negotiate,readIssue,writeIssue } from './compatibility/capabilities';
import contract from './compatibility/contract.json';
import { readFileSync } from 'node:fs';
const key='input-overlay-studio.document';
const envelope=()=>({...encodeModule(makeModule('distance')),type:'test.badge',config:{caption:'kept',nested:{list:[null,true,1,'text']}},resources:{assets:[],shapes:[]}});
const fallback=(id:string)=>makeModule('distance',0,id);
function withUnknown(){const document=encodeDocument(initialDocument());document.profiles[0].modules.push(envelope());return document;}
function local(raw:string){const data=new Map([[key,raw]]),storage={getItem:(k:string)=>data.get(k)??null,setItem:vi.fn((k:string,v:string)=>data.set(k,v))};vi.stubGlobal('localStorage',storage);return {data,storage};}
afterEach(()=>vi.unstubAllGlobals());

describe('versioned module envelopes',()=>{
 it('serializes cleared optional builtin overrides with the canonical JSON semantics',()=>{
  const document=initialDocument();document.profiles[0].modules[0].keys[0].style=undefined;document.profiles[0].modules[0].image.groupId=undefined;
  const wire=encodeDocument(document);expect(wire.profiles[0].modules[0].config.image).not.toHaveProperty('groupId');expect(parseDocument(JSON.stringify(wire))).toEqual(documentSchema.parse(JSON.parse(JSON.stringify(document))));
 });
 it('accepts compact inactive modules independently of the size of private editing views',()=>{
  const wire=encodeDocument(initialDocument()),seed={...encodeModule(makeModule('distance')),type:'test.future',enabled:false,config:{}};
  wire.profiles=Array.from({length:50},(_,i)=>({...wire.profiles[0],id:`profile-${i}`,modules:Array.from({length:32},(_,j)=>({...structuredClone(seed),id:`opaque-${j}`}))}));wire.activeProfileId='profile-0';
  expect(new TextEncoder().encode(JSON.stringify(wire)).length).toBeLessThan(1_800_000);const view=parseDocument(JSON.stringify(wire));expect(encodeDocument(view)).toEqual(wire);
 });
 it('matches all shared native corpus decisions without modifying the input',()=>{
  const cases=JSON.parse(readFileSync(new URL('../../../ws-server/src-tauri/test-fixtures/modules-current.json',import.meta.url),'utf8')) as {name:string;valid:boolean;document:unknown}[];
  for(const item of cases){const before=JSON.stringify(item.document);expect(documentSchema.safeParse(item.document).success,item.name).toBe(item.valid);expect(JSON.stringify(item.document)).toBe(before);}
 });
 it('roundtrips all builtin fields through common/config without reallocating identities',()=>{
  const document=initialDocument(),before=structuredClone(document),wire=encodeDocument(document);
  expect(wire.version).toBe(4);expect(wire.profiles[0].modules[0].type).toBe('overlay.keyboard');expect(wire.profiles[0].modules[0]).not.toHaveProperty('keys');
  const random=vi.spyOn(crypto,'randomUUID');expect(parseDocument(JSON.stringify(wire))).toEqual(before);expect(random).not.toHaveBeenCalled();random.mockRestore();expect(document).toEqual(before);
 });

 it('retains unknown configs and common edits without rendering them as a builtin',()=>{
  const wire=withUnknown(),source=structuredClone(wire),view=parseDocument(JSON.stringify(wire)),module=view.profiles[0].modules.at(-1)!;
  expect(moduleKind(module)).toBe('test.badge');expect(moduleAvailable(module)).toBe(false);module.x=100;module.name='New name';const output=encodeDocument(view).profiles[0].modules.at(-1)!;
  expect(output.config).toEqual(source.profiles[0].modules.at(-1)!.config);expect(output.common).toMatchObject({x:100,name:'New name'});expect(wire).toEqual(source);
 });
 it('preserves future builtin schema versions instead of coercing their config',()=>{
  const wire=encodeDocument(initialDocument()),module=wire.profiles[0].modules[0];module.schemaVersion=2;module.config={future:'unaltered'};
  const view=parseDocument(JSON.stringify(wire));expect(moduleAvailable(view.profiles[0].modules[0])).toBe(false);expect(encodeDocument(view)).toEqual(wire);
 });
 it('keeps disabled builtin configs and reactivates the exact original when enabled',()=>{
  const original=encodeModule(makeModule('keyboard')),disabled={...original,enabled:false};const view=decodeModule(disabled,fallback);expect(moduleAvailable(view)).toBe(false);expect(encodeModule(view)).toEqual(disabled);
  const restored=decodeModule({...encodeModule(view),enabled:true},fallback);expect(restored.extension).toBeUndefined();expect(encodeModule(restored)).toEqual(original);
 });
 it('registers and removes a compiled custom schema without changing the envelope',()=>{
  const source=envelope(),register=()=>moduleConfigurations.register({type:'test.badge',schemaVersion:1,schema:z.strictObject({caption:z.string(),nested:z.object({list:z.array(z.unknown())})})});
  const remove=register();try{const view=decodeModule(source,fallback);expect(moduleAvailable(view)).toBe(true);expect(encodeModule(view)).toEqual(source);moduleConfigurations.setEnabled('test.badge',false);expect(moduleAvailable(view)).toBe(false);moduleConfigurations.setEnabled('test.badge',true);expect(moduleAvailable(view)).toBe(true);}finally{remove();}
  const held=decodeModule(source,fallback);expect(moduleAvailable(held)).toBe(false);const reconnect=register();try{expect(moduleAvailable(held)).toBe(true);expect(encodeModule(held)).toEqual(source);}finally{reconnect();}
 });
 it('rejects invalid known configs atomically instead of treating them as unknown',()=>{
  const wire=encodeDocument(initialDocument());wire.profiles[0].modules[0].config.gap=-1;const before=structuredClone(wire);expect(()=>parseDocument(JSON.stringify(wire))).toThrow('Invalid configuration');expect(wire).toEqual(before);
 });
 it('rejects inconsistent resources in a disabled builtin editor projection before saving',()=>{
  const document=initialDocument(),module=decodeModule({...encodeModule(document.profiles[0].modules[0]),enabled:false},fallback);document.profiles[0].modules[0]=module;
  (module.extension!.config.image as {assetId:string}).assetId='undeclared';expect(documentSchema.safeParse(document).success).toBe(false);
 });
 it('rejects unknown fields in envelopes and new bounds rather than silently stripping or clamping',()=>{
  const wire=withUnknown();(wire.profiles[0].modules[0] as unknown as Record<string,unknown>).future=true;expect(()=>parseDocument(JSON.stringify(wire))).toThrow();
  delete (wire.profiles[0].modules[0] as unknown as Record<string,unknown>).future;wire.profiles[0].modules[0].common.x=1920;expect(()=>parseDocument(JSON.stringify(wire))).toThrow();
 });
 it.each([0,1.5,65536])('rejects invalid module schema version %s',version=>{const wire=withUnknown();wire.profiles[0].modules.at(-1)!.schemaVersion=version;expect(documentSchema.safeParse(wire).success).toBe(false);});
 it('rejects duplicate module IDs, missing resources and undeclared builtin references',()=>{
  const wire=withUnknown();wire.profiles[0].modules[1].id=wire.profiles[0].modules[0].id;expect(documentSchema.safeParse(wire).success).toBe(false);
  wire.profiles[0].modules[1].id='other';wire.profiles[0].modules.at(-1)!.resources.assets=['missing'];expect(documentSchema.safeParse(wire).success).toBe(false);
  const module=encodeModule(makeModule('keyboard'));module.resources.shapes=['extra'];expect(()=>decodeModule(module,fallback)).toThrow('Unexpected builtin');
 });
 it('bounds opaque JSON depth, nodes, strings, size and unsafe keys',()=>{
  expect(boundedModuleJSON({good:[true,1,null]})).toBe(true);expect(boundedModuleJSON(JSON.parse('{"__proto__":{}}'))).toBe(false);expect(boundedModuleJSON({x:Infinity})).toBe(false);expect(boundedModuleJSON({x:()=>0})).toBe(false);expect(boundedModuleJSON({x:'x'.repeat(16385)})).toBe(false);expect(boundedModuleJSON({x:Array(1001).fill(0)})).toBe(false);
  let deep:unknown={};for(let i=0;i<18;i++)deep={deep};expect(boundedModuleJSON(deep)).toBe(false);const cyclic:Record<string,unknown>={};cyclic.self=cyclic;expect(boundedModuleJSON(cyclic)).toBe(false);expect(boundedModuleJSON(Object.fromEntries(Array.from({length:20},(_,i)=>[String(i),'x'.repeat(16000)])))).toBe(false);
 });
 it('validates registry IDs, duplicates and compiled schema versions',()=>{
  const registry=new ModuleConfigurationRegistry();expect(()=>registry.register({type:'bad',schemaVersion:1,schema:z.object({})})).toThrow();const remove=registry.register({type:'test.badge',schemaVersion:1,schema:z.object({})});expect(()=>registry.register({type:'test.badge',schemaVersion:1,schema:z.object({})})).toThrow();remove();remove();expect(registry.all()).toEqual([]);
 });
});

describe('Current persistence and compatibility',()=>{


 it('persists unknown data across save/load and ordinary builtin edits',()=>{
  const wire=withUnknown(),{data}=local(JSON.stringify(wire));const document=loadDocument().document;document.profiles[0].modules[0].gap=3;saveDocument(document);const restored=loadDocument();expect(restored.warning).toBe('');expect(encodeDocument(restored.document).profiles[0].modules.at(-1)).toEqual(wire.profiles[0].modules.at(-1));expect(JSON.parse(data.get(key)!).version).toBe(4);
 });
 it('requires envelope support for custom modules and rejects missing contracts',()=>{
  const document=parseDocument(JSON.stringify(withUnknown())),legacy=negotiate({protocol:5,studio_revisions:true});expect(writeIssue(legacy,document,'studio')).toContain('current capability contract');const modern=negotiate({protocol:5,studio_capabilities:{...contract,role:'capture'}});expect(readIssue(modern,withUnknown())).toBe('');expect(writeIssue(modern,document,'studio')).toBe('');expect(writeIssue(modern,document,'runtime')).toContain('read-only');
 });
 it('generates the persisted envelope schema independently from the editor projection',()=>{
  expect(persistedDocumentSchema.safeParse(initialDocument()).success).toBe(false);expect(persistedDocumentSchema.safeParse(encodeDocument(initialDocument())).success).toBe(true);
 });
});

describe('preserved module resources',()=>{
 const asset={name:'pixel.png',width:1,height:1,data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3S8AAAAASUVORK5CYII='};
 it('keeps inactive image/shape references during pruning, export and preset import',()=>{
  const wire=withUnknown();wire.assets.paint=asset;const module=wire.profiles[0].modules.at(-1)!;module.resources.assets=['paint'];const document=parseDocument(JSON.stringify(wire));pruneAssets(document);expect(document.assets.paint).toEqual(asset);expect(usedShapes(document.profiles[0].modules)).toEqual(new Set());
  document.presets=[{id:'preset',name:'Opaque',theme:'Obsidian',modules:[document.profiles[0].modules.at(-1)!]}];const exported=exportPreset(document,'preset');expect(JSON.parse(exported).version).toBe(2);const imported=importPreset(exported);expect(imported.assets.paint).toEqual(asset);expect(imported.preset.modules[0].extension).toEqual(document.presets[0].modules[0].extension);
  const conflict=initialDocument();conflict.assets.paint={...asset,name:'different'};expect(()=>importPreset(exported,conflict)).toThrow('conflicts');
 });
 it('copies inactive resources through source removal and refuses destructive ID collisions',()=>{
  const wire=withUnknown();wire.assets.paint=asset;wire.profiles[0].modules.at(-1)!.resources.assets=['paint'];const document=parseDocument(JSON.stringify(wire)),module=document.profiles[0].modules.at(-1)!;const clip=copyObject(document,{moduleId:module.id});document.profiles[0].modules.pop();pruneAssets(document);expect(document.assets.paint).toBeUndefined();pasteObject(document,clip,null);expect(document.assets.paint).toEqual(asset);expect(document.profiles[0].modules.at(-1)!.extension).toEqual(module.extension);
  document.assets.paint={...asset,name:'other'};expect(()=>pasteObject(document,clip,null)).toThrow('conflicts');
 });
});
