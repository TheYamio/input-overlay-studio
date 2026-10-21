// End-to-end renderer/editor tests use an explicitly synthetic, authenticated server.
// This never substitutes for validating Windows Raw Input or OBS.
import { chromium, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4455 });
let document = null; let revision = 0;
let sequence = 0; const heldKeys = new Map(), heldButtons = new Set();
const broadcast = packet => {
  if (packet.event_type) {
    packet = { ...packet, sequence: ++sequence };
    if (packet.event_type === 'key_pressed') heldKeys.set(packet.rawcode, 1);
    if (packet.event_type === 'key_released') heldKeys.delete(packet.rawcode);
    if (packet.event_type === 'analog_depth') { if (packet.depth > 0) heldKeys.set(packet.rawcode, packet.depth); else heldKeys.delete(packet.rawcode); }
    if (packet.event_type === 'mouse_pressed') heldButtons.add(packet.button);
    if (packet.event_type === 'mouse_released') heldButtons.delete(packet.button);
    if (packet.event_type === 'input_reset') { heldKeys.clear(); heldButtons.clear(); }
  }
  const text = JSON.stringify(packet); for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(text); };
wss.on('connection', ws => {
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'auth') { ws.authed = message.token === 'integration-test'; ws.send(JSON.stringify({ type: 'auth_response', status: ws.authed ? 'success' : 'failed', protocol: 4, studio_revisions: true, state_snapshot: true })); return; }
    if (!ws.authed) return;
    if (message.type === 'input_snapshot') ws.send(JSON.stringify({ type: 'input_snapshot', sequence: ++sequence, keys: [...heldKeys].map(([rawcode, depth]) => ({ rawcode, depth })), buttons: [...heldButtons] }));
    if (message.type === 'studio_get') { ws.send(JSON.stringify({ type: 'studio_config', revision: String(revision), document })); ws.gotConfig = true; }
    if (message.type === 'studio_set') { if (message.base_revision !== String(revision)) { ws.send(JSON.stringify({ type: 'studio_conflict', document, revision: String(revision), request_id: message.request_id })); return; } revision++; document = message.document; broadcast({ type: 'studio_config', revision: String(revision), document, origin: message.origin }); ws.send(JSON.stringify({ type: 'studio_saved', revision: String(revision), request_id: message.request_id })); }
    if (message.type === 'distance_reset') broadcast({ type: 'distance_total', cm: 0 });
  });
});
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 3000);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1560, height: 1000 }, permissions: ['clipboard-write', 'clipboard-read'] });
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4455', token: 'integration-test' })));
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const results = [];
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
try {
  await page.goto('http://127.0.0.1:5173');
  await check('authenticated Studio and automatic configuration synchronization', async () => { await expect(page.getByText('Capture connected')).toBeVisible(); await expect.poll(() => document?.version).toBe(2); });
  await check('live simultaneous keys, modifiers, mouse and wheel', async () => {
    for (const rawcode of [87, 65, 160, 162, 32]) broadcast({ event_type: 'key_pressed', rawcode });
    for (const button of [1, 2, 4, 5]) broadcast({ event_type: 'mouse_pressed', button });
    await expect(page.locator('[data-key="87"]')).toHaveClass(/pressed/); await expect(page.locator('[data-key="160"]')).toHaveClass(/pressed/); await expect(page.locator('[data-button="2"]')).toHaveClass(/pressed/);
    broadcast({ event_type: 'mouse_wheel', rotation: -1 }); await expect(page.locator('[data-button="6"]')).toHaveClass(/pressed/); await expect(page.locator('[data-button="6"]')).not.toHaveClass(/pressed/, { timeout: 2000 });
    broadcast({ event_type: 'input_reset' }); await expect(page.locator('.overlay-key.pressed')).toHaveCount(0);
  });
  await check('profile calculation and explicit unknown KovaaK scale', async () => {
    await page.getByRole('button', { name: 'Profiles', exact: true }).click(); await expect(page.locator('.calculation>strong')).toContainText('39.97');
    await page.getByLabel('In-game sensitivity', { exact: true }).fill('2,6'); await expect(page.locator('.calculation>strong')).toContainText('19.98');
    await page.getByLabel('Game', { exact: true }).selectOption('KovaaK’s'); await expect(page.locator('.calculation>strong')).toContainText('—');
    await page.getByLabel('Sensitivity scale', { exact: true }).selectOption('Source'); await expect(page.locator('.calculation>strong')).toContainText('19.98');
    await page.getByLabel('Game', { exact: true }).selectOption('Counter-Strike 2'); await page.getByLabel('In-game sensitivity', { exact: true }).fill('1.3');
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
  });
  await check('drag, resize, snap and undo/redo', async () => {
    const hitbox = page.getByRole('button', { name: 'Select Mouse Trail', exact: true }); const before = document.profiles[0].modules.find(m => m.type === 'trail'); const oldX = before.x;
    const bounds = await hitbox.boundingBox(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 15, { steps: 8 }); await page.mouse.up();
    await expect.poll(() => document.profiles[0].modules.find(m => m.type === 'trail').x).not.toBe(oldX);
    const movedX = document.profiles[0].modules.find(m => m.type === 'trail').x;
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click(); await expect.poll(() => document.profiles[0].modules.find(m => m.type === 'trail').x).toBe(oldX);
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click(); await expect.poll(() => document.profiles[0].modules.find(m => m.type === 'trail').x).toBe(movedX);
    const sizeBefore = document.profiles[0].modules.find(m => m.type === 'trail').w;
    const handle = await page.getByRole('button', { name: 'Resize Mouse Trail', exact: true }).boundingBox(); await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + 25, handle.y + 20, { steps: 8 }); await page.mouse.up(); await expect.poll(() => document.profiles[0].modules.find(m => m.type === 'trail').w).toBeGreaterThan(sizeBefore);
  });
  await check('canvas alignment, reset and locked-module protection', async () => {
    await page.getByRole('button', { name: 'Align Center X', exact: true }).click();
    await expect.poll(() => { const m = document.profiles[0].modules.find(m => m.type === 'trail'); return m.x === (1920 - m.w) / 2; }).toBe(true);
    await page.getByRole('button', { name: 'Align Bottom', exact: true }).click();
    await expect.poll(() => { const m = document.profiles[0].modules.find(m => m.type === 'trail'); return m.y + m.h; }).toBe(1080);
    await page.getByLabel('Lock position', { exact: true }).check(); await expect(page.getByRole('button', { name: 'Align Left', exact: true })).toBeDisabled();
    await page.getByLabel('Lock position', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Reset position', exact: true }).click();
    await expect.poll(() => document.profiles[0].modules.find(m => m.type === 'trail').x).toBe(790);
  });
  await check('incremental scene updates retain canvas, keys and trail geometry', async () => {
    const report = await page.evaluate(async () => {
      const { Scene } = await import('/src/renderer/scene.ts'); const { InputEngine } = await import('/src/core/input.ts'); const { initialDocument, activeProfile } = await import('/src/core/config.ts');
      const root = window.document.createElement('div'); window.document.body.append(root);
      root.style.cssText = 'position:fixed;left:-10000px;top:0';
      const d = initialDocument(), p = activeProfile(d), engine = new InputEngine();
      p.modules = p.modules.filter(m => m.type === 'trail' || m.type === 'keyboard');
      const module = p.modules.find(m => m.type === 'trail'); Object.assign(module, { duration: 10000, position: 'Fixed Field', grid: false, center: false, marker: 'None' });
      const scene = new Scene(root, engine); scene.update(d, p);
      const canvas = root.querySelector('canvas'), key = root.querySelector('[data-key="87"]'), context = canvas.getContext('2d');
      const endpoints = []; const lineTo = context.lineTo.bind(context); context.lineTo = (x, y) => { endpoints.push([x, y]); lineTo(x, y); };
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      engine.ingest({ event_type: 'key_pressed', rawcode: 87 });
      engine.ingest({ event_type: 'mouse_moved', dx: 12, dy: 8, distance_counts: 15 }); await frame();
      engine.ingest({ event_type: 'mouse_moved', dx: 10, dy: 4, distance_counts: 11 }); await frame();
      const previous = endpoints.at(-1); endpoints.length = 0;
      const next = structuredClone(d); activeProfile(next).modules.find(m => m.type === 'trail').accent = '#ffcc88';
      scene.update(next, activeProfile(next)); await frame();
      const sameCanvas = root.querySelector('canvas') === canvas, sameKey = root.querySelector('[data-key="87"]') === key;
      const geometryPreserved = endpoints.some(point => JSON.stringify(point) === JSON.stringify(previous));
      activeProfile(next).modules.find(m => m.type === 'trail').w += 30; scene.update(next, activeProfile(next)); await frame();
      const sameAfterResize = root.querySelector('canvas') === canvas;
      const held = key.classList.contains('pressed'); scene.dispose(); root.remove();
      return { sameCanvas, sameKey, geometryPreserved, sameAfterResize, held, listenersAfterDispose: engine.listeners.size };
    });
    expect(report).toEqual({ sameCanvas: true, sameKey: true, geometryPreserved: true, sameAfterResize: true, held: true, listenersAfterDispose: 0 });
  });
  await check('module properties, appearance and persistence after reload', async () => {
    await page.getByLabel('Style', { exact: true }).selectOption('Neon Trail'); await page.getByLabel('Line color', { exact: true }).fill('#82c7ff');
    await expect.poll(() => document.profiles[0].modules.find(m => m.type === 'trail').accent).toBe('#82c7ff');
    await page.reload(); await expect(page.getByText('Capture connected')).toBeVisible(); await page.getByRole('button', { name: 'Select Mouse Trail', exact: true }).click(); await expect(page.getByLabel('Style', { exact: true })).toHaveValue('Neon Trail');
  });
  await check('factory themes and saved preset actions', async () => {
    await page.getByRole('button', { name: 'Presets', exact: true }).click(); await page.locator('.preset-large').filter({ has: page.getByRole('heading', { name: 'Neon', exact: true }) }).getByRole('button', { name: 'Apply theme', exact: true }).click();
    await page.getByLabel('Preset name').fill('Test layout'); await page.getByRole('button', { name: 'Save current layout', exact: true }).click(); await expect(page.getByLabel('Rename saved preset')).toHaveValue('Test layout');
    await page.getByRole('button', { name: 'Duplicate preset', exact: true }).click(); await expect(page.locator('.saved-preset')).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete preset', exact: true }).last().click(); await expect(page.locator('.saved-preset')).toHaveCount(1);
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
  });
  const overlay = await context.newPage(); overlay.on('pageerror', e => errors.push(e.message));
  await check('OBS source is transparent and editor-free', async () => {
    await page.getByRole('button', { name: /Copy OBS URL/ }).click(); await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('overlay.html'); const url = await page.evaluate(() => navigator.clipboard.readText());
    if (url.includes('demo=')) throw Error('Demo leaked into OBS URL');
    await overlay.goto(url); await expect(overlay.locator('.overlay-module')).toHaveCount(document.profiles[0].modules.length);
    expect(await overlay.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)'); await expect(overlay.locator('nav,button,header')).toHaveCount(0);
  });
  await check('OBS fits 1440p and non-16:9 viewports without stretching', async () => {
    for (const [width, height, expectedWidth, expectedHeight, left, top] of [[2560, 1440, 2560, 1440, 0, 0], [1920, 1200, 1920, 1080, 0, 60], [1280, 720, 1280, 720, 0, 0]]) {
      await overlay.setViewportSize({ width, height });
      await expect.poll(async () => { const rect = await overlay.locator('#overlay').boundingBox(); return rect && [Math.round(rect.width), Math.round(rect.height), Math.round(rect.x), Math.round(rect.y)]; }).toEqual([expectedWidth, expectedHeight, left, top]);
    }
  });
  await check('demo remains isolated from active OBS input', async () => {
    await page.getByRole('button', { name: 'Demo', exact: true }).click(); await expect(page.getByText('DEMO PREVIEW', { exact: true })).toBeVisible();
    await expect(page.locator('.overlay-key.pressed').first()).toBeVisible(); await expect(overlay.locator('.overlay-key.pressed')).toHaveCount(0);
    await page.getByRole('button', { name: 'Live', exact: true }).click();
  });
  await check('OBS receives real transport events and configuration updates', async () => {
    broadcast({ event_type: 'key_pressed', rawcode: 87 }); await expect(overlay.locator('[data-key="87"]')).toHaveClass(/pressed/);
    broadcast({ event_type: 'mouse_moved', dx: 40, dy: 20, distance_counts: 80, distance_cm: 321 }); await expect(overlay.locator('.module-distance strong')).toContainText('3.2 m');
    await page.getByRole('button', { name: 'Select Mouse Trail', exact: true }).click(); await page.getByLabel('Style', { exact: true }).selectOption('Segmented Trail');
    await expect.poll(() => document.profiles[0].modules.find(m => m.type === 'trail').trailStyle).toBe('Segmented Trail');
  });
  await check('reconnect restores held keys and buttons, then rejects older queued releases', async () => {
    broadcast({ event_type: 'key_pressed', rawcode: 87 }); broadcast({ event_type: 'mouse_pressed', button: 1 });
    await expect(overlay.locator('[data-button="1"]')).toHaveClass(/pressed/);
    for (const ws of wss.clients) ws.close();
    await expect(overlay.locator('.overlay-key.pressed')).toHaveCount(0);
    await expect(page.getByText('Capture connected')).toBeVisible({ timeout: 8000 });
    await expect.poll(() => [...wss.clients].filter(ws => ws.authed && ws.gotConfig).length).toBe(2);
    await expect(overlay.locator('[data-key="87"]')).toHaveClass(/pressed/); await expect(overlay.locator('[data-button="1"]')).toHaveClass(/pressed/);
    for (const ws of wss.clients) if (ws.authed) ws.send(JSON.stringify({ event_type: 'key_released', rawcode: 87, sequence: sequence - 1 }));
    await overlay.waitForTimeout(120); await expect(overlay.locator('[data-key="87"]')).toHaveClass(/pressed/);
    broadcast({ type: 'distance_total', cm: 8 }); await expect(overlay.locator('[data-key="87"]')).toHaveClass(/pressed/);
    broadcast({ event_type: 'input_reset' });
  });
  await check('keys released while disconnected stay released after recovery', async () => {
    broadcast({ event_type: 'key_pressed', rawcode: 87 });
    for (const ws of wss.clients) ws.close();
    broadcast({ event_type: 'key_released', rawcode: 87 });
    await expect(page.getByText('Capture connected')).toBeVisible({ timeout: 8000 });
    await expect.poll(() => [...wss.clients].filter(ws => ws.authed && ws.gotConfig).length).toBe(2);
    await expect(overlay.locator('.overlay-key.pressed')).toHaveCount(0);
  });
  await check('overlay continues without an editor window', async () => {
    await page.close(); broadcast({ event_type: 'key_pressed', rawcode: 68 }); await expect(overlay.locator('[data-key="68"]')).toHaveClass(/pressed/); broadcast({ event_type: 'input_reset' });
  });
  await overlay.close();
  const screenshotPage = await context.newPage(); await screenshotPage.goto('http://127.0.0.1:5173'); await screenshotPage.getByRole('button', { name: 'Demo', exact: true }).click(); await screenshotPage.waitForTimeout(900); await screenshotPage.screenshot({ path: fileURLToPath(new URL('studio.png', artifacts)), fullPage: true });
  await check('no browser runtime errors', async () => expect(errors).toEqual([]));
  await writeFile(new URL('browser-results.json', artifacts), JSON.stringify({ results, errors }, null, 2));
  console.log(`${results.length} browser checks passed.`);
} finally {
  clearInterval(heartbeat); await context.close(); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await vite.close();
}
