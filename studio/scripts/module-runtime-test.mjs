import { chromium,expect } from './test-browser.mjs';
import { createServer } from 'vite';
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const artifacts=new URL('../artifacts/module-runtime/',import.meta.url);await mkdir(artifacts,{recursive:true});
const vite=await createServer({server:{host:'127.0.0.1',port:5223,strictPort:true},plugins:[{name:'module-runtime-probe',configureServer(server){server.middlewares.use('/__module_runtime.html',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__module_runtime.html','<html><body><div id="root"></div><script type="module" src="/scripts/fixtures/module-runtime.tsx"></script></body></html>'));});}}]});await vite.listen();
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:1000}}),results=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
const check=async(name,run)=>{await run();results.push(name);console.log(`PASS ${name}`);};
const call=(fn,arg)=>page.evaluate(({source,arg})=>Function('arg',`return (${source})(window.moduleRuntimeProbe,arg)`)(arg),{source:fn.toString(),arg});
try {
 await page.goto('http://127.0.0.1:5223/__module_runtime.html');await expect.poll(()=>page.evaluate(()=>!!window.moduleRuntimeProbe)).toBe(true);
 await check('geometry updates retain inherited language while an explicit locale change still applies',async()=>{
  const result=await call(async p=>{p.setup();const root=document.querySelector('[data-test-scene="new"]');const changes=[];const observer=new MutationObserver(records=>changes.push(...records));observer.observe(root,{attributes:true,attributeFilter:['lang']});p.mutate(d=>{d.profiles[0].modules[0].x+=10;});p.update();await Promise.resolve();const geometryChanges=changes.length;p.mutate(d=>{d.profiles[0].locale='ar';});p.update();await Promise.resolve();observer.disconnect();return {geometryChanges,localeChanges:changes.length,lang:root.lang,dir:root.dir};});
  expect(result).toEqual({geometryChanges:0,localeChanges:1,lang:'ar',dir:'ltr'});
 });
 await check('moving an ungrouped keyboard preserves key labels, DOM and held animation state',async()=>{
  await call(p=>{p.setup();p.mutate(d=>{const m=d.profiles[0].modules[0];d.profiles[0].modules=[m];Object.assign(m.appearance,{motion:'Scale',lighting:'Fill',pressDuration:0,releaseDuration:0});});p.input({event_type:'key_pressed',rawcode:87});p.tick();});
  const result=await call(async p=>{const group=document.querySelector('[data-test-scene="new"] .cap-layout'),key=group.querySelector('[data-key="87"]'),label=key.querySelector('.key-label').firstChild,changes=[];const observer=new MutationObserver(records=>changes.push(...records));observer.observe(group,{subtree:true,attributes:true,childList:true,characterData:true});p.mutate(d=>{d.profiles[0].modules[0].x+=10;});await Promise.resolve();observer.disconnect();return {changes:changes.length,sameLabel:key.querySelector('.key-label').firstChild===label,pressed:key.classList.contains('pressed'),transform:getComputedStyle(key).transform};});
  expect(result.changes).toBe(0);expect(result.sameLabel).toBe(true);expect(result.pressed).toBe(true);expect(result.transform).toMatch(/matrix\(0.92/);
 });
 await check('moving shared artwork updates both picture origins without replacing text or image nodes',async()=>{
  await call(p=>{p.setup();p.mutate(d=>{d.assets.synthetic=p.image();const first=d.profiles[0].modules[0],second=structuredClone(first);Object.assign(first,{x:100,y:100,w:300,h:300});Object.assign(second,{id:'second-keyboard',x:700,y:100,w:300,h:300});for(const m of [first,second])Object.assign(m.image,{enabled:true,assetId:'synthetic',groupId:'optimization-group'});d.profiles[0].modules=[first,second];});});
  const result=await call(async p=>{const modules=[...document.querySelector('[data-test-scene="new"]').children],labels=modules.map(m=>m.querySelector('.key-label').firstChild),planes=modules.map(m=>m.querySelector('.image-plane')),left=planes[1].style.left;p.mutate(d=>{d.profiles[0].modules[0].x+=20;});await Promise.resolve();return {sameLabels:modules.every((m,i)=>m.querySelector('.key-label').firstChild===labels[i]),samePlanes:modules.every((m,i)=>m.querySelector('.image-plane')===planes[i]),neighborRepositioned:planes[1].style.left!==left};});
  expect(result).toEqual({sameLabels:true,samePlanes:true,neighborRepositioned:true});
 });
 await check('shared assets remain leased while another active module uses them and release after the last hides',async()=>{
  await call(p=>{p.setup();p.mutate(d=>{d.assets.synthetic=p.image();for(const m of d.profiles[0].modules.filter(m=>m.type==='keyboard'||m.type==='mouse'))Object.assign(m.image,{enabled:true,assetId:'synthetic'});});});const before=await call(p=>p.state());
  await call(p=>p.mutate(d=>{d.profiles[0].modules[0].visible=false;}));expect((await call(p=>p.state())).revoked).toBe(before.revoked);
  await call(p=>p.mutate(d=>{d.profiles[0].modules.find(m=>m.type==='mouse').visible=false;}));expect((await call(p=>p.state())).revoked).toBe(before.revoked+1);
 });
 await check('hiding and reenabling a trail frees its canvas and stale movement while other modules stay live',async()=>{
  await call(p=>{p.setup();p.input({event_type:'mouse_moved',dx:20,dy:10});p.tick();});const canvas=await page.locator('[data-test-scene="new"] canvas').elementHandle();
  await call(p=>p.mutate(d=>{d.profiles[0].modules.find(m=>m.type==='trail').visible=false;}));expect(await canvas.evaluate(canvas=>[canvas.width,canvas.height,canvas.isConnected])).toEqual([0,0,false]);
  await call(p=>{p.input({event_type:'key_pressed',rawcode:87});p.tick();});await expect(page.locator('[data-test-scene="new"] [data-key="87"]')).toHaveClass(/pressed/);
  await call(p=>p.mutate(d=>{d.profiles[0].modules.find(m=>m.type==='trail').visible=true;}));expect(await page.locator('[data-test-scene="new"] canvas').evaluate((current,old)=>current===old,canvas)).toBe(false);
 });
 await check('registry disable and reenable dispose only the selected module and rebuild its current state',async()=>{
  await call(p=>{p.setup();p.enable('overlay.keyboard',false);});await expect(page.locator('[data-test-scene="new"] .module-keyboard .overlay-key')).toHaveCount(0);await expect(page.locator('[data-test-scene="new"] .module-mouse .overlay-key')).not.toHaveCount(0);
  await call(p=>{p.input({event_type:'key_pressed',rawcode:87});p.enable('overlay.keyboard',true);});await expect(page.locator('[data-test-scene="new"] [data-key="87"]')).toHaveClass(/pressed/);
 });
 await check('removal, type change and profile switch release previous module resources',async()=>{
  await call(p=>{p.setup();p.mutate(d=>{d.assets.synthetic=p.image();Object.assign(d.profiles[0].modules[0].image,{enabled:true,assetId:'synthetic'});});});const before=await call(p=>p.state());
  await call(p=>p.mutate(d=>{d.profiles[0].modules[0].type='distance';}));expect((await call(p=>p.state())).revoked).toBe(before.revoked+1);await expect(page.locator('[data-test-scene="new"] .module-keyboard .overlay-key')).toHaveCount(0);
  await call(p=>p.mutate(d=>{d.profiles[0].id='another-profile';d.profiles[0].modules=d.profiles[0].modules.filter(m=>m.type!=='trail');}));await expect(page.locator('[data-test-scene="new"] canvas')).toHaveCount(0);
 });
 await check('create/update/input/frame/preview/resize errors isolate the faulty module and clean resources',async()=>{
  for(const phase of ['create','update','input','frame','preview','resize']){
   await call((p,phase)=>{p.fault(phase);if(phase==='input'){p.input({event_type:'key_pressed',rawcode:87});p.tick();}if(phase==='resize')p.resize();},phase);
   const state=await call(p=>p.state());expect(state.failures).toContainEqual({type:'distance',phase});await call(p=>{p.event();p.input({event_type:'key_pressed',rawcode:87});p.tick();});await expect(page.locator('[data-test-scene="fault"] [data-key="87"]')).toHaveClass(/pressed/);expect((await call(p=>p.state())).events).toBe(0);
  }
 });
 await check('module-owned event and timer errors are isolated and the remaining modules keep rendering',async()=>{
  for(const phase of ['resource-event','resource-timer']){await call((p,phase)=>p.fault(phase),phase);if(phase==='resource-event')await call(p=>p.event());else await page.waitForTimeout(80);expect((await call(p=>p.state())).failures).toContainEqual({type:'distance',phase:'resource'});await call(p=>{p.input({event_type:'key_pressed',rawcode:87});p.tick();});await expect(page.locator('[data-test-scene="fault"] [data-key="87"]')).toHaveClass(/pressed/);}
 });
 await check('dispose failures still release leases/listeners/timers and an empty hidden scene stops scheduling',async()=>{
  await call(p=>{p.fault('dispose');p.enable('overlay.distance',false);p.event();});let state=await call(p=>p.state());expect(state.failures).toContainEqual({type:'distance',phase:'dispose'});expect(state.events).toBe(0);await page.waitForTimeout(80);expect((await call(p=>p.state())).timers).toBe(0);
  await call(p=>p.mutate(d=>{for(const m of d.profiles[0].modules)m.visible=false;}));await call(p=>{p.input({event_type:'mouse_moved',dx:10,dy:5});p.tick();p.tick();});expect((await call(p=>p.state())).pendingFrames).toBe(0);
 });
 await check('all scenes dispose idempotently with balanced image URLs and no engine/frame subscriptions',async()=>{
  await call(p=>{p.clear();p.clear();});const state=await call(p=>p.state());expect(state.listeners).toBe(0);expect(state.pendingFrames).toBe(0);expect(state.created).toBe(state.revoked);
 });
 await check('an additional registered module supplies its inspector and output through the v2 adapter',async()=>{
  await call(p=>p.probe());await page.getByRole('button',{name:'Probe settings',exact:true}).click();await page.getByLabel('Caption',{exact:true}).fill('PROBE');await page.getByLabel('Caption',{exact:true}).press('Enter');await expect(page.locator('[data-test-scene="probe"]')).toHaveText('Registered output: PROBE');
  await call(p=>p.probeDisable());await expect(page.locator('[data-test-scene="probe"]')).toHaveText('');await call(p=>p.probeEnable());await expect(page.locator('[data-test-scene="probe"]')).toHaveText('Registered output: PROBE');await page.screenshot({path:fileURLToPath(new URL('registered-module.png',artifacts)),fullPage:true});
 });
 await check('a failed registered inspector is contained and common properties stay available',async()=>{
  await call(p=>p.probePanelError(true));await expect(page.getByRole('alert')).toContainText('Other modules remain available');await page.getByRole('button',{name:'Position',exact:true}).click();await expect(page.getByLabel('Width',{exact:true})).toBeVisible();await call(p=>p.probePanelError(false));await page.getByRole('button',{name:'Probe settings',exact:true}).click();await page.getByRole('button',{name:'Retry module editor',exact:true}).click();await expect(page.getByLabel('Caption',{exact:true})).toHaveValue('PROBE');
 });
 await check('a failed registered canvas editor is contained without losing inspector state or the renderer',async()=>{
  await call(p=>p.probeCanvasError(true));await expect(page.getByTestId('canvas-probe').getByRole('alert')).toContainText('Other modules remain available');await expect(page.getByLabel('Caption',{exact:true})).toHaveValue('PROBE');await expect(page.locator('[data-test-scene="probe"]')).toHaveText('Registered output: PROBE');await call(p=>p.probeCanvasError(false));await page.getByTestId('canvas-probe').getByRole('button',{name:'Retry module editor',exact:true}).click();await expect(page.getByTestId('canvas-probe')).toHaveText('Registered canvas editor ready');
 });
 await check('no unexpected browser exceptions',async()=>expect(errors).toEqual([]));
 await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{await browser.close();await vite.close();}
