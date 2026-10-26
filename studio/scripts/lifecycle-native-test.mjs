// Compiled Windows server + browser Runtime. No physical input is simulated.
import {chromium,expect} from './test-browser.mjs';
import {spawn} from 'node:child_process';
import {connect as tcpConnect,createServer} from 'node:net';
import WebSocket from 'ws';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};

const root=new URL('../../',import.meta.url),data=new URL(`.tools/lifecycle-native/run-${Date.now()}/`,root),artifacts=new URL('../artifacts/lifecycle-native/',import.meta.url);
await mkdir(data,{recursive:true});await mkdir(artifacts,{recursive:true});
const endpoint='ws://127.0.0.1:4689',http='http://127.0.0.1:5289',token='lifecycle-isolated-fixture';
await writeFile(new URL('config.json',data),JSON.stringify({host:'127.0.0.1',port:4689,http_enabled:true,http_port:5289,auth_token:token,capture_enabled:false,cpu_affinity:[]}));
const exe=process.env.STUDIO_NATIVE_EXE||fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe',root));
const sockets=[],results=[],errors=[],skipped=[];let child,browser;
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
const client=async role=>{
 const ws=new WebSocket(endpoint),messages=[];sockets.push(ws);ws.on('error',()=>{});ws.on('message',data=>messages.push(JSON.parse(String(data))));
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 const send=value=>ws.send(JSON.stringify(value));send({type:'auth',token,studio_client:{...contract,role}});
 await expect.poll(()=>messages.some(m=>m.type==='auth_response')).toBe(true);
 return {ws,messages,send,last:type=>messages.findLast(m=>m.type===type)};
};
const tcp=async()=>{const socket=tcpConnect(5289,'127.0.0.1');sockets.push(socket);socket.on('error',()=>{});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});return socket;};
const response=socket=>new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('HTTP response deadline exceeded')),7500);socket.on('data',data=>text+=data);socket.once('close',()=>{clearTimeout(timer);resolve(text);});});
// A separate Node listener/client distinguishes OS IPv6 restrictions from app failures.
const ipv6Prerequisite=()=>new Promise((resolve,reject)=>{
 const listener=createServer(socket=>socket.end());let client;
 const finish=error=>{client?.destroy();listener.close();if(!error)resolve(true);else if(['EACCES','EAFNOSUPPORT','EADDRNOTAVAIL','ENETUNREACH'].includes(error.code))resolve(error.code);else reject(error);};
 listener.once('error',finish);listener.listen(0,'::1',()=>{client=tcpConnect(listener.address().port,'::1');client.once('connect',()=>finish());client.once('error',finish);});
});
try{
 child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data),WEBVIEW2_USER_DATA_FOLDER:fileURLToPath(new URL('webview/',data))}});
 await expect.poll(async()=>{try{return(await fetch(`${http}/studio/index.html`)).status;}catch{return 0;}},{timeout:25000}).toBe(200);
 const studio=await client('studio');studio.send({type:'studio_get'});await expect.poll(()=>!!studio.last('studio_config')).toBe(true);
 studio.send({type:'studio_set',document:encodeDocument(initialDocument()),base_revision:studio.last('studio_config').revision,request_id:1});await expect.poll(()=>studio.last('studio_saved')?.request_id).toBe(1);
 browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${http}/studio/overlay.html#ws=${encodeURIComponent(endpoint)}&token=${token}`);
 await check('actual browser Runtime renders and confirms the document',async()=>{await expect(page.locator('.overlay-key').first()).toBeAttached();await expect.poll(()=>studio.last('connection_status')?.runtimes.ready).toBe(1);});
 await check('nonreading abusive Runtime is bounded while browser Runtime stays ready',async()=>{
  const slow=await client('runtime');slow.send({type:'studio_get'});await expect.poll(()=>!!slow.last('studio_config')).toBe(true);
  slow.send({type:'runtime_ready',revision:slow.last('studio_config').revision,state:'ready'});await expect.poll(()=>studio.last('connection_status')?.runtimes.ready).toBe(2);
  slow.ws._socket.pause();for(let i=0;i<40;i++)slow.send({type:'input_snapshot'});
  await expect.poll(()=>studio.last('connection_status')?.runtimes,{timeout:8000}).toEqual({connected:1,ready:1,failed:0,unresponsive:0});slow.ws.terminate();
  const document=encodeDocument(initialDocument());document.profiles[0].name='Healthy after overload';studio.send({type:'studio_set',document,base_revision:studio.last('studio_saved').revision,request_id:2});
  await expect.poll(()=>studio.last('studio_saved')?.request_id).toBe(2);await expect.poll(()=>studio.last('connection_status')?.runtimes.ready).toBe(1);
 });
 await check('incomplete slow HTTP header does not block ordinary static requests and expires',async()=>{
  const slow=await tcp(),done=response(slow);slow.write('GET /studio/index.html HTTP/1.1\r\nHost: localhost\r\nX-Slow: ');
  for(let i=0;i<3;i++)expect((await fetch(`${http}/studio/overlay.html`)).status).toBe(200);
  expect(await done).toContain('408 Request Timeout');
 });
 await check('oversized URI and header are rejected without breaking static service',async()=>{
  for(const [request,status] of [[`GET /${'x'.repeat(5000)} HTTP/1.1\r\n\r\n`,'414'],[`GET / HTTP/1.1\r\nX: ${'x'.repeat(5000)}\r\n\r\n`,'431']]){const socket=await tcp(),done=response(socket);socket.write(request);expect(await done).toContain(` ${status} `);}
  expect((await fetch(`${http}/studio/index.html`)).status).toBe(200);expect(studio.last('connection_status').runtimes.ready).toBe(1);
 });
 const ipv6=await ipv6Prerequisite();
 if(ipv6===true)await check('IPv6 loopback binds both native services and accepts bracketed client URLs',async()=>{
  await browser.close();browser=undefined;
  for(const socket of sockets){if(socket instanceof WebSocket)socket.terminate();else socket.destroy();}
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
  await writeFile(new URL('config.json',data),JSON.stringify({host:'::1',port:4689,http_enabled:true,http_port:5289,auth_token:token,capture_enabled:false,cpu_affinity:[]}));
  child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data),WEBVIEW2_USER_DATA_FOLDER:fileURLToPath(new URL('webview/',data))}});
  await expect.poll(async()=>{try{return(await fetch('http://[::1]:5289/studio/index.html')).status;}catch{return 0;}},{timeout:25000}).toBe(200);
  const ws=new WebSocket('ws://[::1]:4689'),messages=[];sockets.push(ws);ws.on('error',()=>{});ws.on('message',data=>messages.push(JSON.parse(String(data))));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.send(JSON.stringify({type:'auth',token,studio_client:{...contract,role:'studio'}}));
  await expect.poll(()=>messages.some(m=>m.type==='auth_response'&&m.status==='success')).toBe(true);
  ws.send(JSON.stringify({type:'studio_get'}));await expect.poll(()=>messages.findLast(m=>m.type==='studio_config')?.document?.profiles[0]?.name).toBe('Healthy after overload');
 });
 else{skipped.push({name:'native IPv6 loopback',reason:`Independent Node IPv6 self-test: ${ipv6}`});console.log('SKIP native IPv6 loopback: '+ipv6);}
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,skipped,errors},null,2));
}finally{
 await browser?.close();for(const socket of sockets){if(socket instanceof WebSocket)socket.terminate();else socket.destroy();}
 if(child?.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
}
