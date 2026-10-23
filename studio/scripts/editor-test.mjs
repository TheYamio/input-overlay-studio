import {wireJSON} from './fixtures/current-config.mjs';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { initialDocument , parseDocument} from '../src/core/config.ts';
const vite = await createServer({ server: { host: '127.0.0.1', port: 5192, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4498 });
let document = initialDocument(), revision = 0;
document.profiles[0].modules[0].id = 'quoted"[module]\\id'; document.profiles[0].modules[0].x = 1920-document.profiles[0].modules[0].w;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)); if(m.document?.version===4)m.document=parseDocument(JSON.stringify(m.document)); const send = data => ws.send(JSON.stringify(data));
  if (m.type === 'auth') { ws.authed = m.token === 'editor-test'; send({ type: 'auth_response', studio_capabilities:{...contract,role:'capture'}, status: ws.authed ? 'success' : 'failed', protocol:5, studio_revisions: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = m.document; revision++; broadcast({ type: 'studio_config', document, revision: String(revision), origin: m.origin }); send({ type: 'studio_saved', revision: String(revision), request_id: m.request_id });
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1560, height: 1050 }, permissions: ['clipboard-read', 'clipboard-write'] });
await context.addInitScript(() => localStorage.setItem('studio.inspector-section', 'all'));
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4498', token: 'editor-test' })));
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const module = type => document.profiles[0].modules.find(m => m.type === type);
// After movement, another higher layer may cover the object's canvas hit target.
const select = name => page.locator('.layer-list').getByRole('button', { name, exact: true }).click();
const synced = () => expect(page.locator('.statusbar')).toContainText('Synced to OBS');
try {
  await page.goto('http://127.0.0.1:5192'); await expect(page.getByText('Capture connected')).toBeVisible();
  await check('quoted module IDs drag and resize without selector errors', async () => {
    await select('Keyboard'); await expect(page.getByLabel('X', { exact: true })).toHaveValue(String(1920 - module('keyboard').w));
    const hitbox = page.getByRole('button', { name: 'Select Keyboard', exact: true }), box = await hitbox.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 45, box.y + box.height / 2 - 20, { steps: 8 }); await page.mouse.up();
    await expect.poll(() => module('keyboard').x).toBeLessThan(1920 - module('keyboard').w);
    const before = module('keyboard').w, handle = await page.getByRole('button', { name: 'Resize Keyboard', exact: true }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x - 18, handle.y - 12, { steps: 5 }); await page.mouse.up();
    await expect.poll(() => module('keyboard').w).toBeLessThan(before);
  });
  await check('locked fields and mouse mode preserve the complete transform', async () => {
    await select('Mouse Buttons'); await page.getByLabel('Lock position', { exact: true }).check(); await synced();
    for (const label of ['X', 'Y', 'Width', 'Height']) await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
    const { x, y, w, h } = module('mouse'); await page.getByLabel('Display', { exact: true }).selectOption('Mouse Diagram');
    await expect.poll(() => module('mouse').mouseMode).toBe('Mouse Diagram'); expect(module('mouse')).toMatchObject({ x, y, w, h });
    await page.getByLabel('Lock position', { exact: true }).uncheck();
  });
  await check('gap extremes keep all key surfaces within the selected module', async () => {
    await select('Keyboard');
    for (const gap of [0, 8, 30]) {
      await page.getByLabel('Key gap', { exact: true }).fill(String(gap)); await expect.poll(() => module('keyboard').gap).toBe(gap);
      const inside = await page.locator('.preview-viewport .module-keyboard').evaluate(el => {
        const box = el.getBoundingClientRect(); return [...el.querySelectorAll('.overlay-key')].every(k => { const r = k.getBoundingClientRect(); return r.right <= box.right + .5 && r.bottom <= box.bottom + .5; });
      }); expect(inside).toBe(true);
    }
  });
  await check('non-interactive modules hide press controls and Trail hides typography', async () => {
    await select('Mouse Trail'); await expect(page.getByText('Press & release', { exact: true })).toHaveCount(0); await expect(page.getByText('Text & typography', { exact: true })).toHaveCount(0);
    await select('Distance'); await expect(page.getByText('Press & release', { exact: true })).toHaveCount(0); await page.getByText('Text & typography', { exact: true }).click();
    await expect(page.getByLabel('Pressed text color', { exact: true })).toHaveCount(0); await expect(page.getByLabel('Fit text inside module', { exact: true })).toBeChecked();
  });
  await check('long Distance text fits a narrow module and manual size remains clipped', async () => {
    await page.getByLabel('Caption', { exact: true }).fill('W'.repeat(100)); await page.getByLabel('Font size', { exact: true }).fill('96'); await page.getByLabel('Width', { exact: true }).fill('40'); await synced();
    const fit = () => page.locator('.preview-viewport .module-distance').evaluate(el => { const b = el.getBoundingClientRect(), c = el.querySelector('.module-text-content').getBoundingClientRect(); return { inside: c.right <= b.right + .5 && c.bottom <= b.bottom + .5, scale: el.querySelector('.module-text-content').style.transform, overflow: getComputedStyle(el).overflow }; });
    await expect.poll(async () => (await fit()).inside).toBe(true);
    const checkbox = page.getByLabel('Fit text inside module', { exact: true }); await checkbox.scrollIntoViewIfNeeded(); const beforeClick = await checkbox.boundingBox();
    // Width still has focus: its disappearing hint must not move the checkbox
    // between pointerdown and pointerup and swallow this real mouse click.
    await checkbox.uncheck(); const afterClick = await checkbox.boundingBox();
    expect(Math.abs(afterClick.y - beforeClick.y)).toBeLessThan(.5);
    expect((await fit()).overflow).toBe('hidden'); expect((await fit()).scale).toBe('scale(1)');
  });
  await check('Sensitivity fits both dimensions and shows only controls for its selected format', async () => {
    await select('Sensitivity'); await page.getByLabel('Format', { exact: true }).selectOption('Detailed'); await page.getByText('Text & typography', { exact: true }).click();
    await page.getByLabel('Font size', { exact: true }).fill('96'); await page.getByLabel('Width', { exact: true }).fill('60'); await page.getByLabel('Height', { exact: true }).fill('40'); await synced();
    expect(await page.locator('.preview-viewport .module-sensitivity').evaluate(el => { const b = el.getBoundingClientRect(), c = el.querySelector('.module-text-content').getBoundingClientRect(); return c.right <= b.right + .5 && c.bottom <= b.bottom + .5; })).toBe(true);
    await page.getByLabel('Format', { exact: true }).selectOption('Minimal'); await expect(page.getByLabel('Game', { exact: true })).toHaveCount(0); await expect(page.getByLabel('DPI', { exact: true })).toHaveCount(0); await expect(page.getByLabel('cm/360', { exact: true })).toHaveCount(1);
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const importDocument = async doc => { await page.locator('input[type="file"][accept=".json,application/json"]:not(.language-settings input)').setInputFiles({ name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(wireJSON(doc)) }); };
  const artwork = JSON.parse(await readFile(new URL('../../ws-server/src-tauri/schema/test-artwork.json', import.meta.url), 'utf8'));
  await check('PNG, JPEG and WebP headers and decoded dimensions agree', async () => {
    const valid = await page.evaluate(async () => {
      const { assetSchema } = await import('/src/core/visual.ts'), { validateArtwork } = await import('/src/core/artwork.ts');
      const c = window.document.createElement('canvas'); c.width = 80; c.height = 48; const ctx = c.getContext('2d'); ctx.fillStyle = '#4488aa'; ctx.fillRect(0, 0, 80, 48);
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        const asset = { name: type, width: 80, height: 48, data: c.toDataURL(type, .9) };
        if (!assetSchema.safeParse(asset).success) return false; await validateArtwork({ test: asset });
      }
      return true;
    }); expect(valid).toBe(true);
  });
  await check('JSON import rejects non-images without changing the configuration', async () => {
    await synced(); const before = revision, bad = structuredClone(document); bad.assets.bad = { ...artwork, name: 'bad.png', data: 'data:image/png;base64,aGVsbG8=' };
    await importDocument(bad); await expect(page.getByRole('alert')).toContainText('Image “bad.png”'); expect(revision).toBe(before);
  });
  await check('JSON import decodes raster data and rejects truncated PNG payloads', async () => {
    const before = revision, bad = structuredClone(document), truncated = Buffer.from(artwork.data.split(',')[1], 'base64').subarray(0, 33);
    bad.assets.bad = { ...artwork, name: 'truncated.png', data: 'data:image/png;base64,' + truncated.toString('base64') };
    await importDocument(bad); await expect(page.getByRole('alert')).toContainText('Image “truncated.png” is damaged'); expect(revision).toBe(before);
  });
  await check('invalid out-of-frame imports are rejected without changing the layout',async()=>{const before=revision,doc=structuredClone(document);for(const m of doc.profiles[0].modules){m.x=1920;m.y=1080;}await importDocument(doc);await expect(page.getByRole('alert')).toContainText('Import rejected');expect(revision).toBe(before);});
  await check('slow artwork decoding cannot restore an older configuration', async () => {
    await synced();
    await page.evaluate(data => {
      const decode = Image.prototype.decode; window.__slowDecodeDone = false;
      Image.prototype.decode = function () { if (this.src !== data) return decode.call(this); return new Promise((resolve, reject) => setTimeout(() => decode.call(this).then(() => { window.__slowDecodeDone = true; resolve(); }, reject), 300)); };
      window.__restoreDecode = () => { Image.prototype.decode = decode; };
    }, artwork.data);
    const older = structuredClone(document); older.assets.paint = artwork; older.gameProfiles[0].name = 'Older artwork config';
    broadcast({ type: 'studio_config', document: older, revision: String(++revision) });
    document = structuredClone(document); document.gameProfiles[0].name = 'Newest config';
    broadcast({ type: 'studio_config', document, revision: String(++revision) });
    await page.getByRole('button', { name: 'Profiles', exact: true }).click();
    await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Newest config');
    await expect.poll(() => page.evaluate(() => window.__slowDecodeDone)).toBe(true);
    await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Newest config');
    await page.evaluate(() => window.__restoreDecode()); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  });
  await check('missing browser overlay page blocks URL copying', async () => {
    await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
    await page.route('**/overlay.html', route => route.fulfill({ status: 404, body: 'missing' })); await page.getByRole('button', { name: 'Copy OBS URL', exact: true }).first().click();
    await expect(page.getByRole('alert')).toContainText('overlay page is unavailable'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged'); await page.unroute('**/overlay.html');
  });
  await check('native disabled HTTP and bind errors block copying with specific instructions', async () => {
    const nativeContext = await browser.newContext({ viewport: { width: 1560, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await nativeContext.addInitScript(() => { window.__httpFixture = null; window.__TAURI__ = { core: { invoke: async command => { if (['enum_keyboards', 'enum_mice', 'check_linux_perms'].includes(command)) throw Error('unsupported platform'); return command === 'get_config' ? { host: '127.0.0.1', port: 4498, auth_token: 'editor-test', http_enabled: false, http_port: 4456, capture_enabled: true, analog_keyboard: '', key_whitelist: [], raw_mouse_min_delta: 0, send_mouse_move: true, cpu_affinity: [], linux_evdev_keyboard_device: '', linux_raw_mouse_device: '' } : command === 'get_http_status' ? window.__httpFixture : command === 'get_device_status' ? { keyboard_count: 1, mouse_count: 1, capture_running: true } : null; } } }; });
    const native = await nativeContext.newPage(); native.on('pageerror', e => errors.push(e.message)); await native.goto('http://127.0.0.1:5192'); await expect(native.getByText('Capture connected')).toBeVisible();
    await native.getByRole('button', { name: 'Copy OBS URL', exact: true }).first().click(); await expect(native.getByRole('alert')).toContainText('HTTP server is disabled');
    await native.evaluate(() => { window.__httpFixture = { running: false, bind_error: 'inuse', host: '127.0.0.1', port: 4456, overlay_available: true }; });
    await native.getByRole('button', { name: 'Copy OBS URL', exact: true }).first().click(); await expect(native.getByRole('alert')).toContainText('already in use'); await expect(native.getByLabel('OBS URL', { exact: true })).toHaveValue(''); await nativeContext.close();
  });
  expect(errors).toEqual([]); await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/editor-results.json', import.meta.url), JSON.stringify({ results, errors }, null, 2));
} finally { clearInterval(heartbeat); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(r => wss.close(r)); await vite.close(); }
