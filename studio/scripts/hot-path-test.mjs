import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
const vite=await createServer({server:{host:'127.0.0.1',port:5293,strictPort:true},plugins:[{name:'hot-path',configureServer(server){server.middlewares.use('/__hot_path.html',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__hot_path.html','<html><body><script type="module" src="/scripts/fixtures/hot-path.ts"></script></body></html>'));});}}]});await vite.listen();
const browser=await chromium.launch({headless:true}),context=await browser.newContext(),results=[],errors=[];let page;
const key='input-overlay-studio.document';const open=async()=>{page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:5293/__hot_path.html?probe');await expect.poll(()=>page.evaluate(()=>!!window.hotProbe)).toBe(true);};
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
try{
 await open();await page.evaluate(seed=>window.hotPath.startProbe(window.hotPath.prepare(seed).large),encodeDocument(initialDocument()));
 await check('large gestures journal every update and keep the full checkpoint unchanged until the boundary',async()=>{
  const state=await page.evaluate(key=>{const p=window.hotProbe,before=localStorage.getItem(key),opacity=p.settings.document.profiles[0].modules[0].opacity;p.settings.beginGesture('drag');for(let i=0;i<25;i++)p.settings.transaction(d=>{d.profiles[0].modules[0].opacity=.5+i/1000;});return {same:localStorage.getItem(key)===before,bytes:localStorage.getItem(key+'.draft').length,recovered:p.load().document.profiles[0].modules[0].opacity,opacity};},key);
  expect(state.same).toBe(true);expect(state.bytes).toBeLessThan(1000);expect(state.recovered).toBe(.524);
  await page.evaluate(()=>window.hotProbe.settings.endGesture());expect(await page.evaluate(key=>localStorage.getItem(key+'.draft'),key)).toBeNull();
  await page.evaluate(()=>window.hotProbe.settings.undo());expect(await page.evaluate(()=>window.hotProbe.load().document.profiles[0].modules[0].opacity)).toBe(state.opacity);
  await page.evaluate(()=>window.hotProbe.settings.redo());expect(await page.evaluate(()=>window.hotProbe.load().document.profiles[0].modules[0].opacity)).toBe(.524);
 });
 await check('page reload checkpoints the latest gesture and restores the exact draft',async()=>{
  await page.evaluate(()=>{const p=window.hotProbe;p.settings.beginGesture('typing');p.settings.transaction(d=>{d.profiles[0].name='Durable reload';});});await page.reload();await expect.poll(()=>page.evaluate(()=>window.hotProbe?.settings.document.profiles[0].name)).toBe('Durable reload');
 });
 await check('a closed realm recovers its journal even when lifecycle checkpoint hooks never run',async()=>{
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.evaluate(()=>{const p=window.hotProbe;p.detach();p.settings.beginGesture('crash');p.settings.transaction(d=>{d.profiles[0].name='Journal recovery';});});await page.close();await open();
  expect(await page.evaluate(()=>window.hotProbe.settings.document.profiles[0].name)).toBe('Journal recovery');expect(await page.evaluate(()=>window.hotProbe.settings.getSnapshot().pending)).toBe(true);
 });
 await check('journal quota failures retain the visible draft and explicit Save retries synchronously',async()=>{
  const state=await page.evaluate(key=>{const native=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key+'.draft')throw Error('quota');return native.call(this,k,v);};const p=window.hotProbe;p.settings.beginGesture('quota');p.settings.transaction(d=>{d.profiles[0].name='Quota draft';});const status=p.settings.getSnapshot().saveStatus;Storage.prototype.setItem=native;const saved=p.settings.save();return {status,saved,recovered:p.load().document.profiles[0].name};},key);
  expect(state).toEqual({status:'Local save failed',saved:true,recovered:'Quota draft'});
 });
 await check('conflict journals retain their CAS base and server resolution remains undoable',async()=>{
  const state=await page.evaluate(()=>{const p=window.hotProbe;p.settings.connect({url:'ws://benchmark',token:''});p.transport.onDocument(structuredClone(p.settings.document),'r1');p.settings.beginGesture('conflict');p.settings.transaction(d=>{d.profiles[0].name='Local conflict';});const remote=structuredClone(p.settings.document);remote.profiles[0].name='Remote conflict';p.transport.onConflict(remote,'r2');const base=p.load().sync.baseRevision;p.settings.resolveConflict('server');const server=p.load().document.profiles[0].name;p.settings.undo();return {base,server,undo:p.load().document.profiles[0].name,undoBase:p.load().sync.baseRevision};});
  expect(state).toEqual({base:'r1',server:'Remote conflict',undo:'Local conflict',undoBase:'r2'});
 });
 expect(errors).toEqual([]);const target=new URL('../artifacts/hot-path/',import.meta.url);await mkdir(target,{recursive:true});await writeFile(new URL('results.json',target),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{await context.close();await browser.close();await vite.close();}
