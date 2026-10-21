import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument } from '../src/core/config.ts';
const artifacts = new URL('../artifacts/', import.meta.url); await mkdir(artifacts, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5194, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4500 });
let document = initialDocument(), revision = 0;
const mods = document.profiles[0].modules, keyboardSeed = mods[0], mouseSeed = mods[1];
mods.slice(2).forEach(m => m.visible = false);
Object.assign(keyboardSeed, { x: 100, y: 200, w: 340, h: 100, layout: 'Custom', keys: [65, 66, 67].map((code, i) => ({ id: String(code), code, label: String.fromCharCode(code), x: i * 60, y: 0, w: 50, h: 50 })) });
Object.assign(mouseSeed, { x: 700, y: 200, w: 300, h: 110 });
keyboardSeed.appearance.backgroundOpacity = mouseSeed.appearance.backgroundOpacity = 0;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = packet => ws.send(JSON.stringify(packet));
  if (m.type === 'auth') { ws.authed = m.token === 'visual-features'; send({ type: 'auth_response', status: ws.authed ? 'success' : 'failed', protocol: 4, studio_revisions: true, studio_visuals: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = m.document; revision++; broadcast({ type: 'studio_config', document, revision: String(revision), origin: m.origin }); send({ type: 'studio_saved', request_id: m.request_id, revision: String(revision) });
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1560, height: 1050 }, acceptDownloads: true });
await context.addInitScript(() => {
  localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4500', token: 'visual-features' }));
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL); window.__activeBlobURLs = new Set();
  URL.createObjectURL = object => { const url = create(object); window.__activeBlobURLs.add(url); return url; };
  URL.revokeObjectURL = url => { window.__activeBlobURLs.delete(url); revoke(url); };
});
const page = await context.newPage(), overlay = await context.newPage(), errors = [], results = [];
for (const p of [page, overlay]) p.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const profile = () => document.profiles.find(p => p.id === document.activeProfileId), module = type => profile().modules.find(m => m.type === type);
const field = label => page.getByLabel(label, { exact: true }), select = name => page.locator('.layer-list').getByRole('button', { name, exact: true }).click();
const undo = () => page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
const dialog = () => page.getByRole('dialog', { name: 'Keycap image placement' });
const openImage = () => page.getByRole('button', { name: 'Position & scale image', exact: true }).click();
const sample = async (points, filename = 'shared-artwork.png') => {
  const buffer = await overlay.screenshot({ omitBackground: true }); await writeFile(new URL(filename, artifacts), buffer);
  return overlay.evaluate(async ({ data, points }) => { const image = new Image(); image.src = data; await image.decode(); const c = window.document.createElement('canvas'); c.width = image.width; c.height = image.height; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]); }, { data: `data:image/png;base64,${buffer.toString('base64')}`, points });
};
try {
  await page.goto('http://127.0.0.1:5194'); await expect(page.locator('.statusbar')).toContainText('Synced to OBS'); await select('Keyboard');
  const data = await page.evaluate(() => { const c = window.document.createElement('canvas'); c.width = 900; c.height = 110; const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 900, 0); g.addColorStop(0, '#ff0000'); g.addColorStop(1, '#0000ff'); ctx.fillStyle = g; ctx.fillRect(0, 0, 900, 110); return c.toDataURL('image/png'); });
  await field('Upload keycap image').setInputFiles({ name: 'shared-gradient.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64') }); await expect(page.getByAltText('Keycap artwork')).toBeVisible(); await field('Image opacity').fill('1'); await expect.poll(() => module('keyboard').image.opacity).toBe(1);
  await overlay.setViewportSize({ width: 1920, height: 1080 }); await overlay.goto('http://127.0.0.1:5194/overlay.html#token=visual-features&ws=ws%3A%2F%2F127.0.0.1%3A4500');
  await overlay.addStyleTag({ content: '.key-label,.overlay-key:after{visibility:hidden}.key-active{display:none}' });
  await check('linking modules synchronizes one image and its adjustments', async () => {
    await page.locator('.artwork-group summary').click(); await field('Share artwork with Mouse Buttons').check();
    await expect.poll(() => module('mouse').image.assetId).toBe(module('keyboard').image.assetId); expect(module('keyboard').image.groupId).toBeTruthy(); expect(module('mouse').image).toEqual(module('keyboard').image);
    await expect(overlay.locator('[data-button="1"] .key-art')).toHaveCount(1);
  });
  await check('pixels continue across differently scaled modules while gaps stay transparent', async () => {
    await expect.poll(async () => (await sample([[150, 250], [270, 250], [747, 230], [500, 230]]))[0][3]).toBe(255);
    const pixels = await sample([[150, 250], [270, 250], [747, 230], [500, 230]]);
    expect(pixels[0][0]).toBeGreaterThan(pixels[1][0] + 20); expect(pixels[1][0]).toBeGreaterThan(pixels[2][0] + 100); expect(pixels[2][2]).toBeGreaterThan(pixels[0][2] + 150); expect(pixels[3][3]).toBe(0);
  });
  await check('cached surfaces refresh when another group member moves or the same asset is replaced', async () => {
    await expect(page.locator('.statusbar')).toContainText('Synced to OBS');
    const saved = structuredClone(document), original = (await sample([[350, 230]]))[0];
    const publish = () => { revision++; broadcast({ type: 'studio_config', document, revision: String(revision) }); };
    try {
      module('mouse').x = 1050; publish();
      await expect.poll(async () => (await sample([[350, 230]]))[0][0]).toBeGreaterThan(original[0] + 10);
      const green = await page.evaluate(() => { const c = window.document.createElement('canvas'); c.width = 900; c.height = 110; const ctx = c.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 900, 110); return c.toDataURL('image/png'); });
      document.assets[module('keyboard').image.assetId].data = green; publish();
      await expect.poll(async () => (await sample([[150, 230]]))[0][1]).toBeGreaterThan(240);
    } finally { document = saved; publish(); }
    await expect.poll(async () => (await sample([[350, 230]]))[0][0]).toBe(original[0]);
  });
  await check('rotated tiled artwork fills both very wide and very tall key surfaces', async () => {
    for (const vertical of [false, true]) {
      await overlay.evaluate(async ({ vertical, asset }) => {
        const [{ Scene }, { InputEngine }, { initialDocument }] = await Promise.all([import('/src/renderer/scene.ts'), import('/src/core/input.ts'), import('/src/core/config.ts')]);
        const doc = initialDocument(), m = doc.profiles[0].modules[0]; doc.assets.paint = asset; m.image = { ...m.image, enabled: true, assetId: 'paint', fit: 'Tile', rotation: 90, scale: .05, opacity: 1, flipX: true };
        Object.assign(m, { x: 100, y: 50, w: vertical ? 40 : 1000, h: vertical ? 1000 : 40, radius: 0 }); m.appearance.borderWidth = 0; m.appearance.backgroundOpacity = 0;
        m.keys = [{ id: 'tile', code: 70, label: '', x: 0, y: 0, w: vertical ? 20 : 1000, h: vertical ? 1000 : 20 }];
        const root = window.document.createElement('div'); root.id = 'tile-check'; Object.assign(root.style, { position: 'fixed', left: '0', top: '0', zIndex: '9999' }); window.document.body.append(root);
        const scene = new Scene(root, new InputEngine()); scene.update(doc, { ...doc.profiles[0], modules: [m] }); window.__disposeTile = () => { scene.dispose(); root.remove(); };
      }, { vertical, asset: document.assets[module('keyboard').image.assetId] });
      const points = vertical ? [[110, 70], [110, 600], [110, 1030]] : [[120, 60], [600, 60], [1080, 60]];
      await expect.poll(async () => (await sample(points, 'rotated-tile.png')).every(p => p[3] === 255)).toBe(true);
      await overlay.evaluate(() => window.__disposeTile());
    }
  });
  await check('editing either member changes the group and Undo restores every member', async () => {
    await select('Mouse Buttons'); await field('Image opacity').fill('0.62'); await expect.poll(() => module('keyboard').image.opacity).toBe(.62); expect(module('mouse').image.opacity).toBe(.62);
    await undo(); await expect.poll(() => module('mouse').image.opacity).toBe(1); expect(module('keyboard').image.opacity).toBe(1); await select('Keyboard');
  });
  await check('the complete image editor previews states and source guides without saving', async () => {
    const before = JSON.stringify(document); await openImage(); const d = dialog();
    await expect(d.locator('.overlay-module')).toHaveCount(2); await d.getByLabel('Source guide (editor only)', { exact: true }).check(); await expect(d.locator('.source-image-guide')).toHaveCount(1); await expect(overlay.locator('.source-image-guide')).toHaveCount(0);
    await d.getByLabel('Preview key state', { exact: true }).selectOption('Pressed'); await expect(d.locator('[data-key="65"]')).toHaveClass(/pressed/); await expect(overlay.locator('[data-key="65"]')).not.toHaveClass(/pressed/);
    await d.getByLabel('Preview zoom', { exact: true }).selectOption('200%'); await d.getByLabel('Image X', { exact: true }).fill('34'); await d.getByLabel('Image brightness', { exact: true }).fill('1.25'); await d.getByRole('button', { name: 'Flip horizontally', exact: true }).click();
    expect(JSON.stringify(document)).toBe(before); await d.getByRole('button', { name: 'Compare original', exact: true }).click(); await expect(d.getByRole('button', { name: 'Showing original', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await d.getByRole('button', { name: 'Center image', exact: true }).click(); await expect(d.getByLabel('Image X', { exact: true })).toHaveValue('0'); await expect(d.getByRole('button', { name: 'Compare original', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(d).not.toBeVisible(); expect(JSON.stringify(document)).toBe(before);
  });
  await check('horizontal mirroring is shared, reaches the output, and is one Undo step', async () => {
    await openImage(); await dialog().getByRole('button', { name: 'Flip horizontally', exact: true }).click(); await dialog().getByRole('button', { name: 'Apply image placement', exact: true }).click();
    await expect.poll(() => module('mouse').image.flipX).toBe(true); expect(module('keyboard').image.flipX).toBe(true);
    await expect.poll(async () => (await sample([[150, 250], [747, 230]], 'shared-artwork-flipped.png'))[0][2]).toBeGreaterThan(200);
    const pixels = await sample([[150, 250], [747, 230]]); expect(pixels[0][2]).toBeGreaterThan(pixels[1][2] + 150);
    await undo(); await expect.poll(() => !!module('keyboard').image.flipX).toBe(false); expect(!!module('mouse').image.flipX).toBe(false);
  });
  await check('image corrections, vertical flip and press behavior apply to all group members', async () => {
    await openImage(); const d = dialog(); await d.getByRole('button', { name: 'Flip vertically', exact: true }).click(); await d.getByLabel('Image rotation', { exact: true }).fill('25'); await d.getByLabel('Image contrast', { exact: true }).fill('1.2'); await d.getByLabel('Image on press', { exact: true }).selectOption('Hide'); await d.getByRole('button', { name: 'Apply image placement', exact: true }).click();
    await expect.poll(() => module('mouse').image.rotation).toBe(25); expect(module('keyboard').image).toEqual(module('mouse').image); expect(module('mouse').image.flipY).toBe(true);
    await expect(overlay.locator('[data-button="1"] .key-art')).toHaveCSS('--image-contrast', '1.2'); await undo(); await expect.poll(() => module('keyboard').image.rotation).toBe(0);
  });
  await check('pressed/analog editor states leave OBS and document input state untouched', async () => {
    await field('Preview key state').selectOption('Pressed'); await expect(page.locator('.preview-viewport [data-key="65"]')).toHaveClass(/pressed/); await expect(overlay.locator('[data-key="65"]')).not.toHaveClass(/pressed/);
    await page.locator('.properties-panel .style-fields').first().locator('summary').filter({ hasText: 'Press & release' }).click(); await field('Press effect').selectOption('Analog Fill');
    const before = JSON.stringify(document); await field('Preview key state').selectOption('Analog'); await field('Preview analog depth').fill('0.37'); await expect(page.locator('.preview-viewport [data-key="65"]')).toHaveCSS('--depth', '37%'); expect(JSON.stringify(document)).toBe(before);
    await field('Preview key state').selectOption('Idle'); broadcast({ event_type: 'key_pressed', rawcode: 65 }); await expect(overlay.locator('[data-key="65"]')).toHaveClass(/pressed/); await expect(page.locator('.preview-viewport [data-key="65"]')).not.toHaveClass(/pressed/);
    await field('Preview key state').selectOption('Input'); await expect(page.locator('.preview-viewport [data-key="65"]')).toHaveClass(/pressed/); broadcast({ event_type: 'key_released', rawcode: 65 }); await expect(overlay.locator('[data-key="65"]')).not.toHaveClass(/pressed/);
  });
  await check('wheel preview stays visible without producing real scroll events', async () => {
    await select('Mouse Buttons'); await field('Preview key state').selectOption('Scroll up'); const wheel = page.locator('.preview-viewport [data-button="6"]'); await expect(wheel).toHaveClass(/pressed/); await page.waitForTimeout(600); await expect(wheel).toHaveClass(/pressed/);
    await expect(overlay.locator('[data-button="6"]')).not.toHaveClass(/pressed/); await field('Preview key state').selectOption('Scroll down'); await expect(page.locator('.preview-viewport [data-button="7"]')).toHaveClass(/pressed/); await field('Preview key state').selectOption('Input');
  });
  await check('hidden group members retain the source coordinate system', async () => {
    await select('Keyboard'); const before = await overlay.locator('[data-key="65"] .image-plane').getAttribute('style'); await page.getByRole('button', { name: 'Hide Mouse Buttons', exact: true }).click(); await expect(overlay.locator('.module-mouse')).toBeHidden(); expect(await overlay.locator('[data-key="65"] .image-plane').getAttribute('style')).toBe(before);
    await page.getByRole('button', { name: 'Show Mouse Buttons', exact: true }).click(); await expect(overlay.locator('.module-mouse')).toBeVisible();
    const width = await overlay.locator('[data-key="65"] .image-plane').evaluate(el => el.style.width);
    await page.getByRole('button', { name: 'Edit keys on canvas', exact: true }).click(); await expect(page.locator('.preview-viewport [data-key="65"] .image-plane')).toHaveCSS('width', width);
    await page.getByRole('button', { name: 'Finish editing keys on canvas', exact: true }).click();
  });
  await check('unlinking keeps an independent image and Undo restores shared membership', async () => {
    if (!await field('Share artwork with Mouse Buttons').isVisible()) await page.locator('.artwork-group summary').click();
    await field('Share artwork with Mouse Buttons').uncheck(); await expect.poll(() => module('mouse').image.groupId).toBeUndefined(); expect(module('mouse').image.assetId).toBe(module('keyboard').image.assetId);
    await field('Image opacity').fill('0.8'); await expect.poll(() => module('keyboard').image.opacity).toBe(.8); expect(module('mouse').image.opacity).toBe(1);
    await undo(); await expect.poll(() => module('keyboard').image.opacity).toBe(1); await undo(); await expect.poll(() => module('mouse').image.groupId).toBe(module('keyboard').image.groupId);
  });
  await check('preset thumbnails render the saved scene and exports remap group identities', async () => {
    await openImage(); await dialog().getByRole('button', { name: 'Flip horizontally', exact: true }).click(); await dialog().getByRole('button', { name: 'Apply image placement', exact: true }).click(); await expect.poll(() => module('keyboard').image.flipX).toBe(true);
    await page.getByRole('button', { name: 'Presets', exact: true }).click(); await field('Preset name').fill('Shared artwork'); await page.getByRole('button', { name: 'Save current layout', exact: true }).click(); await expect.poll(() => document.presets.length).toBe(1);
    const saved = page.locator('.saved-preset').first(); await saved.scrollIntoViewIfNeeded(); await expect(saved.locator('.scene-thumbnail .key-art').first()).toBeVisible(); await expect(saved.locator('.module-trail')).toBeHidden();
    const downloadPromise = page.waitForEvent('download'); await saved.getByRole('button', { name: 'Export preset', exact: true }).click(); const download = await downloadPromise, text = await readFile(await download.path(), 'utf8');
    await field('Import preset file').setInputFiles({ name: 'shared.json', mimeType: 'application/json', buffer: Buffer.from(text) }); await expect.poll(() => document.presets.length).toBe(2);
    const imported = document.presets[1].modules; expect(imported[0].image.groupId).not.toBe(module('keyboard').image.groupId); expect(imported[0].image.groupId).toBe(imported[1].image.groupId); expect(imported[0].image.flipX).toBe(true); expect(imported[0].image.assetId).not.toBe(module('keyboard').image.assetId);
  });
  await check('factory cards show real scenes and restore different complete compositions', async () => {
    const card = name => page.locator('.preset-large').filter({ has: page.getByRole('heading', { name, exact: true }) }); await card('Essential').scrollIntoViewIfNeeded(); await expect(card('Essential').locator('.scene-thumbnail .module-keyboard')).toBeVisible();
    const dpi = profile().dpi; await card('Essential').getByRole('button', { name: 'Reset layout', exact: true }).click(); await expect.poll(() => module('keyboard').keys.length).toBe(4); expect(module('trail').visible).toBe(false); expect(profile().dpi).toBe(dpi); const x = module('keyboard').x;
    await card('Glass').getByRole('button', { name: 'Reset layout', exact: true }).click(); await expect.poll(() => module('mouse').mouseMode).toBe('Mouse Diagram'); expect(module('keyboard').x).not.toBe(x); expect(module('sensitivity').textLayout).toBe('Vertical');
    await page.getByRole('button', { name: 'Studio', exact: true }).click(); await undo(); await expect.poll(() => module('keyboard').x).toBe(x);
  });
  await check('theme-only application preserves current geometry and the live layout preview', async () => {
    const before = profile().modules.map(m => [m.x, m.y, m.w, m.h, m.visible]); await page.locator('.theme-card').filter({ hasText: 'Neon' }).click(); await expect.poll(() => profile().theme).toBe('Neon'); expect(profile().modules.map(m => [m.x, m.y, m.w, m.h, m.visible])).toEqual(before);
    await page.locator('.theme-card').first().scrollIntoViewIfNeeded(); await expect(page.locator('.theme-card').first().locator('.scene-thumbnail .module-keyboard')).toBeVisible();
  });
  await check('preview scenes release their image URLs and reload retains saved groups', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.__activeBlobURLs.size)).toBe(0);
    await expect(page.locator('.statusbar')).toContainText('Synced to OBS'); await page.reload(); await page.getByRole('button', { name: 'Presets', exact: true }).click(); expect(document.presets[0].modules[0].image.groupId).toBeTruthy(); expect(document.presets[0].modules[0].image.flipX).toBe(true);
    await page.locator('.saved-preset').first().getByRole('button', { name: 'Apply', exact: true }).click(); await page.getByRole('button', { name: 'Studio', exact: true }).click(); await select('Keyboard');
    await expect(field('Preview key state')).toHaveValue('Input'); await page.setViewportSize({ width: 1366, height: 768 }); await openImage(); await expect(dialog()).toBeVisible(); await dialog().getByLabel('Source guide (editor only)', { exact: true }).check();
    expect(await dialog().evaluate(el => el.getBoundingClientRect().height <= innerHeight * .95)).toBe(true); await page.screenshot({ path: fileURLToPath(new URL('visual-workspace-1366.png', artifacts)) }); await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Presets', exact: true }).click(); await expect(page.locator('.preset-large').first().locator('.scene-thumbnail .module-keyboard')).toBeVisible(); await page.screenshot({ path: fileURLToPath(new URL('real-preset-previews.png', artifacts)) });
  });
  expect(errors).toEqual([]); await writeFile(new URL('visual-features-results.json', artifacts), JSON.stringify({ checks: results.length, results, errors }, null, 2)); console.log(`${results.length} visual feature checks passed.`);
} finally { clearInterval(heartbeat); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await vite.close(); }
