import contract from '../src/core/compatibility/contract.json' with {type:'json'};
// Synthetic transport; no live user configuration is read or changed.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument, documentSchema , parseDocument} from '../src/core/config.ts';
const artifacts = new URL('../artifacts/shapes/', import.meta.url); await mkdir(artifacts, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5211, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4601 });
let document = initialDocument(), revision = 0;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = packet => ws.send(JSON.stringify(packet)); if(m.document?.version===4)m.document=parseDocument(JSON.stringify(m.document));
  if (m.type === 'auth') { ws.authed = m.token === 'shape-test'; send({ type: 'auth_response', studio_capabilities:{...contract,role:'capture'}, status: ws.authed ? 'success' : 'failed', protocol:5, studio_revisions: true, studio_visuals: true, studio_animation: true, studio_shapes: true, studio_preset_metadata: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = documentSchema.parse(m.document); revision++;
    broadcast({ type: 'studio_config', document, revision: String(revision), origin: m.origin }); send({ type: 'studio_saved', revision: String(revision), request_id: m.request_id });
  }
}));
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4601', token: 'shape-test' })));
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M5 5H95V95H5Z M30 30H70V70H30Z"/></svg>';
const upload = (name, source = svg) => page.getByLabel('Upload SVG shape', { exact: true }).setInputFiles({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(source) });
try {
  await page.goto('http://127.0.0.1:5211'); await expect(page.getByText('Capture connected')).toBeVisible();
  await page.locator('.layer-list').getByRole('button', { name: 'Keyboard', exact: true }).click();
  await page.getByText('Borders & shape', { exact: true }).click();
  await check('SVG upload stores geometry and applies a reusable vector mask', async () => {
    await upload('Ring.svg'); await expect(page.getByLabel('Shape', { exact: true })).not.toHaveValue('');
    await expect.poll(() => Object.keys(document.shapes).length).toBe(1);
    expect(document.profiles[0].modules[0].appearance.shapeId).toBeTruthy();
    await expect(page.locator('.preview-viewport .module-keyboard .custom-shape')).toHaveCount(7);
  });
  await check('one undo restores the previous shape and removes the imported geometry', async () => {
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByLabel('Shape', { exact: true })).toHaveValue('');
    await expect.poll(() => Object.keys(document.shapes).length).toBe(0);
    await page.getByRole('button', { name: /^Redo/ }).click();
    await expect.poll(() => Object.keys(document.shapes).length).toBe(1);
  });
  await check('labels hide without destroying their saved names or bindings', async () => {
    await page.getByText('Text & typography', { exact: true }).click();
    await page.getByLabel('Show labels', { exact: true }).uncheck();
    await expect(page.locator('.preview-viewport .module-keyboard .key-label').first()).toBeHidden();
    expect(await page.locator('.preview-viewport .module-keyboard .key-label').first().textContent()).toBe('W');
    await expect.poll(() => document.profiles[0].modules[0].appearance.showLabels).toBe(false);
  });
  await check('active SVG content, unsupported references and empty geometry are rejected', async () => {
    for (const source of ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="https://example.com/a.svg"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M20 20H30V30Z"/></svg>']) {
      await upload('Invalid.svg', source); await expect(page.locator('.shape-control [role="status"]').first()).not.toContainText('Imported');
      expect(Object.keys(document.shapes)).toHaveLength(1);
    }
  });
  await check('groups, transforms, curves, even-odd holes and basic SVG geometry normalize correctly', async () => {
    const parsed = await page.evaluate(async () => {
      const { parseSvgShape } = await import('/src/core/svg-import.ts');
      return parseSvgShape('<svg viewBox="0 0 100 100"><g transform="translate(2 3) scale(2)"><rect x="0" y="0" width="20" height="20" rx="3"/><circle cx="30" cy="30" r="5"/><polygon points="0,0 3,0 3,3"/></g></svg>', 'Primitives');
    });
    expect(parsed.paths).toHaveLength(3); expect(parsed.paths[0].matrix).toEqual([2, 0, 0, 2, 2, 3]); expect(parsed.paths[0].d).toContain('a3 3');
  });
  await check('signature layout loads all 81 keys and the skeleton mouse without labels', async () => {
    await page.getByRole('button', { name: 'Presets', exact: true }).click(); await page.locator('.library-card').filter({ has: page.getByRole('heading', { name: 'Yamio preset', exact: true }) }).getByRole('button', { name: 'Use full layout', exact: true }).click();
    await expect.poll(() => document.profiles[0].modules[0].keys.length).toBe(81);
    expect(Object.keys(document.shapes)).toHaveLength(7);
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
    await expect(page.locator('.preview-viewport .module-keyboard .custom-shape')).toHaveCount(81);
    await expect(page.locator('.preview-viewport .mouse-custom-body')).toHaveCount(1);
    await expect(page.locator('.preview-viewport .module-mouse .key-label').first()).toBeHidden();
    await expect(page.locator('.preview-viewport [data-key="32"] .key-label')).toHaveText('SPACE');
    const stats = page.locator('.preview-viewport .module-sensitivity');
    for (const label of ['DPI', 'SENS', 'CM / 360°']) await expect(stats.getByText(label, { exact: true })).toBeVisible();
    expect(await stats.evaluate(el => { const box = el.getBoundingClientRect(); return [...el.querySelectorAll('.sensitivity-content > div')].every(item => { const r = item.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1; }); })).toBe(true);
    await page.screenshot({ path: fileURLToPath(new URL('signature-editor.png', artifacts)) });
  });
  const fixture = await context.newPage(); await fixture.setViewportSize({ width: 1920, height: 1080 }); await fixture.goto('http://127.0.0.1:5211');
  await fixture.evaluate(async () => {
    const [{ Scene }, { InputEngine }, { initialDocument }, { parseSvgShape }] = await Promise.all([import('/src/renderer/scene.ts'), import('/src/core/input.ts'), import('/src/core/config.ts'), import('/src/core/svg-import.ts')]);
    const d = initialDocument(), m = d.profiles[0].modules[0]; d.profiles[0].modules = [m];
    Object.assign(m, { x: 0, y: 0, w: 100, h: 100, gap: 8, effect: 'Instant', background: '#ff0000', accent: '#0000ff', keys: [{ id: 'one', code: 65, label: 'A', x: 0, y: 0, w: 100, h: 100 }] });
    Object.assign(m.appearance, { showLabels: false, shapeId: 'ring', backgroundOpacity: 1, borderColor: '#00ff00', borderOpacity: 1, borderWidth: 6, activeBorderColor: '#00ff00', pressTravel: 0 });
    d.shapes.ring = parseSvgShape('<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="M5 5H95V95H5Z M30 30H70V70H30Z"/></svg>', 'Ring');
    document.body.replaceChildren(); document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; document.body.style.margin = '0';
    const root = document.createElement('div'); document.body.append(root);
    const engine = new InputEngine(), scene = new Scene(root, engine); scene.update(d, d.profiles[0]);
    window.__shapeFixture = { d, m, root, scene, engine };
  });
  const pixels = async filename => {
    const png = await fixture.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 100, height: 100 } }); await writeFile(new URL(filename, artifacts), png);
    return fixture.evaluate(async png => { const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode(); const c = document.createElement('canvas'); c.width = c.height = 100; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return [[2, 50], [50, 50], [8, 50], [20, 50], [27, 50]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]); }, png.toString('base64'));
  };
  await check('actual pixels preserve holes and clip contour borders without a rectangular rim', async () => {
    const values = await pixels('mask-idle.png'); expect(values[0][3]).toBe(0); expect(values[1][3]).toBe(0); expect(values[2]).toEqual([0, 255, 0, 255]); expect(values[3]).toEqual([255, 0, 0, 255]); expect(values[4]).toEqual([0, 255, 0, 255]);
  });
  await check('press fill respects the vector silhouette and its holes', async () => {
    await fixture.evaluate(() => window.__shapeFixture.engine.ingest({ event_type: 'key_pressed', rawcode: 65 }));
    await expect(fixture.locator('.overlay-key')).toHaveClass(/pressed/);
    const values = await pixels('mask-pressed.png'); expect(values[1][3]).toBe(0); expect(values[3]).toEqual([0, 0, 255, 255]);
  });
  await check('artwork follows the same mask and resizing keeps vector contours', async () => {
    await fixture.evaluate(() => {
      const { d, m, scene, engine } = window.__shapeFixture; engine.ingest({ event_type: 'key_released', rawcode: 65 });
      const c = document.createElement('canvas'); c.width = c.height = 8; const ctx = c.getContext('2d'); ctx.fillStyle = '#ffff00'; ctx.fillRect(0, 0, 8, 8);
      d.assets.art = { name: 'Yellow', width: 8, height: 8, data: c.toDataURL() }; Object.assign(m.image, { enabled: true, assetId: 'art', opacity: 1 }); scene.update(d, d.profiles[0]);
    });
    const values = await pixels('mask-artwork.png'); expect(values[1][3]).toBe(0); expect(values[3]).toEqual([255, 255, 0, 255]);
    await fixture.evaluate(() => { const f = window.__shapeFixture; Object.assign(f.m, { w: 200, h: 200 }); f.scene.update(f.d, f.d.profiles[0]); });
    expect(await fixture.locator('.cap-layout').evaluate(el => el.style.transform)).toBe('scale(2)');
  });
  await check('replacing geometry under the same ID invalidates cached masks', async () => {
    await fixture.evaluate(() => { const f = window.__shapeFixture; Object.assign(f.m, { w: 100, h: 100 }); f.d.shapes.ring.paths[0].d = 'M5 5H95V95H5Z'; f.scene.update(f.d, f.d.profiles[0]); });
    const values = await pixels('mask-replaced.png'); expect(values[1]).toEqual([255, 255, 0, 255]);
  });
  const roundedPixels = async filename => {
    const png = await fixture.locator('.overlay-key').first().screenshot({ omitBackground: true }); await writeFile(new URL(filename, artifacts), png);
    return fixture.evaluate(async png => { const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img,0,0); return [[2,2],[c.width-3,2],[2,c.height-3],[c.width-3,c.height-3],[Math.floor(c.width/2),Math.floor(c.height/2)]].map(([x,y]) => [...ctx.getImageData(x,y,1,1).data]); },png.toString('base64'));
  };
  await check('rounded key artwork clips all four corners, including individual radii and pressed fill', async () => {
    await fixture.evaluate(() => { const f = window.__shapeFixture; Object.assign(f.m,{radius:30,effect:'Instant'}); Object.assign(f.m.appearance,{shapeId:'',borderWidth:0,backgroundOpacity:0}); Object.assign(f.m.image,{press:'Tint',pressTint:1}); f.scene.setPreview({mode:'Idle',depth:.5}); f.scene.update(f.d,f.d.profiles[0]); });
    let values = await roundedPixels('rounded-idle.png'); for(const pixel of values.slice(0,4)) expect(pixel[3]).toBe(0); expect(values[4]).toEqual([255,255,0,255]);
    await fixture.evaluate(() => { const f = window.__shapeFixture; f.m.keys[0].style={radius:0}; f.scene.update(f.d,f.d.profiles[0]); });
    values = await roundedPixels('square-override.png'); for(const pixel of values) expect(pixel).toEqual([255,255,0,255]);
    await fixture.evaluate(() => { const f = window.__shapeFixture; f.m.keys[0].style={radius:50}; f.scene.update(f.d,f.d.profiles[0]); f.scene.setPreview({mode:'Pressed',depth:1}); });
    await expect(fixture.locator('.overlay-key')).toHaveClass(/pressed/);
    values = await roundedPixels('rounded-pressed.png'); for(const pixel of values.slice(0,4)) expect(pixel[3]).toBe(0); expect(values[4]).toEqual([0,0,255,255]);
  });
  await check('mouse button artwork uses its own rounded silhouette', async () => {
    await fixture.evaluate(() => { const f = window.__shapeFixture; Object.assign(f.m,{type:'mouse',w:300,h:110,mouseMode:'Compact Buttons',buttons:[1],radius:0,buttonStyles:{1:{radius:25}}}); f.scene.update(f.d,f.d.profiles[0]); f.scene.setPreview({mode:'Idle',depth:.5}); });
    const values = await roundedPixels('rounded-mouse.png'); for(const pixel of values.slice(0,4)) expect(pixel[3]).toBe(0); expect(values[4]).toEqual([255,255,0,255]);
  });
  await fixture.evaluate(async () => {
    const { signaturePreset } = await import('/src/core/signature-preset.ts'); const bundle = signaturePreset(), { scene, d } = window.__shapeFixture;
    d.shapes = bundle.shapes; d.profiles[0].modules = bundle.preset.modules; scene.update(d, d.profiles[0]);
    scene.setPreview({ mode: 'Idle', depth: .5 }); window.__signatureScene = scene;
  });
  await fixture.evaluate(async () => {
    const { engine } = window.__shapeFixture;
    for (let i = 0; i < 36; i++) { engine.ingest({ event_type: 'mouse_moved', dx: Math.cos(i * .18) * (5 + i), dy: Math.sin(i * .18) * (5 + i) }); await new Promise(requestAnimationFrame); }
  });
  await fixture.screenshot({ path: fileURLToPath(new URL('signature-overlay.png', artifacts)), omitBackground: true, clip: { x: 60, y: 620, width: 1860, height: 450 } });
  await fixture.evaluate(() => { window.__signatureScene.setPreview({ mode: 'Input', depth: .65 }); window.__shapeFixture.engine.ingest({ event_type: 'key_pressed', rawcode: 87 }); window.__shapeFixture.engine.ingest({ event_type: 'mouse_pressed', button: 1 }); });
  await fixture.screenshot({ path: fileURLToPath(new URL('signature-pressed.png', artifacts)), omitBackground: true, clip: { x: 60, y: 620, width: 1860, height: 450 } });
  await fixture.close(); expect(errors).toEqual([]);
  await writeFile(new URL('results.json', artifacts), JSON.stringify({ results, errors }, null, 2)); console.log(`${results.length} shape checks passed.`);
} finally { await context.close(); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await vite.close(); }
