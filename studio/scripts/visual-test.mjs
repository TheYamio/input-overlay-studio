// UI, pixel masking, portable images and migration checks. Input transport is synthetic.
import { chromium, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument } from '../src/core/config.ts';
const artifacts = new URL('../artifacts/', import.meta.url); await mkdir(artifacts, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5177, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4495 });
let document = null; let revision = 0; const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'auth') { ws.authed = m.token === 'visual-test'; ws.send(JSON.stringify({ type: 'auth_response', status: ws.authed ? 'success' : 'failed', protocol: 4, studio_revisions: true, state_snapshot: true })); return; }
  if (!ws.authed) return;
  if (m.type === 'input_snapshot') ws.send(JSON.stringify({ type: 'input_snapshot', sequence: 0, keys: [], buttons: [] }));
  if (m.type === 'studio_get') ws.send(JSON.stringify({ type: 'studio_config', revision: String(revision), document }));
  if (m.type === 'studio_set') { if (m.base_revision !== String(revision)) { ws.send(JSON.stringify({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id })); return; } revision++; document = m.document; broadcast({ type: 'studio_config', revision: String(revision), document, origin: m.origin }); ws.send(JSON.stringify({ type: 'studio_saved', revision: String(revision), request_id: m.request_id })); }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 2000);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1560, height: 1050 }, acceptDownloads: true });
const legacy = initialDocument(); legacy.version = 1; delete legacy.assets;
for (const m of legacy.profiles[0].modules) for (const key of ['appearance', 'image', 'buttonStyles', 'buttonGeometry', 'buttonImages', 'trailAppearance', 'wheelDuration', 'textLayout']) delete m[key];
await context.addInitScript(({ legacy }) => { localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4495', token: 'visual-test' })); if (!localStorage.getItem('input-overlay-studio.v1')) localStorage.setItem('input-overlay-studio.v1', JSON.stringify(legacy)); }, { legacy });
const page = await context.newPage(), errors = [], results = []; page.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
const keyboard = () => document.profiles[0].modules.find(m => m.type === 'keyboard');
const mouse = () => document.profiles[0].modules.find(m => m.type === 'mouse');
let overlay;
try {
  await page.goto('http://127.0.0.1:5177');
  await check('v1 settings migrate and synchronize as v2 with original key positions', async () => {
    await expect(page.getByText('Capture connected')).toBeVisible(); await expect.poll(() => document?.version).toBe(2);
    expect(keyboard().keys).toEqual(legacy.profiles[0].modules[0].keys);
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
  });
  await check('background transparency is independent of label opacity and per-key colors inherit', async () => {
    await page.getByLabel('Background opacity', { exact: true }).fill('0');
    await page.getByLabel('Customize this key', { exact: true }).check();
    await page.getByLabel('Key Accent color', { exact: true }).fill('#ff6600');
    await expect.poll(() => keyboard().keys[0].style?.accent).toBe('#ff6600');
    const color = await page.locator('.preview-viewport [data-key="87"]').evaluate(el => ({ bg: getComputedStyle(el.querySelector('.key-surface')).backgroundColor, label: getComputedStyle(el.querySelector('.key-label')).opacity, accent: el.style.getPropertyValue('--active-bg') }));
    expect(color).toEqual({ bg: 'rgba(22, 27, 32, 0)', label: '1', accent: '#ff6600' });
    await page.getByLabel('Customize this key', { exact: true }).uncheck();
  });
  const source = await page.evaluate(() => { const c = window.document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, '#ff0000'); g.addColorStop(1, '#0000ff'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256); return c.toDataURL('image/png'); });
  await check('upload embeds optimized raster artwork and synchronizes it to OBS', async () => {
    await page.getByLabel('Upload keycap image', { exact: true }).setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: Buffer.from(source.split(',')[1], 'base64') });
    await expect(page.getByAltText('Keycap artwork')).toBeVisible(); await page.getByLabel('Image opacity', { exact: true }).fill('1');
    await expect.poll(() => keyboard().image.opacity).toBe(1); expect(document.assets[keyboard().image.assetId].data).toMatch(/^data:image\/webp;base64,/);
    overlay = await context.newPage(); overlay.on('pageerror', e => errors.push(e.message)); await overlay.setViewportSize({ width: 1920, height: 1080 });
    await overlay.goto('http://127.0.0.1:5177/overlay.html#ws=ws%3A%2F%2F127.0.0.1%3A4495&token=visual-test');
    await expect(overlay.locator('.module-keyboard .key-art')).toHaveCount(7);
    await expect.poll(() => overlay.locator('.module-keyboard .image-content').first().evaluate(el => getComputedStyle(el).backgroundImage)).toMatch(/blob:/);
    await overlay.waitForTimeout(150);
  });
  await check('pixel mask has transparent key gaps and one continuous gradient across caps', async () => {
    const style = await overlay.addStyleTag({ content: '.key-label,.overlay-key:after{visibility:hidden}.key-active{display:none}' });
    const module = overlay.locator('.module-keyboard'); const box = await module.boundingBox();
    const positions = await module.evaluate(el => { const origin = el.getBoundingClientRect(), keys = [65, 83, 68].map(code => el.querySelector(`[data-key="${code}"]`).getBoundingClientRect()); return { samples: keys.map(k => [k.x - origin.x + k.width / 2, k.y - origin.y + k.height / 2]), gap: [(keys[0].right + keys[1].left) / 2 - origin.x, keys[0].top - origin.y + keys[0].height / 2] }; });
    const screenshot = await module.screenshot({ omitBackground: true }); await writeFile(new URL('keycap-mask.png', artifacts), screenshot);
    const pixels = await overlay.evaluate(async ({ data, positions }) => { const img = new Image(); img.src = data; await img.decode(); const c = window.document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...positions.samples, positions.gap].map(([x, y]) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data]); }, { data: `data:image/png;base64,${screenshot.toString('base64')}`, positions });
    expect(box.width).toBeGreaterThan(200); expect(pixels[3][3]).toBe(0); for (const pixel of pixels.slice(0, 3)) expect(pixel[3]).toBe(255);
    expect(pixels[0][0]).toBeGreaterThan(pixels[1][0] + 30); expect(pixels[1][0]).toBeGreaterThan(pixels[2][0] + 30);
    expect(pixels[0][2]).toBeLessThan(pixels[1][2] - 30); expect(pixels[1][2]).toBeLessThan(pixels[2][2] - 30);
    await style.evaluate(el => el.remove());
  });
  await check('art placement supports drag, scale, rotation, cancel and undo', async () => {
    const before = structuredClone(keyboard().image); await page.getByRole('button', { name: 'Position & scale image' }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); const preview = await page.locator('.image-placement').boundingBox();
    await page.mouse.move(preview.x + 100, preview.y + 100); await page.mouse.down(); await page.mouse.move(preview.x + 145, preview.y + 120, { steps: 4 }); await page.mouse.up();
    await expect(page.getByLabel('Image X', { exact: true })).not.toHaveValue('0'); expect(keyboard().image).toEqual(before);
    await page.getByLabel('Image rotation', { exact: true }).fill('25'); await page.getByLabel('Image scale', { exact: true }).fill('1.4'); await page.getByRole('button', { name: 'Apply image placement' }).click();
    await expect.poll(() => keyboard().image.rotation).toBe(25); await expect(overlay.locator('.module-keyboard .image-content').first()).toHaveCSS('transform', /matrix/);
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click(); await expect.poll(() => keyboard().image.rotation).toBe(0);
    await page.getByRole('button', { name: 'Position & scale image' }).click(); await page.getByLabel('Image X', { exact: true }).fill('100'); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(keyboard().image.x).toBe(0);
  });
  await check('per-key image exclusion and pressed artwork modes preserve labels', async () => {
    await page.getByLabel('Include this key in image', { exact: true }).uncheck(); await expect(overlay.locator('[data-key="87"] .key-art')).toHaveCount(0);
    await page.getByLabel('Include this key in image', { exact: true }).check(); await page.getByLabel('Image on press', { exact: true }).selectOption('Hide');
    broadcast({ event_type: 'key_pressed', rawcode: 87 }); await expect(overlay.locator('[data-key="87"]')).toHaveClass(/pressed/);
    await expect(overlay.locator('[data-key="87"] .key-art')).toHaveCSS('opacity', '0'); await expect(overlay.locator('[data-key="87"] .key-label')).toHaveText('W');
    broadcast({ event_type: 'input_reset' }); await page.getByLabel('Image on press', { exact: true }).selectOption('Tint');
  });
  await check('saved preset exports artwork and imports with independent asset identities', async () => {
    await page.getByRole('button', { name: 'Presets', exact: true }).click(); await page.getByLabel('Preset name').fill('Painted caps'); await page.getByRole('button', { name: 'Save current layout', exact: true }).click();
    await expect.poll(() => document.presets.length).toBe(1); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export preset', exact: true }).click(); const download = await downloadPromise;
    const text = await readFile(await download.path(), 'utf8'), bundle = JSON.parse(text); expect(Object.keys(bundle.assets)).toHaveLength(1); expect(text).not.toContain('visual-test');
    await page.getByLabel('Import preset file', { exact: true }).setInputFiles({ name: 'painted.json', mimeType: 'application/json', buffer: Buffer.from(text) }); await expect.poll(() => document.presets.length).toBe(2);
    const imported = document.presets[1].modules.find(m => m.type === 'keyboard'); expect(imported.image.assetId).not.toBe(keyboard().image.assetId); expect(document.assets[imported.image.assetId].data).toBe(document.assets[keyboard().image.assetId].data);
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
  });
  await check('mouse diagram retains button identity when hiding M1 and supports individual geometry', async () => {
    await page.getByRole('button', { name: 'Select Mouse Buttons', exact: true }).click(); await page.getByLabel('Display', { exact: true }).selectOption('Mouse Diagram');
    await expect(overlay.locator('.module-mouse .cap-layout')).toHaveClass(/mouse-diagram/); const before = await overlay.locator('[data-button="2"]').boundingBox(); await page.getByLabel('Show button 1', { exact: true }).uncheck(); await expect(overlay.locator('[data-button="1"]')).toHaveCount(0);
    expect(await overlay.locator('[data-button="2"]').boundingBox()).toEqual(before);
    await page.getByLabel('Edit mouse button', { exact: true }).selectOption('2'); await page.getByLabel('Button X', { exact: true }).fill('150'); await expect.poll(() => mouse().buttonGeometry['2']?.x).toBe(150);
    await page.getByLabel('Customize this button', { exact: true }).check(); await page.getByLabel('Button Accent color', { exact: true }).fill('#ff00aa'); await expect(overlay.locator('[data-button="2"]')).toHaveCSS('--active-bg', '#ff00aa');
    await page.getByLabel('Show button 1', { exact: true }).check();
  });
  await check('reload retains images and live OBS reconnect restores the painted layout', async () => {
    const id = keyboard().image.assetId; await page.reload(); await expect(page.getByText('Capture connected')).toBeVisible(); expect(keyboard().image.assetId).toBe(id);
    for (const ws of wss.clients) ws.close(); await expect(page.getByText('Capture connected')).toBeVisible({ timeout: 8000 }); await expect(overlay.locator('.module-keyboard .key-art')).toHaveCount(7);
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
  });
  await check('non-raster artwork is rejected without replacing the current image', async () => {
    const id = keyboard().image.assetId; await page.getByLabel('Upload keycap image', { exact: true }).setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    await expect(page.getByRole('alert')).toContainText('PNG, JPEG or WebP'); expect(keyboard().image.assetId).toBe(id);
  });
  await check('raster optimization preserves source alpha', async () => {
    const alpha = await page.evaluate(async () => {
      const { readImageAsset } = await import('/src/core/skins.ts');
      const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = 8; canvas.getContext('2d').fillStyle = 'rgba(255,0,0,.5)'; canvas.getContext('2d').fillRect(0, 0, 4, 8);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), asset = await readImageAsset(new File([blob], 'alpha.png', { type: 'image/png' }));
      const image = new Image(); image.src = asset.data; await image.decode(); const c = canvas.getContext('2d'); c.clearRect(0, 0, 8, 8); c.drawImage(image, 0, 0);
      return [c.getImageData(1, 1, 1, 1).data[3], c.getImageData(6, 1, 1, 1).data[3]];
    });
    expect(alpha[0]).toBeGreaterThanOrEqual(126); expect(alpha[0]).toBeLessThanOrEqual(129); expect(alpha[1]).toBe(0);
  });
  await check('typography and border edits reach the renderer, and short taps remain visible', async () => {
    const fields = page.locator('.style-fields').first(); await fields.locator('summary').filter({ hasText: 'Text & typography' }).click(); await page.getByLabel('Font family', { exact: true }).selectOption('Consolas'); await page.getByLabel('Font size', { exact: true }).fill('22');
    await fields.locator('summary').filter({ hasText: 'Borders & shape' }).click(); await page.getByLabel('Border width', { exact: true }).fill('3');
    await expect(overlay.locator('[data-key="87"]')).toHaveCSS('--border-width', '3px'); await expect(overlay.locator('[data-key="87"]')).toHaveCSS('font-family', 'Consolas');
    const flashed = await page.evaluate(async () => {
      const { Scene } = await import('/src/renderer/scene.ts'), { InputEngine } = await import('/src/core/input.ts'), { initialDocument } = await import('/src/core/config.ts');
      const root = window.document.createElement('div'); root.style.cssText = 'position:fixed;left:-10000px'; window.document.body.append(root); const d = initialDocument(), engine = new InputEngine(), scene = new Scene(root, engine); scene.update(d, d.profiles[0]);
      engine.ingest({ event_type: 'key_pressed', rawcode: 87 }); engine.ingest({ event_type: 'key_released', rawcode: 87 });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const key = root.querySelector('[data-key="87"]'); const result = { flash: key.classList.contains('tap-flash'), held: key.classList.contains('pressed'), actualState: engine.keys[87] }; scene.dispose(); root.remove(); return result;
    }); expect(flashed).toEqual({ flash: true, held: false, actualState: 0 });
  });
  await check('immediate reload keeps the last unsent local style edit', async () => {
    await page.getByLabel('Border width', { exact: true }).fill('2'); await page.reload();
    await expect(page.getByText('Capture connected')).toBeVisible(); await expect.poll(() => keyboard().appearance.borderWidth).toBe(2);
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
  });
  await check('visual editor has no browser runtime errors', async () => { expect(errors).toEqual([]); });
  await page.getByRole('button', { name: 'Position & scale image' }).click(); await page.screenshot({ path: fileURLToPath(new URL('keycap-editor.png', artifacts)) }); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const mouseModule = mouse(); mouseModule.buttonGeometry = {}; mouseModule.buttons = [1, 2, 3, 4, 5, 6, 7]; mouseModule.x = 180; mouseModule.y = 680; broadcast({ type: 'studio_config', revision: String(revision), document }); await expect(overlay.locator('[data-button="1"]')).toHaveCount(1);
  await overlay.screenshot({ path: fileURLToPath(new URL('painted-overlay.png', artifacts)), omitBackground: true });
  await writeFile(new URL('visual-results.json', artifacts), JSON.stringify({ date: new Date().toISOString(), results, errors }, null, 2));
  console.log(`${results.length} visual checks passed.`);
} finally { clearInterval(heartbeat); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await vite.close(); }
