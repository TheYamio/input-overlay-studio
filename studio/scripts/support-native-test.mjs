import supportConfig from '../src/core/support/config.json' with {type:'json'};
// Real native binary; isolated data and synthetic authenticated clients only.
import {chromium,expect} from './test-browser.mjs';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const root=new URL('../../',import.meta.url),data=new URL(`.tools/support-native/run-${Date.now()}/`,root),artifacts=new URL('../artifacts/support-native/',import.meta.url);
await mkdir(data,{recursive:true});await mkdir(artifacts,{recursive:true});
await writeFile(new URL('config.json',data),JSON.stringify({host:'127.0.0.1',port:4668,http_enabled:true,http_port:5269,auth_token:'support-native-fixture',capture_enabled:false,cpu_affinity:[]}));
await writeFile(new URL('studio.json',data),JSON.stringify(encodeDocument(initialDocument())));
const exe=process.env.STUDIO_NATIVE_EXE||fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe',root)),usage=new URL('studio-activity.json',data);let child;
const sockets=[],results=[],errors=[];const browser=await chromium.launch({headless:true});
const start=async()=>{child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data),WEBVIEW2_USER_DATA_FOLDER:fileURLToPath(new URL('webview/',data))}});await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:5269/studio/index.html')).status;}catch{return 0;}},{timeout:20000}).toBe(200);};
const stop=async()=>{for(const ws of sockets.splice(0))ws.terminate();if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}};
const connect=async(role,token='support-native-fixture')=>{const ws=new WebSocket('ws://127.0.0.1:4668'),messages=[];sockets.push(ws);ws.on('message',raw=>messages.push(JSON.parse(String(raw))));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.send(JSON.stringify({type:'auth',token,studio_client:{...contract,role}}));await expect.poll(()=>messages.some(m=>m.type==='auth_response')).toBe(true);return {ws,messages};};
const disk=async()=>JSON.parse(await readFile(usage,'utf8'));
const ready=async client=>{client.ws.send(JSON.stringify({type:'studio_get'}));await expect.poll(()=>client.messages.some(m=>m.type==='studio_config')).toBe(true);};
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
try{
 await start();
 await check('native app creates only a local aggregate and does not count Studio or failed authentication',async()=>{const before=await disk();expect(before.overlay_connections).toBe(0);const studio=await connect('studio');await ready(studio);await connect('runtime','incorrect-token');expect(await disk()).toEqual(before);expect(Object.keys(before).sort()).toEqual(['first_launched_at','last_counted_at','overlay_connections','version']);});
 await check('runtime counts only after receiving a real configuration and ignores reload storms',async()=>{const runtime=await connect('runtime');expect((await disk()).overlay_connections).toBe(0);await ready(runtime);await expect.poll(async()=>(await disk()).overlay_connections).toBe(1);await ready(runtime);const second=await connect('runtime');await ready(second);expect((await disk()).overlay_connections).toBe(1);});
 await stop();
 await check('native restart retains bounded usage and an older successful session can reach the threshold',async()=>{const before=await disk();await writeFile(usage,JSON.stringify({...before,first_launched_at:Date.now()-8*86400000,overlay_connections:2,last_counted_at:Date.now()-3600000}));await start();const runtime=await connect('runtime');await ready(runtime);await expect.poll(async()=>(await disk()).overlay_connections).toBe(3);});
 await check('compiled Studio shows configured services while OBS has no support content or local state',async()=>{const context=await browser.newContext({viewport:{width:1440,height:900}});await context.addInitScript(()=>localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4668',token:'support-native-fixture'})));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5269/studio/index.html');await expect(page.locator('.statusbar')).toContainText('Saved to capture server');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('.language-settings select').selectOption('ru');await page.locator('[data-action=support]').click();await expect(page.locator('.support-empty')).toHaveCount(0);await expect(page.locator('.support-provider')).toHaveCount(supportConfig.providers.length);for(const provider of supportConfig.providers)await expect(page.locator('.support-providers').getByRole('button',{name:provider.name,exact:true})).toBeVisible();await page.screenshot({path:fileURLToPath(new URL('compiled-support-ru.png',artifacts))});await page.goto('http://127.0.0.1:5269/studio/overlay.html#ws='+encodeURIComponent('ws://127.0.0.1:4668')+'&token=support-native-fixture');await expect(page.locator('.overlay-key').first()).toBeAttached();await expect(page.locator('[data-action=support],.support-page,.support-prompt')).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem('studio.support'))).toBeNull();await context.close();});
 await stop();
 await check('future usage metadata remains untouched and cannot be overwritten by runtime activity',async()=>{const raw='{"version":99,"future":true}\n';await writeFile(usage,raw);await start();await ready(await connect('runtime'));expect(await readFile(usage,'utf8')).toBe(raw);});
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{await browser.close();await stop();}
