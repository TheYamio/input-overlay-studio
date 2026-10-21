export type InputEvent =
  | { event_type: 'key_pressed' | 'key_released' | 'analog_depth'; rawcode: number; depth?: number }
  | { event_type: 'mouse_pressed' | 'mouse_released'; button: number }
  | { event_type: 'mouse_wheel'; rotation: number }
  | { event_type: 'mouse_moved'; dx: number; dy: number; distance_counts?: number; distance_cm?: number }
  | { event_type: 'input_reset' | 'state_restored' }
  | { event_type: 'distance_changed'; cm: number };

export interface InputSnapshot { sequence: number; keys: { rawcode: number; depth: number }[]; buttons: number[] }
export function decodeSnapshot(value: unknown): InputSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.sequence) || (v.sequence as number) < 0 || !Array.isArray(v.keys) || v.keys.length > 255 || !Array.isArray(v.buttons) || v.buttons.length > 5) return null;
  const codes = new Set<number>(), buttons = new Set<number>();
  for (const key of v.keys) {
    if (!key || !Number.isInteger(key.rawcode) || key.rawcode < 1 || key.rawcode > 255 || typeof key.depth !== 'number' || !Number.isFinite(key.depth) || key.depth < 0 || key.depth > 1 || codes.has(key.rawcode)) return null;
    codes.add(key.rawcode);
  }
  for (const button of v.buttons) {
    if (!Number.isInteger(button) || button < 1 || button > 5 || buttons.has(button)) return null;
    buttons.add(button);
  }
  return { sequence: v.sequence as number, keys: v.keys, buttons: v.buttons };
}

export function decodeInput(value: unknown): InputEvent | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  switch (e.event_type) {
    case 'input_reset': return { event_type: 'input_reset' };
    case 'key_pressed': case 'key_released': case 'analog_depth':
      return num(e.rawcode, 1, 255) && Number.isInteger(e.rawcode) && (e.event_type !== 'analog_depth' || num(e.depth, 0, 1)) ? e as InputEvent : null;
    case 'mouse_pressed': case 'mouse_released': return num(e.button, 1, 5) && Number.isInteger(e.button) ? e as InputEvent : null;
    case 'mouse_wheel': return num(e.rotation, -127, 127) ? e as InputEvent : null;
    case 'mouse_moved': return num(e.dx, -1e8, 1e8) && num(e.dy, -1e8, 1e8) && (e.distance_counts === undefined || num(e.distance_counts, 0, 1e12)) && (e.distance_cm === undefined || num(e.distance_cm, 0, 1e15)) ? e as InputEvent : null;
    default: return null;
  }
}

/** No React state here. Distance is integrated at ingestion, before drawing samples. */
export class InputEngine {
  readonly keys = new Float32Array(256);
  readonly buttons = new Uint8Array(8);
  readonly listeners = new Set<(e: InputEvent, now: number) => void>();
  distanceCm = 0;
  legacyDistance = false;
  revision = 0;
  dpi = 800;
  lastWheel = 0;
  setDistance(cm: number) {
    this.ingest({ event_type: 'distance_changed', cm });
  }
  applySnapshot(snapshot: InputSnapshot) {
    this.keys.fill(0); this.buttons.fill(0);
    for (const key of snapshot.keys) this.keys[key.rawcode] = key.depth;
    for (const button of snapshot.buttons) this.buttons[button] = 1;
    this.ingest({ event_type: 'state_restored' });
  }
  ingest(e: InputEvent, now = performance.now()) {
    switch (e.event_type) {
      case 'key_pressed': this.keys[e.rawcode] = 1; break;
      case 'key_released': this.keys[e.rawcode] = 0; break;
      case 'analog_depth': this.keys[e.rawcode] = e.depth!; break;
      case 'mouse_pressed': this.buttons[e.button] = 1; break;
      case 'mouse_released': this.buttons[e.button] = 0; break;
      case 'mouse_wheel': this.buttons[6] = Number(e.rotation < 0); this.buttons[7] = Number(e.rotation > 0); this.lastWheel = now; break;
      case 'mouse_moved':
        this.legacyDistance ||= e.distance_counts === undefined;
        if (e.distance_cm !== undefined) this.distanceCm = e.distance_cm;
        else this.distanceCm += (e.distance_counts ?? Math.hypot(e.dx, e.dy)) * 2.54 / this.dpi;
        break;
      case 'input_reset': this.keys.fill(0); this.buttons.fill(0); break;
      case 'state_restored': break;
      case 'distance_changed': this.distanceCm = e.cm; break;
    }
    this.revision++;
    this.listeners.forEach(fn => fn(e, now));
  }
  reset() { this.ingest({ event_type: 'input_reset' }); }
}

export class PointRing {
  readonly data: Float64Array;
  head = 0;
  length = 0;
  constructor(readonly capacity = 1024) { this.data = new Float64Array(capacity * 4); }
  push(x: number, y: number, t: number, speed: number) {
    const i = this.head * 4;
    this.data[i] = x; this.data[i + 1] = y; this.data[i + 2] = t; this.data[i + 3] = speed;
    this.head = (this.head + 1) % this.capacity; this.length = Math.min(this.length + 1, this.capacity);
  }
  index(n: number) { return ((this.head - this.length + n + this.capacity) % this.capacity) * 4; }
  clear() { this.length = 0; this.head = 0; }
}

export function demo(engine: InputEngine): () => void {
  let t = 0;
  const timer = setInterval(() => {
    t++;
    const dx = Math.cos(t / 25) * 9 + Math.cos(t / 11) * 4;
    const dy = Math.sin(t / 19) * 6;
    engine.ingest({ event_type: 'mouse_moved', dx, dy, distance_counts: Math.hypot(dx, dy) });
    if (t % 40 === 1) engine.ingest({ event_type: 'key_pressed', rawcode: 87 });
    if (t % 40 === 28) engine.ingest({ event_type: 'key_released', rawcode: 87 });
    if (t % 65 === 0) engine.ingest({ event_type: 'mouse_pressed', button: 1 });
    if (t % 65 === 8) engine.ingest({ event_type: 'mouse_released', button: 1 });
    if (t % 90 === 0) engine.ingest({ event_type: 'key_pressed', rawcode: 68 });
    if (t % 90 === 20) engine.ingest({ event_type: 'key_released', rawcode: 68 });
  }, 16);
  return () => { clearInterval(timer); engine.reset(); };
}
