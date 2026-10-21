import { WebSocketServer } from 'ws';
import { writeFile } from 'node:fs/promises';
import { processResources, resourceDelta } from './process-resources.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function measureOBS({ request, document, url, sourceName, capture, obs, artifacts, seconds }) {
  if (!Number.isFinite(seconds) || seconds < 10 || seconds > 600) throw Error('OBS benchmark duration must be 10–600 seconds');
  const records = [], sockets = new WebSocketServer({ host: '127.0.0.1', port: 4495 });
  let active = false, count = 0, sequence = 0, revision = 0;
  const d = structuredClone(document), profile = d.profiles.find(p => p.id === d.activeProfileId);
  const keyboard = profile.modules.find(m => m.type === 'keyboard'), mouse = profile.modules.find(m => m.type === 'mouse');
  keyboard.image.groupId = 'obs-resources'; mouse.image = structuredClone(keyboard.image);
  const broadcast = packet => { const raw = JSON.stringify(packet); for (const ws of sockets.clients) if (ws.authed && ws.readyState === 1) ws.send(raw); };
  sockets.on('connection', ws => ws.on('message', raw => {
    const m = JSON.parse(String(raw)), send = packet => ws.send(JSON.stringify(packet));
    if (m.type === 'auth') { ws.authed = m.token === 'obs-resources'; send({ type: 'auth_response', status: ws.authed ? 'success' : 'failed', protocol: 4, state_snapshot: true, studio_revisions: true, studio_visuals: true }); }
    if (!ws.authed) return;
    if (m.type === 'input_snapshot') send({ type: 'input_snapshot', sequence, keys: [], buttons: [] });
    if (m.type === 'studio_get') send({ type: 'studio_config', document: d, revision: String(revision), config_sequence: revision });
  }));
  const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
  const input = setInterval(() => {
    if (!active) return;
    const t = count++ / 125;
    broadcast({ event_type: 'mouse_moved', dx: Math.cos(t * 2) * 64, dy: Math.sin(t * 3) * 64, distance_counts: 192, sequence: ++sequence });
    if (count % 32 === 0) { const pressed = count % 64 === 0;
      broadcast({ event_type: pressed ? 'key_pressed' : 'key_released', rawcode: 87, sequence: ++sequence });
      broadcast({ event_type: pressed ? 'mouse_pressed' : 'mouse_released', button: 1, sequence: ++sequence });
      broadcast({ event_type: 'mouse_wheel', rotation: pressed ? 1 : -1, sequence: ++sequence });
    }
  }, 8);
  async function sample(name, duration) {
    await delay(3000);
    const nativeBefore = await processResources(capture.pid), obsBefore = await processResources(obs.pid), before = await request('GetStats'), startCount = count, samples = [];
    const start = performance.now();
    const gpuSamples = [];
    while (performance.now() - start < duration * 1000) { await delay(Math.max(1, Math.min(5000, duration * 1000 - (performance.now() - start)))); samples.push(await request('GetStats')); gpuSamples.push(await processResources(obs.pid, true)); }
    const after = samples.at(-1), obsAfter = await processResources(obs.pid), nativeAfter = await processResources(capture.pid);
    const mean = key => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
    const gpu = gpuSamples.map(s => { const engines = {}; for (const row of s.gpuEngines) { const key = row.Name.replace(/^pid_[0-9]+_/, ''); engines[key] = (engines[key] || 0) + row.UtilizationPercentage; } return { available: s.gpuAvailable, engines, dedicatedMiB: s.gpuMemory.reduce((sum, row) => sum + Number(row.DedicatedUsage), 0) / 1048576, sharedMiB: s.gpuMemory.reduce((sum, row) => sum + Number(row.SharedUsage), 0) / 1048576, processes: s.gpuMemory }; });
    const record = { name, sourceWidth: 1920, sourceHeight: 1080, samples: samples.length, transportHz: +((count - startCount) / ((performance.now() - start) / 1000)).toFixed(1), obsActiveFps: +mean('activeFps').toFixed(2), obsAverageFrameRenderMs: +mean('averageFrameRenderTime').toFixed(3), renderFrames: after.renderTotalFrames - before.renderTotalFrames, renderSkippedFrames: after.renderSkippedFrames - before.renderSkippedFrames, obsReportedCpuPercent: +mean('cpuUsage').toFixed(3), obsReportedMemoryMiB: +mean('memoryUsage').toFixed(2), obsAndChildren: resourceDelta(obsBefore, obsAfter), native: resourceDelta(nativeBefore, nativeAfter), gpuSamples: gpu };
    records.push(record); const { gpuSamples: detailedGPU, ...summary } = record; console.log(JSON.stringify({ ...summary, gpuDedicatedSamplesMiB: detailedGPU.map(g => +g.dedicatedMiB.toFixed(1)) }));
  }
  try {
    await request('SetInputSettings', { inputName: sourceName, inputSettings: { width: 1920, height: 1080 }, overlay: true });
    if (!process.env.STUDIO_OBS_PERF_CASE) await sample('native-connected-idle', 15);
    const syntheticURL = new URL(url); syntheticURL.hash = new URLSearchParams({ ws: 'ws://127.0.0.1:4495', token: 'obs-resources' }).toString();
    await request('SetInputSettings', { inputName: sourceName, inputSettings: { url: syntheticURL.toString() }, overlay: true });
    active = true;
    if (process.env.STUDIO_OBS_PERF_CASE === 'soak') {
      if (process.env.STUDIO_OBS_RESOURCE_ONLY === '1') {
        d.performance.fps = '60'; revision++; broadcast({ type: 'studio_config', document: d, revision: String(revision), config_sequence: revision }); await sample('shared-artwork-60-fps-clean', Math.max(10, Math.floor(seconds / 2)));
        d.performance.fps = '30'; revision++; broadcast({ type: 'studio_config', document: d, revision: String(revision), config_sequence: revision }); await sample('shared-artwork-30-fps-clean', Math.max(10, Math.floor(seconds / 2)));
      } else { d.performance.fps = '30'; revision++; broadcast({ type: 'studio_config', document: d, revision: String(revision), config_sequence: revision }); await sample('shared-artwork-30-fps-soak', seconds); }
      active = false; broadcast({ event_type: 'input_reset', sequence: ++sequence }); await sample('cooldown-after-soak', 15);
      const seed = keyboard; profile.modules = Array.from({ length: 32 }, (_, i) => ({ ...structuredClone(seed), id: `dense-${i}`, x: i % 4 * 480, y: Math.floor(i / 4) * 135, w: 475, h: 130, keys: Array.from({ length: 100 }, (_, j) => ({ id: `k-${j}`, code: j + 32, label: String(j), x: j % 16 * 27, y: Math.floor(j / 16) * 16, w: 25, h: 14 })) }));
      d.performance.fps = '60'; revision++; broadcast({ type: 'studio_config', document: d, revision: String(revision), config_sequence: revision }); active = true; await sample('extreme-3200-keys-active', 15);
    } else {
    await sample('shared-artwork-active-60-fps', seconds);
    d.performance.fps = '30'; revision++; broadcast({ type: 'studio_config', document: d, revision: String(revision), config_sequence: revision });
    await sample('shared-artwork-active-30-fps', Math.max(10, Math.floor(seconds / 2)));
    }
    const filename = process.env.STUDIO_OBS_RESOURCE_ONLY === '1' ? 'obs-resources-clean.json' : process.env.STUDIO_OBS_PERF_CASE === 'soak' ? 'obs-resources-soak.json' : 'obs-resources.json';
    await writeFile(new URL(filename, artifacts), JSON.stringify({ syntheticInput: true, hardwarePollingVerified: false, singleBrowserSourceVerified: true, acceptanceScreenshotsBeforeMeasurement: process.env.STUDIO_OBS_RESOURCE_ONLY !== '1', note: 'OBS plus CEF process-tree CPU measured by Windows process accounting; 100% core = one logical CPU. Working-set and GPU per-process allocation sums are not unique physical memory. No stream or recording.', records }, null, 2));
  } finally { clearInterval(input); clearInterval(heartbeat); for (const ws of sockets.clients) ws.terminate(); await new Promise(resolve => sockets.close(resolve)); }
}
