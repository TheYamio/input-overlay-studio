import contract from '../src/core/compatibility/contract.json' with {type:'json'};
// Isolated synthetic capture server. Never reads the user's native configuration.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument, documentSchema , parseDocument} from '../src/core/config.ts';
const artifacts = new URL('../artifacts/presets/', import.meta.url); await mkdir(artifacts, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5218, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4618 });
let document = initialDocument(), revision = 0;
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = packet => ws.send(JSON.stringify(packet)); if(m.document?.version===4)m.document=parseDocument(JSON.stringify(m.document));
  if (m.type === 'auth') { send({ type: 'auth_response', studio_capabilities:{...contract,role:'capture'}, status: 'success', studio_revisions: true, studio_visuals: true, studio_animation: true, studio_shapes: true, studio_preset_metadata: true }); return; }
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision) }); return; }
    document = documentSchema.parse(m.document); revision++;
    for (const client of wss.clients) if (client.readyState === 1) client.send(JSON.stringify({ type: 'studio_config', document, revision: String(revision), origin: m.origin }));
    send({ type: 'studio_saved', revision: String(revision), request_id: m.request_id });
  }
}));
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1560, height: 1050 }, acceptDownloads: true });
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4618', token: 'presets' })));
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const profile = () => document.profiles[0], card = name => page.locator('.library-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
const saved = () => page.locator('.saved-preset'), synced = () => expect(page.locator('.statusbar')).toContainText('Synced to OBS');
try {
  await page.goto('http://127.0.0.1:5218'); await synced(); await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await check('all compositions show descriptions, swatches and an explicit full-layout action', async () => {
    await expect(page.locator('.library-card')).toHaveCount(8);
    await expect(page.getByRole('button', { name: 'Use full layout', exact: true })).toHaveCount(8);
    for (const name of ['Essential','Competitive','Obsidian','Neon','Glass','Clean Recording','Classic Input','Yamio preset']) {
      expect((await card(name).locator('.preset-description').innerText()).length).toBeGreaterThan(40);
      expect(await card(name).locator('.preset-palette i').count()).toBeGreaterThanOrEqual(3);
    }
    await page.screenshot({ path: fileURLToPath(new URL('full-layouts.png', artifacts)), fullPage: true });
    await card('Glass').scrollIntoViewIfNeeded(); await expect(card('Glass').locator('.module-keyboard')).toBeVisible(); await expect(card('Neon').locator('.module-keyboard')).toBeVisible(); await page.screenshot({ path: fileURLToPath(new URL('more-layouts.png', artifacts)), fullPage: true });
    await page.locator('.preset-mode').scrollIntoViewIfNeeded();
  });
  await check('full layouts install vector shapes without changing profile setup', async () => {
    const setup = structuredClone(document.gameProfiles);
    await card('Neon').getByRole('button', { name: 'Use full layout', exact: true }).click();
    await expect.poll(() => profile().theme).toBe('Neon'); await synced();
    expect(document.gameProfiles).toEqual(setup);
    const key = profile().modules[0].keys[0]; expect(document.shapes[key.style.shapeId]).toBeTruthy();
    await card('Neon').getByRole('button', { name: 'Use full layout', exact: true }).click(); await synced(); expect(Object.keys(document.shapes)).toHaveLength(1);
  });
  await check('color mode previews the current buttons and preserves their complete geometry', async () => {
    const original = structuredClone(profile().modules);
    await page.getByRole('button', { name: /Colors on my layout/ }).click();
    await expect(page.getByRole('button', { name: 'Apply colors', exact: true })).toHaveCount(8);
    await expect(card('Yamio preset').locator('.overlay-key').first()).toBeVisible();
    const keyCount = await card('Yamio preset').locator('.module-keyboard .overlay-key').count(); expect(keyCount).toBe(original[0].keys.length);
    await card('Yamio preset').getByRole('button', { name: 'Apply colors', exact: true }).click(); await synced();
    expect(profile().modules.map(m => [m.id,m.x,m.y,m.w,m.h,m.visible,m.effect,m.appearance.shapeId,m.keys.map(k => [k.id,k.code,k.x,k.y,k.w,k.h,k.style?.shapeId])])).toEqual(original.map(m => [m.id,m.x,m.y,m.w,m.h,m.visible,m.effect,m.appearance.shapeId,m.keys.map(k => [k.id,k.code,k.x,k.y,k.w,k.h,k.style?.shapeId])]));
    expect(profile().modules[0].background).toBe('#7255a4'); expect(Object.keys(document.shapes)).toHaveLength(1);
    await page.screenshot({ path: fileURLToPath(new URL('colors-on-my-layout.png', artifacts)), fullPage: true });
  });
  await check('save dialog supports descriptions, palette-only presets, cancellation and focus return', async () => {
    const save = page.getByRole('button', { name: 'Save current setup', exact: true }); await save.click();
    await page.getByLabel('Preset name', { exact: true }).fill(''); await expect(page.getByRole('button', { name: 'Save preset', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(page.locator('dialog')).toHaveCount(0); await expect(save).toBeFocused(); expect(document.presets).toHaveLength(0);
    await save.click(); await page.getByLabel('Preset name', { exact: true }).fill('Моя палитра'); await page.getByLabel('Preset description', { exact: true }).fill('Лиловый и лайм\nДля вечернего стрима'); await page.getByLabel('Preset type', { exact: true }).selectOption('style'); await page.getByRole('button', { name: 'Save preset', exact: true }).click(); await synced();
    expect(document.presets[0]).toMatchObject({ name: 'Моя палитра', kind: 'style', description: 'Лиловый и лайм\nДля вечернего стрима' });
    expect(await saved().locator('.preset-palette i').count()).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: /Full layouts/ }).click(); await expect(saved().getByRole('button', { name: 'Apply colors', exact: true })).toBeVisible(); await expect(saved().getByRole('button', { name: 'Use full layout', exact: true })).toHaveCount(0);
  });
  await check('details save as one transaction and search includes descriptions', async () => {
    await saved().getByRole('button', { name: 'Edit details', exact: true }).click(); await page.getByLabel('Preset description', { exact: true }).fill('Searchable description');
    expect(document.presets[0].description).toContain('Лиловый');
    await page.getByRole('button', { name: 'Save details', exact: true }).click(); await synced();
    await page.getByLabel('Search presets', { exact: true }).fill('searchable'); await expect(saved()).toHaveCount(1);
    await page.getByLabel('Search presets', { exact: true }).fill('absent'); await expect(saved()).toHaveCount(0);
    await page.getByLabel('Search presets', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Studio', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await synced(); expect(document.presets[0].description).toContain('Лиловый');
    await page.getByRole('button', { name: 'Presets', exact: true }).click();
  });
  await check('metadata and palette semantics survive export, import and reload', async () => {
    await page.getByRole('button', { name: /^Saved / }).click();
    const downloadEvent = page.waitForEvent('download'); await saved().getByRole('button', { name: 'Export preset', exact: true }).click(); const download = await downloadEvent; const bytes = await readFile(await download.path());
    expect(JSON.parse(bytes).preset.kind).toBe('style');
    await page.getByLabel('Import preset file', { exact: true }).setInputFiles({ name: 'palette.json', mimeType: 'application/json', buffer: bytes }); await expect.poll(() => document.presets.length).toBe(2); await synced();
    await page.reload(); await synced(); await page.getByRole('button', { name: 'Presets', exact: true }).click(); await expect(page.locator('.library-card')).toHaveCount(10); expect(document.presets[1].description).toContain('Лиловый');
  });
  await check('saved full layouts can be updated, duplicated and removed with Undo', async () => {
    await page.getByRole('button', { name: 'Save current setup', exact: true }).click(); await page.getByLabel('Preset name', { exact: true }).fill('Complete'); await page.getByRole('button', { name: 'Save preset', exact: true }).click(); await synced();
    await card('Complete').getByRole('button', { name: 'Update from current setup', exact: true }).click(); await synced();
    expect(document.presets.at(-1).modules).toEqual(profile().modules);
    await card('Complete').getByRole('button', { name: 'Duplicate preset', exact: true }).click(); await expect.poll(() => document.presets.length).toBe(4);
    await saved().last().getByRole('button', { name: 'Delete preset', exact: true }).click(); await expect.poll(() => document.presets.length).toBe(3);
    await page.getByRole('button', { name: 'Studio', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await synced(); expect(document.presets).toHaveLength(4); await page.getByRole('button', { name: 'Presets', exact: true }).click();
  });
  await check('gallery and dialogs fit small screens without horizontal clipping', async () => {
    for (const width of [960,375]) {
      await page.setViewportSize({ width, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Save current setup', exact: true }).click();
      expect(await page.locator('dialog').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })).toBe(true);
      await page.keyboard.press('Escape');
    }
  });
  expect(errors).toEqual([]); console.log(`${results.length} preset checks passed.`);
} finally { await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await vite.close(); }
