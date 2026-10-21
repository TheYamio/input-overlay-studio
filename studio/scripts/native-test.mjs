import { chromium, expect } from '@playwright/test';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url), data = new URL('.tools/native-smoke/', root);
await mkdir(data, { recursive: true });
const exe = process.env.STUDIO_NATIVE_EXE || fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe', root));
await writeFile(new URL('config.json', data), JSON.stringify({ host: '127.0.0.1', port: 4465, auth_token: 'native-smoke-test', http_enabled: true, http_port: 4466, cpu_affinity: [] }));
let child;
const start = (showUI = false) => { child = spawn(exe, showUI ? [] : ['--tray'], { windowsHide: true, env: { ...process.env, RUST_LOG: 'info', INPUT_OVERLAY_STUDIO_DATA_DIR: fileURLToPath(data), ...(showUI ? { WEBVIEW2_USER_DATA_FOLDER: fileURLToPath(new URL('webview/', data)) } : {}) }, stdio: 'ignore' }); };
const stop = async () => { if (!child || child.exitCode !== null) return; const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exit; };
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
  await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4465', token: 'native-smoke-test' })));
  await check('compiled frontend uses the actual Rust server', async () => {
    await page.goto('http://127.0.0.1:4466/studio/index.html'); await expect(page.getByText('Capture connected')).toBeVisible();
    await expect.poll(async () => { try { return JSON.parse(await readFile(new URL('studio.json', data), 'utf8')).version; } catch { return 0; } }).toBe(2);
    await page.getByRole('button', { name: 'Profiles', exact: true }).click(); await page.getByLabel('Profile name', { exact: true }).fill('Native persisted');
    await expect.poll(async () => JSON.parse(await readFile(new URL('studio.json', data), 'utf8')).profiles[0].name).toBe('Native persisted');
  });
  await check('embedded keycap artwork is accepted and saved by the actual native backend', async () => {
    await page.getByRole('button', { name: 'Studio', exact: true }).click(); await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
    const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d'); ctx.fillStyle = '#4488ee'; ctx.fillRect(0, 0, 64, 64); return c.toDataURL('image/png'); });
    await page.getByLabel('Upload keycap image', { exact: true }).setInputFiles({ name: 'native.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
    await expect.poll(async () => { const d = JSON.parse(await readFile(new URL('studio.json', data), 'utf8')), m = d.profiles.find(p => p.id === d.activeProfileId).modules.find(m => m.type === 'keyboard'); return !!d.assets[m.image.assetId]?.data.startsWith('data:image/webp;base64,'); }).toBe(true);
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
      const auth = receive('auth_response'); ws.send(JSON.stringify({ type: 'auth', token: 'native-smoke-test' })); expect((await auth).studio_revisions).toBe(true);
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
    await stop(); start(); await expect(page.getByText('Capture connected')).toBeVisible({ timeout: 20000 });
    await page.reload(); await expect(page.getByText('Capture connected')).toBeVisible(); await page.getByRole('button', { name: 'Profiles', exact: true }).click(); await expect(page.getByLabel('Profile name', { exact: true })).toHaveValue('Native persisted');
  });
  await check('compiled transparent OBS entry is served locally', async () => {
    const overlay = await context.newPage(); await overlay.goto('http://127.0.0.1:4466/studio/overlay.html#ws=ws%3A%2F%2F127.0.0.1%3A4465&token=native-smoke-test'); await expect(overlay.locator('.overlay-module')).toHaveCount(5); expect(await overlay.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)'); await overlay.close();
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
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true }); await writeFile(new URL('../artifacts/native-results.json', import.meta.url), JSON.stringify({ results, errors, physicalDevicesVerified: false }, null, 2));
} finally { await context.close(); await browser.close(); await stop(); }
