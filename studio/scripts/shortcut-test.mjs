import contract from '../src/core/compatibility/contract.json' with {type:'json'};
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { WebSocketServer } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initialDocument , parseDocument} from '../src/core/config.ts';
const vite = await createServer({ server: { host: '127.0.0.1', port: 5199, strictPort: true } }); await vite.listen();
const wss = new WebSocketServer({ host: '127.0.0.1', port: 4505 });
let document = initialDocument(), revision = 0;
const broadcast = packet => { for (const ws of wss.clients) if (ws.authed && ws.readyState === 1) ws.send(JSON.stringify(packet)); };
wss.on('connection', ws => ws.on('message', raw => {
  const m = JSON.parse(String(raw)), send = data => ws.send(JSON.stringify(data)); if(m.document?.version===4)m.document=parseDocument(JSON.stringify(m.document));
  if (m.type === 'auth') { ws.authed = m.token === 'shortcut-test'; send({ type: 'auth_response', studio_capabilities:{...contract,role:'capture'}, status: ws.authed ? 'success' : 'failed', protocol:5, studio_revisions: true, studio_shapes: true }); return; }
  if (!ws.authed) return;
  if (m.type === 'studio_get') send({ type: 'studio_config', document, revision: String(revision) });
  if (m.type === 'studio_set') {
    if (m.base_revision !== String(revision)) { send({ type: 'studio_conflict', document, revision: String(revision), request_id: m.request_id }); return; }
    document = m.document; revision++; broadcast({ type: 'studio_config', document, revision: String(revision), origin: m.origin }); send({ type: 'studio_saved', revision: String(revision), request_id: m.request_id });
  }
}));
const heartbeat = setInterval(() => broadcast({ type: 'heartbeat' }), 1000);
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1560, height: 1050 }, permissions: ['clipboard-read','clipboard-write'] });
await context.addInitScript(() => localStorage.setItem('studio.inspector-section', 'all'));
await context.addInitScript(() => localStorage.setItem('studio.connection', JSON.stringify({ url: 'ws://127.0.0.1:4505', token: 'shortcut-test' })));
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
const bodyFocus = () => page.locator('.selection-tools').getByRole('button',{name:'Copy selection',exact:true}).focus();
const focusModule = async name => { await select(name); await page.getByRole('button',{name:`Select ${name}`,exact:true}).focus(); };
const modules = () => document.profiles.find(p => p.id === document.activeProfileId).modules;
const shortcutSection = () => page.getByRole('region',{name:'Keyboard shortcuts',exact:true});
const settings = async () => { await page.getByRole('button',{name:'Settings',exact:true}).click(); await page.getByLabel('Find a shortcut command',{exact:true}).fill(''); };
const studio = () => page.getByRole('button',{name:'Studio',exact:true}).click();
const bind = async (command,combo) => { await page.getByRole('button',{name:`Change ${command} shortcut`,exact:true}).click(); await page.keyboard.press(combo); };
const restoreDefaults = () => page.getByRole('button',{name:'Restore default shortcuts',exact:true}).click();
try {
  await page.goto('http://127.0.0.1:5199'); await expect(page.locator('.statusbar')).toContainText('Synced to OBS');
  await check('Ctrl+C/V copy a whole module with independent identities and single-step Undo',async()=>{
    await focusModule('Keyboard'); const initial=structuredClone(module('keyboard')), count=modules().length, before=await history();
    await page.keyboard.press('Control+c'); expect(await history()).toBe(before); await page.keyboard.press('Control+v'); await expect.poll(()=>modules().length).toBe(count+1);
    const copy=modules().find(m=>m.name==='Keyboard copy'); expect(copy.keys.map(k=>k.id).some(id=>initial.keys.some(k=>k.id===id))).toBe(false); expect(copy.x).toBe(initial.x+24); expect(copy.y).toBe(initial.y+24); expect(await history()).toBe(before+1);
    await page.keyboard.press('Control+z'); await expect.poll(()=>modules().length).toBe(count); await page.keyboard.press('Control+y'); await expect.poll(()=>modules().length).toBe(count+1);
    await undo(); await expect.poll(()=>modules().length).toBe(count);
  });
  await check('Ctrl+D duplicates; Delete and Backspace remove only the selected block and ignore repeats',async()=>{
    await focusModule('Keyboard'); const count=modules().length; await page.keyboard.press('Control+d'); await expect.poll(()=>modules().length).toBe(count+1);
    await page.keyboard.down('Delete'); await page.keyboard.down('Delete'); await page.keyboard.down('Delete'); await page.keyboard.up('Delete'); await expect.poll(()=>modules().length).toBe(count);
    await focusModule('Keyboard'); await page.keyboard.press('Backspace'); await expect.poll(()=>modules().length).toBe(count-1); await undo(); await expect.poll(()=>modules().length).toBe(count);
  });
  await check('cut/paste preserves the object resources and original position',async()=>{
    await focusModule('Keyboard'); const initial=structuredClone(module('keyboard')), count=modules().length;
    await page.keyboard.press('Control+x'); await expect.poll(()=>modules().length).toBe(count-1); await page.keyboard.press('Control+v'); await expect.poll(()=>modules().length).toBe(count);
    const copy=modules().find(m=>m.name==='Keyboard'); expect(copy.x).toBe(initial.x); expect(copy.y).toBe(initial.y); expect(copy.keys.map(k=>k.code)).toEqual(initial.keys.map(k=>k.code));
    await undo(); await expect.poll(()=>modules().length).toBe(count-1); await undo(); await expect.poll(()=>modules().length).toBe(count);
  });
  await check('key mode routes copy/paste/duplicate/delete to the key, leaving its block intact',async()=>{
    await focusModule('Keyboard'); await page.keyboard.press('Control+e'); await expect(page.locator('.key-hitbox')).toHaveCount(module('keyboard').keys.length);
    await cap(key().label).focus(); const count=module('keyboard').keys.length, block=module('keyboard').id;
    await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await expect.poll(()=>module('keyboard').keys.length).toBe(count+1); expect(module('keyboard').id).toBe(block);
    await page.keyboard.press('Control+d'); await expect.poll(()=>module('keyboard').keys.length).toBe(count+2); await page.keyboard.press('Delete'); await expect.poll(()=>module('keyboard').keys.length).toBe(count+1);
    await undo(); await expect.poll(()=>module('keyboard').keys.length).toBe(count+2); await undo(); await expect.poll(()=>module('keyboard').keys.length).toBe(count+1); await undo(); await expect.poll(()=>module('keyboard').keys.length).toBe(count);
  });
  await check('Ctrl+C/V/X and Delete keep native text behavior in property inputs',async()=>{
    const count=module('keyboard').keys.length; await field('Key label').fill('TEXT'); await field('Key label').press('Control+a'); await field('Key label').press('Control+c'); await field('Key label').press('End'); await field('Key label').press('Control+v'); await expect(field('Key label')).toHaveValue('TEXTTEXT');
    await field('Key label').press('Control+a'); await field('Key label').press('Control+x'); await expect(field('Key label')).toHaveValue(''); await field('Key label').press('Control+v'); await expect(field('Key label')).toHaveValue('TEXTTEXT');
    await field('Key label').press('Control+a'); await field('Key label').press('Delete'); await expect(field('Key label')).toHaveValue(''); expect(module('keyboard').keys.length).toBe(count);
    await field('Key label').fill('W'); await bodyFocus(); await page.keyboard.press('Escape'); await expect(page.locator('.key-hitbox')).toHaveCount(0);
  });
  await check('locked blocks reject cut/delete and locked keyboards reject individual paste',async()=>{
    await select('Keyboard'); await field('Lock position').check(); await bodyFocus(); const count=modules().length, keys=module('keyboard').keys.length;
    await page.keyboard.press('Control+x'); await page.keyboard.press('Delete'); await page.keyboard.press('Backspace'); expect(modules().length).toBe(count);
    await page.keyboard.press('Control+e'); await bodyFocus(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); expect(module('keyboard').keys.length).toBe(keys);
    await field('Lock position').uncheck(); await bodyFocus(); await page.keyboard.press('Escape');
  });
  await check('selected mouse buttons support copy/paste/delete/duplicate without changing input identities',async()=>{
    await select('Mouse Buttons'); await field('Edit mouse button').selectOption('1'); await bodyFocus(); await page.keyboard.press('Control+c');
    await field('Edit mouse button').selectOption('2'); await bodyFocus(); await page.keyboard.press('Control+v'); await expect.poll(()=>module('mouse').buttonLabels[1]).toBe(module('mouse').buttonLabels[0]);
    await page.keyboard.press('Delete'); await expect.poll(()=>module('mouse').buttons.includes(2)).toBe(false);
    await field('Edit mouse button').selectOption('1'); await bodyFocus(); await page.keyboard.press('Control+d'); await expect.poll(()=>module('mouse').buttons.includes(2)).toBe(true);
    await undo(); await expect.poll(()=>module('mouse').buttons.includes(2)).toBe(false); await undo(); await expect.poll(()=>module('mouse').buttons.includes(2)).toBe(true); await undo(); await expect.poll(()=>module('mouse').buttonLabels[1]).toBe('M2');
  });
  await check('native key assignment cannot accidentally invoke an editor command',async()=>{
    await select('Keyboard'); await page.getByRole('button',{name:'Edit keys on canvas',exact:true}).click(); await field('Edit key').selectOption('0');
    const count=module('keyboard').keys.length; await page.getByRole('button',{name:'Assign by pressing a key',exact:true}).click();
    broadcast({event_type:'key_pressed',rawcode:67}); await expect(page.getByRole('button',{name:'Assign by pressing a key',exact:true})).toBeVisible(); await page.keyboard.press('Control+d');
    expect(module('keyboard').keys.length).toBe(count); await page.waitForTimeout(300); await bodyFocus(); await page.keyboard.press('Control+d'); await expect.poll(()=>module('keyboard').keys.length).toBe(count+1); await undo(); await expect.poll(()=>module('keyboard').keys.length).toBe(count); await bodyFocus(); await page.keyboard.press('Escape');
  });
  await check('view shortcuts change zoom and panels without editing the document or replaying on page return',async()=>{
    await bodyFocus(); const before=await history(), scale=()=>page.locator('.scene-scale').evaluate(el=>getComputedStyle(el).transform);
    await page.keyboard.press('Shift+Digit0'); await expect.poll(scale).toBe('matrix(1, 0, 0, 1, 0, 0)'); await page.keyboard.press('Control+Equal'); await expect.poll(scale).toBe('matrix(1.1, 0, 0, 1.1, 0, 0)');
    await settings(); await studio(); await expect.poll(scale).toBe('matrix(1.1, 0, 0, 1.1, 0, 0)'); await bodyFocus(); await page.keyboard.press('Control+Minus'); await expect.poll(scale).toBe('matrix(1, 0, 0, 1, 0, 0)');
    await page.keyboard.press('Shift+Digit1'); await expect.poll(scale).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
    const snapButton=page.getByRole('button',{name:'Snap to grid',exact:true}), snapBefore=await snapButton.getAttribute('class'); await page.keyboard.press('Control+Shift+g'); await expect.poll(()=>snapButton.getAttribute('class')).not.toBe(snapBefore); await page.keyboard.press('Control+Shift+g');
    await page.keyboard.press('Control+Shift+i'); await expect(page.locator('.properties-panel')).toBeHidden(); await page.keyboard.press('Control+Shift+i'); await expect(page.locator('.properties-panel')).toBeVisible();
    await page.keyboard.press('Control+Shift+l'); await expect(page.locator('.modules-panel')).toBeHidden(); await page.keyboard.press('Control+Shift+l'); await expect(page.locator('.modules-panel')).toBeVisible(); expect(await history()).toBe(before);
  });
  await check('custom command bindings survive reload and physical codes work on Russian layouts',async()=>{
    await settings(); await bind('Copy selection','Alt+c'); await bind('Delete selection','F2');
    await page.reload(); await expect(page.getByText('Capture connected')).toBeVisible(); await settings(); await expect(page.getByRole('button',{name:'Change Copy selection shortcut',exact:true})).toContainText('Alt+C'); await expect(page.getByRole('button',{name:'Change Delete selection shortcut',exact:true})).toContainText('F2');
    await studio(); await focusModule('Keyboard'); const count=modules().length;
    await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC',key:'с',altKey:true,bubbles:true,cancelable:true}))); await page.keyboard.press('Control+v'); await expect.poll(()=>modules().length).toBe(count+1);
    await page.keyboard.press('F2'); await expect.poll(()=>modules().length).toBe(count); await settings(); await restoreDefaults();
  });
  await check('conflicts are explicit and can be cancelled or reassigned without double commands',async()=>{
    await bind('Copy selection','Control+v'); await expect(page.getByRole('alert')).toContainText('Paste selection'); await page.getByRole('button',{name:'Keep existing bindings',exact:true}).click(); await expect(page.getByRole('button',{name:'Change Copy selection shortcut',exact:true})).toContainText('Ctrl+C');
    await bind('Copy selection','Control+v'); await page.getByRole('button',{name:'Reassign shortcut',exact:true}).click(); await expect(page.getByRole('button',{name:'Change Paste selection shortcut',exact:true})).toContainText('Not assigned');
    await studio(); await focusModule('Keyboard'); const count=modules().length; await page.keyboard.press('Control+v'); expect(modules().length).toBe(count); await settings(); await restoreDefaults();
  });
  await check('shortcut recording suppresses commands, cancels on Escape and rejects reserved keys',async()=>{
    const count=modules().length; await page.getByRole('button',{name:'Change Copy selection shortcut',exact:true}).click(); await page.keyboard.press('Delete'); expect(modules().length).toBe(count); await expect(page.getByRole('alert')).toContainText('Delete selection'); await page.getByRole('button',{name:'Keep existing bindings',exact:true}).click();
    await page.getByRole('button',{name:'Change Copy selection shortcut',exact:true}).click(); await page.keyboard.press('Escape'); await expect(page.getByRole('button',{name:'Change Copy selection shortcut',exact:true})).toContainText('Ctrl+C');
    await page.getByRole('button',{name:'Change Copy selection shortcut',exact:true}).click(); await page.keyboard.press('ArrowRight'); await expect(shortcutSection().getByRole('status')).toContainText('reserved'); await page.keyboard.press('Escape');
  });
  await check('disabled commands stay disabled after reload and resetting restores aliases',async()=>{
    await page.getByRole('button',{name:'Clear Delete selection shortcuts',exact:true}).click(); await page.reload(); await expect(page.getByText('Capture connected')).toBeVisible(); await studio(); await focusModule('Keyboard'); const count=modules().length; await page.keyboard.press('Delete'); expect(modules().length).toBe(count);
    await settings(); await page.getByRole('button',{name:'Reset Delete selection shortcuts',exact:true}).click(); await expect(page.getByRole('button',{name:'Change Delete selection shortcut',exact:true})).toContainText('Delete / Backspace');
  });
  await check('remapped Undo cancels an active resize without committing it',async()=>{
    await bind('Undo','Alt+u'); await studio(); await focusModule('Keyboard'); const initial=structuredClone(module('keyboard')),before=await history(); await page.getByRole('button',{name:'Focus selection',exact:true}).click();
    await drag(page.getByRole('button',{name:'Resize Keyboard',exact:true}),-25,-15,'Alt+u'); expect(module('keyboard')).toEqual(initial); expect(await history()).toBe(before);
    await settings(); await restoreDefaults();
  });
  await check('additional bindings, search and short windows retain reachable settings',async()=>{
    await page.getByRole('button',{name:'Add Copy selection shortcut',exact:true}).click(); await page.keyboard.press('Alt+c'); await expect(page.getByRole('button',{name:'Change Copy selection shortcut',exact:true})).toContainText('Ctrl+C / Alt+C');
    await field('Find a shortcut command').fill('Paste'); await expect(page.getByRole('button',{name:'Change Paste selection shortcut',exact:true})).toHaveCount(1); await expect(page.getByRole('button',{name:'Change Undo shortcut',exact:true})).toHaveCount(0); await field('Find a shortcut command').fill('');
    await page.setViewportSize({width:960,height:540}); await page.getByRole('button',{name:'Restore default shortcuts',exact:true}).scrollIntoViewIfNeeded(); await expect(page.getByRole('button',{name:'Restore default shortcuts',exact:true})).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false); await page.setViewportSize({width:1560,height:1050}); await restoreDefaults(); await field('Find a shortcut command').fill('selection');
    await page.getByRole('button',{name:'Change Copy selection shortcut',exact:true}).scrollIntoViewIfNeeded(); await mkdir('artifacts',{recursive:true}); await page.screenshot({path:'artifacts/shortcut-settings.png'});
  });
  expect(errors).toEqual([]); console.log(`Passed ${results.length} shortcut checks`);
} finally { clearInterval(heartbeat); await browser.close(); for (const ws of wss.clients) ws.terminate(); await new Promise(r=>wss.close(r)); await vite.close(); }
