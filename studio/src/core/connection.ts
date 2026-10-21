import { validateArtwork } from './artwork';
import { MAX_MESSAGE_BYTES, utf8Bytes } from './limits';
import { documentSchema, type StudioDocument } from './config';
import { decodeInput, decodeSnapshot, type InputEngine } from './input';
export type ConnectionState = 'Offline' | 'Connecting' | 'Authenticating' | 'Connected' | 'Authentication failed' | 'Paused';
export interface ConnectionOptions { url: string; token: string }
export class InputConnection {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private stopped = true;
  private authenticated = false;
  private heartbeatSupported = false;
  private lastInputSequence = -1;
  private lastConfigSequence = -1;
  private configGeneration = 0;
  private attempts = 0;
  private lastMessage = 0;
  private options?: ConnectionOptions;
  private readonly clientId = crypto.randomUUID();
  private sequence = 0;
  private inFlight?: { id: number; json: string };
  private saveTimer?: ReturnType<typeof setTimeout>;
  revision?: string;
  migrationRequired = false;
  private revisionSupported = false;
  onStatus: (s: ConnectionState) => void = () => {};
  onDocument: (d: StudioDocument | null, revision?: string) => void = () => {};
  onRecovery: (backup: StudioDocument | null, revision?: string) => void = () => {};
  onError: (s: string) => void = () => {};
  onSaved: (documentJson: string, revision?: string) => void = () => {};
  onConflict: (d: StudioDocument | null, revision?: string) => void = () => {};
  constructor(private engine: InputEngine) {}
  connect(options: ConnectionOptions) {
    this.stop(); this.options = options; this.stopped = false; this.attempts = 0; this.open();
  }
  private open() {
    if (this.stopped || !this.options) return;
    this.onStatus('Connecting');
    let ws: WebSocket;
    try {
      const url = new URL(this.options.url);
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw Error();
      ws = new WebSocket(url);
    } catch { this.onStatus('Offline'); this.onError('Enter a valid ws:// or wss:// server address.'); return; }
    this.socket = ws;
    this.lastMessage = performance.now();
    this.watchdog = setInterval(() => {
      if ((!this.authenticated || this.heartbeatSupported) && performance.now() - this.lastMessage > 12000) { this.engine.reset(); ws.close(); }
    }, 3000);
    ws.onopen = () => { if (this.socket !== ws) return; this.onStatus('Authenticating'); ws.send(JSON.stringify({ type: 'auth', token: this.options!.token })); };
    ws.onmessage = ({ data }) => {
      if (this.socket !== ws) return;
      if (typeof data !== 'string' || utf8Bytes(data) > MAX_MESSAGE_BYTES) return;
      let value: Record<string, unknown>;
      try { value = JSON.parse(data); if (!value || typeof value !== 'object') return; } catch { return; }
      this.lastMessage = performance.now();
      if (value.type === 'auth_response') {
        this.authenticated = value.status === 'success';
        this.revisionSupported = value.studio_revisions === true;
        this.heartbeatSupported = typeof value.protocol === 'number' && value.protocol >= 2;
        if (!this.authenticated) { this.onStatus('Authentication failed'); this.stopped = true; this.engine.reset(); ws.close(); return; }
        this.attempts = 0; this.lastInputSequence = -1; this.lastConfigSequence = -1; this.engine.reset(); this.onStatus('Connected');
        if (value.state_snapshot === true) ws.send(JSON.stringify({ type: 'input_snapshot' }));
        ws.send(JSON.stringify({ type: 'studio_get' })); return;
      }
      if (!this.authenticated) return;
      if (value.type === 'input_snapshot') {
        const snapshot = decodeSnapshot(value);
        if (snapshot && snapshot.sequence >= this.lastInputSequence) { this.lastInputSequence = snapshot.sequence; this.engine.applySnapshot(snapshot); }
        return;
      }
      if (value.type === 'studio_recovery') {
        const backup = documentSchema.safeParse(value.backup);
        this.revision = typeof value.revision === 'string' ? value.revision : undefined;
        this.onRecovery(backup.success ? backup.data : null, this.revision); return;
      }
      if (value.type === 'distance_total' && typeof value.cm === 'number' && Number.isFinite(value.cm) && value.cm >= 0) {
        this.engine.setDistance(value.cm); return;
      }
      if (value.type === 'studio_config' || value.type === 'studio_conflict') {
        if (Number.isSafeInteger(value.config_sequence)) {
          const sequence = value.config_sequence as number;
          if (sequence < this.lastConfigSequence) return;
          this.lastConfigSequence = sequence;
        }
        if (value.origin === this.clientId && value.type === 'studio_config') { this.configGeneration++; return; }
        const parsed = documentSchema.safeParse(value.document);
        const revision = typeof value.revision === 'string' ? value.revision : undefined;
        if (this.revisionSupported && !revision) { this.onError('Server did not provide a configuration revision.'); return; }
        if (parsed.success || value.document === null) {
          const apply = () => {
            this.revision = revision;
            this.migrationRequired = !!value.document && typeof value.document === 'object' && 'version' in value.document && value.document.version === 1;
            if (value.type === 'studio_conflict') { clearTimeout(this.saveTimer); this.inFlight = undefined; this.onConflict(parsed.success ? parsed.data : null, revision); }
            else this.onDocument(parsed.success ? parsed.data : null, revision);
          };
          const generation = ++this.configGeneration;
          if (parsed.success && Object.keys(parsed.data.assets).length) {
            void validateArtwork(parsed.data.assets).then(() => { if (this.socket === ws && generation === this.configGeneration) apply(); })
              .catch(error => { if (this.socket === ws && generation === this.configGeneration) this.onError((error as Error).message); });
          } else apply();
        } else this.onError('The server contains an unsupported configuration. Export your settings before replacing it.');
        return;
      }
      if (value.type === 'studio_saved') {
        if (this.inFlight && value.request_id === this.inFlight.id) {
          if (Number.isSafeInteger(value.config_sequence) && (value.config_sequence as number) >= this.lastConfigSequence) {
            this.lastConfigSequence = value.config_sequence as number; this.configGeneration++;
          }
          const json = this.inFlight.json; this.inFlight = undefined; clearTimeout(this.saveTimer);
          this.revision = typeof value.revision === 'string' ? value.revision : this.revision;
          this.onSaved(json, this.revision);
        }
        return;
      }
      if (value.type === 'studio_error') { clearTimeout(this.saveTimer); this.inFlight = undefined; this.onError('Server could not save this configuration. Local copy is retained.'); return; }
      const event = decodeInput(value);
      if (event) {
        if (value.sequence !== undefined) {
          if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) <= this.lastInputSequence) return;
          this.lastInputSequence = value.sequence as number;
        }
        this.engine.ingest(event);
      }
    };
    ws.onerror = () => { /* close handles backoff without exposing URL credentials */ };
    ws.onclose = () => {
      clearInterval(this.watchdog); clearTimeout(this.saveTimer); this.authenticated = false; this.inFlight = undefined; this.engine.reset();
      if (this.stopped) return;
      this.onStatus('Offline');
      this.timer = setTimeout(() => this.open(), Math.min(1000 * 2 ** this.attempts++, 15000));
    };
  }
  publish(document: StudioDocument, baseRevision = this.revision) {
    if (!this.authenticated || this.socket?.readyState !== WebSocket.OPEN || this.inFlight) return false;
    if (!this.revisionSupported) { this.onError('Update the capture server to enable safe saving.'); return false; }
    if (!baseRevision) return false;
    const id = ++this.sequence, json = JSON.stringify(document);
    const packet = JSON.stringify({ type: 'studio_set', document, base_revision: baseRevision, origin: this.clientId, request_id: id });
    if (utf8Bytes(packet) > MAX_MESSAGE_BYTES) { this.onError('Configuration exceeds the server message limit.'); return false; }
    this.inFlight = { id, json }; this.socket.send(packet);
    this.saveTimer = setTimeout(() => {
      this.onError('Save acknowledgement timed out. Reconnecting with the local draft retained.');
      this.socket?.close();
    }, 12000);
    return true;
  }
  resetDistance() { if (this.authenticated) this.socket?.send(JSON.stringify({ type: 'distance_reset' })); }
  stop() {
    this.stopped = true; this.configGeneration++; clearTimeout(this.timer); clearTimeout(this.saveTimer); clearInterval(this.watchdog); this.authenticated = false; this.inFlight = undefined;
    if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = undefined; }
    this.engine.reset();
  }
}

export function obsUrl(options: ConnectionOptions, base: string) {
  const url = new URL(base);
  url.hash = new URLSearchParams({ ws: options.url, token: options.token }).toString();
  return url.toString();
}
