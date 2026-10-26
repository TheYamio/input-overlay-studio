import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'vite';
import {WebSocketServer} from 'ws';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument,parseDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const artifacts=new URL('../artifacts/localization-layout/',import.meta.url);await mkdir(artifacts,{recursive:true});
const vite=await createServer({server:{host:'127.0.0.1',port:5244,strictPort:true}});await vite.listen();
const wss=new WebSocketServer({host:'127.0.0.1',port:4644});let document=initialDocument(),revision=0;
const send=(ws,value)=>ws.send(JSON.stringify(value)),broadcast=value=>{for(const ws of wss.clients)if(ws.authed&&ws.readyState===1)send(ws,value);};
wss.on('connection',ws=>ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='auth'){ws.authed=m.token==='layout-languages';send(ws,{type:'auth_response',status:ws.authed?'success':'failed',protocol:5,studio_capabilities:{...contract,role:'capture'}});return;}if(!ws.authed)return;if(m.type==='studio_get')send(ws,{type:'studio_config',document:encodeDocument(document),revision:String(revision)});if(m.type==='studio_set'){if(m.base_revision!==String(revision)){send(ws,{type:'studio_conflict',document:encodeDocument(document),revision:String(revision),request_id:m.request_id});return;}document=parseDocument(JSON.stringify(m.document));revision++;broadcast({type:'studio_config',document:encodeDocument(document),revision:String(revision),origin:m.origin});send(ws,{type:'studio_saved',revision:String(revision),request_id:m.request_id});}}));
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1366,height:768}});await context.addInitScript(()=>localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4644',token:'layout-languages'})));
await context.addInitScript(()=>{window.__TAURI__={core:{invoke:async command=>{if(command==='get_config')return {host:'127.0.0.1',port:4644,auth_token:'layout-languages',http_enabled:true,http_port:5244,analog_keyboard:'',capture_enabled:false,key_whitelist:[],raw_mouse_min_delta:0,send_mouse_move:true,cpu_affinity:[0,1],linux_evdev_keyboard_device:'',linux_raw_mouse_device:''};if(command==='get_device_status')return {keyboard_count:1,mouse_count:1,capture_running:false};if(command==='get_autostart')return false;if(command==='get_http_status'||command==='get_startup_warning')return null;throw Error('Read-only native fixture');}}};});
const page=await context.newPage(),errors=[],issues=[],scans=[],results=[];page.on('pageerror',e=>errors.push(e.message));
const nav=async index=>page.locator('.navigation nav button').nth(index).click();
const text=source=>page.evaluate(async source=>(await import('/src/core/localization/messages.ts')).trText(source),source);
const button=async(source,scope=page)=>scope.getByRole('button',{name:await text(source),exact:true});
const screenshot=async name=>page.screenshot({path:fileURLToPath(new URL(name+'.png',artifacts)),fullPage:true});
async function scan(name){
 const found=await page.evaluate(async()=>{
  // Measure final font metrics rather than a transient fallback while catalogs load.
  await document.fonts.ready;
  const issues=[];
  if(document.documentElement.scrollWidth>innerWidth+1)issues.push({type:'page overflow',text:String(document.documentElement.scrollWidth)});
  const nodes=document.querySelectorAll('.content-page button,.property-scroll button,.inspector-tabs button,.editor-toolbar button,.workspace-tools button,.field>span,.number-field>span,.range-field>span,.hint,dialog label,dialog h2,dialog h3,.settings-section h3');
  for(const n of nodes){const rect=n.getBoundingClientRect(),style=getComputedStyle(n);if(rect.width<2||rect.height<2||rect.bottom<0||rect.top>innerHeight||n.closest('[hidden],.scene-host,.scene-thumbnail'))continue;
   let visible=true;for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),r=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowY)&& (rect.top<r.top-1||rect.bottom>r.bottom+1)){visible=false;break;}}if(!visible)continue;
   if(n.clientWidth&&n.scrollWidth>n.clientWidth+2&&style.textOverflow!=='ellipsis')issues.push({type:'horizontal clipping',text:n.textContent.trim().slice(0,160),tag:n.tagName,cls:n.className,width:n.clientWidth,content:n.scrollWidth});
   if(n.tagName==='BUTTON'&&n.clientHeight&&n.scrollHeight>n.clientHeight+2)issues.push({type:'vertical clipping',text:n.textContent.trim().slice(0,160),cls:n.className,height:n.clientHeight,content:n.scrollHeight});
  }return issues;
 });issues.push(...found.map(issue=>({view:name,...issue})));scans.push(name);
}
async function selectModule(index){
 if(await page.locator('.studio-workspace.layers-closed').count())await page.locator('.editor-toolbar > button').first().click();
 await page.locator('.layer-row > button:first-child').filter({hasText:document.profiles[0].modules[index].name}).click();
}
async function scanPage(name){
 const container=page.locator('.content-page').first();
 if(await container.count()){
  const {height,total}=await container.evaluate(n=>({height:n.clientHeight,total:n.scrollHeight}));
  for(let top=0;top<total;top+=Math.max(100,height*.8)){await container.evaluate((n,top)=>n.scrollTop=top,top);await scan(`${name}-scroll-${Math.round(top)}`);}
  await container.evaluate(n=>n.scrollTop=0);
 }else await scan(name);
}
try{
 await page.goto('http://127.0.0.1:5244');await expect(page.locator('.statusbar')).toContainText('Saved to capture server');
 await nav(3);await page.locator('.language-settings input[type=file]').setInputFiles({name:'audit-language.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,locale:'zz-x-audit',name:'日本語 · Benutzerübersetzung mit einem langen Namen',namespaces:{language:{title:'Audit custom'}}}))});await expect(page.locator('.language-package')).toHaveCount(1);
 for(const locale of ['en','ru','de','fr','es','pt-br','tr','pl','ja','ko','zh-cn','zh-tw']){
  await nav(3);await page.locator('.language-settings select').selectOption(locale);await expect(page.locator('.language-settings select')).toBeEnabled();
  for(const [width,height] of [[1366,768],[820,900]]){await page.setViewportSize({width,height});for(const index of [3,1,2]){await nav(index);await scanPage(`${locale}-${width}-page-${index}`);}await nav(0);await selectModule(0);await scan(`${locale}-${width}-studio`);}
  console.log('PASS all pages at desktop and compact widths: '+locale);
 }
 for(const locale of ['de','ja','ko','zh-cn','zh-tw']){
  await nav(3);await page.locator('.language-settings select').selectOption(locale);
  for(const [width,height] of [[1366,768],[820,900],[910,512]]){
   await page.setViewportSize({width,height});await nav(0);
   for(let module=0;module<5;module++){await selectModule(module);const tabs=page.locator('.inspector-tabs button');for(let index=0;index<await tabs.count();index++){await tabs.nth(index).click();const scroll=page.locator('.property-scroll');await scroll.evaluate(n=>n.scrollTop=0);await scan(`${locale}-${width}-module-${module}-tab-${index}-top`);await scroll.evaluate(n=>n.scrollTop=n.scrollHeight);await scan(`${locale}-${width}-module-${module}-tab-${index}-bottom`);}}
   await selectModule(0);await(await button('Artwork',page.locator('.inspector-tabs'))).click();
   if(!Object.keys(document.assets).length){const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='#8064c4';x.fillRect(0,0,64,64);return c.toDataURL();});await page.getByLabel(await text('Upload keycap image'),{exact:true}).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});}
   await(await button('Position & scale image')).click();let dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await scan(`${locale}-${width}-image-dialog`);await expect(await button('Cancel',dialog)).toBeInViewport();await expect(await button('Apply image placement',dialog)).toBeInViewport();await screenshot(`${locale}-${width}-image`);await(await button('Cancel',dialog)).click();
   await nav(2);await(await button('Save current setup')).click();dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await scan(`${locale}-${width}-preset-dialog`);await expect(await button('Cancel',dialog)).toBeInViewport();await expect(await button('Save preset',dialog)).toBeInViewport();await screenshot(`${locale}-${width}-preset`);await(await button('Cancel',dialog)).click();
   await nav(3);await page.locator('.language-package button').click();dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await scan(`${locale}-${width}-language-dialog`);await expect(dialog.locator('[data-cancel]')).toBeFocused();await expect(dialog.locator('footer button').first()).toBeInViewport();await expect(dialog.locator('footer button').last()).toBeInViewport();await page.keyboard.press('Escape');
  }
  console.log('PASS all module panels and artwork/preset dialogs at three sizes: '+locale);
 }
 for(const locale of ['de','ja','ko','zh-cn','zh-tw']){
  await nav(3);await page.locator('.language-settings select').selectOption(locale);await nav(0);await selectModule(0);await(await button('Close properties')).click();await expect(page.locator('[data-action="toggle-properties"]')).toBeFocused();await page.locator('[data-action="toggle-properties"]').click();
  await nav(3);const first=page.locator('.shortcut-row').first();const label=await text('Undo');await expect(first.getByRole('button',{name:await text('Change {{p0}} shortcut').then(template=>template.replace('{{p0}}',label)),exact:true})).toBeVisible();await first.getByRole('button').first().click();await page.keyboard.press('Control+KeyC');await expect(page.locator('.shortcut-conflict')).toBeVisible();const before=JSON.stringify(document);
  await page.evaluate(async()=>{const {studioLocalization}=await import('/src/core/localization/builtins.ts');const {loadBuiltinLanguage}=await import('/src/core/localization/load-language.ts');await loadBuiltinLanguage('ru');studioLocalization.setLocale('ru');});await expect(page.locator('.shortcut-conflict')).toContainText('Копировать выделение');await expect(page.locator('.shortcut-conflict')).not.toContainText('Copy selection');expect(JSON.stringify(document)).toBe(before);await page.keyboard.press('Escape');
  await page.locator('.language-settings select').selectOption('en');await page.locator('.language-settings select').selectOption(locale);await nav(2);await(await button('Save current setup')).click();const dialog=page.getByRole('dialog'),name=dialog.locator('input').first();await name.fill('日本語 · Unchanged draft');const original=document.profiles[0].name,title=await dialog.locator('h2').innerText();
  await page.evaluate(async()=>{const {studioLocalization}=await import('/src/core/localization/builtins.ts');await(await import('/src/core/localization/load-language.ts')).loadBuiltinLanguage('ru');studioLocalization.setLocale('ru');});await expect(name).toHaveValue('日本語 · Unchanged draft');await expect(name).toBeFocused();await expect(dialog.locator('h2')).not.toHaveText(title);await expect(dialog).toContainText('Сохранить');expect(document.profiles[0].name).toBe(original);await page.keyboard.press('Escape');await page.locator('.navigation nav button').nth(3).click();await page.locator('.language-settings select').selectOption('en');
  console.log('PASS translated accessible commands, focus return and live dialog/conflict switching: '+locale);
 }
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({scans:scans.length,issues,errors},null,2));console.log(JSON.stringify({scans:scans.length,issues:issues.length,examples:issues.slice(0,12)},null,2));
 expect(issues).toEqual([]);
}finally{await browser.close();await new Promise(resolve=>wss.close(resolve));await vite.close();}
