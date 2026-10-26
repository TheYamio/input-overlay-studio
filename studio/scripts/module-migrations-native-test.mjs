// Actual compiled server, isolated data per builtin, no simulated physical input.
import {chromium,expect} from './test-browser.mjs';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const root=new URL('../../',import.meta.url),base=new URL(`.tools/module-migrations-native/run-${Date.now()}/`,root),artifacts=new URL('../artifacts/module-migrations-native/',import.meta.url);
await mkdir(base,{recursive:true});await mkdir(artifacts,{recursive:true});
const cases=JSON.parse(await readFile(new URL('ws-server/src-tauri/test-fixtures/module-migrations.json',root),'utf8'));
const exe=process.env.STUDIO_NATIVE_EXE||fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe',root)),endpoint='ws://127.0.0.1:4688',http='http://127.0.0.1:5288',token='module-migration-fixture';
const browser=await chromium.launch({headless:true}),results=[],errors=[],sockets=[];let child,page;
const start=async data=>{
 child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data),WEBVIEW2_USER_DATA_FOLDER:fileURLToPath(new URL('webview/',data))}});
 await expect.poll(async()=>{try{return(await fetch(`${http}/studio/overlay.html`)).status;}catch{return 0;}},{timeout:25000}).toBe(200);
};
const stop=async()=>{await page?.close();page=undefined;for(const socket of sockets.splice(0))socket.terminate();const process=child;child=undefined;if(process?.exitCode===null&&process.signalCode===null){const exited=new Promise(resolve=>process.once('exit',resolve));process.kill();await exited;}};
const studio=async()=>{
 const ws=new WebSocket(endpoint),messages=[];sockets.push(ws);ws.on('error',()=>{});ws.on('message',raw=>messages.push(JSON.parse(String(raw))));await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 const send=packet=>ws.send(JSON.stringify(packet)),last=type=>messages.findLast(message=>message.type===type);send({type:'auth',token,studio_client:{...contract,role:'studio'}});await expect.poll(()=>last('auth_response')?.status).toBe('success');return {send,last};
};
const overlay=async observer=>{page=await browser.newPage({viewport:{width:1000,height:600}});page.on('pageerror',error=>errors.push(error.message));await page.goto(`${http}/studio/overlay.html#ws=${encodeURIComponent(endpoint)}&token=${token}`);await expect.poll(()=>observer.last('connection_status')?.runtimes.ready,{timeout:15000}).toBe(1);};
try{
 for(const item of cases){
  const data=new URL(`${item.type}/`,base);await mkdir(data,{recursive:true});const original=JSON.stringify(item.legacy,null,1)+'\n';await writeFile(new URL('config.json',data),JSON.stringify({host:'127.0.0.1',port:4688,http_enabled:true,http_port:5288,auth_token:token,capture_enabled:false,cpu_affinity:[]}));await writeFile(new URL('studio.json',data),original);
  await start(data);let observer=await studio();observer.send({type:'studio_get'});await expect.poll(()=>!!observer.last('studio_config')).toBe(true);expect(observer.last('studio_config').document).toEqual(item.legacy);await overlay(observer);
  expect(await readFile(new URL('studio.json',data),'utf8')).toBe(original);
  const sequence=observer.last('connection_status').sequence;observer.send({type:'studio_set',document:item.legacy,base_revision:observer.last('studio_config').revision,request_id:1});await expect.poll(()=>observer.last('studio_saved')?.request_id).toBe(1);await expect.poll(()=>observer.last('connection_status')?.sequence>sequence&&observer.last('connection_status')?.runtimes.ready===1).toBe(true);
  expect(JSON.parse(await readFile(new URL('studio.json',data),'utf8'))).toEqual(item.current);expect(await readFile(new URL('studio.backup.json',data),'utf8')).toBe(original);
  await stop();await start(data);observer=await studio();observer.send({type:'studio_get'});await expect.poll(()=>!!observer.last('studio_config')).toBe(true);expect(observer.last('studio_config').document).toEqual(item.current);await overlay(observer);
  await stop();await writeFile(new URL('studio.json',data),'{');await start(data);observer=await studio();observer.send({type:'studio_get'});await expect.poll(()=>!!observer.last('studio_recovery')).toBe(true);const recovery=observer.last('studio_recovery');expect(recovery.backup).toEqual(item.legacy);
  observer.send({type:'studio_set',document:recovery.backup,base_revision:recovery.revision,request_id:2});await expect.poll(()=>observer.last('studio_saved')?.request_id).toBe(2);expect(JSON.parse(await readFile(new URL('studio.json',data),'utf8'))).toEqual(item.current);expect(await readFile(new URL('studio.invalid.json',data),'utf8')).toBe('{');await overlay(observer);
  const unknown=JSON.parse(await readFile(new URL('studio.json',data),'utf8')).profiles[0].modules[1];expect(unknown).toEqual(item.legacy.profiles[0].modules[1]);results.push(item.type);console.log(`PASS ${item.type}: old render, migration, exact backup, restart, recovery and opaque resources`);await stop();
 }
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{await stop();await browser.close();}
