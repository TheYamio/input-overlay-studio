// Connection indicators in the real editor, with a controlled authenticated server.
import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'vite';
import {WebSocketServer} from 'ws';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const vite=await createServer({server:{host:'127.0.0.1',port:5277,strictPort:true}});await vite.listen();
const wss=new WebSocketServer({host:'127.0.0.1',port:4677});
let document=encodeDocument(initialDocument()),revision=1,sequence=0,holdSave=false,pendingSave,allowAuth=true,advertise=true;
let report={capture_enabled:true,capture_running:true,runtimes:{connected:0,ready:0,failed:0,unresponsive:0}};
const send=(ws,m)=>{if(ws.readyState===1)ws.send(JSON.stringify(m));};
const status=patch=>{report={...report,...patch};sequence++;for(const ws of wss.clients)if(ws.authed)send(ws,{type:'connection_status',sequence,...report});};
wss.on('connection',ws=>ws.on('message',raw=>{
 const m=JSON.parse(String(raw));
 if(m.type==='auth'){ws.authed=allowAuth;const features={...contract.features};if(!advertise)delete features['runtime.status'];send(ws,{type:'auth_response',status:ws.authed?'success':'failed',protocol:5,studio_capabilities:{...contract,features,role:'capture'}});if(ws.authed)send(ws,{type:'connection_status',sequence,...report});return;}
 if(!ws.authed)return;
 if(m.type==='studio_get')send(ws,{type:'studio_config',document,revision:String(revision)});
 if(m.type==='studio_set'){const commit=()=>{document=m.document;revision++;send(ws,{type:'studio_saved',request_id:m.request_id,revision:String(revision)});};if(holdSave)pendingSave=commit;else commit();}
}));
const heartbeat=setInterval(()=>{for(const ws of wss.clients)if(ws.authed)send(ws,{type:'heartbeat'});},1000);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),results=[],errors=[];
await context.addInitScript(()=>localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4677',token:'connection-fixture'})));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const part=id=>page.locator(`[data-connection-part=${id}]`),state=(id,value)=>expect(part(id)).toHaveAttribute('data-connection-state',value);
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
const runtimes=(connected,ready=0,failed=0,unresponsive=0)=>status({runtimes:{connected,ready,failed,unresponsive}});
const artifacts=new URL('../artifacts/connection-status/',import.meta.url);await mkdir(artifacts,{recursive:true});
try{
 await page.goto('http://127.0.0.1:5277');
 await check('saving to Capture does not claim a connected overlay',async()=>{await state('save','Saved to capture server');await state('capture','active');await state('runtime','none');});
 await check('source loading, current profile, failure, partial and timeout are independent',async()=>{
  runtimes(1);await state('runtime','loading');runtimes(1,1);await state('runtime','ready');
  status({capture_enabled:false,capture_running:false});await state('capture','disabled');await state('runtime','ready');
  runtimes(1,0,1);await state('runtime','error');runtimes(2,1,1);await state('runtime','partial');await expect(part('runtime')).toContainText('(1/2)');
  runtimes(1,0,0,1);await state('runtime','unresponsive');runtimes(1,1);await state('runtime','ready');
  status({capture_enabled:true,capture_running:false});await state('capture','unavailable');
 });
 await check('unsaved local edits cannot display a current overlay profile',async()=>{
  holdSave=true;await page.getByRole('button',{name:'Profiles',exact:true}).click();await page.getByLabel('Profile name',{exact:true}).fill('Pending status fixture');await state('runtime','changes');await expect(part('runtime')).toHaveAttribute('data-tone','warning');
  await expect.poll(()=>!!pendingSave).toBe(true);holdSave=false;pendingSave();await state('save','Saved to capture server');await state('runtime','ready');
 });
 await check('footer and connection explanations fit all bundled languages and short windows',async()=>{
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  for(const locale of ['en','ru','de','fr','es','pt-br','tr','pl','ja','ko','zh-cn','zh-tw']){
   await page.locator('.language-settings select').selectOption(locale);
   for(const [width,height] of [[1440,900],[910,512],[820,614]]){
    await page.setViewportSize({width,height});
    const failure=await page.locator('.statusbar').evaluate(n=>{const r=n.getBoundingClientRect();return {overflow:n.scrollWidth>n.clientWidth+1,outside:r.bottom>innerHeight+1,parts:[...n.querySelectorAll('[data-connection-part]')].some(p=>{const b=p.getBoundingClientRect();return b.left<r.left-1||b.right>r.right+1||b.bottom>r.bottom+1;})};});
    expect(failure,`${locale} ${width}×${height}`).toEqual({overflow:false,outside:false,parts:false});
   }
  }
  await page.locator('.language-settings select').selectOption('ru');await expect(page.locator('.connection-details')).toContainText('Источник оверлея');
  await page.screenshot({path:fileURLToPath(new URL('compact-ru.png',artifacts))});await page.locator('.language-settings select').selectOption('en');
 });
 await check('disconnect and failed authentication clear the previous green state',async()=>{
  allowAuth=false;for(const ws of wss.clients)ws.terminate();await state('runtime','unknown');await expect(part('capture')).not.toHaveAttribute('data-connection-state','active');
  await expect(page.locator('.connection-badge')).toContainText('Authentication failed');await state('runtime','unknown');
 });
 await check('a server without the optional report leaves capture and source explicitly unknown',async()=>{
  allowAuth=true;advertise=false;await page.reload();await state('save','Saved to capture server');await state('capture','unknown');await state('runtime','unknown');
 });
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{clearInterval(heartbeat);await browser.close();for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await vite.close();}
