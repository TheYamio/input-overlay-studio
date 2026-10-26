// Real Windows build, isolated profile and disabled capture. No hardware input
// is synthesised or counted; the explicit skip remains visible to the user.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
const root=new URL('../../',import.meta.url),data=new URL(`.tools/setup-native/run-${Date.now()}/`,root),artifacts=new URL('../artifacts/setup-guide-native/',import.meta.url);
await mkdir(data,{recursive:true});await mkdir(artifacts,{recursive:true});
await writeFile(new URL('config.json',data),JSON.stringify({host:'127.0.0.1',port:4680,http_enabled:true,http_port:5280,auth_token:'setup-native-fixture',capture_enabled:false,cpu_affinity:[]}));
await writeFile(new URL('studio.json',data),JSON.stringify(encodeDocument(initialDocument())));
const exe=process.env.STUDIO_NATIVE_EXE||fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe',root)),http='http://127.0.0.1:5280';let child;
const browser=await chromium.launch({headless:true}),results=[],errors=[];
const start=async()=>{child=spawn(exe,['--tray'],{windowsHide:true,stdio:'ignore',env:{...process.env,INPUT_OVERLAY_STUDIO_DATA_DIR:fileURLToPath(data),WEBVIEW2_USER_DATA_FOLDER:fileURLToPath(new URL('webview/',data))}});await expect.poll(async()=>{try{return(await fetch(`${http}/studio/index.html`)).status;}catch{return 0;}},{timeout:25000}).toBe(200);};
const stop=async()=>{if(child?.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}};
const context=await browser.newContext({viewport:{width:1366,height:768}});
await context.addInitScript(()=>{localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4680',token:'setup-native-fixture'}));Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedURL=value;}}});});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const dialog=()=>page.locator('dialog.setup-guide'),check=async(name,run)=>{await run();results.push(name);console.log('PASS '+name);};
try{
 await start();await page.goto(`${http}/studio/index.html`);
 await check('compiled Studio opens the real setup guide on a fresh browser installation',async()=>{await expect(dialog()).toBeVisible();await expect(dialog().getByRole('heading',{name:'Set up your overlay',exact:true})).toBeVisible();await expect(page.locator('[data-connection-part=save]')).toHaveAttribute('data-connection-state','Saved to capture server');});
 await check('compiled first-run language selection takes effect immediately and survives reload',async()=>{const language=dialog().locator('[data-studio-language]');await expect(language).toBeInViewport();await language.selectOption('ru');await expect(dialog().locator('#setup-title')).toHaveText('Настройка оверлея');await page.reload();await expect(dialog().locator('#setup-title')).toHaveText('Настройка оверлея');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('studio.setup')).step)).toBe(0);await dialog().locator('[data-studio-language]').selectOption('en');await expect(dialog().locator('#setup-title')).toHaveText('Set up your overlay');});
 await check('disabled real Capture cannot satisfy checks with local keyboard events',async()=>{await dialog().locator('footer .primary').click();await expect(dialog().locator('.setup-body')).toHaveAttribute('data-setup-step','1');await page.keyboard.press('KeyW');await expect(dialog().locator('[data-received=true]')).toHaveCount(0);await expect(dialog()).toContainText('Input capture disabled');await dialog().getByRole('button',{name:'Continue without input check',exact:true}).click();});
 await check('native connection settings return to the same guide step without restarting it',async()=>{await dialog().getByRole('button',{name:'Open connection settings',exact:true}).click();await expect(dialog()).toBeHidden();await expect(page.locator('[data-settings-section=connection] input').first()).toBeFocused();await page.locator('[data-setup-resume]').click();await expect(dialog().locator('.setup-body')).toHaveAttribute('data-setup-step','2');});
 let url;
 await check('the compiled guide prepares a usable authenticated local URL and keeps it masked',async()=>{await dialog().getByRole('button',{name:'Copy OBS URL',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof window.copiedURL)).toBe('string');url=await page.evaluate(()=>window.copiedURL);expect(new URL(url).pathname).toBe('/studio/overlay.html');expect(new URL(url).hash).toContain('setup-native-fixture');await expect(dialog().getByLabel('OBS source URL',{exact:true})).toHaveAttribute('type','password');await dialog().locator('footer .primary').click();await expect(dialog()).toContainText('No overlay source');await expect(dialog().getByRole('button',{name:'Finish setup',exact:true})).toBeDisabled();});
 let overlay;
 await check('a real Runtime applies the native profile while disabled capture still blocks completion',async()=>{overlay=await context.newPage();overlay.on('pageerror',e=>errors.push(e.message));await overlay.goto(url);await expect(overlay.locator('.overlay-key').first()).toBeAttached();await expect(page.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','ready');await expect(dialog()).toContainText('Input check is incomplete.');await expect(dialog().getByRole('button',{name:'Finish setup',exact:true})).toBeDisabled();await page.screenshot({path:fileURLToPath(new URL('runtime-ready-capture-disabled.png',artifacts))});});
 await check('server restart loses readiness and reconnects without losing wizard progress',async()=>{await overlay.close();await stop();await expect(page.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','unknown');await start();await expect(page.locator('[data-connection-part=save]')).toHaveAttribute('data-connection-state','Saved to capture server',{timeout:20000});await expect(dialog().locator('.setup-body')).toHaveAttribute('data-setup-step','3');await expect(page.locator('[data-connection-part=runtime]')).toHaveAttribute('data-connection-state','none');await page.reload();await expect(dialog().locator('.setup-body')).toHaveAttribute('data-setup-step','3');});
 await check('explicit skip persists and settings reopen the compiled guide',async()=>{await dialog().getByRole('button',{name:'Set up later',exact:true}).first().click();await page.reload();await expect(dialog()).toHaveCount(0);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Open setup guide',exact:true}).click();await expect(dialog().locator('.setup-body')).toHaveAttribute('data-setup-step','0');await page.keyboard.press('Escape');});
 await check('compiled lazy catalogs include the new guide in every built-in language',async()=>{
  await page.locator('.setup-entry button').click();
  for(const [locale,title]of [['en','Set up your overlay'],['ru','Настройка оверлея'],['de','Overlay einrichten'],['fr','Configurer votre overlay'],['es','Configura tu overlay'],['pt-br','Configure seu overlay'],['tr','Kaplamanı ayarla'],['pl','Skonfiguruj nakładkę'],['ja','オーバーレイを設定'],['ko','오버레이 설정'],['zh-cn','设置叠加层'],['zh-tw','設置疊加層']]){
   await dialog().locator('[data-studio-language]').selectOption(locale);await expect(dialog().locator('#setup-title')).toHaveText(title);
  }
  await page.keyboard.press('Escape');
 });
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors,physicalInputVerified:false},null,2));
}finally{await browser.close();await stop();}
