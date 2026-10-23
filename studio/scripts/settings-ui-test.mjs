// Isolated synthetic storage and test-only React mount. Never loads user files.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument,encodeDocument } from '../src/core/config.ts';
const artifacts=new URL('../artifacts/settings-ui/',import.meta.url);await mkdir(artifacts,{recursive:true});
const vite=await createServer({server:{host:'127.0.0.1',port:5218,strictPort:true},plugins:[{name:'settings-probe',configureServer(server){server.middlewares.use('/__settings_probe.html',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__settings_probe.html','<html><head></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/settings-ui.tsx"></script></body></html>'));});}}]});await vite.listen();
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:1600}}),results=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
const check=async(name,run)=>{await run();results.push(name);console.log(`PASS ${name}`);};
const module=page.getByTestId('module'),key=page.getByTestId('key');
const action=(fn,arg)=>page.evaluate(({source,arg})=>Function('arg',`return (${source})(window.settingsProbe,arg)`)(arg),{source:fn.toString(),arg});
try {
 await page.goto('http://127.0.0.1:5218/__settings_probe.html');await expect(module.getByLabel('Module name',{exact:true})).toBeVisible();
 await check('all six standard controls derive their values and bounds without initial writes',async()=>{
  for(const id of ['overlay.instance.name','overlay.surface.accent','overlay.surface.radius','overlay.instance.opacity','overlay.instance.visible','render.performance.fps'])await expect(module.locator(`[data-setting-id="${id}"]`)).toBeVisible();
  expect(await action(p=>p.writes.length)).toBe(0);await expect(module.getByLabel('Module name',{exact:true})).not.toHaveAttribute('maxlength');await expect(module.getByLabel('Corner radius',{exact:true})).toHaveValue('12');
 });
 await check('schema number bounds reject invalid drafts and preserve last valid value',async()=>{
  const radius=module.getByLabel('Corner radius',{exact:true});await radius.fill('101');await expect(radius).toHaveAttribute('aria-invalid','true');expect(await action(p=>p.snapshot().profiles[0].modules[0].radius)).toBe(12);await radius.blur();await expect(radius).toHaveValue('12');
 });
 await check('integer schemas reject fractional values before they reach the settings service',async()=>{
  const layer=module.getByLabel('Layer',{exact:true}),before=await layer.inputValue();await layer.fill('1.5');await expect(layer).toHaveAttribute('aria-invalid','true');await layer.blur();await expect(layer).toHaveValue(before);expect(await action(p=>p.snapshot().profiles[0].modules[0].z)).toBe(Number(before));
 });
 await check('locale switch preserves numeric draft, focus, caret and schema ID',async()=>{
  const radius=module.getByLabel('Corner radius',{exact:true});await radius.fill('13,');await action(p=>p.locale('ru'));
  const translated=module.getByLabel('Радиус углов',{exact:true});await expect(translated).toHaveValue('13,');await expect(translated).toBeFocused();expect(await translated.evaluate(input=>input.selectionStart)).toBe(3);await translated.press('ArrowUp');await expect(translated).toHaveValue('14');await translated.press('Escape');await expect(translated).toHaveValue('12');
 });
 await check('missing translations fall back to English and enum labels never change persisted values',async()=>{
  await expect(module.getByLabel('Opacity',{exact:true})).toBeVisible();const fps=module.getByLabel('Частота анимации',{exact:true});await expect(fps.locator('option[value="Auto"]')).toHaveText('Авто');await fps.selectOption('60');expect(await action(p=>p.snapshot().performance.fps)).toBe('60');
 });
 await check('translated edits and reset operate on the same element inheritance',async()=>{
  await key.getByLabel('Акцент hex',{exact:true}).fill('#123456');await key.getByLabel('Акцент hex',{exact:true}).blur();await expect(key.locator('[data-setting-source="overridden"]')).toBeVisible();
  await key.getByRole('button',{name:'Сбросить Акцент к модулю',exact:true}).click();await expect(key.locator('[data-setting-source="inherited"]')).toBeVisible();expect(await action(p=>p.snapshot().profiles[0].modules[0].keys[0].style?.accent)).toBeUndefined();
 });
 await check('slider exact entry keeps percent formatting and a single undo gesture',async()=>{
  const opacity=module.getByLabel('Opacity value',{exact:true});await opacity.fill('42,5');await opacity.press('Enter');await expect(opacity).toHaveValue('42.5');expect(await action(p=>p.snapshot().profiles[0].modules[0].opacity)).toBe(.425);await action(p=>p.service.undo());await expect(opacity).toHaveValue('100');
 });
 await check('color drafts reject malformed hex and revert without a configuration write',async()=>{
  const hex=module.getByLabel('Акцент hex',{exact:true}),before=await action(p=>p.snapshot().profiles[0].modules[0].accent);await hex.fill('#bad');await expect(hex).toHaveAttribute('aria-invalid','true');await hex.press('Enter');await expect(hex).toHaveValue(before);
 });
 await check('conditional fields react to stable setting IDs',async()=>{
  await action(p=>p.service.set('overlay.animation.lighting',{scope:'module',profileId:p.snapshot().profiles[0].id,moduleId:p.snapshot().profiles[0].modules[0].id},'Fill'));await expect(module.getByLabel('Secondary light color',{exact:true})).toHaveCount(0);
  await action(p=>p.service.set('overlay.animation.lighting',{scope:'module',profileId:p.snapshot().profiles[0].id,moduleId:p.snapshot().profiles[0].modules[0].id},'Gradient'));await expect(module.getByLabel('Secondary light color',{exact:true})).toBeVisible();
 });
 await check('unavailable capabilities disable both slider and exact entry with a reason',async()=>{
  await page.getByRole('button',{name:'Toggle capability'}).click();const field=page.getByTestId('capability');await expect(field.getByLabel('Opacity',{exact:true})).toBeDisabled();await expect(field.getByLabel('Opacity value',{exact:true})).toBeDisabled();await expect(field).toContainText('Renderer capability is required.');
 });
 await check('custom SVG disables radius and exposes an accessible reason',async()=>{
  expect(await action(p=>p.shape())).toBe(true);await expect(module.getByLabel('Радиус углов',{exact:true})).toBeDisabled();const field=module.locator('[data-setting-id="overlay.surface.radius"]');await expect(field).toContainText('Clear the custom button shape');expect(await field.getAttribute('aria-describedby')).toBeTruthy();
 });
 await check('trusted specialized components register and unregister without affecting values',async()=>{
  const custom=page.getByTestId('custom');await expect(custom).toContainText('This specialized editor is not available.');await action(p=>p.register());await custom.getByLabel('Specialized name').fill('Yamio test');await custom.getByLabel('Specialized name').blur();await expect(module.getByLabel('Имя модуля',{exact:true})).toHaveValue('Yamio test');await action(p=>p.unregister());await expect(custom.getByLabel('Specialized name')).toHaveCount(0);
 });
 await check('changing Studio language preserves every document byte and overlay label',async()=>{
  const before=await action(p=>JSON.stringify(p.snapshot()));await action(p=>p.locale('qya'));await expect(module.getByLabel('Module name',{exact:true})).toHaveValue('Yamio test');expect(await action(p=>JSON.stringify(p.snapshot()))).toBe(before);
 });
 await check('localization strings render as text and cannot inject HTML',async()=>{
  await action(p=>{p.registry.register({version:1,locale:'qya',namespaces:{settings:{'overlay.instance.name.label':'<img src=x onerror="window.injected=true">'}}});p.locale('en');p.locale('qya');});
  const field=module.locator('[data-setting-id="overlay.instance.name"]');await expect(field).toContainText('<img src=x');await expect(field.locator('img')).toHaveCount(0);expect(await page.evaluate(()=>window.injected)).toBeUndefined();
 });
 await check('future configurations disable generated controls without changing the document',async()=>{
  const before=await action(p=>JSON.stringify(p.snapshot()));await action(p=>p.service.inspectUnsupported({source:'import',version:99,reason:'Future test',text:'original'}));await expect(module.getByLabel('Opacity value',{exact:true})).toBeDisabled();await expect(module.locator('[data-setting-id="overlay.instance.opacity"]')).toContainText('This configuration is read-only.');expect(await action(p=>JSON.stringify(p.snapshot()))).toBe(before);
 });
 await page.screenshot({path:fileURLToPath(new URL('controls.png',artifacts)),fullPage:true});
 await check('production panels use generated controls',async()=>{
  const context=await browser.newContext({viewport:{width:1560,height:1000}}),doc=initialDocument();
  await context.addInitScript(doc=>{if(!localStorage.getItem('input-overlay-studio.document'))localStorage.setItem('input-overlay-studio.document',JSON.stringify(doc));},encodeDocument(doc));
  const app=await context.newPage();app.on('pageerror',error=>errors.push(error.message));await app.goto('http://127.0.0.1:5218');await app.locator('.layer-list').getByRole('button',{name:'Keyboard',exact:true}).click();
  await expect(app.locator('.appearance-panel [data-setting-id="overlay.instance.name"]')).toBeVisible();await app.getByLabel('Module name',{exact:true}).fill('Stage four');await app.getByLabel('Module name',{exact:true}).blur();
  await app.screenshot({path:fileURLToPath(new URL('workspace.png',artifacts))});
  await app.getByRole('button',{name:'Settings',exact:true}).click();await expect(app.locator('[data-setting-id="render.performance.fps"]')).toBeVisible();await app.getByLabel('Animation FPS',{exact:true}).selectOption('120');await app.screenshot({path:fileURLToPath(new URL('settings.png',artifacts)),fullPage:true});await context.close();
 });
 await check('no browser exceptions',async()=>expect(errors).toEqual([]));
 await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{await browser.close();await vite.close();}
