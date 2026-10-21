// Actual OBS/CEF acceptance using a separate portable installation and test-only credentials.
// No desktop/game/microphone sources, streams or recordings are created.
import { chromium, expect } from '@playwright/test';
import WebSocket from 'ws';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument, activeProfile } from '../src/core/config.ts';

const root = new URL('../../', import.meta.url), portable = new URL('.tools/obs-portable/', root);
const captureData = new URL('.tools/obs-acceptance/', root), artifacts = new URL('../artifacts/', import.meta.url);
const token = randomBytes(24).toString('hex'), password = randomBytes(24).toString('hex');
const obsDirectory = fileURLToPath(new URL('bin/64bit/', portable));
await mkdir(captureData, { recursive: true }); await mkdir(artifacts, { recursive: true });
await mkdir(new URL('config/obs-studio/plugin_config/obs-websocket/', portable), { recursive: true });
await writeFile(new URL('config/obs-studio/plugin_config/obs-websocket/config.json', portable), JSON.stringify({ first_load: false, server_enabled: true, server_port: 4475, auth_required: true, server_password: password, alerts_enabled: false }));
await writeFile(new URL('config/obs-studio/global.ini', portable), '[General]\nFirstRun=false\nEnableAutoUpdates=false\nMaxLogs=3\n');
await writeFile(new URL('config.json', captureData), JSON.stringify({ host: '127.0.0.1', port: 4485, auth_token: token, http_enabled: true, http_port: 4486, cpu_affinity: [] }));
const doc = initialDocument(); await writeFile(new URL('studio.json', captureData), JSON.stringify(doc));
let capture, obs, nativeSocket, obsSocket, browser;
const startCapture = () => { capture = spawn(fileURLToPath(new URL('ws-server/src-tauri/target/release/input-overlay-ws.exe', root)), ['--tray'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, RUST_LOG: 'info', INPUT_OVERLAY_STUDIO_DATA_DIR: fileURLToPath(captureData) } }); };
const stop = async child => { if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = text => createHash('sha256').update(text).digest('base64');
const results = []; const check = async (name, fn) => { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
let serial = 0; const requests = new Map();
function request(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    const requestId = String(++serial);
    const timeout = setTimeout(() => { requests.delete(requestId); reject(Error(`OBS ${requestType}: timeout`)); }, 15000);
    requests.set(requestId, { resolve, reject, timeout, type: requestType });
    obsSocket.send(JSON.stringify({ op: 6, d: { requestId, requestType, requestData } }));
  });
}
async function connectOBS() {
  await expect.poll(async () => new Promise(resolve => {
    const ws = new WebSocket('ws://127.0.0.1:4475'); ws.once('open', () => { ws.close(); resolve(true); }); ws.once('error', () => resolve(false));
  }), { timeout: 45000, intervals: [500, 1000] }).toBe(true);
  obsSocket = new WebSocket('ws://127.0.0.1:4475');
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error('OBS identification timeout')), 15000);
    obsSocket.on('error', reject);
    obsSocket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.op === 0) {
        const auth = message.d.authentication;
        obsSocket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, ...(auth ? { authentication: hash(hash(password + auth.salt) + auth.challenge) } : {}) } }));
      }
      if (message.op === 2) { clearTimeout(deadline); resolve(); }
      if (message.op === 7) {
        const pending = requests.get(message.d.requestId); if (!pending) return;
        requests.delete(message.d.requestId); clearTimeout(pending.timeout);
        if (message.d.requestStatus.result) pending.resolve(message.d.responseData || {});
        else pending.reject(Error(`OBS ${pending.type}: ${message.d.requestStatus.comment || message.d.requestStatus.code}`));
      }
    });
  });
}
async function nativeObserver() {
  nativeSocket = new WebSocket('ws://127.0.0.1:4485');
  await new Promise((resolve, reject) => { nativeSocket.once('error', reject); nativeSocket.once('open', () => nativeSocket.send(JSON.stringify({ type: 'auth', token }))); nativeSocket.once('message', raw => { const auth = JSON.parse(raw.toString()); if (auth.status !== 'success') reject(Error('Capture auth failed')); else resolve(); }); });
}
async function saveNativeDocument(document, request_id) {
  const receive = type => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { nativeSocket.off('message', handler); reject(Error(`Native ${type} timeout`)); }, 10000);
    const handler = raw => { const value = JSON.parse(String(raw)); if (value.type === type) { clearTimeout(timer); nativeSocket.off('message', handler); resolve(value); } };
    nativeSocket.on('message', handler);
  });
  const current = receive('studio_config'); nativeSocket.send(JSON.stringify({ type: 'studio_get' })); const { revision } = await current;
  const saved = receive('studio_saved'); nativeSocket.send(JSON.stringify({ type: 'studio_set', document, base_revision: revision, origin: 'obs-acceptance', request_id })); await saved;
}
async function logs() {
  const files = await readdir(new URL('logs/', captureData)); return readFile(new URL(`logs/${files.sort().at(-1)}`, captureData), 'utf8');
}
try {
  startCapture();
  await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:4486/studio/overlay.html')).status; } catch { return 0; } }, { timeout: 15000 }).toBe(200);
  await nativeObserver();
  obs = spawn(fileURLToPath(new URL('bin/64bit/obs64.exe', portable)), ['--portable', '--multi', '--disable-updater', '--minimize-to-tray', '--disable-missing-files-check', '--websocket_ipv4_only'], { cwd: obsDirectory, windowsHide: true, stdio: 'ignore' });
  await connectOBS();
  const version = await request('GetVersion');
  const sceneName = `Input Overlay acceptance ${Date.now()}`, sourceName = `Overlay ${Date.now()}`;
  await request('CreateScene', { sceneName }); await request('SetCurrentProgramScene', { sceneName });
  await request('SetVideoSettings', { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 });
  const url = new URL('http://127.0.0.1:4486/studio/overlay.html'); url.hash = new URLSearchParams({ ws: 'ws://127.0.0.1:4485', token }).toString();
  await check('actual OBS Browser Source loads the production overlay and authenticates', async () => {
    const kinds = await request('GetInputKindList'); expect(kinds.inputKinds).toContain('browser_source');
    await request('CreateInput', { sceneName, inputName: sourceName, inputKind: 'browser_source', sceneItemEnabled: true, inputSettings: { url: url.toString(), width: 1920, height: 1080, is_local_file: false, shutdown: false, fps_custom: true, fps: 60, css: 'body { background: rgba(0,0,0,0); margin:0; overflow:hidden; }' } });
    await expect.poll(async () => (await logs()).match(/client authenticated/g)?.length || 0, { timeout: 25000 }).toBeGreaterThanOrEqual(2);
  });
  browser = await chromium.launch({ headless: true }); const decoder = await browser.newPage();
  const screenshot = async (width, height, name) => {
    const response = await request('GetSourceScreenshot', { sourceName, imageFormat: 'png', imageWidth: width, imageHeight: height });
    await writeFile(new URL(name, artifacts), Buffer.from(response.imageData.split(',')[1], 'base64'));
    return decoder.evaluate(async dataURL => {
      const image = await createImageBitmap(await (await fetch(dataURL)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let transparent = 0, visible = 0, left = image.width, right = 0, top = image.height, bottom = 0, sensitivityHash = 0;
      for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % image.width, y = Math.floor(i / 4 / image.width);
        if (data[i + 3] === 0) transparent++;
        if (data[i + 3] > 10) { visible++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
        if (x >= 440 * image.width / 1920 && x < 1420 * image.width / 1920 && y >= 890 * image.height / 1080 && y < 955 * image.height / 1080) sensitivityHash = (sensitivityHash + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7 + data[i + 3] * 11) >>> 0;
      }
      const keycapSamples = [[459.375, 495.5833], [539.4583, 495.5833], [619.5417, 495.5833], [514.9167, 495.5833]].map(([lx, ly]) => { const x = Math.floor(lx * image.width / 1920), y = Math.floor(ly * image.height / 1080), i = (y * image.width + x) * 4; return [...data.slice(i, i + 4)]; });
      return { width: image.width, height: image.height, transparent, visible, bounds: { left, right, top, bottom }, sensitivityHash, keycapSamples };
    }, response.imageData);
  };
  let base, larger;
  await check('CEF output contains overlay graphics and an alpha-transparent background', async () => {
    await expect.poll(async () => { base = await screenshot(1920, 1080, 'obs-1080.png'); return base.visible; }, { timeout: 20000 }).toBeGreaterThan(1000);
    expect(base.transparent / (1920 * 1080)).toBeGreaterThan(.6);
    expect(base.bounds.left).toBeGreaterThan(100); expect(base.bounds.top).toBeGreaterThan(100);
  });
  await check('actual OBS 2560×1440 source preserves the logical scene proportions', async () => {
    await request('SetInputSettings', { inputName: sourceName, inputSettings: { width: 2560, height: 1440 }, overlay: true }); await delay(1200);
    larger = await screenshot(2560, 1440, 'obs-1440.png');
    expect(larger.visible).toBeGreaterThan(base.visible * 1.4);
    expect(Math.abs(larger.bounds.left / (4 / 3) - base.bounds.left)).toBeLessThan(4);
    expect(Math.abs(larger.bounds.top / (4 / 3) - base.bounds.top)).toBeLessThan(4);
  });
  await check('actual CEF paints one embedded image across keycaps with transparent gaps', async () => {
    const data = await decoder.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 256, 0); gradient.addColorStop(0, '#ff0000'); gradient.addColorStop(1, '#0000ff'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 256); return c.toDataURL('image/png'); });
    const keyboard = activeProfile(doc).modules.find(m => m.type === 'keyboard'); doc.assets.paint = { name: 'OBS gradient.png', data, width: 256, height: 256 }; keyboard.image = { ...keyboard.image, enabled: true, assetId: 'paint', opacity: 1 }; keyboard.appearance.backgroundOpacity = 0;
    await saveNativeDocument(doc, 10);
    await expect.poll(async () => { const report = await screenshot(2560, 1440, 'obs-keycaps.png'); const p = report.keycapSamples; return p[0][0] > p[1][0] + 30 && p[1][0] > p[2][0] + 30 && p[3][3] === 0; }, { timeout: 10000 }).toBe(true);
    const saved = JSON.parse(await readFile(new URL('studio.json', captureData), 'utf8')); expect(saved.assets.paint.data).toBe(data);
  });
  await check('OBS applies sensitivity/profile changes without refreshing the source', async () => {
    const before = larger.sensitivityHash; activeProfile(doc).sensitivity = 2.6;
    await saveNativeDocument(doc, 1);
    await expect.poll(async () => (await screenshot(2560, 1440, 'obs-updated.png')).sensitivityHash, { timeout: 10000 }).not.toBe(before);
  });
  await check('OBS reconnects to a restarted native capture server without an editor', async () => {
    const previousLog = (await readdir(new URL('logs/', captureData))).sort().at(-1);
    nativeSocket.close(); await stop(capture); await delay(1100); startCapture();
    await expect.poll(async () => {
      try {
        const latest = (await readdir(new URL('logs/', captureData))).sort().at(-1);
        return latest !== previousLog && (await logs()).includes('client authenticated');
      } catch { return false; }
    }, { timeout: 20000 }).toBe(true);
    const restored = await screenshot(2560, 1440, 'obs-reconnected.png'); expect(restored.visible).toBeGreaterThan(1000); expect(restored.keycapSamples[0][0]).toBeGreaterThan(restored.keycapSamples[2][0] + 50); expect(restored.keycapSamples[3][3]).toBe(0);
  });
  const stats = await request('GetStats');
  const report = { obsVersion: version.obsVersion, results, base, larger, stats: { activeFps: stats.activeFps, renderTotalFrames: stats.renderTotalFrames, renderSkippedFrames: stats.renderSkippedFrames }, physicalDevicesVerified: false, recordingTested: false, sourceURLContainsDemo: false };
  await writeFile(new URL('obs-results.json', artifacts), JSON.stringify(report, null, 2));
  console.log(`${results.length} actual OBS checks passed (OBS ${version.obsVersion}).`);
} finally {
  for (const pending of requests.values()) clearTimeout(pending.timeout);
  nativeSocket?.close(); obsSocket?.close(); await browser?.close(); await stop(obs); await stop(capture);
}
