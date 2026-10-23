import contract from '../src/core/compatibility/contract.json' with {type:'json'};
// Isolated renderer and synthetic transport; never changes live capture settings.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument, documentSchema , parseDocument} from '../src/core/config.ts';
const artifacts = new URL('../artifacts/animation/', import.meta.url); await mkdir(artifacts, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5220, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4620 });
let document = initialDocument(), revision = 0;
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = packet => ws.send(JSON.stringify(packet)); if(m.document?.version===4)m.document=parseDocument(JSON.stringify(m.document));
  if (m.type === 'auth') { send({ type: 'auth_response', studio_capabilities:{...contract,role:'capture'}, status: 'success', studio_revisions: true, studio_visuals: true, studio_shapes: true, studio_animation: true, studio_preset_metadata: true }); return; }
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    document = documentSchema.parse(m.document); revision++;
    for (const client of wss.clients) if (client.readyState === 1) client.send(JSON.stringify({ type: 'studio_config', document, revision: String(revision), origin: m.origin }));
    send({ type: 'studio_saved', request_id: m.request_id, revision: String(revision) });
  }
}));
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1560, height: 1050 } });
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4620', token: 'animation' })));
const page = await context.newPage(), fixture = await context.newPage(), errors = [], results = [];
for (const p of [page, fixture]) p.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const key = () => fixture.locator('[data-key="65"]');
const configure = patch => fixture.evaluate(patch => { const a = window.__animation; a.engine.reset(); Object.assign(a.module.appearance, patch); a.scene.update(a.document, a.document.profiles[0]); }, patch);
const input = (event_type, extra = {}) => fixture.evaluate(({ event_type, extra }) => window.__animation.engine.ingest({ event_type, rawcode: 65, ...extra }), { event_type, extra });
try {
  await fixture.goto('http://127.0.0.1:5220');
  await fixture.evaluate(async () => {
    const [{ Scene }, { InputEngine }, { initialDocument }, { parseSvgShape }] = await Promise.all([import('/src/renderer/scene.ts'), import('/src/core/input.ts'), import('/src/core/config.ts'), import('/src/core/svg-import.ts')]);
    const d = initialDocument(), m = d.profiles[0].modules[0]; d.profiles[0].modules = [m];
    Object.assign(m, { x: 60, y: 60, w: 100, h: 100, gap: 8, effect: 'Instant', background: '#ff0000', accent: '#0000ff', keys: [{ id: 'A', code: 65, label: 'A', x: 0, y: 0, w: 100, h: 100 }] });
    Object.assign(m.appearance, { showLabels: false, motion: 'None', lighting: 'Fill', pressDuration: 0, releaseDuration: 0, pressDelay: 0, releaseDelay: 0, borderWidth: 4, borderColor: '#ff0000', activeBorderColor: '#00ff00', lightingOpacity: 1 });
    d.performance.glowQuality = 'High'; d.shapes.ring = parseSvgShape('<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="M5 5H95V95H5Z M30 30H70V70H30Z"/></svg>', 'Ring');
    document.body.replaceChildren(); document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
    const root = document.createElement('div'); document.body.append(root); const engine = new InputEngine(), scene = new Scene(root, engine);
    const a = window.__animation = { document: d, module: m, engine, scene, frames: 0 }; scene.onFrame = () => a.frames++; scene.update(d, d.profiles[0]);
  });
  await check('onset and release delays affect visuals while physical state stays immediate', async () => {
    await configure({ pressDelay: 180, releaseDelay: 240 }); await input('key_pressed');
    expect(await fixture.evaluate(() => window.__animation.engine.keys[65])).toBe(1); await expect(key()).not.toHaveClass(/pressed/);
    await expect(key()).toHaveClass(/pressed/); await input('key_released');
    expect(await fixture.evaluate(() => window.__animation.engine.keys[65])).toBe(0); await expect(key()).toHaveClass(/pressed/); await expect(key()).not.toHaveClass(/pressed/);
  });
  await check('very short delayed taps render, repeat releases cancel and disconnect clears pending presses', async () => {
    await configure({ pressDelay: 180, releaseDelay: 0 });
    expect(await fixture.evaluate(() => new Promise(resolve => {
      const a = window.__animation, el = document.querySelector('[data-key="65"]');
      const timeout = setTimeout(() => { observer.disconnect(); resolve(false); }, 2000);
      const observer = new MutationObserver(() => { if (el.classList.contains('pressed')) { clearTimeout(timeout); observer.disconnect(); resolve(true); } });
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
      a.engine.ingest({ event_type: 'key_pressed', rawcode: 65 }); a.engine.ingest({ event_type: 'key_released', rawcode: 65 });
    }))).toBe(true); await expect(key()).not.toHaveClass(/pressed/);
    await configure({ pressDelay: 0, releaseDelay: 250 }); await input('key_pressed'); await expect(key()).toHaveClass(/pressed/); await input('key_released'); await input('key_pressed'); await fixture.waitForTimeout(300); await expect(key()).toHaveClass(/pressed/);
    await configure({ pressDelay: 250, releaseDelay: 0 }); await input('key_pressed'); await input('input_reset'); await fixture.waitForTimeout(300); await expect(key()).not.toHaveClass(/pressed/);
  });
  await check('all lighting variants are distinct and honor intensity and gradient controls', async () => {
    await configure({ pressDelay: 0, releaseDelay: 0 });
    const appearances = [];
    for (const lighting of ['Fill','Outline','Glow','Fill + glow','Gradient','Ripple','Analog Fill','Off']) {
      await configure({ lighting, secondaryColor: '#ff00ff', gradientAngle: 45 }); await input('key_pressed'); await expect(key()).toHaveClass(/pressed/);
      appearances.push(await key().evaluate(el => { const a = getComputedStyle(el.querySelector('.key-active')); return [a.opacity,a.backgroundImage,getComputedStyle(el).filter].join('|'); }));
    }
    expect(new Set(appearances).size).toBeGreaterThanOrEqual(7);
    await configure({ lighting: 'Gradient', lightingOpacity: .4 }); await input('key_pressed'); await expect(key().locator('.key-active')).toHaveCSS('opacity', '0.4');
    await expect(key().locator('.key-active')).toHaveCSS('background-image', /45deg.*255, 0, 255/);
  });
  await check('movement modes, easing, SVG contours and analog fill use the production scene', async () => {
    for (const motion of ['None','Press','Scale','Lift','Bounce','Pulse']) {
      await configure({ lighting: 'Fill', lightingOpacity: 1, motion, pressDuration: 150, releaseDuration: 0, easing: 'Spring', motionScale: .85, pressTravel: 5 }); await input('key_pressed'); await expect(key()).toHaveAttribute('data-motion', motion); await expect(key()).toHaveClass(/pressed/);
      if (motion === 'None') await expect(key()).toHaveCSS('transform', 'none');
      else if (motion === 'Press') await expect(key()).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 0, 5\)/);
      else if (motion === 'Scale') await expect(key()).toHaveCSS('transform', /matrix\(0.85/);
      else if (motion === 'Lift') await expect(key()).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 0, -5\)/);
      else await expect(key()).toHaveCSS('animation-name', motion === 'Bounce' ? 'key-bounce' : 'key-pop');
    }
    await configure({ motion: 'None', lighting: 'Analog Fill', pressDuration: 0, shapeId: 'ring' }); await input('analog_depth', { depth: .37 });
    await expect(key()).toHaveCSS('--depth', /37/); await expect(key().locator('.key-body')).toHaveCSS('mask-image', /svg/);
    const png = await fixture.screenshot({ omitBackground: true });
    const center = await fixture.evaluate(async data => { const i = new Image(); i.src = data; await i.decode(); const c=document.createElement('canvas'); c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return x.getImageData(110,110,1,1).data[3]; }, `data:image/png;base64,${png.toString('base64')}`);
    expect(center).toBe(0);
  });
  await check('reduced motion suppresses movement and low glow quality caps blur', async () => {
    await fixture.evaluate(() => window.__animation.document.performance.reducedMotion = true);
    await configure({ motion: 'Bounce', lighting: 'Ripple', pressDuration: 400 }); await input('key_pressed'); await expect(key()).toHaveCSS('transform', 'none'); await expect(key()).toHaveCSS('animation-name', 'none'); await expect(key().locator('.key-active')).toHaveCSS('animation-name', 'none');
    await fixture.evaluate(() => { window.__animation.document.performance.reducedMotion = false; window.__animation.document.performance.glowQuality = 'Off'; });
    await configure({ lighting: 'Glow', glowStrength: 40 }); await expect(key()).toHaveCSS('--light-glow', '0px');
    await fixture.evaluate(() => { const a = window.__animation; a.document.performance.glowQuality = 'High'; a.scene.update(a.document, a.document.profiles[0]); }); await expect(key()).toHaveCSS('--light-glow', '40px');
    await fixture.evaluate(() => { const a = window.__animation; a.document.performance.glowQuality = 'Low'; a.scene.update(a.document, a.document.profiles[0]); }); await expect(key()).toHaveCSS('--light-glow', '12px');
    await fixture.evaluate(() => { const a = window.__animation; a.document.performance.glowQuality = 'Off'; a.scene.update(a.document, a.document.profiles[0]); }); await expect(key()).toHaveCSS('--light-glow', '0px');
  });
  await check('idle, held and delayed states avoid a continuous JavaScript frame loop', async () => {
    await configure({ motion: 'None', lighting: 'Fill', pressDelay: 600, releaseDelay: 0, shapeId: '' }); await input('key_pressed'); await fixture.waitForTimeout(50);
    const before = await fixture.evaluate(() => window.__animation.frames); await fixture.waitForTimeout(200); expect(await fixture.evaluate(() => window.__animation.frames)).toBe(before);
    await expect(key()).toHaveClass(/pressed/); const held = await fixture.evaluate(() => window.__animation.frames); await fixture.waitForTimeout(200); expect(await fixture.evaluate(() => window.__animation.frames)).toBe(held);
    await input('key_released'); await expect(key()).not.toHaveClass(/pressed/);
  });
  await check('mouse buttons and wheel pulses use independent delayed timelines', async () => {
    await fixture.evaluate(async () => {
      const { makeModule } = await import('/src/core/config.ts'), a = window.__animation, mouse = makeModule('mouse');
      Object.assign(mouse, { x: 300, y: 60, buttons: [1,6,7] });
      Object.assign(mouse.appearance, { motion: 'Scale', lighting: 'Fill', pressDelay: 150, releaseDelay: 0, pressDuration: 0, releaseDuration: 0 });
      a.document.profiles[0].modules.push(mouse); a.scene.update(a.document, a.document.profiles[0]);
      a.engine.ingest({ event_type: 'mouse_pressed', button: 1 });
    });
    await expect(fixture.locator('[data-button="1"]')).toHaveClass(/pressed/);
    await fixture.evaluate(() => window.__animation.engine.ingest({ event_type: 'mouse_released', button: 1 }));
    await expect(fixture.locator('[data-button="1"]')).not.toHaveClass(/pressed/);
    expect(await fixture.evaluate(() => new Promise(resolve => {
      const a = window.__animation, el = document.querySelector('[data-button="6"]');
      const timeout = setTimeout(() => { observer.disconnect(); resolve(false); }, 2000);
      const observer = new MutationObserver(() => { if (el.classList.contains('pressed')) { clearTimeout(timeout); observer.disconnect(); resolve(true); } });
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
      a.engine.ingest({ event_type: 'mouse_wheel', rotation: -1 });
    }))).toBe(true);
    await expect(fixture.locator('[data-button="6"]')).not.toHaveClass(/pressed/);
    expect(await fixture.evaluate(() => window.__animation.engine.buttons[6])).toBe(0);
  });
  await page.goto('http://127.0.0.1:5220'); await expect(page.locator('.statusbar')).toContainText('Synced to OBS');
  await check('editor controls save independent animation fields and preview without publishing input or document changes', async () => {
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click();
    const details = page.locator('.properties-panel .animation-details').first(); await details.locator('summary').click();
    await page.getByLabel('Button motion', { exact: true }).selectOption('Scale'); await page.getByLabel('Lighting mode', { exact: true }).selectOption('Gradient');
    await page.getByLabel('Press delay', { exact: true }).fill('160'); await page.getByLabel('Release delay', { exact: true }).fill('240'); await page.getByLabel('Secondary light color', { exact: true }).fill('#ff00ff');
    await expect.poll(() => document.profiles[0].modules[0].appearance.pressDelay).toBe(160); await expect(page.locator('.statusbar')).toContainText('Synced to OBS');
    const saved = JSON.stringify(document), beforeRevision = revision;
    await page.getByRole('button', { name: 'Play animation', exact: true }).click(); await expect(details.locator('.animation-sample .overlay-key')).toHaveClass(/pressed/); await expect(details.locator('.animation-sample .overlay-key')).not.toHaveClass(/pressed/);
    expect(JSON.stringify(document)).toBe(saved); expect(revision).toBe(beforeRevision);
    await page.screenshot({ path: fileURLToPath(new URL('animation-controls.png', artifacts)) });
    await page.reload(); await expect(page.locator('.statusbar')).toContainText('Synced to OBS'); expect(document.profiles[0].modules[0].appearance).toMatchObject({ motion: 'Scale', lighting: 'Gradient', pressDelay: 160, releaseDelay: 240, secondaryColor: '#ff00ff' });
  });
  await check('individual keys inherit timing and can override and reset a single field', async () => {
    await page.getByRole('button', { name: 'Select Keyboard', exact: true }).click(); await page.getByRole('button', { name: 'Keys', exact: true }).click(); await page.getByLabel('Customize this key', { exact: true }).check();
    const details = page.locator('.properties-panel .animation-details').first(); await details.locator('summary').click();
    await page.getByLabel('Key Press delay', { exact: true }).fill('350'); await expect.poll(() => document.profiles[0].modules[0].keys[0].style?.pressDelay).toBe(350);
    await page.getByRole('button', { name: 'Reset Key Press delay to module', exact: true }).click(); await expect.poll(() => document.profiles[0].modules[0].keys[0].style?.pressDelay).toBeUndefined(); await expect(page.getByLabel('Key Press delay', { exact: true })).toHaveValue('160');
  });
  expect(errors).toEqual([]); console.log(`${results.length} animation checks passed.`);
} finally { await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await vite.close(); }
