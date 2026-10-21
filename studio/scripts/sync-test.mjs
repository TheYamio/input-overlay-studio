// Two real editor contexts against a controlled revision-aware transport.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
const vite = await createServer({ server: { host: '127.0.0.1', port: 5191, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4497 });
let document = null, revision = 0, rejectSave = false, delayAck = false;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw));
  const send = packet => { if (ws.readyState === 1) ws.send(JSON.stringify(packet)); };
  if (m.type === 'auth') { ws.authed = m.token === 'sync-test'; send({ type: 'auth_response', status: ws.authed ? 'success' : 'failed', protocol: 4, studio_revisions: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (rejectSave) { send({ type: 'studio_error', request_id: m.request_id }); return; }
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = m.document; const committed = String(++revision);
    broadcast({ type: 'studio_config', document, revision: committed, origin: m.origin });
    const ack = () => send({ type: 'studio_saved', request_id: m.request_id, revision: committed });
    if (delayAck) setTimeout(ack, 800); else ack();
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
const browser = await chromium.launch({ headless: true }); const results = [], errors = [];
const makeContext = async () => { const context = await browser.newContext({ viewport: { width: 1560, height: 1000 } }); await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4497', token: 'sync-test' }))); return context; };
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
try {
  const ca = await makeContext(), cb = await makeContext(); const a = await ca.newPage(), b = await cb.newPage();
  for (const page of [a, b]) { page.on('pageerror', e => errors.push(e.message)); await page.goto('http://127.0.0.1:5191'); await expect(page.locator('.statusbar')).toContainText('Synced to OBS'); await page.getByRole('button', { name: 'Profiles', exact: true }).click(); }
  const name = page => page.getByLabel('Profile name', { exact: true });
  const conflict = page => page.getByRole('button', { name: 'Publish local version', exact: true });
  const publish = page => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await check('remote update preserves the unsent local draft and Undo', async () => {
    await name(a).fill('Local A'); await name(b).fill('Server B'); await publish(b);
    await expect(conflict(a)).toBeVisible(); await expect(name(a)).toHaveValue('Local A');
    expect(document.profiles[0].name).toBe('Server B'); expect(Number(await a.locator('.app-shell').getAttribute('data-history'))).toBeGreaterThan(0);
  });
  await check('explicit local resolution publishes safely and updates the other editor', async () => {
    await conflict(a).click(); await expect.poll(() => document.profiles[0].name).toBe('Local A'); await expect(name(b)).toHaveValue('Local A');
    await expect(a.locator('.statusbar')).toContainText('Synced to OBS');
  });
  await check('server resolution retains the discarded draft in Undo', async () => {
    await name(a).fill('Kept in Undo'); await name(b).fill('New server'); await publish(b);
    await expect(conflict(a)).toBeVisible(); await a.getByRole('button', { name: 'Use server version', exact: true }).click(); await expect(name(a)).toHaveValue('New server');
    await a.getByRole('button', { name: 'Studio', exact: true }).click(); await a.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
    await a.getByRole('button', { name: 'Profiles', exact: true }).click(); await expect(name(a)).toHaveValue('Kept in Undo');
    await expect.poll(() => document.profiles[0].name).toBe('Kept in Undo');
    await expect(name(b)).toHaveValue('Kept in Undo');
  });
  await check('reload before debounce retains the draft and its stale base revision', async () => {
    await name(a).fill('Reloaded local');
    await a.close();
    await name(b).fill('Changed while closed'); await publish(b); await expect.poll(() => document.profiles[0].name).toBe('Changed while closed');
    const reopened = await ca.newPage(); reopened.on('pageerror', e => errors.push(e.message)); await reopened.goto('http://127.0.0.1:5191');
    await expect(conflict(reopened)).toBeVisible(); await reopened.getByRole('button', { name: 'Profiles', exact: true }).click(); await expect(name(reopened)).toHaveValue('Reloaded local');
    expect(document.profiles[0].name).toBe('Changed while closed'); await reopened.getByRole('button', { name: 'Use server version', exact: true }).click();
  });
  await check('edits during an outstanding acknowledgement are sent after it', async () => {
    delayAck = true; await name(b).fill('First pending'); await publish(b);
    await expect.poll(() => document.profiles[0].name).toBe('First pending'); await name(b).fill('Newest pending');
    await expect.poll(() => document.profiles[0].name).toBe('Newest pending');
    await expect(b.locator('.statusbar')).toContainText('Synced to OBS'); delayAck = false;
  });
  await check('server write error retains the draft and retry succeeds', async () => {
    rejectSave = true; const before = document.profiles[0].name;
    await name(b).fill('Retry this draft'); await publish(b); await expect(b.locator('.statusbar')).toContainText('Save failed · draft kept');
    expect(document.profiles[0].name).toBe(before); await expect(name(b)).toHaveValue('Retry this draft');
    rejectSave = false; await b.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect.poll(() => document.profiles[0].name).toBe('Retry this draft');
  });
  expect(errors).toEqual([]);
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/sync-results.json', import.meta.url), JSON.stringify({ results, errors }, null, 2));
} finally { clearInterval(heartbeat); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(r => wss.close(r)); await vite.close(); }
