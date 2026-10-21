import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const server = await preview({ preview: { host: '127.0.0.1', port: 5174, strictPort: true } });
const browser = await chromium.launch({ headless: true });
let sampleTimer; const samples = [], pendingSamples = new Set();
try {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5174/?diagnostics=1&artwork=1'); await page.locator('#rate').selectOption('8000');
  await page.locator('#seconds').fill(process.env.STUDIO_STRESS_SECONDS || '60');
  const cdp = await page.context().newCDPSession(page); await cdp.send('HeapProfiler.collectGarbage'); const before = await cdp.send('Runtime.getHeapUsage');
  await page.locator('#run').click();
  const started = performance.now();
  sampleTimer = setInterval(() => {
    const job = (async () => { await cdp.send('HeapProfiler.collectGarbage'); samples.push({ seconds: +((performance.now() - started) / 1000).toFixed(1), ...(await cdp.send('Runtime.getHeapUsage')) }); })();
    pendingSamples.add(job); job.then(() => pendingSamples.delete(job), () => pendingSamples.delete(job));
  }, 30000);
  await expect(page.locator('#results')).toContainText('"completed": true', { timeout: (Number(process.env.STUDIO_STRESS_SECONDS || 60) + 10) * 1000 });
  clearInterval(sampleTimer); await Promise.all(pendingSamples);
  const report = JSON.parse(await page.locator('#results').textContent());
  await cdp.send('HeapProfiler.collectGarbage'); const after = await cdp.send('Runtime.getHeapUsage');
  report.heapBeforeGCBytes = before.usedSize; report.heapAfterGCBytes = after.usedSize; report.errors = errors;
  report.production = true; report.heapSamplesAfterGC = samples;
  expect(report.events).toBe(8000 * Number(process.env.STUDIO_STRESS_SECONDS || 60)); expect(errors).toEqual([]);
  // A bounded storage smoke check, not a proof against every possible memory leak.
  expect(after.usedSize - before.usedSize).toBeLessThan(8_000_000);
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/performance-results.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { clearInterval(sampleTimer); await Promise.allSettled(pendingSamples); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
