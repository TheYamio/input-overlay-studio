import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputConnection } from './connection';
import { InputEngine } from './input';
import { initialDocument } from './config';

class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor() { Socket.latest = this; }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
  const connection = new InputConnection(new InputEngine()); connection.connect({ url: 'ws://127.0.0.1', token: 'test' });
  const socket = Socket.latest; socket.onopen?.(); socket.receive({ type: 'auth_response', status: 'success', protocol: 4, studio_revisions: true });
  return { connection, socket };
}
describe('revision-aware connection', () => {
  it('retains advanced artwork locally when a server does not advertise visual support', () => {
    const { connection, socket } = setup(), error = vi.fn(), d = initialDocument(); connection.onError = error;
    d.profiles[0].modules[0].image.flipX = true; socket.receive({ type: 'studio_config', document: d, revision: 'r1' });
    expect(connection.publish(d)).toBe(false); expect(error).toHaveBeenCalledWith(expect.stringContaining('local draft is kept')); expect(socket.sent.some(m => m.type === 'studio_set')).toBe(false); connection.stop();
  });
  it('sends only one save at a time and acknowledges its actual document', () => {
    const { connection, socket } = setup(), first = initialDocument(), saved = vi.fn(); connection.onSaved = saved;
    socket.receive({ type: 'studio_config', document: first, revision: 'r1', config_sequence: 1 });
    expect(connection.publish(first)).toBe(true);
    const second = structuredClone(first); second.profiles[0].name = 'Newer'; expect(connection.publish(second)).toBe(false);
    const packet = socket.sent.at(-1)!; expect(packet.base_revision).toBe('r1');
    socket.receive({ type: 'studio_saved', request_id: packet.request_id, revision: 'r2' });
    expect(saved).toHaveBeenCalledWith(JSON.stringify(first), 'r2'); expect(connection.publish(second)).toBe(true);
    expect(socket.sent.at(-1)!.base_revision).toBe('r2'); connection.stop();
  });
  it('ignores an older broadcast queued behind a newer configuration snapshot', () => {
    const { connection, socket } = setup(), onDocument = vi.fn(); connection.onDocument = onDocument;
    const latest = initialDocument(); latest.profiles[0].name = 'Latest';
    socket.receive({ type: 'studio_config', document: latest, revision: 'new', config_sequence: 8 });
    socket.receive({ type: 'studio_config', document: initialDocument(), revision: 'old', config_sequence: 7 });
    expect(onDocument).toHaveBeenCalledTimes(1); expect(connection.revision).toBe('new'); connection.stop();
  });
  it('reconnects when heartbeats continue but a save acknowledgement never arrives', () => {
    const { connection, socket } = setup(), error = vi.fn(); connection.onError = error;
    const d = initialDocument(); socket.receive({ type: 'studio_config', document: d, revision: 'r1' }); connection.publish(d);
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(3000); socket.receive({ type: 'heartbeat' }); }
    vi.advanceTimersByTime(3000);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('acknowledgement timed out')); expect(socket.readyState).toBe(3); connection.stop();
  });
});
