// Production Chromium benchmark. CPU means renderer-main-thread TaskDuration / wall time,
// not whole-machine CPU or GPU utilization. The WS source emulates native coalescing at 125 Hz.
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { initialDocument, activeProfile, documentSchema } from '../src/core/config.ts';

const label = process.env.STUDIO_BENCH_LABEL || 'current';
if (!/^[a-z0-9-]+$/i.test(label)) throw Error('Invalid benchmark label');
const seconds = Number(process.env.STUDIO_BENCH_SECONDS || 15);
if (!Number.isFinite(seconds) || seconds < 3 || seconds > 300) throw Error('Duration must be 3–300 seconds');
const server = await preview({ preview: { host: '127.0.0.1', port: 5196, strictPort: true } });
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4490 });
let document = initialDocument(), sequence = 0, revision = 0, movement = false, movementCount = 0;
const broadcast = packet => { const raw = JSON.stringify(packet); for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(raw); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = packet => ws.send(JSON.stringify(packet));
  if (m.type === 'auth') { ws.authed = m.token === 'resource-test'; send({ type: 'auth_response', status: ws.authed ? 'success' : 'failed', protocol: 4, state_snapshot: true, studio_revisions: true, studio_visuals: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'input_snapshot') send({ type: 'input_snapshot', sequence, keys: [], buttons: [] });
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision), config_sequence: revision });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), config_sequence: revision, request_id: m.request_id }); return; }
    document = m.document; revision++; broadcast({ type: 'studio_config', document, revision: String(revision), config_sequence: revision, origin: m.origin }); send({ type: 'studio_saved', request_id: m.request_id, revision: String(revision), config_sequence: revision });
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
const input = setInterval(() => {
  if (!movement) return;
  const phase = movementCount++ / 125;
  broadcast({ event_type: 'mouse_moved', dx: Math.cos(phase * 2) * 64, dy: Math.sin(phase * 3) * 64, distance_counts: 192, sequence: ++sequence });
  if (movementCount % 32 === 0) {
    const pressed = movementCount % 64 === 0;
    broadcast({ event_type: pressed ? 'key_pressed' : 'key_released', rawcode: 87, sequence: ++sequence });
    broadcast({ event_type: pressed ? 'mouse_pressed' : 'mouse_released', button: 1, sequence: ++sequence });
    broadcast({ event_type: 'analog_depth', rawcode: 65, depth: (movementCount % 128) / 128, sequence: ++sequence });
    broadcast({ event_type: 'mouse_wheel', rotation: pressed ? 1 : -1, sequence: ++sequence });
  }
}, 8);
const browser = await chromium.launch({ headless: true });
const results = [], errors = [];
const artifacts = new URL('../artifacts/', import.meta.url); await mkdir(artifacts, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.addInitScript(() => {
  localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4490', token: 'resource-test' }));
  const nativeRAF = window.requestAnimationFrame.bind(window);
  window.__resource = { enabled: false, frames: 0, intervals: [], last: 0, longTasks: [] };
  window.requestAnimationFrame = callback => nativeRAF(now => {
    const r = window.__resource;
    if (r.enabled) { r.frames++; if (r.last && now - r.last > 1) r.intervals.push(now - r.last); r.last = now; }
    callback(now);
  });
  new PerformanceObserver(list => { if (window.__resource.enabled) for (const e of list.getEntries()) window.__resource.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: false });
});
let page;
async function open(editor = false) {
  documentSchema.parse(document); movement = false; await page?.close();
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(editor ? 'http://127.0.0.1:5196/' : 'http://127.0.0.1:5196/overlay.html#token=resource-test&ws=ws%3A%2F%2F127.0.0.1%3A4490');
  if (process.env.STUDIO_BENCH_CSS) {
    const css = { contain: '.key-art{contain:paint}', 'no-filter': '.key-art{filter:none}', combined: '.key-art{contain:paint;filter:none}' }[process.env.STUDIO_BENCH_CSS];
    if (!css) throw Error('Unknown CSS experiment'); await page.addStyleTag({ content: css });
  }
  await expect(page.locator(editor ? '.preview-viewport .overlay-key' : '#overlay .overlay-key').first()).toBeVisible();
  if (editor) await expect(page.locator('.statusbar')).toContainText('Synced to OBS');
}
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v => [v.name, v.value]));
async function sample(name, active, duration = seconds) {
  movement = active; await delay(2000);
  const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage');
  const before = await metrics(cdp), nodesBefore = await cdp.send('Memory.getDOMCounters'), count = movementCount;
  await page.evaluate(() => Object.assign(window.__resource, { enabled: true, frames: 0, intervals: [], last: 0, longTasks: [] }));
  const start = performance.now(); await delay(duration * 1000); const elapsed = (performance.now() - start) / 1000;
  const samples = await page.evaluate(() => { window.__resource.enabled = false; return window.__resource; });
  const after = await metrics(cdp); await cdp.send('HeapProfiler.collectGarbage'); const heap = await cdp.send('Runtime.getHeapUsage'), nodes = await cdp.send('Memory.getDOMCounters');
  const sorted = samples.intervals.sort((a, b) => a - b), percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
  const result = { name, seconds: +elapsed.toFixed(2), transportHz: +((movementCount - count) / elapsed).toFixed(1), mainThreadBusyPercent: +((after.TaskDuration - before.TaskDuration) / elapsed * 100).toFixed(3), scriptMsPerSecond: +((after.ScriptDuration - before.ScriptDuration) / elapsed * 1000).toFixed(3), layoutMsPerSecond: +((after.LayoutDuration - before.LayoutDuration) / elapsed * 1000).toFixed(3), styleMsPerSecond: +((after.RecalcStyleDuration - before.RecalcStyleDuration) / elapsed * 1000).toFixed(3), appRafCallbacks: samples.frames, frameP50Ms: percentile(.5), frameP95Ms: percentile(.95), frameP99Ms: percentile(.99), longTasks: samples.longTasks.length, maxLongTaskMs: Math.max(0, ...samples.longTasks), heapMiB: +(heap.usedSize / 1048576).toFixed(2), domNodes: nodes.nodes, nodeGrowth: nodes.nodes - nodesBefore.nodes };
  results.push(result); console.log(JSON.stringify(result)); await cdp.detach();
}
async function memorySnapshot(cdp) { await delay(300); await cdp.send('HeapProfiler.collectGarbage'); return { heapBytes: (await cdp.send('Runtime.getHeapUsage')).usedSize, ...(await cdp.send('Memory.getDOMCounters')) }; }
try {
  const maker = await context.newPage();
  const data = await maker.evaluate(() => { const c = window.document.createElement('canvas'); c.width = 1024; c.height = 512; const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 1024, 512); g.addColorStop(0, '#ef5588'); g.addColorStop(1, '#4466ff'); ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512); return c.toDataURL('image/webp', .85); }); await maker.close();
  const grouped = () => { const d = initialDocument(), p = activeProfile(d); d.assets.paint = { name: 'benchmark.webp', width: 1024, height: 512, data }; for (const m of p.modules.filter(m => m.type === 'keyboard' || m.type === 'mouse')) m.image = { ...m.image, enabled: true, assetId: 'paint', groupId: 'benchmark', flipX: true, rotation: 12 }; return d; };
  const dense = count => { const d = grouped(), p = activeProfile(d), seed = p.modules[0]; p.modules = Array.from({ length: 32 }, (_, i) => ({ ...structuredClone(seed), id: `dense-${i}`, x: i % 4 * 480, y: Math.floor(i / 4) * 135, w: 475, h: 130, keys: Array.from({ length: count }, (_, j) => ({ id: `k-${j}`, code: j + 32, label: String(j), x: j % 16 * 27, y: Math.floor(j / 16) * 16, w: 25, h: 14 })) })); return d; };
  if (process.env.STUDIO_BENCH_CASE === 'full-keyboard') {
    document = grouped(); const keyboard = activeProfile(document).modules[0]; keyboard.keys = dense(100).profiles[0].modules[0].keys; revision++; await open(); await sample('overlay-full-100-key-keyboard', true);
    await writeFile(new URL(`resources-${label}.json`, artifacts), JSON.stringify({ label, production: true, chromium: browser.version(), results, errors }, null, 2)); expect(errors).toEqual([]);
  } else if (process.env.STUDIO_BENCH_CASE === 'dense') {
    document = dense(100); revision++; await open(); await sample('overlay-3200-keys-active', true);
    await writeFile(new URL(`resources-${label}.json`, artifacts), JSON.stringify({ label, production: true, cssExperiment: process.env.STUDIO_BENCH_CSS || null, chromium: browser.version(), results, errors }, null, 2)); expect(errors).toEqual([]);
  } else if (process.env.STUDIO_BENCH_CASE === 'updates') {
    const updates = [];
    for (const count of [0, 32, 100]) {
      document = count ? dense(count) : grouped();
      revision++; await open(); await delay(1000);
      const timings = [], cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
      const before = await metrics(cdp);
      for (let i = 0; i < 12; i++) {
        const m = activeProfile(document).modules[0], x = m.x === 0 ? 1 : 0;
        await page.evaluate(({ id, x }) => {
          window.__updateTiming = null; const start = performance.now(), el = window.document.querySelector(`[data-module-id="${id}"]`);
          const observer = new MutationObserver(() => { if (el.style.left === `${x}px`) { observer.disconnect(); requestAnimationFrame(() => window.__updateTiming = performance.now() - start); } }); observer.observe(el, { attributes: true, attributeFilter: ['style'] });
        }, { id: m.id, x });
        m.x = x; revision++; broadcast({ type: 'studio_config', document, revision: String(revision), config_sequence: revision });
        await expect.poll(() => page.evaluate(() => window.__updateTiming), { timeout: 15000, intervals: [20] }).not.toBeNull();
        timings.push(await page.evaluate(() => window.__updateTiming)); await delay(100);
      }
      const after = await metrics(cdp); await cdp.detach(); timings.sort((a, b) => a - b);
      const result = { modules: count ? 32 : 5, keysPerKeyboard: count || activeProfile(document).modules[0].keys.length, updates: timings.length, medianMs: timings[6], maxMs: timings.at(-1), mainThreadMsPerUpdate: (after.TaskDuration - before.TaskDuration) * 1000 / timings.length };
      updates.push(result); console.log(JSON.stringify(result));
    }
    await writeFile(new URL(`updates-${label}.json`, artifacts), JSON.stringify({ label, production: true, chromium: browser.version(), updates, errors }, null, 2)); expect(errors).toEqual([]);
  } else {
  await open(); await sample('overlay-idle', false, Math.min(seconds, 10)); await sample('overlay-active', true);
  document = grouped(); revision++; await open(); await sample('overlay-shared-artwork', true);
  const heavy = grouped(), p = activeProfile(heavy), seed = p.modules[0];
  p.modules = Array.from({ length: 32 }, (_, i) => ({ ...structuredClone(seed), id: `dense-${i}`, x: i % 4 * 480, y: Math.floor(i / 4) * 135, w: 475, h: 130, keys: Array.from({ length: process.env.STUDIO_BENCH_MAX === '1' ? 100 : 32 }, (_, j) => ({ id: `k-${j}`, code: j + 32, label: String(j), x: j % 16 * 27, y: Math.floor(j / 16) * 16, w: 25, h: 14 })) }));
  document = heavy; revision++; await open(); await sample('overlay-dense-32-modules', true, Math.min(seconds, 10));
  document = grouped(); activeProfile(document).modules.filter(m => m.type === 'trail' || m.type === 'distance').forEach(m => m.visible = false); revision++; await open(); await sample('overlay-hidden-metrics-and-trail', true);
  document = grouped(); revision++; await open(true); await sample('editor-idle', false, Math.min(seconds, 10)); await sample('editor-active-shared-artwork', true);
  movement = false; await page.getByRole('button', { name: 'Presets', exact: true }).click(); await sample('presets-idle', false, Math.min(seconds, 10));
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.locator('.layer-list').getByRole('button', { name: 'Keyboard', exact: true }).click();
  const cdp = await context.newCDPSession(page);
  async function churn(rounds) { for (let i = 0; i < rounds; i++) {
    await page.getByRole('button', { name: 'Position & scale image', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Presets', exact: true }).click(); await delay(100); await page.getByRole('button', { name: 'Studio', exact: true }).click();
  } }
  await churn(5); const before = await memorySnapshot(cdp); await churn(25); const after = await memorySnapshot(cdp);
  const retention = { warmupCycles: 5, measuredCycles: 25, before, after, retainedHeapGrowthBytes: after.heapBytes - before.heapBytes, retainedNodeGrowth: after.nodes - before.nodes, retainedListenerGrowth: after.jsEventListeners - before.jsEventListeners };
  expect(retention.retainedHeapGrowthBytes).toBeLessThan(8_000_000); expect(retention.retainedNodeGrowth).toBeLessThan(500); expect(errors).toEqual([]);
  await cdp.detach();
  const report = { label, chromium: browser.version(), production: true, note: 'Main-thread CPU is TaskDuration/wall time, 100% = one fully occupied renderer main thread. Excludes raster/GPU/native threads. Synthetic WS movement attempts 125 Hz, no physical device injection.', maxKeysPerModule: process.env.STUDIO_BENCH_MAX === '1' ? 100 : 32, results, retention, errors };
  await writeFile(new URL(`resources-${label}.json`, artifacts), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ retention, errors }));
  }
} finally {
  clearInterval(input); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate();
  await browser.close(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.httpServer.close(resolve));
}
