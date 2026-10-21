import { cm360, type OverlayModule, type Profile, type StudioDocument } from '../core/config';
import { InputEngine, PointRing, type InputEvent } from '../core/input';
import './overlay.css';
import { capsFor, imagePlacement, resolvedStyle, rgba, type Cap } from '../core/skins';

class Trail {
  readonly points = new PointRing(2048);
  x = 0; y = 0; cameraX = 0; cameraY = 0;
  pending = false; speed = 0; lastInput = 0; lastDraw = 0;
  clicks: { x: number; y: number; t: number; button: number }[] = [];
  readonly canvas = document.createElement('canvas');
  readonly ctx = this.canvas.getContext('2d')!;
  constructor(public module: OverlayModule, private engine: InputEngine) {
    this.canvas.width = Math.round(module.w); this.canvas.height = Math.round(module.h);
    this.canvas.className = 'trail-canvas';
  }
  input(e: InputEvent, now: number) {
    const m = this.module;
    if (e.event_type === 'input_reset') { this.points.clear(); this.clicks = []; this.x = this.y = this.cameraX = this.cameraY = 0; this.pending = true; return; }
    if (e.event_type === 'mouse_moved') {
      const factor = m.scale * (m.scaleMode === 'DPI Normalized Scale' ? 800 / this.engine.dpi : 1);
      this.x += e.dx * factor; this.y += e.dy * factor;
      // Shift the virtual field at the boundary. No clamping that traps a cursor at an edge.
      if (m.position === 'Fixed Field') {
        const margin = 16;
        const left = -m.w * m.originX + margin, right = m.w * (1 - m.originX) - margin;
        const top = -m.h * m.originY + margin, bottom = m.h * (1 - m.originY) - margin;
        this.cameraX = this.x < this.cameraX + left ? this.x - left : this.x > this.cameraX + right ? this.x - right : this.cameraX;
        this.cameraY = this.y < this.cameraY + top ? this.y - top : this.y > this.cameraY + bottom ? this.y - bottom : this.cameraY;
      }
      this.speed = Math.hypot(e.dx, e.dy) / Math.max(1, now - this.lastInput);
      this.lastInput = now; this.pending = true;
    }
    if (e.event_type === 'mouse_pressed' && m.clickEffects !== 'Off') {
      this.clicks.push({ x: this.x, y: this.y, t: now, button: e.button });
      if (this.clicks.length > 24) this.clicks.shift();
    }
  }
  draw(now: number, d: StudioDocument) {
    const m = this.module, astyle = m.trailAppearance, c = this.ctx, w = m.w, h = m.h;
    c.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
    if (this.pending) { this.points.push(this.x, this.y, this.lastInput || now, this.speed); this.pending = false; }
    while (this.points.length && now - this.points.data[this.points.index(0) + 2] > m.duration) this.points.length--;
    const dt = Math.min(100, now - (this.lastDraw || now)); this.lastDraw = now;
    if (m.position === 'Follow / Recenter') {
      const follow = 1 - Math.exp(-dt / astyle.followMs);
      this.cameraX += (this.x - this.cameraX) * follow; this.cameraY += (this.y - this.cameraY) * follow;
    }
    c.clearRect(0, 0, w, h);
    if (m.grid) {
      c.strokeStyle = rgba(astyle.gridColor, astyle.gridOpacity); c.lineWidth = 1; c.beginPath();
      for (let x = 0; x < w; x += astyle.gridSpacing) { c.moveTo(x, 0); c.lineTo(x, h); }
      for (let y = 0; y < h; y += astyle.gridSpacing) { c.moveTo(0, y); c.lineTo(w, y); } c.stroke();
    }
    const ox = w * m.originX, oy = h * m.originY;
    if (m.center) {
      c.strokeStyle = astyle.centerColor; const size = astyle.centerSize; c.beginPath(); c.moveTo(ox - size, oy); c.lineTo(ox + size, oy); c.moveTo(ox, oy - size); c.lineTo(ox, oy + size); c.stroke();
    }
    c.save(); c.translate(ox - this.cameraX, oy - this.cameraY);
    c.lineWidth = m.thickness; c.lineCap = 'round'; c.lineJoin = 'round';
    if (m.trailStyle === 'Neon Trail' && d.performance.glowQuality !== 'Off') {
      c.shadowBlur = d.performance.glowQuality === 'High' ? m.glow : Math.min(m.glow, 5); c.shadowColor = m.accent;
    }
    const budget = d.performance.quality === 'Low' ? 128 : d.performance.quality === 'Medium' ? 384 : 1024;
    const step = Math.max(1, Math.ceil(this.points.length / budget));
    const a = this.points.data;
    for (let j = step; j < this.points.length; j += step) {
      const i0 = this.points.index(j - step), i1 = this.points.index(j);
      c.globalAlpha = m.trailStyle === 'Clean Line' ? 1 : Math.max(0, 1 - (now - a[i1 + 2]) / m.duration);
      c.strokeStyle = m.trailStyle === 'Speed Gradient' ? mixColor(astyle.slowColor, astyle.fastColor, Math.min(1, a[i1 + 3] * 800 / this.engine.dpi / astyle.speedRange)) : m.accent;
      if (m.trailStyle === 'Segmented Trail' && j % (step * 3) === 0) continue;
      c.beginPath(); c.moveTo(a[i0], a[i0 + 1]); c.lineTo(a[i1], a[i1 + 1]); c.stroke();
    }
    c.shadowBlur = 0; c.globalAlpha = 1;
    this.clicks = this.clicks.filter(click => now - click.t < astyle.clickDuration);
    for (const click of this.clicks) {
      const age = (now - click.t) / astyle.clickDuration;
      c.strokeStyle = click.button === 2 ? astyle.rightClickColor : astyle.leftClickColor; c.globalAlpha = 1 - age;
      c.beginPath(); c.arc(click.x, click.y, m.clickEffects === 'Ripple' && !d.performance.reducedMotion ? 5 + age * astyle.clickSize : astyle.clickSize / 4, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1; c.fillStyle = astyle.markerColor; c.strokeStyle = astyle.markerColor;
    if (m.marker === 'Dot') { c.beginPath(); c.arc(this.x, this.y, astyle.markerSize, 0, Math.PI * 2); c.fill(); }
    if (m.marker === 'Crosshair') { c.beginPath(); c.moveTo(this.x - astyle.markerSize * 1.75, this.y); c.lineTo(this.x + astyle.markerSize * 1.75, this.y); c.moveTo(this.x, this.y - astyle.markerSize * 1.75); c.lineTo(this.x, this.y + astyle.markerSize * 1.75); c.stroke(); }
    c.restore();
  }
}

function mixColor(a: string, b: string, t: number) { return `rgb(${[1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)).join(',')})`; }

export class Scene {
  private document!: StudioDocument;
  private profile!: Profile;
  private nodes = new Map<string, HTMLElement>();
  private trails = new Map<string, Trail>();
  private contents = new Map<string, string>();
  private moduleTypes = new Map<string, OverlayModule["type"]>();
  private controls: { el: HTMLElement; code: number; mouse: boolean; previous: number; flashUntil: number; wheelMs: number }[] = [];
  private distances: { el: HTMLElement; module: OverlayModule }[] = [];
  private measure = document.createElement('canvas').getContext('2d')!;
  private assetUrls = new Map<string, { data: string; url: string }>();
  private wheelDuration = 110;
  private raf = 0;
  private timer = 0;
  private disposed = false;
  private lastFrame = 0;
  private lastRevision = -1;
  private lastDistance = -1;
  private dirty = true;
  private listener = (e: InputEvent, now: number) => {
    this.trails.forEach(t => t.input(e, now));
    if (e.event_type === 'input_reset' || e.event_type === 'key_pressed' || e.event_type === 'mouse_pressed') for (const control of this.controls) {
      if (e.event_type === 'input_reset') { control.flashUntil = 0; control.el.classList.remove('tap-flash'); }
      if ((e.event_type === 'key_pressed' && !control.mouse && e.rawcode === control.code) || (e.event_type === 'mouse_pressed' && control.mouse && e.button === control.code)) control.flashUntil = now + 65;
    }
    this.wake();
  };
  onFrame?: (ms: number) => void;
  constructor(private root: HTMLElement, readonly engine: InputEngine) {
    root.classList.add('overlay-scene'); this.engine.listeners.add(this.listener); window.addEventListener('resize', this.resizeOutput);
  }
  update(d: StudioDocument, p: Profile) {
    const profileChanged = this.profile && this.profile.id !== p.id;
    this.document = d; this.profile = p; this.engine.dpi = p.dpi;
    this.wheelDuration = Math.max(50, ...p.modules.filter(m => m.type === 'mouse').map(m => m.wheelDuration));
    this.root.classList.toggle('reduced-motion', d.performance.reducedMotion);
    for (const [id, cached] of this.assetUrls) if (!d.assets[id] || d.assets[id].data !== cached.data) { URL.revokeObjectURL(cached.url); this.assetUrls.delete(id); }
    if (profileChanged) {
      this.root.replaceChildren(); this.nodes.clear(); this.trails.clear(); this.contents.clear(); this.moduleTypes.clear();
      this.controls = []; this.distances = [];
    }
    const ids = new Set(p.modules.map(m => m.id));
    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) { node.remove(); this.nodes.delete(id); this.trails.delete(id); this.contents.delete(id); this.moduleTypes.delete(id); }
    }
    let index = 0;
    for (const m of [...p.modules].sort((a, b) => a.z - b.z)) {
      let el = this.nodes.get(m.id);
      if (el && this.moduleTypes.get(m.id) !== m.type) {
        el.remove(); this.nodes.delete(m.id); this.trails.delete(m.id); this.contents.delete(m.id); el = undefined;
      }
      if (!el) {
        el = document.createElement('div'); el.dataset.moduleId = m.id;
        this.nodes.set(m.id, el); this.moduleTypes.set(m.id, m.type);
      }
      el.className = `overlay-module module-${m.type} effect-${m.effect.replace(' ', '-').toLowerCase()}`;
      Object.assign(el.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px`, opacity: `${m.opacity}`, zIndex: `${m.z}`, display: m.visible ? '' : 'none' });
      el.style.setProperty('--module-accent', m.accent); el.style.setProperty('--module-bg', rgba(m.background, m.appearance.backgroundOpacity)); el.style.setProperty('--module-radius', `${m.radius}px`);
      el.style.setProperty('--surface-border', rgba(m.appearance.borderColor, m.appearance.borderOpacity)); el.style.setProperty('--surface-border-width', `${m.appearance.borderWidth}px`);
      el.style.setProperty('--text-color', m.appearance.textColor); el.style.setProperty('--font-family', m.appearance.fontFamily);
      el.style.setProperty('--font-size', `${m.appearance.fontSize}px`); el.style.setProperty('--font-weight', `${m.appearance.fontWeight}`);
      el.style.setProperty('--letter-spacing', `${m.appearance.letterSpacing}px`); el.style.setProperty('--outline', `${m.appearance.textOutline}px`);
      el.style.setProperty('--text-shadow', `0 1px ${m.appearance.textShadow}px #000`); el.dataset.textLayout = m.textLayout;
      const signature = JSON.stringify(m.type === 'keyboard' || m.type === 'mouse' ? 'caps' : m.type === 'distance' ? m.caption : m.type === 'sensitivity' ? [p.game, p.caption, p.dpi, p.sensitivity, p.yaw, p.scale, p.manualCm, m.sensitivityStyle, m.showGame, m.showDpi, m.showSens, m.showEdpi, m.showCm] : 'trail');
      if (signature !== this.contents.get(m.id)) {
        el.replaceChildren();
        this.controls = this.controls.filter(c => !el!.contains(c.el) && c.el.closest('[data-module-id]') !== el);
        this.distances = this.distances.filter(v => v.module.id !== m.id);
        if (m.type === 'keyboard' || m.type === 'mouse') { const group = document.createElement('div'); group.className = 'cap-layout'; el.append(group); }
        if (m.type === 'trail') { const trail = new Trail(m, this.engine); this.trails.set(m.id, trail); el.append(trail.canvas); }
        if (m.type === 'distance') {
          const caption = document.createElement('span'); caption.className = 'metric-caption'; caption.textContent = m.caption;
          const value = document.createElement('strong'); el.append(caption, value); this.distances.push({ el: value, module: m });
        }
        if (m.type === 'sensitivity') this.sensitivity(el, m);
        this.contents.set(m.id, signature);
      }
      if (m.type === 'distance') { el.classList.add('metric'); const metric = this.distances.find(v => v.module.id === m.id); if (metric) metric.module = m; }
      if (m.type === 'sensitivity') el.classList.add('sensitivity-strip');
      if (m.type === 'keyboard' || m.type === 'mouse') this.renderCaps(el, m);
      const trail = this.trails.get(m.id);
      if (trail) { trail.module = m; this.sizeTrail(trail); }
      const at = this.root.children[index];
      if (at !== el) this.root.insertBefore(el, at || null);
      index++;
    }
    this.controls = this.controls.filter(c => this.root.contains(c.el));
    this.distances = this.distances.filter(v => this.root.contains(v.el));
    this.dirty = true; this.lastDistance = -1; this.wake();
  }
  private sizeTrail(trail: Trail) {
    const ratio = Math.max(1, Math.min(2, this.root.getBoundingClientRect().width / 1920 * window.devicePixelRatio));
    const w = Math.round(trail.module.w * ratio), h = Math.round(trail.module.h * ratio);
    if (trail.canvas.width !== w) trail.canvas.width = w;
    if (trail.canvas.height !== h) trail.canvas.height = h;
  }
  resizeOutput = () => { this.trails.forEach(t => this.sizeTrail(t)); this.dirty = true; this.wake(); };
  private assetUrl(id: string) {
    const asset = this.document.assets[id]; if (!asset) return '';
    let entry = this.assetUrls.get(id);
    if (!entry) {
      const [header, encoded] = asset.data.split(',');
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      entry = { data: asset.data, url: URL.createObjectURL(new Blob([bytes], { type: header.slice(5, header.indexOf(';')) })) }; this.assetUrls.set(id, entry);
    }
    return entry.url;
  }
  private renderCaps(el: HTMLElement, m: OverlayModule) {
    const group = el.querySelector<HTMLElement>('.cap-layout')!, { caps, w, h } = capsFor(m);
    const scale = Math.min(m.w / w, m.h / h);
    Object.assign(group.style, { width: `${w}px`, height: `${h}px`, transform: `scale(${scale})` });
    group.classList.toggle('mouse-diagram', m.type === 'mouse' && m.mouseMode === 'Mouse Diagram');
    let outline = group.querySelector<SVGElement>('.mouse-outline');
    if (m.type === 'mouse' && m.mouseMode === 'Mouse Diagram') {
      if (!outline) {
        outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); outline.classList.add('mouse-outline'); outline.setAttribute('viewBox', '0 0 220 300');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M110 4 C42 4 6 45 6 119 L6 207 C6 267 42 296 110 296 C178 296 214 267 214 207 L214 119 C214 45 178 4 110 4 Z'); outline.append(path); group.prepend(outline);
      }
    } else outline?.remove();
    const ids = new Set(caps.map(k => k.id));
    for (const child of group.querySelectorAll<HTMLElement>('.overlay-key')) if (!ids.has(child.dataset.capId!)) child.remove();
    for (const cap of caps) {
      let key = [...group.querySelectorAll<HTMLElement>('.overlay-key')].find(k => k.dataset.capId === cap.id);
      if (!key) {
        key = document.createElement('div'); key.className = 'overlay-key'; key.dataset.capId = cap.id;
        const surface = document.createElement('div'); surface.className = 'key-surface';
        const active = document.createElement('div'); active.className = 'key-active'; surface.append(active);
        const label = document.createElement('span'); label.className = 'key-label'; key.append(surface, label); group.append(key);
        this.controls.push({ el: key, code: cap.code, mouse: m.type === 'mouse', previous: -1, flashUntil: 0, wheelMs: m.wheelDuration });
      }
      const control = this.controls.find(c => c.el === key)!; control.code = cap.code; control.wheelMs = m.wheelDuration;
      if (m.type === 'mouse') key.dataset.button = `${cap.code}`; else key.dataset.key = `${cap.code}`;
      key.querySelector('.key-label')!.textContent = cap.label;
      Object.assign(key.style, { position: 'absolute', left: `${cap.x}px`, top: `${cap.y}px`, width: `${cap.w}px`, height: `${cap.h}px` });
      const style = resolvedStyle(m, cap.style);
      const variables: Record<string, string | number> = { '--idle-bg': rgba(style.background, style.backgroundOpacity), '--active-bg': style.accent, '--idle-ink': style.textColor, '--active-ink': style.activeTextColor, '--idle-border': rgba(style.borderColor, style.borderOpacity), '--active-border': style.activeBorderColor, '--border-width': `${style.borderWidth}px`, '--corner': `${style.radius}px`, '--font-family': style.fontFamily, '--font-size': `${style.fontSize}px`, '--font-weight': style.fontWeight, '--letter-spacing': `${style.letterSpacing}px`, '--outline': `${style.textOutline}px`, '--text-shadow': style.textShadow ? `0 1px ${style.textShadow}px #000` : 'none', '--press-ms': `${style.pressDuration}ms`, '--release-ms': `${style.releaseDuration}ms`, '--travel': `${style.pressTravel}px`, '--glow': `${style.glowStrength}px` };
      for (const [name, value] of Object.entries(variables)) key.style.setProperty(name, `${value}`);
      if (style.autoFitText) { this.measure.font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`; const width = this.measure.measureText(cap.label).width + Math.max(0, cap.label.length - 1) * style.letterSpacing; const fontSize = Math.max(6, Math.min(style.fontSize, style.fontSize * (cap.w - 8) / Math.max(1, width), cap.h * .65)); key.style.setProperty('--font-size', `${fontSize}px`); }
      key.dataset.effect = style.effect;
      this.texture(key, cap, m, w, h);
    }
  }
  private texture(key: HTMLElement, cap: Cap, m: OverlayModule, w: number, h: number) {
    const settings = m.image, asset = this.document.assets[settings.assetId], surface = key.querySelector('.key-surface')!;
    let art = surface.querySelector<HTMLElement>('.key-art');
    const enabled = settings.enabled && asset && cap.imageEnabled !== false;
    key.classList.toggle('has-art', !!enabled); key.dataset.imagePress = settings.press;
    key.style.setProperty('--image-opacity', `${settings.opacity}`); key.style.setProperty('--press-tint', `${settings.pressTint}`);
    if (!enabled) { art?.remove(); return; }
    if (!art) { art = document.createElement('div'); art.className = 'key-art'; surface.prepend(art); }
    const url = this.assetUrl(settings.assetId), rect = imagePlacement(settings, asset, w, h);
    art.style.mixBlendMode = settings.blend;
    art.style.setProperty('--image-brightness', `${settings.brightness}`); art.style.setProperty('--image-contrast', `${settings.contrast}`); art.style.setProperty('--image-saturation', `${settings.saturation}`);
    const signature = `${url}:${settings.fit === 'Tile'}`;
    if (art.dataset.source !== signature) {
      art.replaceChildren(); const plane = document.createElement('div'); plane.className = 'image-plane';
      const image = document.createElement('div'); image.className = 'image-content'; plane.append(image); art.append(plane);
      const tint = document.createElement('div'); tint.className = 'image-tint'; art.append(tint); art.dataset.source = signature;
    }
    const plane = art.querySelector<HTMLElement>('.image-plane')!, image = art.querySelector<HTMLElement>('.image-content')!, tint = art.querySelector<HTMLElement>('.image-tint')!;
    Object.assign(plane.style, { left: `${-cap.x}px`, top: `${-cap.y}px`, width: `${w}px`, height: `${h}px` });
    if (settings.fit === 'Tile') {
      // Overscan keeps rotated patterns filled even at the layout corners.
      Object.assign(image.style, { left: `${-w * 4}px`, top: `${-h * 4}px`, width: `${w * 9}px`, height: `${h * 9}px`, backgroundImage: `url("${url}")`, backgroundSize: `${rect.width}px ${rect.height}px`, backgroundRepeat: 'repeat', backgroundPosition: `${w * 4 + settings.x}px ${h * 4 + settings.y}px`, transformOrigin: 'center', transform: `rotate(${settings.rotation}deg)` });
    } else {
      Object.assign(image.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, backgroundImage: `url("${url}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', backgroundPosition: '0 0', transformOrigin: 'center', transform: `rotate(${settings.rotation}deg)` });
    }
    tint.style.background = rgba(settings.tint, settings.tintOpacity);
  }
  private sensitivity(el: HTMLElement, m: OverlayModule) {
    const p = this.profile, cm = cm360(p);
    el.classList.add('sensitivity-strip');
    const add = (text: string, caption: string) => { const item = document.createElement('div'); const value = document.createElement('strong'); value.textContent = text; const sub = document.createElement('span'); sub.textContent = caption; item.append(value, sub); el.append(item); };
    if (m.sensitivityStyle === 'Detailed' && m.showGame) add(p.game, p.caption || 'GAME');
    if (m.sensitivityStyle !== 'Minimal' && m.showDpi) add(p.dpi.toLocaleString('en-US'), 'DPI');
    if (m.sensitivityStyle !== 'Minimal' && m.showSens) add(p.sensitivity.toFixed(2), 'SENS');
    if (m.sensitivityStyle === 'Detailed' && m.showEdpi) add((p.dpi * p.sensitivity).toFixed(0), 'eDPI');
    if (m.showCm) add(cm === null ? 'Unknown scale' : cm.toFixed(2), 'CM / 360°');
  }
  private wake() {
    if (!this.disposed && !this.raf && !this.timer) this.raf = requestAnimationFrame(this.frame);
  }
  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || !this.document) return;
    const fps = this.document.performance.fps === 'Auto' ? 120 : Number(this.document.performance.fps);
    if (now - this.lastFrame < 1000 / fps - 1) { this.wake(); return; }
    const start = performance.now(); this.lastFrame = now;
    if (now - this.engine.lastWheel > this.wheelDuration && (this.engine.buttons[6] || this.engine.buttons[7])) { this.engine.buttons[6] = this.engine.buttons[7] = 0; this.engine.revision++; }
    if (this.lastRevision !== this.engine.revision || this.dirty || this.engine.buttons[6] || this.engine.buttons[7]) {
      for (const control of this.controls) {
        const value = control.mouse ? (control.code >= 6 && now - this.engine.lastWheel >= control.wheelMs ? 0 : this.engine.buttons[control.code]) : this.engine.keys[control.code];
        if (value === control.previous) continue;
        control.el.classList.toggle('pressed', value > 0); control.el.style.setProperty('--depth', `${value * 100}%`); control.previous = value;
      }
      this.lastRevision = this.engine.revision;
    }
    if (this.engine.distanceCm !== this.lastDistance || this.dirty) {
      for (const { el, module: m } of this.distances) {
        const meters = m.unit === 'm' || (m.unit === 'Auto' && this.engine.distanceCm >= 100);
        el.textContent = `${(this.engine.distanceCm / (meters ? 100 : 1)).toLocaleString('en-US', { minimumFractionDigits: m.decimals, maximumFractionDigits: m.decimals })} ${meters ? 'm' : 'cm'}`;
      }
      this.lastDistance = this.engine.distanceCm;
    }
    let animate = false;
    for (const control of this.controls) { const flash = control.flashUntil > now && !control.el.classList.contains('pressed'); control.el.classList.toggle('tap-flash', flash); animate ||= control.flashUntil > now; }
    this.trails.forEach(t => {
      if (!t.module.visible) return;
      const movingCamera = Math.abs(t.x - t.cameraX) + Math.abs(t.y - t.cameraY) > .1 && t.module.position === 'Follow / Recenter';
      const active = t.points.length > 0 || t.pending || t.clicks.length > 0 || movingCamera;
      if (active || this.dirty) t.draw(now, this.document);
      animate ||= active;
    });
    this.dirty = false; this.onFrame?.(performance.now() - start);
    if (animate || this.engine.buttons[6] || this.engine.buttons[7]) this.wake();
  };
  resetDistance() { this.engine.distanceCm = 0; this.dirty = true; this.wake(); }
  dispose() { this.disposed = true; cancelAnimationFrame(this.raf); clearTimeout(this.timer); this.engine.listeners.delete(this.listener); window.removeEventListener('resize', this.resizeOutput); this.assetUrls.forEach(v => URL.revokeObjectURL(v.url)); this.assetUrls.clear(); this.root.replaceChildren(); }
}
