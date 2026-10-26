import contract from '../src/core/compatibility/contract.json' with {type:'json'};
import { chromium, expect } from './test-browser.mjs';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument , parseDocument} from '../src/core/config.ts';
const vite = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4504 });
let document = initialDocument(), revision = 0;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = data => ws.send(JSON.stringify(data)); if(m.document?.version===4)m.document=parseDocument(JSON.stringify(m.document));
  if (m.type === 'auth') { ws.authed = m.token === 'transform-test'; send({ type: 'auth_response', studio_capabilities:{...contract,role:'capture'}, status: ws.authed ? 'success' : 'failed', protocol:5, studio_revisions: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = m.document; revision++; broadcast({ type: 'studio_config', document, revision: String(revision), origin: m.origin }); send({ type: 'studio_saved', revision: String(revision), request_id: m.request_id });
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1560, height: 1050 } });
await context.addInitScript(() => localStorage.setItem('studio.inspector-section', 'all'));
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4504', token: 'transform-test' })));
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const module = type => document.profiles.find(p => p.id === document.activeProfileId).modules.find(m => m.type === type);
const key = (i = 0) => module('keyboard').keys[i];
const history = () => page.locator('.app-shell').getAttribute('data-history').then(Number);
const field = label => page.getByLabel(label, { exact: true });
const select = name => page.locator('.layer-list').getByRole('button', { name, exact: true }).click();
const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click();
const redo = () => page.getByRole('button', { name: 'Redo', exact: true }).click();
const cap = label => page.getByRole('button', { name: `Edit key ${label}`, exact: true });
const drag = async (target, dx, dy, cancel = false) => { await target.scrollIntoViewIfNeeded(); const b = await target.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 }); if (cancel) await page.keyboard.press(typeof cancel === 'string' ? cancel : 'Escape'); await page.mouse.up(); };
const assign = () => page.getByRole('button', { name: 'Assign by pressing a key', exact: true }).click();
try {
  await page.goto('http://127.0.0.1:5198'); await expect(page.locator('.statusbar')).toContainText('Saved to capture server'); await select('Keyboard');
  const hit = page.getByRole('button', { name: 'Select Keyboard', exact: true });
  const shape = () => { const { x, y, w, h } = module('keyboard'); return { x, y, w, h }; };
  await check('eight module handles remain usable at canvas boundary and small zoom', async () => {
    await field('X').fill('0'); await field('Y').fill('0'); await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await expect(hit.locator('[data-resize]')).toHaveCount(8);
    const sizes = await hit.locator('[data-resize]').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(), shell = el.closest('.canvas-shell').getBoundingClientRect(); return { w: r.width, h: r.height, inside: r.x >= shell.x && r.y >= shell.y }; }));
    expect(sizes.every(s => s.w >= 15.5 && s.h >= 15.5 && s.inside)).toBe(true);
    await field('X').fill('400'); await field('Y').fill('300'); await expect.poll(() => module('keyboard').x).toBe(400); await expect.poll(() => module('keyboard').y).toBe(300); await page.getByRole('button', { name: 'Focus selection', exact: true }).click(); await expect(page.getByRole('button', { name: 'Focus selection', exact: true })).toHaveAttribute('aria-pressed','true'); await page.waitForTimeout(250);
  });
  await check('resizing repaints actual keys before release and commits one Undo action', async () => {
    const initial = shape(), before = await history(), handle = hit.locator('[data-resize=e]');
    const keyWidth = () => page.locator('.preview-viewport .module-keyboard .overlay-key').first().evaluate(el => el.getBoundingClientRect().width);
    const width = await keyWidth(), b = await handle.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 45, b.y + b.height / 2, { steps: 8 });
    expect(await keyWidth()).toBeGreaterThan(width + 1); expect(shape()).toEqual(initial); expect(await history()).toBe(before);
    await page.mouse.up(); await expect.poll(() => module('keyboard').w).toBeGreaterThan(initial.w); expect(await history()).toBe(before + 1);
    expect(module('keyboard').w / module('keyboard').h).toBeCloseTo(initial.w / initial.h, 4);
    await undo(); await expect.poll(shape).toEqual(initial);
  });
  await check('Escape and lost focus restore the artwork without creating history', async () => {
    const initial = shape(), before = await history(); await drag(hit.locator('[data-resize=se]'), -30, -20, true);
    expect(shape()).toEqual(initial); expect(await history()).toBe(before);
    const b = await hit.locator('[data-resize=se]').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x - 30, b.y - 20);
    await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up(); expect(shape()).toEqual(initial); expect(await history()).toBe(before);
  });
  await check('all eight directions resize from the appropriate anchored edges', async () => {
    await page.getByRole('button', { name: 'Keep proportions', exact: true }).click();
    for (const d of ['nw','n','ne','e','se','s','sw','w']) {
      const initial = shape(); await drag(hit.locator(`[data-resize=${d}]`), d.includes('w') ? 15 : -15, d.includes('n') ? 12 : -12);
      await expect.poll(shape).not.toEqual(initial); const r = shape();
      if (!d.includes('e')) expect(r.x+r.w).toBeCloseTo(initial.x+initial.w, 4);
      if (!d.includes('s')) expect(r.y+r.h).toBeCloseTo(initial.y+initial.h, 4);
      if (!d.includes('w')) expect(r.x).toBe(initial.x);
      if (!d.includes('n')) expect(r.y).toBe(initial.y);
      await undo(); await expect.poll(shape).toEqual(initial);
    }
  });
  await check('Shift temporarily keeps proportions and Alt bypasses grid', async () => {
    const initial = shape(); await page.keyboard.down('Shift'); await page.keyboard.down('Alt'); await drag(hit.locator('[data-resize=se]'), -31, -17); await page.keyboard.up('Alt'); await page.keyboard.up('Shift');
    await expect.poll(shape).not.toEqual(initial); expect(module('keyboard').w / module('keyboard').h).toBeCloseTo(initial.w/initial.h,4); await undo(); await expect.poll(shape).toEqual(initial);
  });
  await check('held arrow movements are one Undo and resize handles support the keyboard', async () => {
    const initial = shape(), before = await history(); await hit.focus(); for(let i=0;i<3;i++) await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
    await expect.poll(() => module('keyboard').x).toBe(initial.x+3); expect(await history()).toBe(before+1); await undo(); await expect.poll(shape).toEqual(initial);
    await hit.locator('[data-resize=w]').focus(); await page.keyboard.press('Shift+ArrowRight'); await expect.poll(() => module('keyboard').x).toBe(initial.x+10); expect(module('keyboard').w).toBe(initial.w-10); await undo(); await expect.poll(shape).toEqual(initial);
  });
  await check('locked modules expose no resize handles and reject arrow movements', async () => {
    await field('Lock position').check(); const initial = shape(); await expect(hit.locator('[data-resize]')).toHaveCount(0); await hit.focus(); await page.keyboard.press('ArrowRight'); expect(shape()).toEqual(initial); await field('Lock position').uncheck();
  });
  await mkdir('artifacts', { recursive: true }); await page.screenshot({path:'artifacts/transform-modules.png'});
  await check('double click opens key editing with eight key handles and anchored resizing', async () => {
    await hit.dblclick(); await expect(page.locator('.key-hitbox')).toHaveCount(module('keyboard').keys.length); await expect(hit.locator(':scope > [data-resize]')).toHaveCount(0);
    await cap(key().label).click(); const handles = page.locator('.key-hitbox.selected [data-resize]'); await expect(handles).toHaveCount(8);
    const initial = structuredClone(key()), before = await history(); await drag(page.locator('.key-hitbox.selected [data-resize=nw]'), 12, 8);
    await expect.poll(() => key().w).not.toBe(initial.w); expect(key().x+key().w).toBeCloseTo(initial.x+initial.w,4); expect(key().y+key().h).toBeCloseTo(initial.y+initial.h,4); expect(await history()).toBe(before+1);
    await undo(); await expect.poll(key).toEqual(initial);
  });
  await check('key handle keyboard resizing and Escape preserve a single-step history', async () => {
    const initial = structuredClone(key()), before = await history(), handle = page.locator('.key-hitbox.selected [data-resize=e]'); await handle.focus(); await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => key().w).toBe(initial.w+10); expect(key().x).toBe(initial.x); expect(await history()).toBe(before+1); await undo(); await expect.poll(key).toEqual(initial);
    const cancelledAt = await history(); await drag(handle,20,0,true); expect(key()).toEqual(initial); expect(await history()).toBe(cancelledAt);
  });
  expect(errors).toEqual([]); await mkdir('artifacts',{recursive:true}); await page.screenshot({path:'artifacts/transform-editor.png'}); console.log(`Passed ${results.length} transform checks`);
} finally { clearInterval(heartbeat); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(r => wss.close(r)); await vite.close(); }
