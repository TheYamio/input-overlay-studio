// Real compiled server + real Studio/overlay pages; only isolated synthetic data.
import {chromium,expect} from './test-browser.mjs';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const root=new URL('../../',import.meta.url),data=new URL(`.tools/connection-native/run-${Date.now()}/`,root),artifacts=new URL('../artifacts/connection-status-native/',import.meta.url);
await mkdir(data,{recursive:true});await mkdir(artifacts,{recursive:true});
await writeFile(new URL('config.json',data),JSON.stringify({host:'127.0.0.1',port:4678,http_enabled:true,http_port:5278,auth_token:'connection-native-fixture',capture_enabled:false,cpu_affinity:[]}));
const exe=process.env.STUDIO_NATIVE_EXE||fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe',root));
const endpoint='ws://127.0.0.1:4678',http='http://127.0.0.1:5278',sockets=[],results=[],errors=[];let child;
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}});
await context.addInitScript(()=>localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4678',token:'connection-native-fixture'})));
const start=async()=>{child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data),WEBVIEW2_USER_DATA_FOLDER:fileURLToPath(new URL('webview/',data))}});await expect.poll(async()=>{try{return(await fetch(`${http}/studio/index.html`)).status;}catch{return 0;}},{timeout:25000}).toBe(200);};
const stop=async()=>{for(const ws of sockets.splice(0))ws.terminate();if(child?.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}};
const connect=async(role,token='connection-native-fixture',capabilities=contract)=>{
 const ws=new WebSocket(endpoint),messages=[];sockets.push(ws);ws.on('message',raw=>messages.push(JSON.parse(String(raw))));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 ws.send(JSON.stringify({type:'auth',token,studio_client:{...capabilities,role}}));await expect.poll(()=>messages.some(m=>m.type==='auth_response')).toBe(true);
 return {ws,messages,send:m=>ws.send(JSON.stringify(m)),last:type=>messages.findLast(m=>m.type===type)};
};
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
const get=async c=>{const n=c.messages.filter(m=>m.type==='studio_config').length;c.send({type:'studio_get'});await expect.poll(()=>c.messages.filter(m=>m.type==='studio_config').length).toBe(n+1);return c.last('studio_config');};
const ack=(c,revision,state='ready')=>c.send({type:'runtime_ready',revision,state});
const close=async c=>{if(c.ws.readyState===3)return;const done=new Promise(r=>c.ws.once('close',r));c.ws.close();await done;};
let observer,bare,revision,studio;
const counts=async value=>{await expect.poll(()=>observer.last('connection_status')?.runtimes,{timeout:20000}).toEqual(value);};
const expected=(connected,ready=0,failed=0,unresponsive=0)=>({connected,ready,failed,unresponsive});
const page=async url=>{const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);return p;};
const overlay=()=>page(`${http}/studio/overlay.html#ws=${encodeURIComponent(endpoint)}&token=connection-native-fixture`);
try{
 await start();observer=await connect('studio');
 await check('a fresh server has no source, capture is disabled and Studio is not a Runtime',async()=>{await counts(expected(0));expect(observer.last('connection_status')).toMatchObject({capture_enabled:false,capture_running:false});expect((await get(observer)).document).toBeNull();});
 await check('failed authentication and incompatible Runtime cannot claim a connected source',async()=>{const rejected=await connect('runtime','incorrect-fixture');expect(rejected.last('auth_response').status).toBe('failed');const incompatible=await connect('runtime',undefined,{...contract,protocolVersion:99});await get(incompatible);await close(incompatible);await get(observer);await counts(expected(0));});
 await check('an empty profile and unauthorised ready messages cannot mark Runtime ready',async()=>{bare=await connect('runtime');await counts(expected(1));const empty=await get(bare);expect(empty.document).toBeNull();ack(bare,empty.revision);ack(observer,empty.revision);await get(observer);await counts(expected(1));revision=empty.revision;});
 let real;
 await check('the first profile broadcast reaches an already waiting overlay and confirms its first frame',async()=>{real=await overlay();await counts(expected(2));observer.send({type:'studio_set',document:encodeDocument(initialDocument()),base_revision:revision,request_id:1,origin:'connection-fixture'});await expect.poll(()=>observer.last('studio_saved')?.request_id).toBe(1);revision=observer.last('studio_saved').revision;await counts(expected(2,1));await expect(real.locator('.overlay-key').first()).toBeAttached();ack(bare,revision);await counts(expected(2,2));});
 await check('wrong revisions and failed rendering remain distinct from loading and readiness',async()=>{ack(bare,'wrong-revision','error');await get(observer);await counts(expected(2,2));ack(bare,revision,'error');await counts(expected(2,1,1));ack(bare,revision);await counts(expected(2,2));});
 await check('a silent connected source expires while an actual idle overlay keeps its heartbeat confirmation',async()=>{await counts(expected(2,1,0,1));ack(bare,revision);await counts(expected(2,2));await close(bare);await counts(expected(1,1));});
 await check('real Studio shows saved Capture and applied Runtime separately, including updated profiles',async()=>{
  studio=await page(`${http}/studio/index.html`);const part=id=>studio.locator(`[data-connection-part=${id}]`);
  await expect(part('save')).toContainText('Saved to capture server');await expect(part('capture')).toHaveAttribute('data-connection-state','disabled');await expect(part('runtime')).toHaveAttribute('data-connection-state','ready');
  await studio.getByRole('button',{name:'Profiles',exact:true}).click();await studio.getByLabel('Profile name',{exact:true}).fill('Native connection stage');await studio.getByRole('button',{name:'Save profile',exact:true}).click();await expect(part('save')).toHaveAttribute('data-connection-state','Saved to capture server');await expect(part('runtime')).toHaveAttribute('data-connection-state','ready');
  expect(JSON.parse(await readFile(new URL('studio.json',data),'utf8')).gameProfiles[0].name).toBe('Native connection stage');
 });
 await check('multiple real sources connect and disconnect without counting Studio or Demo',async()=>{const second=await overlay();await counts(expected(2,2));const demo=await page(`${http}/studio/overlay.html#demo=1`);await expect(demo.locator('.overlay-key').first()).toBeAttached();await get(observer);await counts(expected(2,2));await demo.close();await second.close();await counts(expected(1,1));await real.close();await counts(expected(0));await expect(studio.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','none');});
 await check('restart clears old source readiness and real Studio reconnects automatically',async()=>{await stop();await expect(studio.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','unknown');await start();await expect(studio.locator('[data-connection-part=save]')).toHaveAttribute('data-connection-state','Saved to capture server',{timeout:20000});await expect(studio.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','none');const reopened=await overlay();await expect(studio.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','ready');await studio.screenshot({path:fileURLToPath(new URL('native-status.png',artifacts))});await reopened.close();});
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{await browser.close();await stop();}
