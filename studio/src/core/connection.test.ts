import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputConnection } from './connection';
import { InputEngine } from './input';
import { initialDocument,encodeDocument } from './config';
import contract from './compatibility/contract.json';

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
  receive(value: unknown) {const packet=value as {document?:ReturnType<typeof initialDocument>};if(packet.document?.version===4&&packet.document.profiles?.[0]?.modules[0]&&!('common' in packet.document.profiles[0].modules[0]))value={...packet,document:encodeDocument(packet.document)};this.onmessage?.({ data: JSON.stringify(value) }); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
  const connection = new InputConnection(new InputEngine()); connection.connect({ url: 'ws://127.0.0.1', token: 'test' });
  const socket = Socket.latest; socket.onopen?.(); socket.receive({ type: 'auth_response', status: 'success', protocol: 5, studio_capabilities:{...structuredClone(contract),role:'capture'} });
  return { connection, socket };
}
describe('revision-aware connection', () => {
  it('only Studio sends global distance reset commands',()=>{
    const {connection,socket}=setup();connection.resetDistance();expect(socket.sent.at(-1)).toEqual({type:'distance_reset'});connection.stop();
    const runtime=new InputConnection(new InputEngine(),'runtime');runtime.connect({url:'ws://test',token:'test'});const observer=Socket.latest;observer.onopen?.();observer.receive({type:'auth_response',status:'success',protocol:5,studio_capabilities:{...structuredClone(contract),role:'capture'}});const before=observer.sent.length;runtime.resetDistance();expect(observer.sent).toHaveLength(before);runtime.stop();
  });
  it('accepts only authenticated negotiated status reports in sequence and clears them on loss',()=>{
    const {connection,socket}=setup(),status=vi.fn();connection.onConnectionStatus=status;
    const packet={type:'connection_status',sequence:3,capture_enabled:true,capture_running:true,runtimes:{connected:1,ready:1,failed:0,unresponsive:0}};
    socket.receive(packet);socket.receive({...packet,sequence:2});socket.receive({...packet,sequence:4,runtimes:{connected:0,ready:1,failed:0,unresponsive:0}});expect(status).toHaveBeenCalledTimes(1);
    socket.receive({...packet,capture_enabled:false});expect(status).toHaveBeenLastCalledWith(expect.objectContaining({captureEnabled:false}));socket.close();expect(status).toHaveBeenLastCalledWith(null);connection.stop();
  });
  it('requires the runtime role and applied revision for readiness and renews it on heartbeat',()=>{
    vi.useFakeTimers();vi.stubGlobal('WebSocket',Socket);const connection=new InputConnection(new InputEngine(),'runtime');connection.connect({url:'ws://test',token:'test'});const socket=Socket.latest;socket.onopen?.();socket.receive({type:'auth_response',status:'success',protocol:5,studio_capabilities:{...structuredClone(contract),role:'capture'}});
    socket.receive({type:'studio_config',document:initialDocument(),revision:'r1'});expect(socket.sent.some(p=>p.type==='runtime_ready')).toBe(false);expect(connection.acknowledgeRuntime('wrong','ready')).toBe(false);expect(connection.acknowledgeRuntime('r1','ready')).toBe(true);
    const n=socket.sent.length;connection.acknowledgeRuntime('r1','ready');expect(socket.sent).toHaveLength(n);socket.receive({type:'heartbeat'});expect(socket.sent.at(-1)).toEqual({type:'runtime_ready',revision:'r1',state:'ready'});
    socket.receive({type:'studio_config',document:initialDocument(),revision:'r2'});const before=socket.sent.length;socket.receive({type:'heartbeat'});expect(socket.sent).toHaveLength(before);expect(connection.acknowledgeRuntime('r1','ready')).toBe(false);connection.acknowledgeRuntime('r2','error');expect(socket.sent.at(-1)).toMatchObject({state:'error',revision:'r2'});connection.stop();
  });
  it('does not accept status features missing from the server contract',()=>{
    const {connection,socket}=setup(),status=vi.fn();connection.onConnectionStatus=status;const capabilities=structuredClone(contract);delete (capabilities.features as Record<string,number>)['runtime.status'];socket.receive({type:'auth_response',status:'success',protocol:5,studio_capabilities:{...capabilities,role:'capture'}});socket.receive({type:'connection_status',sequence:0,capture_enabled:true,capture_running:true,runtimes:{connected:1,ready:1,failed:0,unresponsive:0}});expect(status).not.toHaveBeenCalled();expect(connection.acknowledgeRuntime('r1','ready')).toBe(false);connection.stop();
  });

  it('advertises Studio capabilities separately from the auth token',()=>{
    const {connection,socket}=setup();expect(socket.sent[0]).toMatchObject({type:'auth',token:'test',studio_client:{role:'studio',contractVersion:1,protocolVersion:5,document:{read:[4],write:[4]}}});connection.stop();
  });
  it('uses the shared descriptor for a modern server while keeping the same revision protocol',()=>{
    const {connection,socket}=setup(),d=initialDocument();socket.receive({type:'auth_response',status:'success',protocol:5,studio_capabilities:{...structuredClone(contract),role:'capture'}});
    socket.receive({type:'studio_config',document:d,revision:'r1'});d.profiles[0].modules[0].appearance.pressDelay=10;expect(connection.publish(d)).toBe(true);expect(socket.sent.at(-1)).toMatchObject({type:'studio_set',base_revision:'r1'});connection.stop();
  });
  it('preserves a future server document without applying it or permitting writes',()=>{
    const {connection,socket}=setup(),unsupported=vi.fn(),document=vi.fn();connection.onUnsupported=unsupported;connection.onDocument=document;
    const future={...initialDocument(),version:99,extension:{keep:'everything'}};socket.receive({type:'studio_config',document:future,revision:'future',config_sequence:4});
    expect(document).not.toHaveBeenCalled();expect(JSON.parse(unsupported.mock.calls[0][0].text)).toEqual(future);expect(connection.publish(initialDocument(),'future')).toBe(false);connection.stop();
  });
  it('exports the exact native original text and invalidates outstanding acknowledgements',()=>{
    const {connection,socket}=setup(),unsupported=vi.fn(),saved=vi.fn();connection.onUnsupported=unsupported;connection.onSaved=saved;const d=initialDocument();socket.receive({type:'studio_config',document:d,revision:'r1'});connection.publish(d);
    const request=socket.sent.at(-1)!,text=' { "version": 3, "future": [1, 2] }\n';socket.receive({type:'studio_unsupported',version:3,original_json:text});socket.receive({type:'studio_saved',request_id:request.request_id,revision:'r2'});
    expect(unsupported).toHaveBeenCalledWith(expect.objectContaining({text,version:3}));expect(saved).not.toHaveBeenCalled();expect(connection.publish(d)).toBe(false);connection.stop();
  });
  it('keeps future module schema declarations independent from current documents',()=>{
    const {connection,socket}=setup(),unsupported=vi.fn(),document=vi.fn(),capabilities={...structuredClone(contract),role:'capture'};capabilities.moduleSchemas['overlay.keyboard']=2;
    connection.onUnsupported=unsupported;connection.onDocument=document;socket.receive({type:'auth_response',status:'success',protocol:5,studio_capabilities:capabilities});socket.receive({type:'studio_config',document:initialDocument(),revision:'r1'});
    expect(document).toHaveBeenCalledTimes(1);expect(unsupported).not.toHaveBeenCalled();connection.stop();
  });
  it('keeps old feature flags from bypassing an invalid new contract',()=>{
    const {connection,socket}=setup(),error=vi.fn();connection.onError=error;socket.receive({type:'auth_response',status:'success',protocol:5,studio_revisions:true,studio_capabilities:{contractVersion:99}});
    expect(connection.publish(initialDocument(),'r1')).toBe(false);expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid capability contract'));connection.stop();
  });
  it('recovers compatibility cleanly after connecting to another server',()=>{
    const {connection,socket}=setup();socket.receive({type:'studio_unsupported',version:3});connection.connect({url:'ws://other',token:'test'});const next=Socket.latest;next.onopen?.();next.receive({type:'auth_response',status:'success',protocol:5,studio_capabilities:{...structuredClone(contract),role:'capture'}});const d=initialDocument();next.receive({type:'studio_config',document:d,revision:'other'});
    expect(connection.publish(d)).toBe(true);expect(next.sent.at(-1)?.base_revision).toBe('other');connection.stop();
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
