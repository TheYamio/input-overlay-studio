import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'vite';
import {WebSocketServer} from 'ws';
import {mkdir,writeFile} from 'node:fs/promises';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const vite=await createServer({server:{host:'127.0.0.1',port:5284,strictPort:true}});await vite.listen();
const wss=new WebSocketServer({host:'127.0.0.1',port:4684}),document=encodeDocument(initialDocument());let authentications=0;
wss.on('connection',ws=>ws.on('message',raw=>{const packet=JSON.parse(String(raw));if(packet.type==='auth'){authentications++;ws.send(JSON.stringify({type:'auth_response',status:'success',protocol:5,studio_capabilities:{...contract,role:'capture'}}));}if(packet.type==='studio_get')ws.send(JSON.stringify({type:'studio_config',document,revision:'boundary-r1',config_sequence:1}));}));
const heartbeat=setInterval(()=>{for(const ws of wss.clients)if(ws.readyState===1)ws.send(JSON.stringify({type:'heartbeat'}));},1000);
const browser=await chromium.launch({headless:true}),errors=[],results=[];
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
const open=async(native,startup=false)=>{
 const context=await browser.newContext({viewport:{width:1366,height:900}});
 await context.addInitScript(({native,startup})=>{
  localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4684',token:'boundary-test'}));
  const setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.failConnectionSave&&key==='studio.connection')throw Error('private quota detail');return setItem.call(this,key,value);};
  if(native){window.nativeCalls=[];window.nativeMode='success';window.nativeConfig={host:'127.0.0.1',port:4684,auth_token:'boundary-test',http_enabled:true,http_port:5284,analog_keyboard:'',capture_enabled:false,key_whitelist:[],raw_mouse_min_delta:0,send_mouse_move:true,cpu_affinity:[],linux_evdev_keyboard_device:'',linux_raw_mouse_device:'',future:{data:['keep']}};
   window.__TAURI__={core:{invoke:async(command,args)=>{
    if(command==='get_config')return structuredClone(window.nativeConfig);
    if(command==='get_startup_warning'&&startup)return {code:'native-startup-invalid'};
    if(command==='save_config'){window.nativeCalls.push(structuredClone(args));if(window.nativeMode==='storage')throw Error('PRIVATE-TOKEN-PATH');if(window.nativeMode==='field')throw {code:'native-invalid-field',field:'auth_token',value:'PRIVATE-TOKEN-PATH'};window.nativeConfig=structuredClone(args.newCfg);return;}
    if(command==='get_http_status')return {running:true,bind_error:null,host:'127.0.0.1',port:5284,overlay_available:true};
    if(command==='get_device_status')return {keyboard_count:0,mouse_count:0,capture_running:false};
    if(command==='get_autostart')return false;if(['enum_keyboards','enum_mice','check_linux_perms'].includes(command))return [];return null;
   }}};
  }
 },{native,startup});
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:5284');await expect(page.locator('.topbar')).toContainText('Capture server connected');if(!startup)await page.locator('.navigation nav button').nth(3).click();return{page,context};
};
try{
 await check('startup recovery is visible from Studio and clears only after successful Apply',async()=>{
  const {page,context}=await open(true,true);await expect(page.locator('.native-startup-error')).toContainText('capture is disabled');await page.locator('.native-startup-error').getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('.native-config-error')).toContainText('original file is preserved');await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect(page.locator('.native-config-error')).toHaveCount(0);await page.locator('.navigation nav button').nth(0).click();await expect(page.locator('.native-startup-error')).toHaveCount(0);await context.close();
 });
 await check('connection storage failure keeps the saved endpoint and live connection; retry commits once',async()=>{
  const {page,context}=await open(false),before=authentications,saved=await page.evaluate(()=>localStorage.getItem('studio.connection'));
  await page.evaluate(()=>{window.failConnectionSave=true;});await page.getByLabel('Server address',{exact:true}).fill('ws://127.0.0.1:4684/changed');await page.getByRole('button',{name:'Save & reconnect',exact:true}).click();
  await expect(page.locator('.connection-settings-error')).toHaveText('Connection storage is unavailable');expect(authentications).toBe(before);expect(await page.evaluate(()=>localStorage.getItem('studio.connection'))).toBe(saved);await expect(page.locator('.topbar')).toContainText('Capture server connected');
  await page.evaluate(()=>{window.failConnectionSave=false;});await page.getByRole('button',{name:'Save & reconnect',exact:true}).click();await expect(page.locator('.connection-settings-error')).toHaveCount(0);await expect.poll(()=>authentications).toBe(before+1);expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('studio.connection'))).url).toBe('ws://127.0.0.1:4684/changed');await context.close();
 });
 await check('full Capture validation rejects port collisions and invalid hosts before bridge calls',async()=>{
  const {page,context}=await open(true),saved=await page.evaluate(()=>JSON.stringify(window.nativeConfig));
  await page.getByLabel('HTTP port',{exact:true}).fill('4684');await page.getByLabel('HTTP port',{exact:true}).press('Enter');await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect(page.locator('.native-config-error')).toContainText('different ports');expect(await page.evaluate(()=>window.nativeCalls.length)).toBe(0);
  await page.getByLabel('HTTP port',{exact:true}).fill('5284');await page.getByLabel('HTTP port',{exact:true}).press('Enter');await page.getByLabel('Bind host (loopback by default)',{exact:true}).fill('ws://invalid/host');await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect(page.locator('.native-config-error')).toContainText('valid IP address');expect(await page.evaluate(()=>window.nativeCalls.length)).toBe(0);expect(await page.evaluate(()=>JSON.stringify(window.nativeConfig))).toBe(saved);await context.close();
 });
 await check('backend failure retains the draft and connection, localizes safe errors and permits retry',async()=>{
  const {page,context}=await open(true),saved=await page.evaluate(()=>JSON.stringify(window.nativeConfig)),before=authentications;
  await page.getByLabel('Bind host (loopback by default)',{exact:true}).fill('localhost');await page.evaluate(()=>{window.nativeMode='storage';});await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect(page.locator('.native-config-error')).toContainText('could not be saved');await expect(page.locator('.native-config-error')).not.toContainText('PRIVATE');expect(authentications).toBe(before);expect(await page.evaluate(()=>JSON.stringify(window.nativeConfig))).toBe(saved);await expect(page.getByLabel('Bind host (loopback by default)',{exact:true})).toHaveValue('localhost');
  await page.locator('[data-studio-language]').selectOption('ru');await page.evaluate(()=>{window.nativeMode='field';});await page.getByRole('button',{name:'Применить настройки сервера',exact:true}).click();await expect(page.locator('.native-config-error')).toContainText('Проверьте настройку захвата:');await expect(page.locator('.native-config-error')).not.toContainText('{{');await expect(page.locator('.native-config-error')).not.toContainText('PRIVATE');
  await page.locator('[data-studio-language]').selectOption('en');await page.getByLabel('Bind host (loopback by default)',{exact:true}).fill('127.0.0.1');await page.evaluate(()=>{window.nativeMode='success';});await page.getByRole('button',{name:'Apply server settings',exact:true}).click();await expect(page.locator('.native-config-error')).toHaveCount(0);expect(await page.evaluate(()=>window.nativeConfig.future)).toEqual({data:['keep']});await context.close();
 });
 expect(errors).toEqual([]);const artifacts=new URL('../artifacts/settings-boundary/',import.meta.url);await mkdir(artifacts,{recursive:true});await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results},null,2));
}finally{clearInterval(heartbeat);await browser.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await vite.close();}
