import { activeProfile, initialDocument } from './core/config';
import { InputEngine } from './core/input';
import { Scene } from './renderer/scene';
// Explicit developer entry only: /?diagnostics=1. Never imported by OBS.
export function startDiagnostics() {
  document.body.innerHTML = '<main style="font:14px system-ui;color:#cbd5df;background:#10151b;padding:24px"><h1>Input Overlay · developer diagnostics</h1><p>Synthetic input only. This does not measure hardware polling rate or game latency.</p><label>Rate <select id="rate"><option>1000</option><option>2000</option><option>4000</option><option>8000</option></select> Hz</label> <label>Duration <input id="seconds" type="number" value="30" min="1" max="3600"> seconds</label> <button id="run">Run</button> <button id="stop">Stop</button><pre id="results">Idle</pre><div id="diagnostic-scene" style="transform:scale(.5);transform-origin:top left"></div></main>';
  const engine = new InputEngine(); const scene = new Scene(document.getElementById('diagnostic-scene')!, engine);
  const d = initialDocument();
  const artwork = new URLSearchParams(location.search).get('artwork') === '1';
  if (artwork) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d')!, gradient = ctx.createLinearGradient(0, 0, 1024, 512); gradient.addColorStop(0, '#dd4477'); gradient.addColorStop(1, '#4466ff'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 512);
    d.assets.synthetic = { name: 'diagnostic artwork', width: 1024, height: 512, data: canvas.toDataURL('image/webp', .85) };
    const keyboard = activeProfile(d).modules.find(m => m.type === 'keyboard')!; keyboard.image = { ...keyboard.image, enabled: true, assetId: 'synthetic' };
  }
  scene.update(d, activeProfile(d));
  let timer: ReturnType<typeof setInterval> | undefined;
  const run = document.getElementById('run') as HTMLButtonElement, output = document.getElementById('results')!;
  let frameCount = 0, drawMs = 0, maxDraw = 0;
  scene.onFrame = ms => { frameCount++; drawMs += ms; maxDraw = Math.max(maxDraw, ms); };
  const stop = () => { clearInterval(timer); timer = undefined; engine.reset(); run.disabled = false; };
  run.onclick = () => {
    stop(); run.disabled = true; frameCount = drawMs = maxDraw = 0;
    const hz = Number((document.getElementById('rate') as HTMLSelectElement).value);
    const duration = Math.max(1, Math.min(3600, Number((document.getElementById('seconds') as HTMLInputElement).value) || 30));
    const start = performance.now(); let count = 0, processMs = 0;
    const memory = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const initialMemory = memory();
    timer = setInterval(() => {
      const elapsed = Math.min(duration * 1000, performance.now() - start), target = Math.floor(elapsed * hz / 1000);
      const tick = performance.now();
      while (count < target) {
        const phase = count / hz;
        const dx = Math.cos(phase * 2) * 3, dy = Math.sin(phase * 3) * 4;
        engine.ingest({ event_type: 'mouse_moved', dx, dy, distance_counts: Math.hypot(dx, dy) }, start + count * 1000 / hz);
        if (count % hz === 0) { for (const rawcode of [87, 65, 160, 162, 32]) engine.ingest({ event_type: 'key_pressed', rawcode }); engine.ingest({ event_type: 'mouse_pressed', button: 1 }); }
        if (count % hz === Math.floor(hz / 2)) engine.reset();
        count++;
      }
      processMs += performance.now() - tick;
      const report = { keycapImageActive: artwork, syntheticHz: hz, elapsedSeconds: +(elapsed / 1000).toFixed(2), events: count, processingMs: +processMs.toFixed(2), frames: frameCount, averageDrawMs: +(drawMs / Math.max(1, frameCount)).toFixed(3), maxDrawMs: +maxDraw.toFixed(3), heapStartBytes: initialMemory, heapCurrentBytes: memory(), distanceCm: +engine.distanceCm.toFixed(2), pointCapacityPerTrail: 2048, completed: elapsed >= duration * 1000 };
      output.textContent = JSON.stringify(report, null, 2);
      if (report.completed) stop();
    }, 16);
  };
  document.getElementById('stop')!.onclick = stop;
  window.addEventListener('beforeunload', () => { stop(); scene.dispose(); });
}
