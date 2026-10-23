import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
const root=new URL('../../',import.meta.url),data=new URL(`.tools/language-native/run-${Date.now()}/`,root),artifacts=new URL('../artifacts/language-native/',import.meta.url);
await mkdir(data,{recursive:true});await mkdir(artifacts,{recursive:true});
const original=JSON.stringify(encodeDocument(initialDocument()));
await writeFile(new URL('config.json',data),JSON.stringify({host:'127.0.0.1',port:4652,http_enabled:true,http_port:5252,auth_token:'language-native-test',capture_enabled:false,cpu_affinity:[]}));
await writeFile(new URL('studio.json',data),original);
const exe=process.env.STUDIO_NATIVE_EXE||fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe',root));
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1560,height:1000}});
await context.addInitScript(()=>localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4652',token:'language-native-test'})));
let child;const errors=[],requests=[],results=[],base='http://127.0.0.1:5252/studio/index.html';
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
const start=async()=>{child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data),WEBVIEW2_USER_DATA_FOLDER:fileURLToPath(new URL('webview/',data))}});await expect.poll(async()=>{try{return(await fetch(base)).status;}catch{return 0;}},{timeout:20000}).toBe(200);};
const stop=async()=>{if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}};
const check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
try{
 await start();await page.goto(base);await expect(page.locator('.statusbar')).toContainText('Synced to OBS');await page.getByRole('button',{name:'Settings',exact:true}).click();
 await check('compiled Studio starts without downloading unused language catalogs',async()=>{
  expect(requests.filter(url=>/\/assets\/(?:zh-cn|zh-tw|es|pt-br|de|fr|tr|pl|ja|ko|ru-supplement)-.*\.js/.test(url))).toEqual([]);
  await expect(page.locator('.experimental-badge')).toHaveText('Experimental');
 });
 await check('compiled language loading keeps the previous selection on failure and retries',async()=>{
  await page.route('**/assets/fr-*.js',route=>route.abort());await page.locator('.language-settings select').selectOption('fr');
  await expect(page.locator('.toast')).toContainText('Could not load this language');await expect(page.locator('.language-settings select')).toHaveValue('en');
  await page.unroute('**/assets/fr-*.js');await page.locator('.language-settings select').selectOption('fr');
  await expect(page.getByRole('heading',{name:'Langues et texte',exact:true})).toBeVisible();
 });
 await check('every built-in language loads from embedded native HTTP assets',async()=>{
  for(const [locale,badge] of [['ru','Экспериментально'],['zh-cn','实验性'],['es','Experimental'],['pt-br','Experimental'],['de','Experimentell'],['fr','Expérimental'],['tr','Deneysel'],['pl','Eksperymentalne'],['ja','試験的'],['ko','실험적'],['zh-tw','實驗性'],['sjn-teng-x-art','Experimental']]){
   await page.locator('.language-settings select').selectOption(locale);await expect(page.locator('.experimental-badge')).toHaveText(badge);
   await expect(page.locator('.brand')).toContainText('input');await expect(page.locator('.brand')).toContainText('OVERLAY STUDIO');
  }
  expect(requests.every(url=>new URL(url).hostname==='127.0.0.1')).toBe(true);
 });
 await check('loaded languages are reused and Studio language does not alter overlay data',async()=>{
  const before=requests.filter(url=>/\/assets\/es-.*\.js/.test(url)).length;
  await page.locator('.language-settings select').selectOption('es');await page.locator('.language-settings select').selectOption('de');await page.locator('.language-settings select').selectOption('es');
  expect(requests.filter(url=>/\/assets\/es-.*\.js/.test(url)).length).toBe(before);
  expect(await readFile(new URL('studio.json',data),'utf8')).toBe(original);
 });
 await check('saved built-in language survives native restart and browser reload',async()=>{
  await page.locator('.language-settings select').selectOption('ja');await expect(page.locator('.experimental-badge')).toHaveText('試験的');
  await stop();await start();await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.getByRole('heading',{name:'言語と文字',exact:true})).toBeVisible();
  await page.locator('.language-settings select').selectOption('ru');await page.screenshot({path:fileURLToPath(new URL('russian-settings.png',artifacts)),fullPage:true});
  expect(errors).toEqual([]);
 });
 await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors,realNativeExecutable:true},null,2));
}finally{await browser.close();await stop();}
