import {parseDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
// Layout regressions use synthetic transport, never the user's live configuration.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const artifacts = new URL('../artifacts/workspace/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5207, strictPort: true } });
await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4598 });
let document = null, revision = 0;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = packet => ws.send(JSON.stringify(packet)); if(m.document?.version===4)m.document=parseDocument(JSON.stringify(m.document));
  if (m.type === 'auth') { ws.authed = m.token === 'workspace-test'; send({ type: 'auth_response', studio_capabilities:{...contract,role:'capture'}, status: ws.authed ? 'success' : 'failed', protocol:5, studio_revisions: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = m.document; revision++;
    broadcast({ type: 'studio_config', document, revision: String(revision), origin: m.origin });
    send({ type: 'studio_saved', revision: String(revision), request_id: m.request_id });
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 2000);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4598', token: 'workspace-test' })));
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const tab = name => page.getByRole('group', { name: 'Property sections' }).getByRole('button', { name, exact: true });
try {
  await page.goto('http://127.0.0.1:5207');
  await expect(page.getByText('Capture connected')).toBeVisible();
  await page.locator('.layer-list').getByRole('button', { name: 'Keyboard', exact: true }).click();
  await check('contextual sections preserve edits and keep unrelated fields out of the tab order', async () => {
    await expect(tab('Appearance')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('X', { exact: true })).toBeHidden();
    await tab('Keys').click();
    await page.getByLabel('Key label', { exact: true }).fill('UP');
    await tab('Appearance').click(); await tab('Keys').click();
    await expect(page.getByLabel('Key label', { exact: true })).toHaveValue('UP');
    await page.getByLabel('Key label', { exact: true }).fill('W');
    await tab('Appearance').click();
  });
  await check('numeric drafts accept decimal commas, keyboard steps and cancellation with visible bounds', async () => {
    await tab('Position').click(); const x = page.getByLabel('X', { exact: true });
    const original = await x.inputValue();
    await x.fill('128,'); await expect(x).toHaveValue('128,');
    await x.pressSequentially('50'); await expect(x).toHaveValue('128,50');
    await x.press('ArrowUp'); await expect(x).toHaveValue('129.5');
    await x.press('Shift+ArrowDown'); await expect(x).toHaveValue('119.5');
    await x.press('Escape'); await expect(x).toHaveValue(original);
    await x.fill('99999'); await expect(x).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.number-field, .numeric-control').filter({ has: x }).locator('.numeric-feedback')).toContainText('Value not applied');
    await x.press('Enter'); await expect(x).toHaveValue(original);
    await expect(page.locator('.number-field, .numeric-control').filter({ has: x }).locator('.numeric-feedback')).toContainText('Previous value restored');
    await tab('Appearance').click();
  });
  await check('sliders allow exact percentage entry and colors accept hex codes', async () => {
    const number = page.getByLabel('Background opacity value', { exact: true });
    await number.fill('37,5'); await expect(number).toHaveValue('37,5');
    await expect(page.getByLabel('Background opacity', { exact: true })).toHaveValue('0.375');
    await number.press('Enter'); await expect(number).toHaveValue('37.5');
    await number.fill('100'); await number.press('Enter');
    const hex = page.getByLabel('Accent color hex', { exact: true }), previous = await hex.inputValue();
    await hex.fill('#123abc'); await expect(page.getByLabel('Accent color', { exact: true })).toHaveValue('#123abc');
    await hex.fill(previous); await hex.press('Enter');
  });
  await check('right inspector width is adjustable by keyboard without changing overlay geometry', async () => {
    await expect(page.locator('.statusbar')).toContainText('Synced to OBS'); const before = JSON.stringify(document);
    const handle = page.getByRole('separator', { name: 'Properties panel width' });
    const width = (await page.locator('.properties-panel').boundingBox()).width;
    await handle.focus(); await handle.press('ArrowLeft'); await handle.press('ArrowLeft');
    expect((await page.locator('.properties-panel').boundingBox()).width).toBeCloseTo(width + 32,0);
    await handle.press('Home'); await handle.press('ArrowLeft'); await handle.press('ArrowLeft');
    expect(JSON.stringify(document)).toBe(before);
  });
  await check('dragging the right divider can be cancelled and width survives reload',async()=>{
    const handle=page.getByRole('separator',{name:'Properties panel width'}), original=Number(await handle.getAttribute('aria-valuenow')), before=JSON.stringify(document);
    const box=await handle.boundingBox(); await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down(); await page.mouse.move(box.x+box.width/2-80,box.y+box.height/2,{steps:8});
    await expect(handle).toHaveAttribute('aria-valuenow',String(original+80)); await page.keyboard.press('Escape'); await page.mouse.up(); await expect(handle).toHaveAttribute('aria-valuenow',String(original));
    await handle.focus(); await handle.press('ArrowLeft'); const width=Number(await handle.getAttribute('aria-valuenow')); await page.reload(); await expect(page.getByText('Capture connected')).toBeVisible(); await page.locator('.layer-list').getByRole('button',{name:'Keyboard',exact:true}).click();
    await expect(handle).toHaveAttribute('aria-valuenow',String(width)); expect(JSON.stringify(document)).toBe(before);
  });
  await check('selecting a module reopens its hidden properties', async () => {
    await page.getByRole('button', { name: 'Toggle properties', exact: true }).click();
    await expect(page.locator('.properties-panel')).toBeHidden();
    await page.locator('.layer-list').getByRole('button', { name: 'Keyboard', exact: true }).click();
    await expect(page.locator('.properties-panel')).toBeVisible();
    await page.screenshot({path:fileURLToPath(new URL('right-inspector-default.png',artifacts))});
  });
  for (const [width, height] of [[1920,1080],[1366,768],[1093,614],[960,540],[375,812],[320,740]]) {
    await page.setViewportSize({ width, height });
    await check(`reachable panels and no page overflow at ${width} × ${height}`, async () => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      {
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
        const bounds = await page.locator('.properties-panel').boundingBox();
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      }
      if (width>760) expect(await page.locator('.canvas-scroll').evaluate(el=>el.clientHeight)).toBeGreaterThan(170);
      const canvasBounds = await page.locator('.canvas-panel').boundingBox(), inspectorBounds = await page.locator('.properties-panel').boundingBox();
      if(width>760) { expect(inspectorBounds.x).toBeGreaterThanOrEqual(canvasBounds.x+canvasBounds.width-1); expect(inspectorBounds.y).toBeCloseTo(canvasBounds.y,0); expect(inspectorBounds.height).toBeCloseTo(canvasBounds.height,0); }
      const toolsBounds = await page.locator('.workspace-tools').boundingBox(); expect(toolsBounds.y+toolsBounds.height).toBeCloseTo(canvasBounds.y+canvasBounds.height,0);
      await tab('Position').click();
      await page.getByRole('button', { name: 'Delete module', exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: 'Delete module', exact: true })).toBeInViewport();
      await tab('All properties').click();
      await page.locator('.property-scroll').evaluate(el => { el.scrollTop=el.scrollHeight; });
      const last=await page.getByRole('button',{name:'Delete module',exact:true}).boundingBox(), port=await page.locator('.property-scroll').boundingBox();
      expect(last.y+last.height).toBeLessThanOrEqual(port.y+port.height-16);
      await tab('Appearance').click();
      await page.screenshot({ path: fileURLToPath(new URL(`midnight-${width}.png`, artifacts)), fullPage: true });
    });
    if (width > 760) await check(`zoomed scene has reachable left, top, right and bottom at ${width}`, async () => {
      await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
      for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      const edges = await page.evaluate(() => {
        const sc = document.querySelector('.canvas-scroll'), canvas = document.querySelector('.canvas-shell');
        sc.scrollTo(0,0); const port = sc.getBoundingClientRect(), first = canvas.getBoundingClientRect();
        sc.scrollTo(sc.scrollWidth,sc.scrollHeight); const last = canvas.getBoundingClientRect();
        return { left: first.left-port.left, top: first.top-port.top, right: last.right-port.right, bottom: last.bottom-port.bottom };
      });
      expect(edges.left).toBeGreaterThanOrEqual(0); expect(edges.top).toBeGreaterThanOrEqual(0);
      expect(edges.right).toBeLessThanOrEqual(1); expect(edges.bottom).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await check('collapsing panels gives the scene room without changing the document', async () => {
    await expect(page.locator('.statusbar')).toContainText('Synced to OBS');
    // Resizing across the compact breakpoint reopens layers asynchronously.
    // Measure only after that state has reached the docked desktop layout.
    await expect(page.locator('.modules-panel')).toBeVisible();
    await expect(page.locator('.properties-panel')).toBeVisible();
    const before = JSON.stringify(document), canvas = await page.locator('.canvas-panel').boundingBox();
    await page.getByRole('button', { name: 'Toggle properties', exact: true }).click();
    await expect(page.locator('.properties-panel')).toBeHidden();
    expect((await page.locator('.canvas-panel').boundingBox()).width).toBeGreaterThan(canvas.width + 300);
    await page.getByRole('button', { name: 'Toggle properties', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle layers', exact: true }).click();
    await expect(page.locator('.modules-panel')).toBeHidden();
    expect((await page.locator('.canvas-panel').boundingBox()).width).toBeGreaterThan(canvas.width);
    await page.getByRole('button', { name: 'Toggle layers', exact: true }).click();
    expect(JSON.stringify(document)).toBe(before);
  });
  await check('focus selection enlarges keys without changing exported geometry', async () => {
    const before = JSON.stringify(document), small = await page.getByRole('button', { name: 'Select Keyboard', exact: true }).boundingBox();
    await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
    expect((await page.getByRole('button', { name: 'Select Keyboard', exact: true }).boundingBox()).height).toBeGreaterThan(small.height);
    expect(JSON.stringify(document)).toBe(before);
    await page.screenshot({ path: fileURLToPath(new URL('midnight-focus.png', artifacts)) });
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  });
  await check('actual zoom remains available with a wide inspector and reaches 400 percent', async () => {
    await page.getByRole('separator', { name: 'Properties panel width' }).focus();
    await page.getByRole('separator', { name: 'Properties panel width' }).press('End');
    await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
    await page.getByRole('button', { name: 'Actual size (100%)', exact: true }).click();
    const keyboard = page.getByRole('button', { name: 'Select Keyboard', exact: true });
    expect((await keyboard.boundingBox()).width).toBeCloseTo(document.profiles[0].modules.find(m => m.type === 'keyboard').w, 0);
    for (let i = 0; i < 35; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    expect((await keyboard.boundingBox()).width).toBeCloseTo(document.profiles[0].modules.find(m => m.type === 'keyboard').w * 4, 0);
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    await page.getByRole('separator', { name: 'Properties panel width' }).focus();
    await page.getByRole('separator', { name: 'Properties panel width' }).press('Home');
    await page.getByRole('separator', { name: 'Properties panel width' }).press('ArrowLeft');
    await page.getByRole('separator', { name: 'Properties panel width' }).press('ArrowLeft');
  });
  await check('artwork actions remain reachable in short and narrow windows', async () => {
    await tab('Artwork').click();
    const png = await page.evaluate(() => { const c=document.createElement('canvas'); c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='#8064c4';x.fillRect(0,0,64,64);return c.toDataURL(); });
    await page.getByLabel('Upload keycap image', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await page.getByRole('button', { name: 'Position & scale image', exact: true }).click();
    for (const [width,height] of [[1366,768],[960,540],[375,812]]) {
      await page.setViewportSize({width,height});
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport();
      await expect(dialog.getByRole('button',{name:'Apply image placement',exact:true})).toBeInViewport();
    }
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  });
  await check('adding a module in a narrow window exposes its settings and closes the drawer', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    if (await page.locator('.properties-panel').isVisible()) await page.getByRole('button',{name:'Close properties',exact:true}).click();
    if (!(await page.locator('.modules-panel').isVisible())) await page.getByRole('button', { name: 'Toggle layers', exact: true }).click();
    await page.getByRole('button', { name: 'Add module', exact: true }).click();
    await page.locator('.module-library').getByRole('button').first().click();
    await expect(page.locator('.modules-panel')).toBeHidden();
    await expect(page.locator('.properties-panel')).toBeVisible();
    await tab('Position').click();
    await page.getByRole('button', { name: 'Delete module', exact: true }).click();
    await expect(page.locator('.empty-selection')).toBeVisible();
  });
  await check('narrow screens use a right drawer, and its close control restores focus without moving the canvas',async()=>{
    const before=await page.locator('.canvas-panel').boundingBox(); await expect(page.locator('.properties-panel')).toBeVisible(); await page.getByRole('button',{name:'Close properties',exact:true}).click();
    await expect(page.locator('.properties-panel')).toBeHidden(); await expect(page.getByRole('button',{name:'Toggle properties',exact:true})).toBeFocused(); expect(await page.locator('.canvas-panel').boundingBox()).toEqual(before);
    await page.getByRole('button',{name:'Toggle properties',exact:true}).click(); await expect(page.locator('.properties-panel')).toBeVisible();
  });
  for(const [density,width,height] of [[1.25,1093,614],[1.5,910,512]]) await check(`right inspector remains reachable at emulated ${density*100}% Windows scaling`,async()=>{
    const dpiContext=await browser.newContext({viewport:{width,height},deviceScaleFactor:density});
    try {
      await dpiContext.addInitScript(()=>localStorage.setItem('studio.connection',JSON.stringify({url:'ws://127.0.0.1:4598',token:'workspace-test'})));
      const dpi=await dpiContext.newPage(); await dpi.goto('http://127.0.0.1:5207'); await expect(dpi.locator('.statusbar')).toContainText('Synced to OBS');
      await dpi.getByRole('button',{name:'Toggle layers',exact:true}).click(); await dpi.locator('.layer-list').getByRole('button',{name:'Keyboard',exact:true}).click();
      expect(await dpi.evaluate(()=>devicePixelRatio)).toBe(density); expect(await dpi.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight)).toBe(true);
      await dpi.getByRole('group',{name:'Property sections'}).getByRole('button',{name:'Position',exact:true}).click(); await dpi.getByRole('button',{name:'Delete module',exact:true}).scrollIntoViewIfNeeded(); await expect(dpi.getByRole('button',{name:'Delete module',exact:true})).toBeInViewport();
      await dpi.screenshot({path:fileURLToPath(new URL(`right-inspector-dpi-${density*100}.png`,artifacts))});
    } finally { await dpiContext.close(); }
  });
  await check('secondary pages reflow without horizontal clipping', async () => {
    for (const width of [1280,960,375,320]) {
      await page.setViewportSize({ width, height: 800 });
      for (const name of ['Profiles','Presets','Settings']) {
        await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const overflow = await page.locator('.content-page').evaluate(e => e.scrollWidth > e.clientWidth + 1);
        expect(overflow, `${name} at ${width}`).toBe(false);
      }
    }
  });
  for (const linux of [false, true]) await check(`native advanced settings retain capture options (${linux ? 'Linux fixture' : 'Windows fixture'})`, async () => {
    const nativeContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await nativeContext.addInitScript(linux => {
      Object.defineProperty(navigator,'platform',{get:()=>linux?'Linux x86_64':'Win32'});
      const config = { host: '127.0.0.1', port: 4598, auth_token: 'workspace-test', http_enabled: true, http_port: 5207, analog_keyboard: '', capture_enabled: true, key_whitelist: ['key_w'], raw_mouse_min_delta: 0, send_mouse_move: true, cpu_affinity: [1, 2], linux_evdev_keyboard_device: '', linux_raw_mouse_device: '' };
      window.__savedNative = null; window.__startupCalls = 0;
      window.__TAURI__ = { core: { invoke: async (name, args) => {
        if (name === 'get_config') return config;
        if (name === 'get_autostart') return false;
        if (name === 'set_autostart') { window.__startupCalls++; return true; }
        if (name === 'save_config') { window.__savedNative = args.newCfg; return; }
        if (name === 'get_device_status') return { keyboard_count: 1, mouse_count: 1, capture_running: true };
        if (name === 'get_http_status') return { running: true, port: 5207, host: '127.0.0.1', overlay_available: true, bind_error: null };
        if (name === 'get_startup_warning') return null;
        if (linux && name === 'enum_keyboards') return [['/dev/input/event3', 'Fixture keyboard']];
        if (linux && name === 'enum_mice') return [['/dev/input/event4', 'Fixture mouse']];
        if (linux && name === 'check_linux_perms') return [];
        throw Error('Unsupported command');
      } } };
    }, linux);
    const native = await nativeContext.newPage(); native.on('pageerror', error => errors.push(error.message));
    try {
      await native.goto('http://127.0.0.1:5207'); await expect(native.getByText('Capture connected')).toBeVisible();
      await native.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
      await native.getByText('Advanced capture settings', { exact: true }).click();
      await native.getByLabel('Allowed input names', { exact: true }).fill('key_w, mouse_left');
      if(linux)await expect(native.getByLabel('CPU affinity cores', { exact: true })).toBeDisabled();
      else await native.getByLabel('CPU affinity cores', { exact: true }).fill('3, 4');
      await native.getByLabel('Raw mouse minimum delta', { exact: true }).fill('2');
      await native.getByLabel('Broadcast mouse movement', { exact: true }).uncheck();
      if (linux) {
        await native.getByLabel('Keyboard device', { exact: true }).selectOption('/dev/input/event3');
        await native.getByLabel('Mouse device', { exact: true }).selectOption('/dev/input/event4');
      }
      await native.getByRole('button', { name: 'Apply server settings', exact: true }).click();
      const saved = await native.evaluate(() => window.__savedNative);
      expect(saved.key_whitelist).toEqual(['key_w', 'mouse_left']); expect(saved.cpu_affinity).toEqual(linux?[1,2]:[3,4]);
      expect(saved.raw_mouse_min_delta).toBe(2); expect(saved.send_mouse_move).toBe(false); expect(saved.auth_token).toBe('workspace-test');
      if (linux) { expect(saved.linux_evdev_keyboard_device).toBe('/dev/input/event3'); expect(saved.linux_raw_mouse_device).toBe('/dev/input/event4'); }
      expect(await native.evaluate(() => window.__startupCalls)).toBe(0);
      expect(await native.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally { await nativeContext.close(); }
  });
  await check('no JavaScript runtime errors', async () => expect(errors).toEqual([]));
  await writeFile(new URL('results.json', artifacts), JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close(); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate();
  await new Promise(resolve => wss.close(resolve)); await vite.close();
}
