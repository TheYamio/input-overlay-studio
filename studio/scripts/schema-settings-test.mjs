import contract from '../src/core/compatibility/contract.json' with {type:'json'};
import { parseDocument,encodeDocument } from '../src/core/config.ts';
// Synthetic documents, two sequential UI branches and isolated preview fixtures.
import { chromium,expect } from './test-browser.mjs';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument,documentSchema } from '../src/core/config.ts';
const artifacts=new URL('../artifacts/schema-settings/',import.meta.url);await mkdir(artifacts,{recursive:true});
const vite=await createServer({server:{host:'127.0.0.1',port:5222,strictPort:true}});await vite.listen();
const wss=new WebSocketServer({host:'127.0.0.1',port:4622});let document=initialDocument(),revision=0,packets=[];
wss.on('connection',ws=>ws.on('message',raw=>{const packet=JSON.parse(String(raw));packets.push(packet.type);const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
 if(packet.type==='auth'){ws.authed=true;send({type:'auth_response', studio_capabilities:{...contract,role:'capture'},status:'success',protocol:5,studio_revisions:true,studio_visuals:true,studio_shapes:true,studio_animation:true,studio_preset_metadata:true});}
 if(packet.type==='studio_get')send({type:'studio_config',document,revision:String(revision)});
 if(packet.type==='studio_set'){if(packet.base_revision!==String(revision)){send({type:'studio_conflict',document,revision:String(revision),request_id:packet.request_id});return;}document=documentSchema.parse(packet.document);revision++;for(const peer of wss.clients)if(peer.authed&&peer.readyState===1)peer.send(JSON.stringify({type:'studio_config',document,revision:String(revision),origin:packet.origin}));send({type:'studio_saved',request_id:packet.request_id,revision:String(revision)});}
}));
const browser=await chromium.launch({headless:true}),results=[],errors=[];
const check=async(name,run)=>{await run();results.push(name);console.log(`PASS ${name}`);};
async function open(source=initialDocument(),native=false){
 document=structuredClone(source);revision=0;packets=[];const context=await browser.newContext({viewport:{width:1560,height:1100},acceptDownloads:true});
 await context.addInitScript(({native})=>{
  if(!localStorage.getItem('studio.connection'))localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4622',token:'synthetic'}));
  if(native){
   window.nativeCalls=[];window.nativeFail=false;
   const defaults={host:'127.0.0.1',port:4622,auth_token:'synthetic-native-secret',http_enabled:true,http_port:5222,analog_keyboard:'',capture_enabled:false,key_whitelist:[],raw_mouse_min_delta:0,send_mouse_move:true,cpu_affinity:[0,1],linux_evdev_keyboard_device:'/dev/input/synthetic-unavailable',linux_raw_mouse_device:'/dev/input/synthetic-mouse',future:{value:'keep'}};
   window.__TAURI__={core:{invoke:async(command,args)=>{
    if(command==='get_config')return JSON.parse(localStorage.getItem('test.native.config')||JSON.stringify(defaults));
    if(command==='save_config'){window.nativeCalls.push({command,args});if(window.nativeFail)throw Error('synthetic disk failure');localStorage.setItem('test.native.config',JSON.stringify(args.newCfg));return;}
    if(command==='get_autostart')return false;if(command==='set_autostart'){window.nativeCalls.push({command,args});return true;}
    if(command==='enum_keyboards'||command==='enum_mice'||command==='check_linux_perms')return [];
    if(command==='get_device_status')return {keyboard_count:1,mouse_count:1,capture_running:false};return null;
   }}};
  }
 },{native});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:5222/');await expect(page.locator('.statusbar')).toContainText('Saved to capture server');return {context,page};
}
const select=async(page,name,section)=>{await page.getByRole('button',{name:'Studio',exact:true}).click();await page.locator('.layer-list').getByRole('button',{name,exact:true}).click();if(section)await page.getByRole('group',{name:'Property sections'}).getByRole('button',{name:section,exact:true}).click();};
const details=async(page,name)=>{const summary=page.getByText(name,{exact:true}).filter({visible:true});if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();};
const synced=page=>expect(page.locator('.statusbar')).toContainText('Saved to capture server');
async function exportJSON(page){await page.getByRole('button',{name:'Settings',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON',exact:true}).click();return parseDocument(await readFile(await(await downloading).path(),'utf8'));}
try {
 await check('all five modules open schema groups without changing configuration',async()=>{
  const source=initialDocument(),{context,page}=await open(source);
  for(const name of ['Keyboard','Mouse Buttons','Mouse Trail','Distance','Sensitivity']){await select(page,name,'All properties');expect(await page.locator('.properties-panel [data-setting-id]').count()).toBeGreaterThan(12);}
  await synced(page);expect(encodeDocument(document)).toEqual(encodeDocument(source));expect(revision).toBe(0);await context.close();
 });

 await check('geometry locks and limits preserve invalid drafts and restore one numeric gesture',async()=>{
  const {context,page}=await open();await select(page,'Keyboard','Position');const source=structuredClone(document);const width=page.getByLabel('Width',{exact:true});await width.fill('9999');await expect(width).toHaveAttribute('aria-invalid','true');await width.press('Enter');expect(encodeDocument(document)).toEqual(encodeDocument(source));await width.fill('310');await width.press('Enter');await synced(page);await page.getByRole('button',{name:'Undo',exact:true}).click();await synced(page);expect(encodeDocument(document)).toEqual(encodeDocument(source));await page.getByLabel('Lock position',{exact:true}).check();await expect(width).toBeDisabled();await expect(page.getByLabel('X',{exact:true})).toBeDisabled();await page.getByLabel('Lock position',{exact:true}).uncheck();await expect(width).toBeEnabled();await context.close();
 });
 await check('trail controls retain decimal origin, style and marker semantics',async()=>{
  const {context,page}=await open();await select(page,'Mouse Trail','All properties');await page.getByLabel('Style',{exact:true}).selectOption('Speed Gradient');await page.getByLabel('Thickness',{exact:true}).fill('3.5');await page.getByLabel('Origin X (0–1)',{exact:true}).fill('0,37');await page.getByLabel('Cursor marker',{exact:true}).selectOption('Crosshair');await details(page,'Speed gradient');await page.getByLabel('Speed color range',{exact:true}).fill('3.5');const saved=await exportJSON(page);expect(saved.profiles[0].modules.find(m=>m.type==='trail')).toMatchObject({trailStyle:'Speed Gradient',thickness:3.5,originX:.37,marker:'Crosshair',trailAppearance:{speedRange:3.5}});await context.close();
 });
 await check('distance and statistics controls retain captions, precision and visibility',async()=>{
  const {context,page}=await open();await select(page,'Distance','All properties');await page.getByLabel('Caption',{exact:true}).fill('TRAVEL');await page.getByLabel('Units',{exact:true}).selectOption('m');await page.getByLabel('Decimal places',{exact:true}).fill('2');await select(page,'Sensitivity','All properties');await page.getByLabel('Format',{exact:true}).selectOption('Detailed');await page.getByLabel('eDPI',{exact:true}).uncheck();await page.getByLabel('Text layout',{exact:true}).selectOption('Vertical');await synced(page);expect(document.profiles[0].modules.find(m=>m.type==='distance')).toMatchObject({caption:'TRAVEL',unit:'m',decimals:2});expect(document.profiles[0].modules.find(m=>m.type==='sensitivity')).toMatchObject({sensitivityStyle:'Detailed',showEdpi:false,textLayout:'Vertical'});await context.close();
 });
 await check('layout replaces keys atomically and Undo restores the complete prior layout',async()=>{
  const {context,page}=await open();await select(page,'Keyboard','Keys');const before=structuredClone(document);await page.getByLabel('Layout',{exact:true}).selectOption('WASD');await synced(page);expect(document.profiles[0].modules[0].keys).toHaveLength(4);await page.getByRole('button',{name:'Undo',exact:true}).click();await synced(page);expect(encodeDocument(document)).toEqual(encodeDocument(before));await context.close();
 });
 await check('key typography inherits, resets one stable parameter and preserves sibling overrides',async()=>{
  const {context,page}=await open();await select(page,'Keyboard','Keys');await page.getByLabel('Customize this key',{exact:true}).check();await details(page,'Text & typography');await expect(page.getByLabel('Key Show labels',{exact:true})).toBeChecked();await page.getByLabel('Key Font size',{exact:true}).fill('25');await page.getByLabel('Key Text outline',{exact:true}).fill('1.5');await page.getByLabel('Key Text outline',{exact:true}).press('Enter');await page.getByRole('button',{name:'Reset Key Font size to module',exact:true}).click();await synced(page);expect(document.profiles[0].modules[0].keys[0].style.fontSize).toBeUndefined();expect(document.profiles[0].modules[0].keys[0].style.textOutline).toBe(1.5);await context.close();
 });
 await check('game and overlay fields commit to their separate scopes',async()=>{const {context,page}=await open();await page.getByRole('button',{name:'Profiles',exact:true}).click();await page.getByLabel('Game',{exact:true}).selectOption('KovaaK’s');await page.getByLabel('Mouse DPI',{exact:true}).fill('1600');await page.getByLabel('In-game sensitivity',{exact:true}).fill('0.71');await page.getByLabel('Yaw factor / m_yaw',{exact:true}).fill('0.018');await page.getByLabel(/^Caption /).fill('My setup');await synced(page);const saved=await exportJSON(page);expect(saved.gameProfiles[0]).toMatchObject({game:'KovaaK’s',dpi:1600,sensitivity:.71,yaw:.018,scale:'Custom yaw'});expect(saved.profiles[0].caption).toBe('My setup');await context.close();});
 await check('exclusive positive schema bounds reject zero without adding an arbitrary precision floor',async()=>{
  const {context,page}=await open();await page.getByRole('button',{name:'Profiles',exact:true}).click();const input=page.getByLabel('Yaw factor / m_yaw',{exact:true}),before=structuredClone(document);await input.fill('0');await expect(input).toHaveAttribute('aria-invalid','true');await input.press('Enter');expect(encodeDocument(document)).toEqual(encodeDocument(before));await input.fill('0.00000001');await input.press('Enter');await synced(page);expect(document.gameProfiles[0].yaw).toBe(.00000001);await context.close();
 });
 await check('global distance settings use schema IDs and survive reload without touching totals',async()=>{
  const {context,page}=await open();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Keep total between launches',{exact:true}).check();await page.getByLabel('Reset when capture app starts',{exact:true}).check();await synced(page);expect(document.distance).toMatchObject({persist:true,resetOnStart:true});await page.reload();await synced(page);await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByLabel('Reset when capture app starts',{exact:true})).toBeChecked();await context.close();
 });
 await check('Capture schema fields are explicit-apply, secret-aware and preserve unavailable devices',async()=>{
  const {context,page}=await open(initialDocument(),true);await page.getByRole('button',{name:'Settings',exact:true}).click();await details(page,'Advanced capture settings');await expect(page.getByLabel('Capture server token',{exact:true})).toHaveAttribute('type','password');await expect(page.getByLabel('Analog keyboard',{exact:true})).toHaveValue('');await expect(page.getByLabel('Keyboard device',{exact:true})).toBeDisabled();await page.getByLabel('Raw mouse minimum delta',{exact:true}).fill('3');expect(await page.evaluate(()=>window.nativeCalls.length)).toBe(0);await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.nativeCalls.length)).toBe(1);const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.native.config')));expect(saved).toMatchObject({raw_mouse_min_delta:3,analog_keyboard:'',linux_evdev_keyboard_device:'/dev/input/synthetic-unavailable',future:{value:'keep'}});await page.reload();await synced(page);await page.getByRole('button',{name:'Settings',exact:true}).click();await details(page,'Advanced capture settings');await expect(page.getByLabel('Raw mouse minimum delta',{exact:true})).toHaveValue('3');await context.close();
 });
 await check('failed native Apply retains drafts and retry saves the same validated values',async()=>{
  const {context,page}=await open(initialDocument(),true);await page.getByRole('button',{name:'Settings',exact:true}).click();await details(page,'Advanced capture settings');await page.getByLabel('Raw mouse minimum delta',{exact:true}).fill('4');await page.evaluate(()=>{window.nativeFail=true;});await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect(page.locator('.native-config-error')).toContainText('could not be saved');await expect(page.getByLabel('Raw mouse minimum delta',{exact:true})).toHaveValue('4');expect(await page.evaluate(()=>localStorage.getItem('test.native.config'))).toBeNull();await page.evaluate(()=>{window.nativeFail=false;});await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('test.native.config')||'{}').raw_mouse_min_delta)).toBe(4);await context.close();
 });
 await check('native invalid lists do not alter the draft and autostart remains an immediate system action',async()=>{
  const {context,page}=await open(initialDocument(),true);await page.getByRole('button',{name:'Settings',exact:true}).click();await details(page,'Advanced capture settings');const list=page.getByLabel('Allowed input names',{exact:true});await list.fill('key_w, bad value');await expect(list).toHaveAttribute('aria-invalid','false');await list.fill('key_w, bad-value');await expect(list).toHaveAttribute('aria-invalid','true');await list.blur();await expect(list).toHaveValue('key_w, bad, value');await page.getByLabel('Start capture on login (saved immediately)',{exact:true}).check();await expect.poll(()=>page.evaluate(()=>window.nativeCalls.some(call=>call.command==='set_autostart'&&call.args.enabled))).toBe(true);await context.close();
 });
 await check('connection credentials and native configuration remain outside exported visual JSON',async()=>{
  const {context,page}=await open(initialDocument(),true),source=structuredClone(document),exported=JSON.stringify(await exportJSON(page));expect(encodeDocument(JSON.parse(exported))).toEqual(encodeDocument(source));expect(exported).not.toContain('synthetic-native-secret');expect(exported).not.toContain('cpu_affinity');expect(exported).not.toContain('studio.preferences');await context.close();
 });
 await check('complex editors are registered by stable IDs and opening them does not persist UI state',async()=>{
  const {context,page}=await open();const ids=await page.evaluate(async()=>{const {registeredSettingsViews}=await import('/src/settings-views.tsx');return registeredSettingsViews();});expect(ids).toEqual(expect.arrayContaining(['editor.canvas','editor.key-layout','editor.mouse-buttons','editor.shape-library','editor.key-recorder','editor.image-placement','editor.image-library','editor.shortcuts','editor.connection','editor.native-advanced']));await select(page,'Keyboard','All properties');await page.screenshot({path:fileURLToPath(new URL('schema-inspector.png',artifacts)),fullPage:true});expect(revision).toBe(0);await context.close();
 });
 await check('no browser exceptions',async()=>expect(errors).toEqual([]));
 await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{for(const context of browser.contexts())await context.close();await browser.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await vite.close();}
