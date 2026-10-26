import {expect} from '@playwright/test';
import WebSocket from 'ws';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const root=new URL('../../',import.meta.url),data=new URL(`.tools/settings-boundary-native/run-${Date.now()}/`,root);await mkdir(data,{recursive:true});
const exe=process.env.STUDIO_NATIVE_EXE||fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe',root));
const config={host:'127.0.0.1',port:4785,auth_token:'boundary-native-test',http_enabled:true,http_port:4786,capture_enabled:false,cpu_affinity:[]};
const document=JSON.parse(await readFile(new URL('ws-server/src-tauri/schema/default-current.json',root),'utf8'));document.distance={persist:true,resetOnStart:false};
const results=[],sockets=[];let child;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
const stop=async()=>{for(const ws of sockets.splice(0))ws.terminate();const process=child;child=undefined;if(process&&process.exitCode===null&&process.signalCode===null){const exit=new Promise(resolve=>process.once('exit',resolve));process.kill();await exit;}};
const start=async(httpPort=4786)=>{
 child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data)}});
 await expect.poll(async()=>{if(child.exitCode!==null)throw Error(`Native process exited: ${child.exitCode}`);try{return (await fetch(`http://127.0.0.1:${httpPort}/studio/overlay.html`)).status;}catch{return 0;}},{timeout:20000}).toBe(200);
};
const client=async(role,token='boundary-native-test',descriptor)=>{
 const ws=new WebSocket('ws://127.0.0.1:4785');sockets.push(ws);const packets=[];ws.on('message',raw=>packets.push(JSON.parse(raw.toString())));
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 const next=async type=>{for(let n=0;n<100;n++){const index=packets.findIndex(packet=>packet.type===type);if(index!==-1)return packets.splice(index,1)[0];await wait(30);}throw Error('Native packet timeout: '+type);};
 const send=packet=>ws.send(JSON.stringify(packet));send({type:'auth',token,...(role?{studio_client:descriptor??{...structuredClone(contract),role,document:{read:[4],write:role==='studio'?[4]:[]}}}:{})});
 const auth=await next('auth_response');return{ws,next,send,auth,get:async()=>{send({type:'studio_get'});return next('studio_config');}};
};
try{
 await writeFile(new URL('config.json',data),JSON.stringify(config));await writeFile(new URL('studio.json',data),JSON.stringify(document));await writeFile(new URL('distance.json',data),'42');await start();
 await check('empty and incorrect client tokens are rejected without exposing configuration',async()=>{
  for(const token of ['', 'incorrect-token']){const c=await client('studio',token);expect(c.auth.status).toBe('failed');c.ws.terminate();}
 });
 const studio=await client('studio');expect(studio.auth.status).toBe('success');
 await check('Runtime, legacy and incompatible Studio cannot run any global mutation',async()=>{
  const bad={...structuredClone(contract),role:'studio',document:{read:[4],write:[]}};
  for(const [role,descriptor]of [['runtime',undefined],[null,undefined],['studio',bad]]){
   const c=await client(role,'boundary-native-test',descriptor),before=await c.get(),bytes=await readFile(new URL('studio.json',data),'utf8');
   for(const packet of [{type:'distance_reset'},{type:'studio_set',document,base_revision:before.revision}]){c.send({...packet,request_id:10});const error=await c.next('studio_error');expect(error.code).toBe('command-forbidden');}
   expect(await readFile(new URL('distance.json',data),'utf8')).toBe('42');expect(await readFile(new URL('studio.json',data),'utf8')).toBe(bytes);expect((await c.get()).revision).toBe(before.revision);c.ws.terminate();
  }
 });
 await check('unknown commands are denied and Studio cannot impersonate Runtime readiness',async()=>{
  studio.send({type:'unknown-mutation',request_id:{private:'DO-NOT-ECHO'}});const error=await studio.next('studio_error');expect(error.code).toBe('unknown-command');expect(JSON.stringify(error)).not.toContain('DO-NOT-ECHO');
  studio.send({type:'runtime_ready',revision:'anything',state:'ready'});expect((await studio.next('studio_error')).code).toBe('command-forbidden');
 });
 await check('compatible Runtime can still read configuration and acknowledge a real source',async()=>{
  const runtime=await client('runtime'),current=await runtime.get();runtime.send({type:'runtime_ready',revision:current.revision,state:'ready'});
  await expect.poll(async()=>{const packet=await studio.next('connection_status');return packet.runtimes.ready;},{timeout:10000}).toBe(1);runtime.ws.terminate();
 });
 await check('compatible Studio can save a revision and reset persistent distance',async()=>{
  const current=await studio.get(),next=structuredClone(current.document);next.profiles[0].name='Boundary verified';studio.send({type:'studio_set',document:next,base_revision:current.revision,request_id:20});const saved=await studio.next('studio_saved');expect(saved.revision).not.toBe(current.revision);
  studio.send({type:'distance_reset'});await expect.poll(async()=>JSON.parse(await readFile(new URL('distance.json',data),'utf8'))).toBe(0);expect(JSON.parse(await readFile(new URL('studio.json',data),'utf8')).profiles[0].name).toBe('Boundary verified');
 });
 await stop();
 await check('an empty stored token is replaced once and only the generated token authenticates',async()=>{
  await writeFile(new URL('config.json',data),JSON.stringify({...config,auth_token:''}));await start();const stored=JSON.parse(await readFile(new URL('config.json',data),'utf8'));expect(stored.auth_token).toHaveLength(32);expect(stored.capture_enabled).toBe(false);const bad=await client('studio','arbitrary-token');expect(bad.auth.status).toBe('failed');const good=await client('studio',stored.auth_token);expect(good.auth.status).toBe('success');await stop();await start();expect(JSON.parse(await readFile(new URL('config.json',data),'utf8')).auth_token).toBe(stored.auth_token);await stop();
 });
 await check('invalid native settings preserve the original file and start without capture',async()=>{
  const raw=JSON.stringify({...config,cpu_affinity:[999]});await writeFile(new URL('config.json',data),raw);await start(4456);expect(await readFile(new URL('config.json',data),'utf8')).toBe(raw);
  const logs=(await readdir(new URL('logs/',data))).sort(),text=await readFile(new URL('logs/'+logs.at(-1),data),'utf8');expect(text).not.toContain('raw_input: started');await stop();
 });
 const artifacts=new URL('../artifacts/settings-boundary-native/',import.meta.url);await mkdir(artifacts,{recursive:true});await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results},null,2));
}finally{await stop();}
