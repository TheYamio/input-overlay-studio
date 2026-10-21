import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument } from '../src/core/config.ts';
const vite = await createServer({ server: { host: '127.0.0.1', port: 5193, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4499 });
let document = initialDocument(), revision = 0;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = data => ws.send(JSON.stringify(data));
  if (m.type === 'auth') { ws.authed = m.token === 'customization-test'; send({ type: 'auth_response', status: ws.authed ? 'success' : 'failed', protocol: 4, studio_revisions: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = m.document; revision++; broadcast({ type: 'studio_config', document, revision: String(revision), origin: m.origin }); send({ type: 'studio_saved', revision: String(revision), request_id: m.request_id });
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1560, height: 1050 } });
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4499', token: 'customization-test' })));
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const module = type => document.profiles.find(p => p.id === document.activeProfileId).modules.find(m => m.type === type);
const key = (i = 0) => module('keyboard').keys[i];
const history = () => page.locator('.app-shell').getAttribute('data-history').then(Number);
const field = label => page.getByLabel(label, { exact: true });
const select = name => page.locator('.layer-list').getByRole('button', { name, exact: true }).click();
const undo = () => page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
const redo = () => page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
const cap = label => page.getByRole('button', { name: `Edit key ${label}`, exact: true });
const drag = async (target, dx, dy, cancel = false) => { await target.scrollIntoViewIfNeeded(); const b = await target.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 }); if (cancel) await page.keyboard.press(typeof cancel === 'string' ? cancel : 'Escape'); await page.mouse.up(); };
const assign = () => page.getByRole('button', { name: 'Assign by pressing a key', exact: true }).click();
try {
  await page.goto('http://127.0.0.1:5193'); await expect(page.locator('.statusbar')).toContainText('Synced to OBS'); await select('Keyboard');
  await check('canvas mode selects the same key in the inspector', async () => {
    await page.getByRole('button', { name: 'Edit keys on canvas', exact: true }).click();
    await expect(page.locator('.key-hitbox')).toHaveCount(module('keyboard').keys.length);
    const before = await history(); await cap(key(1).label).click(); expect(await history()).toBe(before); await expect(field('Key label')).toHaveValue(key(1).label);
    await field('Edit key').selectOption('0'); await expect(cap(key().label)).toHaveAttribute('aria-pressed', 'true');
  });
  await check('a key drag commits once and Undo/Redo preserve the module transform', async () => {
    const original = structuredClone(module('keyboard')), before = await history();
    await drag(cap(key().label), 23, 10); await expect.poll(() => key().x).not.toBe(original.keys[0].x);
    expect(await history()).toBe(before + 1); for (const prop of ['x', 'y', 'w', 'h']) expect(module('keyboard')[prop]).toBe(original[prop]);
    const moved = key().x; await undo(); await expect.poll(() => key().x).toBe(original.keys[0].x); await redo(); await expect.poll(() => key().x).toBe(moved);
  });
  await check('key resizing is one action and Escape cancels an uncommitted gesture', async () => {
    const original = structuredClone(key()); await drag(page.getByRole('button', { name: `Resize key ${key().label}`, exact: true }), 12, 8);
    await expect.poll(() => key().w).not.toBe(original.w); await undo(); await expect.poll(() => key().w).toBe(original.w);
    const before = await history(), saved = structuredClone(key()); await drag(cap(key().label), -11, 15, true);
    expect(await history()).toBe(before); expect(key()).toEqual(saved);
    await drag(cap(key().label), 11, -15, 'Control+z'); expect(await history()).toBe(before); expect(key()).toEqual(saved);
  });
  await check('held arrow nudges form one action and Shift moves ten layout units', async () => {
    const start = structuredClone(key()), before = await history(); await cap(key().label).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
    await expect.poll(() => key().x).toBe(start.x + 3); expect(await history()).toBe(before + 1);
    await page.keyboard.press('Shift+ArrowDown'); await expect.poll(() => key().y).toBe(start.y + 10);
    await undo(); await expect.poll(() => key().y).toBe(start.y); await undo(); await expect.poll(() => key().x).toBe(start.x);
  });
  await check('locked modules keep key geometry fixed through canvas and inspector', async () => {
    await field('Lock position').check(); await expect(field('Key X')).toBeDisabled(); const original = structuredClone(key());
    await drag(cap(key().label), 18, 12); await cap(key().label).focus(); await page.keyboard.press('ArrowRight'); expect(key()).toEqual(original);
    await field('Lock position').uncheck(); await expect(field('Key X')).toBeEnabled();
  });
  await check('physical binding distinguishes right modifiers and has one-step Undo', async () => {
    const original = structuredClone(key()); await assign(); await page.keyboard.press('ShiftRight');
    await expect.poll(() => key().code).toBe(161); await expect(field('Key label')).toHaveValue('R Shift');
    await undo(); await expect.poll(() => key().code).toBe(original.code); await expect(field('Key label')).toHaveValue(original.label);
  });
  await check('binding preserves custom labels on request and Escape leaves settings intact', async () => {
    await field('Key label').fill('Jump'); await field('Update label when assigning').uncheck(); await assign(); await page.keyboard.press('Space');
    await expect.poll(() => key().code).toBe(32); expect(key().label).toBe('Jump');
    const before = await history(); await assign(); await page.keyboard.press('Escape'); expect(await history()).toBe(before);
    await expect(page.getByRole('button', { name: 'Assign by pressing a key', exact: true })).toBeVisible();
  });
  await check('native key capture works in Demo and cancels when another control is used', async () => {
    await page.getByRole('button', { name: 'Demo', exact: true }).click(); await field('Update label when assigning').check(); await assign();
    broadcast({ event_type: 'key_pressed', rawcode: 163 }); await expect.poll(() => key().code).toBe(163); expect(key().label).toBe('R Ctrl');
    await assign(); await field('Key label').click(); await expect(page.getByRole('button', { name: 'Assign by pressing a key', exact: true })).toBeVisible();
    broadcast({ event_type: 'key_pressed', rawcode: 164 }); expect(key().code).toBe(163); broadcast({ event_type: 'key_released', rawcode: 163 }); await page.getByRole('button', { name: 'Live', exact: true }).click();
  });
  await check('individual field reset restores inheritance without clearing other overrides', async () => {
    await field('Customize this key').check(); const props = page.locator('.selected-key-properties');
    await expect(props.locator('[data-style-source="inherited"]')).not.toHaveCount(0);
    await field('Key Accent color').fill('#ff44aa'); await props.locator('summary').filter({ hasText: 'Text & typography' }).click(); await field('Key Font size').fill('28');
    await field('Accent color').fill('#3388cc'); await expect.poll(() => module('keyboard').accent).toBe('#3388cc'); expect(key().style.accent).toBe('#ff44aa');
    await page.getByRole('button', { name: 'Reset Key Accent color to module', exact: true }).click();
    await expect.poll(() => key().style.accent).toBeUndefined(); expect(key().style.fontSize).toBe(28); await expect(field('Key Accent color')).toHaveValue('#3388cc');
  });
  await check('style clipboard copies appearance between keys and bulk paste is undoable', async () => {
    await page.getByRole('button', { name: 'Copy style', exact: true }).click(); await field('Edit key').selectOption('1');
    const before = structuredClone(key(1)); await page.getByRole('button', { name: 'Paste style', exact: true }).click();
    await expect.poll(() => key(1).style?.fontSize).toBe(28); expect(key(1).style.accent).toBe('#3388cc'); for (const prop of ['code', 'label', 'x', 'y', 'w', 'h']) expect(key(1)[prop]).toEqual(before[prop]);
    const styles = module('keyboard').keys.map(k => k.style); await page.getByRole('button', { name: 'Paste style to all keys', exact: true }).click();
    await expect.poll(() => module('keyboard').keys.every(k => k.style?.fontSize === 28)).toBe(true);
    await undo(); await expect.poll(() => module('keyboard').keys.map(k => k.style)).toEqual(styles);
    await page.getByRole('button', { name: 'Use module style', exact: true }).click(); await expect.poll(() => key(1).style).toBeUndefined();
    await expect(field('Customize this key')).not.toBeChecked();
  });
  await check('clipboard transfers to mouse buttons while hidden buttons keep their style', async () => {
    await select('Mouse Buttons'); const geometry = structuredClone(module('mouse').buttonGeometry), labels = [...module('mouse').buttonLabels];
    await page.getByRole('button', { name: 'Paste style', exact: true }).click(); await expect.poll(() => module('mouse').buttonStyles['1']?.fontSize).toBe(28);
    await field('Show button 3').uncheck(); await expect.poll(() => module('mouse').buttons.includes(3)).toBe(false);
    await page.getByRole('button', { name: 'Paste style to shown buttons', exact: true }).click(); await expect.poll(() => module('mouse').buttonStyles['2']?.fontSize).toBe(28);
    expect(module('mouse').buttonStyles['3']).toBeUndefined(); expect(module('mouse').buttonGeometry).toEqual(geometry); expect(module('mouse').buttonLabels).toEqual(labels);
    await undo(); await expect.poll(() => module('mouse').buttonStyles['2']).toBeUndefined();
    await page.getByRole('button', { name: 'Reset Button Accent color to module', exact: true }).click(); await expect.poll(() => module('mouse').buttonStyles['1'].accent).toBeUndefined();
  });
  await check('range keyboard gestures and a typed label each undo in one step', async () => {
    const original = module('mouse').opacity; await field('Opacity').focus();
    for (let i = 0; i < 5; i++) await page.keyboard.down('ArrowLeft'); await page.keyboard.up('ArrowLeft');
    await expect.poll(() => module('mouse').opacity).toBeLessThan(original); await undo(); await expect.poll(() => module('mouse').opacity).toBe(original);
    const range = field('Opacity'); await range.scrollIntoViewIfNeeded(); const box = await range.boundingBox();
    await page.mouse.move(box.x + box.width * .95, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .25, box.y + box.height / 2, { steps: 14 }); await page.mouse.up();
    await expect.poll(() => module('mouse').opacity).toBeLessThan(.7); await undo(); await expect.poll(() => module('mouse').opacity).toBe(original);
    await select('Keyboard'); const old = key(1).label; await field('Key label').fill(''); await field('Key label').pressSequentially('Typed label');
    await undo(); await expect(field('Key label')).toHaveValue(old); await redo(); await expect(field('Key label')).toHaveValue('Typed label');
  });
  await check('duplicated keys and customizations survive reload at 1366×768', async () => {
    const count = module('keyboard').keys.length; await page.getByRole('button', { name: 'Duplicate key', exact: true }).click(); await expect.poll(() => module('keyboard').keys.length).toBe(count + 1);
    await expect(page.locator('.statusbar')).toContainText('Synced to OBS'); await page.reload(); await select('Keyboard'); await expect(field('Edit key').locator('option')).toHaveCount(count + 1);
    await page.setViewportSize({ width: 1366, height: 768 }); await page.getByRole('button', { name: 'Edit keys on canvas', exact: true }).click(); await expect(page.locator('.key-hitbox')).toHaveCount(count + 1);
    await expect(page.getByRole('button', { name: 'Paste style', exact: true })).toBeDisabled(); // clipboard is intentionally kept only for the current session
    await expect.poll(() => page.evaluate(() => {
      const frame = window.document.querySelector('.canvas-shell').getBoundingClientRect();
      return [...window.document.querySelectorAll('.preview-viewport .overlay-key')].every(node => { const r = node.getBoundingClientRect(); return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom; });
    })).toBe(true);
    await page.locator('.key-layout-panel').scrollIntoViewIfNeeded();
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true }); await page.screenshot({ path: fileURLToPath(new URL('../artifacts/customization-1366.png', import.meta.url)) });
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  expect(errors).toEqual([]);
  await writeFile(new URL('../artifacts/customization-checks.json', import.meta.url), JSON.stringify({ checks: results.length, results, errors }, null, 2));
  console.log(`${results.length} customization checks passed.`);
} finally { clearInterval(heartbeat); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await vite.close(); }
