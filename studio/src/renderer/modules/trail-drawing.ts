import type { OverlayModule, StudioDocument } from '../../core/config';
import { InputEngine, PointRing, type InputEvent } from '../../core/input';
import { rgba } from '../../core/skins';
export class Trail {
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
