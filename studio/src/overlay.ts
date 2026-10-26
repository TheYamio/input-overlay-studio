import {visualRuntimeRegistry} from './renderer/modules/builtins';
import {localEndpoint} from './core/address';
import { activeProfile, initialDocument } from './core/config';
import { InputConnection } from './core/connection';
import { demo, InputEngine } from './core/input';
import { Scene } from './renderer/scene';
import { fitStage } from './core/layout';
const engine = new InputEngine();
const root = document.querySelector<HTMLElement>('#overlay')!;
let renderFailed=false,pendingRevision:string|undefined;
const scene = new Scene(root, engine,{onModuleError:()=>{renderFailed=true;if(connection.revision)connection.acknowledgeRuntime(connection.revision,'error');}});
scene.onFrame=()=>{if(pendingRevision){connection.acknowledgeRuntime(pendingRevision,renderFailed?'error':'ready');pendingRevision=undefined;}};
const resize = () => {
  const fit = fitStage(window.innerWidth, window.innerHeight);
  Object.assign(root.style, { position: 'absolute', left: `${fit.x}px`, top: `${fit.y}px`, transformOrigin: 'top left', transform: `scale(${fit.scale})` });
  scene.resizeOutput();
};
resize(); window.addEventListener('resize', resize);
const params = new URLSearchParams(location.hash.slice(1));
const connection = new InputConnection(engine, 'runtime',visualRuntimeRegistry.configurations);
let stopDemo: (() => void) | undefined;
connection.onDocument = (document,revision) => {
  if (!document) return;
  renderFailed=false;pendingRevision=revision;
  try{scene.update(document, activeProfile(document));}catch{pendingRevision=undefined;if(revision)connection.acknowledgeRuntime(revision,'error');}
};
// Demo is opt-in, URL-visible, and never inherited from Studio's preview mode.
if (params.get('demo') === '1') {
  const document = initialDocument(); scene.update(document, activeProfile(document)); stopDemo = demo(engine);
  const badge = window.document.createElement('div'); badge.textContent = 'DEMO INPUT'; Object.assign(badge.style, { position: 'fixed', right: '24px', top: '24px', color: '#eabb71', font: '16px sans-serif' }); window.document.body.append(badge);
} else {
  connection.connect({ url: params.get('ws') || localEndpoint('ws',location.hostname||'127.0.0.1',4455), token: params.get('token') || '' });
}
window.addEventListener('beforeunload', () => { window.removeEventListener('resize', resize); stopDemo?.(); connection.stop(); scene.dispose(); });
