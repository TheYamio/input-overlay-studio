import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'vite';
import {WebSocketServer} from 'ws';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const vite=await createServer({server:{host:'127.0.0.1',port:5281,strictPort:true}});await vite.listen();
const wss=new WebSocketServer({host:'127.0.0.1',port:4681}),secret='PRIVATE-CANARY-token-profile-device-error';
const initial=initialDocument();initial.gameProfiles[0].name=secret;initial.profiles[0].name=secret;
let document=encodeDocument(initial),revision=1,allowAuth=true,offline=false;const received=[];
const send=(ws,m)=>{if(ws.readyState===1)ws.send(JSON.stringify(m));};
const broadcast=m=>{for(const ws of wss.clients)if(ws.authed)send(ws,m);};
wss.on('connection',ws=>{if(offline){ws.close();return;}ws.on('message',raw=>{
 const m=JSON.parse(String(raw));received.push(m.type);
 if(m.type==='auth'){ws.authed=allowAuth;send(ws,{type:'auth_response',status:allowAuth?'success':'failed',protocol:5,studio_capabilities:{...contract,role:'capture'}});if(allowAuth)send(ws,{type:'connection_status',sequence:1,capture_enabled:true,capture_running:true,runtimes:{connected:0,ready:0,failed:0,unresponsive:0}});return;}
 if(!ws.authed)return;
 if(m.type==='studio_get')send(ws,{type:'studio_config',document,revision:String(revision),config_sequence:revision});
 if(m.type==='studio_set'){document=m.document;revision++;send(ws,{type:'studio_saved',request_id:m.request_id,revision:String(revision),config_sequence:revision});}
 });});
const heartbeat=setInterval(()=>broadcast({type:'heartbeat'}),1000);
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1366,height:768}}),results=[],errors=[];
await context.addInitScript(({secret})=>{localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4681',token:secret}));Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.failClipboard)throw Error('clipboard');window.copiedText=text;}}});},{secret});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const artifacts=new URL('../artifacts/polish/',import.meta.url);await mkdir(artifacts,{recursive:true});
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
const notice=()=>page.locator('.connection-notice'),nav=async index=>{await page.locator('.navigation nav button').nth(index).click();};
try{
 await page.goto('http://127.0.0.1:5281');await expect(page.locator('[data-connection-part=save]')).toHaveAttribute('data-connection-state','Saved to capture server');
 await check('a successful initial connection does not create a recovery notification',async()=>{await expect(notice()).toHaveCount(0);});
 await check('diagnostics are explicit, useful and contain neither tokens nor user-authored profile data',async()=>{
  await nav(3);const stored=await page.evaluate(()=>({...localStorage})),before=received.length;await page.getByRole('button',{name:'Copy diagnostics',exact:true}).click();await expect(page.locator('.diagnostic-settings')).toContainText('Diagnostic report copied.');const text=await page.evaluate(()=>window.copiedText),report=JSON.parse(text);expect(text).not.toContain(secret);expect(text).not.toContain('ws://');expect(report.connection).toMatchObject({state:'Connected',capture:'active',source:'none',save:'capture-server'});expect(report.window.width).toBe(1366);expect(await page.evaluate(()=>({...localStorage}))).toEqual(stored);expect(received.length).toBe(before);
 });
 await check('clipboard denial exposes a selected plain-text report for manual copying',async()=>{await page.evaluate(()=>{window.failClipboard=true;});await page.getByRole('button',{name:'Copy diagnostics',exact:true}).click();const field=page.getByLabel('Diagnostic report',{exact:true});await expect(field).toBeVisible();await expect(page.locator('.diagnostic-settings')).toContainText('Could not copy.');expect(await field.inputValue()).not.toContain(secret);await field.focus();expect(await field.evaluate(n=>n.selectionEnd-n.selectionStart)).toBe((await field.inputValue()).length);await page.evaluate(()=>{window.failClipboard=false;});});
 await check('complex numeric fields show schema-owned contextual help next to their controls',async()=>{await nav(1);const dpi=page.locator('[data-setting-id="profiles.game.dpi"]');await expect(dpi).toContainText('1600');const yaw=page.locator('[data-setting-id="profiles.game.yaw"]');await expect(yaw).toContainText('cm/360');});
 await check('short-window preset headers preserve mode meaning and expose the first preview in all languages',async()=>{
  for(const locale of ['en','ru','de','fr','es','pt-br','tr','pl','ja','ko','zh-cn','zh-tw']){
   await nav(3);await page.locator('.language-settings select').selectOption(locale);await nav(2);
   for(const [width,height]of [[1366,768],[910,512],[820,614]]){
    await page.setViewportSize({width,height});await page.locator('.preset-library').evaluate(n=>n.scrollTop=0);await page.evaluate(()=>document.fonts.ready);
    await expect(page.locator('.preset-explanation')).toBeVisible();await expect(page.locator('.preset-mode button')).toHaveCount(2);await expect(page.locator('.library-actions button').last()).toBeInViewport();
    const layout=await page.locator('.preset-library').evaluate(n=>{const first=n.querySelector('.library-card'),r=first.getBoundingClientRect();return {overflow:n.scrollWidth>n.clientWidth+1,previewVisible:Math.min(r.bottom,innerHeight)-Math.max(r.top,0)>60};});expect(layout,`${locale} ${width}`).toEqual({overflow:false,previewVisible:true});
    await page.locator('.preset-mode button').nth(1).click();await expect(page.locator('.preset-apply').first()).toHaveText(await page.evaluate(async()=>{const {trText}=await import('/src/core/localization/messages.ts');return trText('Apply colors');}));await page.locator('.preset-mode button').nth(0).click();
   }
   if(locale==='ru')await page.screenshot({path:fileURLToPath(new URL('presets-compact-ru.png',artifacts))});
  }
  await nav(3);await page.locator('.language-settings select').selectOption('en');
 });
 await check('loss is one dismissible incident across retry attempts and recovery is distinct',async()=>{
  offline=true;for(const ws of wss.clients)ws.terminate();await expect(notice()).toHaveAttribute('data-connection-notice','lost');await notice().getByRole('button',{name:'Dismiss message',exact:true}).click();await expect(notice()).toHaveCount(0);await expect(page.locator('.connection-badge')).not.toContainText('Capture server connected');offline=false;await expect(notice()).toHaveAttribute('data-connection-notice','restored',{timeout:12000});await expect(page.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','none');await expect(notice()).toHaveCount(0,{timeout:9000});
 });
 await check('authentication failures explain the token check and the action opens connection settings',async()=>{
  allowAuth=false;for(const ws of wss.clients)ws.terminate();await expect(notice()).toHaveAttribute('data-connection-notice','authentication',{timeout:12000});expect(await notice().innerText()).not.toContain(secret);await nav(0);await notice().getByRole('button',{name:'Connection settings',exact:true}).click();await expect(page.locator('.app-shell')).toHaveAttribute('data-page','Settings');await expect(page.locator('[data-settings-section=connection] input').first()).toBeFocused();
 });
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{clearInterval(heartbeat);await browser.close();for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await vite.close();}
