import contract from '../src/core/compatibility/contract.json' with {type:'json'};
import { parseDocument } from '../src/core/config.ts';
import { chromium, expect } from './test-browser.mjs';
import WebSocket from 'ws';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url), data = new URL(`.tools/native-smoke/run-${Date.now()}/`, root);
await mkdir(data, { recursive: true });
const exe = process.env.STUDIO_NATIVE_EXE || fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe', root));
await writeFile(new URL('config.json', data), JSON.stringify({ host: '127.0.0.1', port: 4465, auth_token: 'native-smoke-test', http_enabled: true, http_port: 4466, cpu_affinity: [] }));
let child;
const start = (showUI = false) => { child = spawn(exe, showUI ? [] : ['--tray'], { windowsHide: true, env: { ...process.env, RUST_LOG: 'info', INPUT_OVERLAY_STUDIO_DATA_DIR: fileURLToPath(data), WEBVIEW2_USER_DATA_FOLDER: fileURLToPath(new URL('webview/', data)) }, stdio: 'ignore' }); };
const stop = async () => { if (!child || child.exitCode !== null) return; const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exit; };
const execute = promisify(execFile);
const runWindow = async mode => (await execute('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./native-window.ps1', import.meta.url)), '-TaskProcessId', String(child.pid), '-Mode', mode], { windowsHide: true })).stdout.trim();
const repeatLaunch = async (directory = data, args = []) => {
  const duplicate = spawn(exe, args, { windowsHide: true, env: { ...process.env, INPUT_OVERLAY_STUDIO_DATA_DIR: fileURLToPath(directory), WEBVIEW2_USER_DATA_FOLDER: fileURLToPath(new URL('webview/', directory)) }, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { duplicate.kill(); reject(new Error('Repeated launch created a separate process')); }, 20000);
    duplicate.once('error', error => { clearTimeout(timeout); reject(error); });
    duplicate.once('exit', (code, signal) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Repeated launch failed: ${code ?? signal}`)); });
  });
};
const browser = await chromium.launch({ headless: true }); const context = await browser.newContext(); const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); const results = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
try {
  start();
  await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:4466/studio/index.html')).status; } catch { return 0; } }, { timeout: 20000 }).toBe(200);
  await check('native executable starts HTTP, WebSocket and Raw Input thread', async () => {
    const logs = await (await import('node:fs/promises')).readdir(new URL('logs/', data));
    await expect.poll(async () => readFile(new URL(`logs/${logs.sort().at(-1)}`, data), 'utf8')).toContain('raw_input: started');
    const latest = await readFile(new URL(`logs/${logs.sort().at(-1)}`, data), 'utf8');
    expect(latest).toContain('raw_input: started'); expect(latest).not.toContain('native-smoke-test');
  });
  await check('repeated tray launch keeps the existing server without opening an editor', async () => {
    await repeatLaunch(data, ['--tray']);
    expect(Number(await runWindow('count'))).toBe(0);
    expect(child.exitCode).toBeNull();
  });
  await check('repeated launch opens the editor in the existing tray process', async () => {
    await repeatLaunch();
    await expect.poll(async () => Number(await runWindow('count')), { timeout: 20000 }).toBe(1);
    expect(child.exitCode).toBeNull();
  });
  await check('repeated launch restores a minimized editor instead of creating another one', async () => {
    await runWindow('minimize');
    await expect.poll(async () => JSON.parse(await runWindow('state')).Minimized).toBe(true);
    await repeatLaunch();
    await expect.poll(async () => JSON.parse(await runWindow('state')), { timeout: 20000 }).toEqual({ Count: 1, Minimized: false, Visible: true });
  });
  await check('other data folders and concurrent launches reuse the same application', async () => {
    await runWindow('close');
    await expect.poll(async () => Number(await runWindow('count'))).toBe(0);
    const alternate = new URL('other-installation/', data);
    await mkdir(alternate, { recursive: true });
    await Promise.all([repeatLaunch(alternate), repeatLaunch(), repeatLaunch(alternate), repeatLaunch()]);
    expect(Number(await runWindow('count'))).toBe(1);
    expect(child.exitCode).toBeNull();
    await runWindow('close');
    await expect.poll(async () => Number(await runWindow('count'))).toBe(0);
  });
  await check('simultaneous cold starts leave exactly one capture process', async () => {
    await stop();
    const contenders = Array.from({ length: 4 }, () => spawn(exe, ['--tray'], { windowsHide: true, env: { ...process.env, INPUT_OVERLAY_STUDIO_DATA_DIR: fileURLToPath(data), WEBVIEW2_USER_DATA_FOLDER: fileURLToPath(new URL('webview/', data)) }, stdio: 'ignore' }));
    try {
      await expect.poll(() => contenders.filter(process => process.exitCode === null).length, { timeout: 30000 }).toBe(1);
      child = contenders.find(process => process.exitCode === null);
      for (const process of contenders) if (process !== child) expect(process.exitCode).toBe(0);
      await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:4466/studio/index.html')).status; } catch { return 0; } }, { timeout: 20000 }).toBe(200);
    } catch (error) {
      for (const process of contenders) if (process.exitCode === null) process.kill();
      throw error;
    }
  });
  await context.addInitScript(() => localStorage.setItem('studio.inspector-section', 'all'));
  await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4465', token: 'native-smoke-test' })));
  await check('compiled frontend uses the actual Rust server', async () => {
    await page.goto('http://127.0.0.1:4466/studio/index.html'); await expect(page.getByText('Capture server connected')).toBeVisible();
    const releaseVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
    await expect(page.locator('.version')).toContainText(releaseVersion);
    await expect.poll(() => page.locator('.brand-mark img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    const logoResponse = await fetch('http://127.0.0.1:4466/studio/logo.svg');
    expect(logoResponse.status).toBe(200); expect(await logoResponse.text()).toContain('Input Overlay Studio');
    await expect.poll(async () => { try { return JSON.parse(await readFile(new URL('studio.json', data), 'utf8')).version; } catch { return 0; } }).toBe(4);
    await page.getByRole('button', { name: 'Profiles', exact: true }).click(); await page.getByLabel('Profile name', { exact: true }).fill('Native persisted');
    await expect.poll(async () => parseDocument(await readFile(new URL('studio.json', data), 'utf8')).gameProfiles[0].name).toBe('Native persisted');
  });
  await check('HTTP root opens Studio and removed editor assets are not shipped', async () => {
    const base = 'http://127.0.0.1:4466';
    const root = await page.request.get(base, { maxRedirects: 0 }); expect(root.status()).toBe(302); expect(root.headers()['location']).toBe('/studio/index.html');
    const studio = await page.request.get(`${base}/studio/`); expect(studio.status()).toBe(200); expect(studio.headers()['content-type']).toContain('text/html');
    const html = await studio.text();
    const assets = [...html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map(match => new URL(match[1], `${base}/studio/`));
    expect(assets.length).toBeGreaterThan(1);
    for (const url of assets) expect((await page.request.get(url.toString())).status(), url.toString()).toBe(200);
    for (const path of ['/style.css', '/scripts/main.js', '/update.html', '/post-update.html']) expect((await page.request.get(`${base}${path}`)).status()).toBe(404);
  });
  await check('native executable serves the Midnight workspace and exact value controls', async () => {
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
    await expect(page.getByRole('separator', { name: 'Properties panel width' })).toBeVisible();
    const layout = await page.evaluate(() => { const c=document.querySelector('.canvas-panel').getBoundingClientRect(),p=document.querySelector('.properties-panel').getBoundingClientRect(),t=document.querySelector('.workspace-tools').getBoundingClientRect(); return {right:p.left>=c.right-1,sameHeight:Math.abs(p.height-c.height)<1,bottomTools:Math.abs(t.bottom-c.bottom)<1}; });
    expect(layout).toEqual({right:true,sameHeight:true,bottomTools:true});
    await expect(page.getByRole('button', { name: 'Actual size (100%)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Property sections' })).toBeVisible();
    await expect(page.getByLabel('Background opacity value', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Accent color hex', { exact: true })).toBeVisible();
    const radii = await page.locator('.preview-viewport .module-keyboard .overlay-key').first().evaluate(el => [el,el.querySelector('.key-body'),el.querySelector('.key-surface')].map(node=>getComputedStyle(node).borderRadius));
    expect(radii[0]).not.toBe('0px'); expect(radii[1]).toBe(radii[0]); expect(radii[2]).toBe(radii[0]);
  });
  await check('canvas resize saves proportional geometry through native validation and Undo restores it', async () => {
    const geometry = async () => { const doc = parseDocument(await readFile(new URL('studio.json', data), 'utf8')), m = doc.profiles.find(p => p.id === doc.activeProfileId).modules.find(m => m.type === 'keyboard'); const {x,y,w,h} = m; return {x,y,w,h}; };
    const original = await geometry();
    await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
    const handle = page.getByRole('button', { name: 'Resize Keyboard', exact: true }); await handle.hover(); const b = await handle.boundingBox();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down(); await page.mouse.move(b.x+b.width/2-25,b.y+b.height/2-18,{steps:8});
    expect(await geometry()).toEqual(original); await page.mouse.up(); await expect.poll(geometry).not.toEqual(original);
    const changed = await geometry(); expect(changed.w/changed.h).toBeCloseTo(original.w/original.h,4);
    await page.getByRole('button', {name:'Undo',exact:true}).click(); await expect.poll(geometry).toEqual(original);
    await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
  });
  await check('SVG contours and label visibility persist through the real native backend', async () => {
    const openDetails = async name => { const summary = page.getByText(name, { exact: true }); if (!await summary.evaluate(el => el.parentElement.open)) await summary.click(); };
    await page.getByRole('group', { name: 'Property sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
    await openDetails('Borders & shape');
    await page.getByLabel('Upload SVG shape', { exact: true }).setInputFiles({ name: 'Native contour.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M0 0H100V100H0Z M30 30H70V70H30Z"/></svg>') });
    await expect.poll(async () => Object.keys(parseDocument(await readFile(new URL('studio.json', data), 'utf8')).shapes || {}).length).toBeGreaterThan(0);
    await openDetails('Text & typography'); await page.getByLabel('Show labels', { exact: true }).uncheck();
    await expect.poll(async () => parseDocument(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].modules[0].appearance.showLabels).toBe(false);
    await page.reload(); await expect(page.getByText('Capture server connected')).toBeVisible();
    await expect(page.locator('.preview-viewport .module-keyboard .custom-shape').first()).toBeVisible();
    await expect(page.locator('.preview-viewport .module-keyboard .key-label').first()).toBeHidden();
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
    await page.getByRole('group', { name: 'Property sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
    await openDetails('Borders & shape'); await page.getByLabel('Shape', { exact: true }).selectOption('');
    await openDetails('Text & typography'); await page.getByLabel('Show labels', { exact: true }).check();
    await page.getByRole('group', { name: 'Property sections' }).getByRole('button', { name: 'All properties', exact: true }).click();
  });
  await check('embedded keycap artwork is accepted and saved by the actual native backend', async () => {
    await page.getByRole('button', { name: 'Studio', exact: true }).click(); await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
    const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d'); ctx.fillStyle = '#4488ee'; ctx.fillRect(0, 0, 64, 64); return c.toDataURL('image/png'); });
    await page.getByLabel('Upload keycap image', { exact: true }).setInputFiles({ name: 'native.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
    await expect.poll(async () => { const d = parseDocument(await readFile(new URL('studio.json', data), 'utf8')), m = d.profiles.find(p => p.id === d.activeProfileId).modules.find(m => m.type === 'keyboard'); return !!d.assets[m.image.assetId]?.data.startsWith('data:image/webp;base64,'); }).toBe(true);
  });
  await check('shared artwork and flips persist through the actual native backend', async () => {
    await page.locator('.artwork-group summary').click(); await page.getByLabel('Share artwork with Mouse Buttons', { exact: true }).check();
    await page.getByRole('button', { name: 'Position & scale image', exact: true }).click(); const editor = page.getByRole('dialog');
    const flip = editor.getByRole('button', { name: 'Flip horizontally', exact: true }); if (await flip.getAttribute('aria-pressed') !== 'true') await flip.click();
    await editor.getByRole('button', { name: 'Apply image placement', exact: true }).click();
    await expect.poll(async () => { const d = parseDocument(await readFile(new URL('studio.json', data), 'utf8')), modules = d.profiles.find(p => p.id === d.activeProfileId).modules, a = modules.find(m => m.type === 'keyboard'), b = modules.find(m => m.type === 'mouse'); return !!a.image.groupId && a.image.flipX === true && JSON.stringify(a.image) === JSON.stringify(b.image); }).toBe(true);
  });
  await check('object clipboard shortcuts save independent modules and artwork through the native backend', async () => {
    const read = async () => parseDocument(await readFile(new URL('studio.json',data),'utf8'));
    const original = await read(), profile = original.profiles.find(p => p.id === original.activeProfileId), source = profile.modules.find(m => m.type === 'keyboard');
    await page.locator('.layer-list').getByRole('button',{name:'Keyboard',exact:true}).click(); await page.getByRole('button',{name:'Select Keyboard',exact:true}).focus();
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await expect.poll(async()=> (await read()).profiles.find(p=>p.id===original.activeProfileId).modules.length).toBe(profile.modules.length+1);
    const changed = await read(), copy = changed.profiles.find(p=>p.id===original.activeProfileId).modules.find(m=>m.name==='Keyboard copy');
    expect(copy.id).not.toBe(source.id); expect(copy.image.groupId).toBeUndefined(); expect(changed.assets[copy.image.assetId].data).toBe(original.assets[source.image.assetId].data);
    await page.keyboard.press('Control+z'); await expect.poll(async()=> (await read()).profiles.find(p=>p.id===original.activeProfileId).modules.length).toBe(profile.modules.length);
    await page.locator('.layer-list').getByRole('button',{name:'Keyboard',exact:true}).click();
  });
  await check('incorrect token is rejected by native authentication', async () => {
    const answer = await new Promise((resolve, reject) => { const ws = new WebSocket('ws://127.0.0.1:4465'); const timer = setTimeout(() => { ws.terminate(); reject(Error('Auth timeout')); }, 5000); ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'incorrect' }))); ws.on('message', text => { clearTimeout(timer); ws.close(); resolve(JSON.parse(text.toString())); }); ws.on('error', reject); });
    expect(answer.status).toBe('failed');
  });
  await check('native revision checks reject stale writes and invalid full configurations', async () => {
    const ws = new WebSocket('ws://127.0.0.1:4465');
    const receive = type => new Promise((resolve, reject) => {
      const handler = raw => { const value = JSON.parse(String(raw)); if (value.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(value); } };
      const timer = setTimeout(() => { ws.off('message', handler); reject(Error(`Native ${type} timeout`)); }, 5000); ws.on('message', handler);
    });
    try {
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      const auth = receive('auth_response'); ws.send(JSON.stringify({ type: 'auth', token: 'native-smoke-test',studio_client:{...contract,role:'studio',document:{read:[4],write:[4]}} })); expect((await auth).studio_capabilities.document.read).toEqual([4]);
      const get = async () => { const answer = receive('studio_config'); ws.send(JSON.stringify({ type: 'studio_get' })); return answer; };
      const before = await get(), changed = structuredClone(before.document); changed.profiles[0].caption = 'Revision test';
      const request = async (type, document, base_revision, request_id) => { const answer = receive(type); ws.send(JSON.stringify({ type: 'studio_set', document, base_revision, request_id, origin: 'native-cas-test' })); return answer; };
      const saved = await request('studio_saved', changed, before.revision, 20); expect(saved.revision).not.toBe(before.revision);
      const conflict = await request('studio_conflict', before.document, before.revision, 21); expect(conflict.document).toEqual(changed);
      const invalid = structuredClone(changed); invalid.performance = {};
      await request('studio_error', invalid, saved.revision, 22);
      const badImage = structuredClone(changed); badImage.assets.bad = { name: 'not-image.png', width: 1, height: 1, data: 'data:image/png;base64,aGVsbG8=' };
      await request('studio_error', badImage, saved.revision, 24);
      const after = await get(); expect(after.document).toEqual(changed); expect(after.revision).toBe(saved.revision);
      await request('studio_saved', before.document, after.revision, 23);
    } finally { ws.close(); }
  });
  await check('native ordered snapshots expose validated current state after authentication', async () => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:4465'); let previous = -1;
      const timer = setTimeout(() => { ws.terminate(); reject(Error('Snapshot timeout')); }, 5000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'native-smoke-test' })));
      ws.on('error', reject);
      ws.on('message', raw => {
        try {
          const value = JSON.parse(raw.toString());
          if (value.type === 'auth_response') { expect(value.state_snapshot).toBe(true); ws.send(JSON.stringify({ type: 'input_snapshot' })); }
          if (value.type === 'input_snapshot') {
            const snapshot = value;
            expect(Number.isSafeInteger(snapshot.sequence)).toBe(true);
            expect(Array.isArray(snapshot.keys) && snapshot.keys.length <= 255).toBe(true);
            expect(Array.isArray(snapshot.buttons) && snapshot.buttons.length <= 5).toBe(true);
            expect(snapshot.keys.every(key => Number.isInteger(key.rawcode) && key.rawcode >= 1 && key.rawcode <= 255 && Number.isFinite(key.depth) && key.depth > 0 && key.depth <= 1)).toBe(true);
            expect(snapshot.buttons.every(button => Number.isInteger(button) && button >= 1 && button <= 5)).toBe(true);
            expect(snapshot.sequence).toBeGreaterThan(previous);
            if (previous < 0) { previous = snapshot.sequence; ws.send(JSON.stringify({ type: 'input_snapshot' })); }
            else { clearTimeout(timer); ws.close(); resolve(); }
          }
        } catch (error) { clearTimeout(timer); ws.terminate(); reject(error); }
      });
    });
  });
  await check('native restart restores saved profiles and web client reconnects', async () => {
    await stop(); start(); await expect.poll(async()=>{try{return (await fetch('http://127.0.0.1:4466/studio/index.html')).status;}catch{return 0;}},{timeout:20000}).toBe(200); await expect(page.getByText('Capture server connected')).toBeVisible({ timeout: 20000 });
    await page.reload(); await expect(page.getByText('Capture server connected')).toBeVisible(); await page.getByRole('button', { name: 'Profiles', exact: true }).click(); await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Native persisted');
  });
  await check('compiled transparent OBS entry is served locally', async () => {
    const overlay = await context.newPage(); await overlay.goto('http://127.0.0.1:4466/studio/overlay.html#ws=ws%3A%2F%2F127.0.0.1%3A4465&token=native-smoke-test'); await expect(overlay.locator('.overlay-module')).toHaveCount(5); expect(await overlay.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)'); await overlay.close();
  });
  await check('signature layout saves all 81 keys and seven vector shapes, with one-step Undo', async () => {
    const before = parseDocument(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].modules;
    await page.getByRole('button', { name: 'Presets', exact: true }).click(); await page.locator('.library-card').filter({ has: page.getByRole('heading', { name: 'Yamio preset', exact: true }) }).getByRole('button', { name: 'Use full layout', exact: true }).click();
    await expect.poll(async () => parseDocument(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].modules[0].keys.length).toBe(81);
    const saved = parseDocument(await readFile(new URL('studio.json', data), 'utf8'));
    const shapeIds = new Set(saved.profiles[0].modules.flatMap(m => [m.mouseBodyShapeId, m.appearance.shapeId, ...m.keys.map(k => k.style?.shapeId), ...Object.values(m.buttonStyles).map(s => s.shapeId)]).filter(Boolean));
    expect(shapeIds.size).toBe(7); for (const id of shapeIds) expect(saved.shapes[id]).toBeTruthy();
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
    await expect(page.locator('.preview-viewport [data-key="32"] .key-label')).toHaveText('SPACE');
    for (const label of ['DPI', 'SENS', 'CM / 360°']) await expect(page.locator('.preview-viewport .module-sensitivity').getByText(label, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(async () => parseDocument(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].modules).toEqual(before);
  });
  await check('native validation stores independent motion, lighting and delay settings', async () => {
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    const details = page.locator('.properties-panel .animation-details').first();
    if (!await details.evaluate(el => el.open)) { await details.locator('summary').focus(); await details.locator('summary').press('Enter'); }
    await page.getByLabel('Button motion', { exact: true }).selectOption('Scale');
    await page.getByLabel('Lighting mode', { exact: true }).selectOption('Gradient');
    await page.getByLabel('Press delay', { exact: true }).fill('160'); await page.getByLabel('Release delay', { exact: true }).fill('240');
    await expect.poll(async () => parseDocument(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].modules[0].appearance.releaseDelay).toBe(240);
    const style = parseDocument(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].modules[0].appearance;
    expect(style).toMatchObject({ motion: 'Scale', lighting: 'Gradient', pressDelay: 160 });
  });
  await check('native disk storage and restart preserve palette descriptions and semantics', async () => {
    await page.getByRole('button', { name: 'Presets', exact: true }).click();
    await page.getByRole('button', { name: 'Save current setup', exact: true }).click();
    await page.getByLabel('Preset name', { exact: true }).fill('Native palette');
    await page.getByLabel('Preset description', { exact: true }).fill('Iris palette for streaming');
    await page.getByLabel('Preset type', { exact: true }).selectOption('style');
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await expect.poll(async () => parseDocument(await readFile(new URL('studio.json', data), 'utf8')).presets.at(-1)?.description).toBe('Iris palette for streaming');
    await stop(); start(); await expect.poll(async()=>{try{return (await fetch('http://127.0.0.1:4466/studio/index.html')).status;}catch{return 0;}},{timeout:20000}).toBe(200); await expect(page.getByText('Capture server connected')).toBeVisible({ timeout: 20000 });
    await page.reload(); await expect(page.getByText('Capture server connected')).toBeVisible();
    await page.getByRole('button', { name: 'Presets', exact: true }).click();
    const saved = page.locator('.saved-preset').filter({ has: page.getByRole('heading', { name: 'Native palette', exact: true }) });
    await expect(saved.getByText('Iris palette for streaming')).toBeVisible();
    expect(parseDocument(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].modules[0].appearance).toMatchObject({ motion: 'Scale', lighting: 'Gradient', pressDelay: 160, releaseDelay: 240 });
    await expect(saved.getByRole('button', { name: 'Apply colors', exact: true })).toBeVisible();
  });
  await check('native Tauri window starts and Studio bootstraps authentication', async () => {
    await page.close(); await stop(); start(true);
    await expect.poll(async () => {
      const logs = await (await import('node:fs/promises')).readdir(new URL('logs/', data));
      return readFile(new URL(`logs/${logs.sort().at(-1)}`, data), 'utf8');
    }, { timeout: 20000 }).toContain('studio: native window opened');
    // Only the native Studio remains to authenticate.
    await expect.poll(async () => {
      const logs = await (await import('node:fs/promises')).readdir(new URL('logs/', data));
      return readFile(new URL(`logs/${logs.sort().at(-1)}`, data), 'utf8');
    }, { timeout: 20000 }).toContain('client authenticated');
  });
  expect(errors).toEqual([]);
  if (process.env.STUDIO_NATIVE_RESOURCES === '1') {
    const { processResources, resourceDelta } = await import('./process-resources.mjs');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const before = await processResources(child.pid); await new Promise(resolve => setTimeout(resolve, 15000)); const after = await processResources(child.pid);
    const resources = { mode: 'actual-native-editor-idle', ...resourceDelta(before, after), processes: after.processes, note: 'Includes this native app and its WebView2 descendants; excludes the separate test Chromium. Working-set sums include shared pages.' };
    await check('closing the actual native editor keeps capture and the OBS source running', async () => {
      // Send the standard close event only to the window of this test's own child.
      const { execFile } = await import('node:child_process'), { promisify } = await import('node:util'); const execute = promisify(execFile);
      const helper = fileURLToPath(new URL('./native-window.ps1', import.meta.url));
      const runWindow = mode => execute('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', helper, '-TaskProcessId', String(child.pid), '-Mode', mode], { windowsHide: true });
      await runWindow('close');
      await expect.poll(async () => Number((await runWindow('count')).stdout.trim()), { timeout: 15000 }).toBe(0);
      expect(child.exitCode).toBeNull();
      const overlay = await context.newPage(); await overlay.goto('http://127.0.0.1:4466/studio/overlay.html#ws=ws%3A%2F%2F127.0.0.1%3A4465&token=native-smoke-test'); await expect(overlay.locator('.overlay-module')).toHaveCount(5); await overlay.close();
    });
    await new Promise(resolve => setTimeout(resolve, 5000)); const trayBefore = await processResources(child.pid); await new Promise(resolve => setTimeout(resolve, 15000)); const trayAfter = await processResources(child.pid);
    resources.afterClosingEditor = { ...resourceDelta(trayBefore, trayAfter), processes: trayAfter.processes };
    await writeFile(new URL('../artifacts/native-resources.json', import.meta.url), JSON.stringify(resources, null, 2)); console.log(JSON.stringify(resources));
  }
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true }); await writeFile(new URL('../artifacts/native-results.json', import.meta.url), JSON.stringify({ results, errors, physicalDevicesVerified: false }, null, 2));
} finally { await context.close(); await browser.close(); await stop(); }
