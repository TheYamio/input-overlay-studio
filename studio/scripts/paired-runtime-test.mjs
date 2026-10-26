// Frozen baseline is test input only. No historical reader is added to the app.
import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {initialDocument,documentSchema,encodeDocument} from '../src/core/config.ts';
import contract from '../src/core/compatibility/contract.json' with {type:'json'};
const baseline=process.env.STUDIO_BASELINE_DIR;if(!baseline)throw Error('Set STUDIO_BASELINE_DIR to the frozen stage-0 archive');
const roots={baseline:resolve(baseline,'restored/frontend'),current:resolve(fileURLToPath(new URL('../dist/',import.meta.url)))};
const frozen=JSON.parse(await readFile(resolve(baseline,'restored/fixtures/v2-default.json'),'utf8'));
// Explicitly maps the synthetic benchmark fixture, never an importable user file.
function currentFixture(source){const d=initialDocument(),p=source.profiles.find(p=>p.id===source.activeProfileId),game=d.gameProfiles[0];for(const key of ['game','dpi','sensitivity','yaw','scale','manualCm'])game[key]=p[key];d.profiles=[{id:p.id,name:p.name,gameProfileId:game.id,locale:'en',caption:p.caption,theme:p.theme,modules:p.modules}];d.activeProfileId=p.id;d.assets=source.assets;d.shapes=source.shapes;d.performance=source.performance;d.distance=source.distance;return documentSchema.parse(d);}
const visibleData=d=>({modules:d.profiles[0].modules,assets:d.assets,shapes:d.shapes,performance:d.performance,distance:d.distance});
const current=currentFixture(frozen);expect(visibleData(current)).toEqual(visibleData(frozen));
const fingerprint=createHash('sha256').update(JSON.stringify(visibleData(frozen))).digest('hex');
const artifacts=new URL('../artifacts/paired-runtime/',import.meta.url);await mkdir(artifacts,{recursive:true});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1'),parts=decodeURIComponent(url.pathname).split('/').filter(Boolean),generation=parts.shift();if(!Object.hasOwn(roots,generation)){res.writeHead(404).end();return;}const path=resolve(roots[generation],parts.join('/')||'index.html');if(!path.startsWith(roots[generation]+sep)){res.writeHead(403).end();return;}const data=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(5232,'127.0.0.1',resolve));
const sockets=new WebSocketServer({host:'127.0.0.1',port:4632});let document=frozen,generation='baseline',revision=0,sequence=0,active=false,count=0;
const wire=d=>generation==='current'?encodeDocument(d):d;
const broadcast=message=>{const raw=JSON.stringify(message);for(const ws of sockets.clients)if(ws.authed&&ws.readyState===1)ws.send(raw);};
sockets.on('connection',ws=>ws.on('message',raw=>{const m=JSON.parse(String(raw));const send=p=>ws.send(JSON.stringify(p));if(m.type==='auth'){ws.authed=m.token==='paired';send({type:'auth_response',status:ws.authed?'success':'failed',protocol:generation==='current'?5:4,state_snapshot:true,studio_revisions:true,studio_visuals:true,studio_animation:true,studio_capabilities:{...contract,role:'capture'}});}if(!ws.authed)return;if(m.type==='input_snapshot')send({type:'input_snapshot',sequence,keys:[],buttons:[]});if(m.type==='studio_get')send({type:'studio_config',document:wire(document),revision:String(revision)});}));
const heartbeat=setInterval(()=>broadcast({type:'heartbeat'}),1000),input=setInterval(()=>{if(!active)return;count++;broadcast({event_type:'mouse_moved',dx:Math.cos(count/40)*64,dy:Math.sin(count/30)*64,distance_counts:192,sequence:++sequence});},16);
const browser=await chromium.launch({headless:true}),results=[],errors=[];const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 for(const mode of ['baseline','current']){
  generation=mode;document=mode==='baseline'?structuredClone(frozen):currentFixture(frozen);revision++;active=false;
  const context=await browser.newContext({viewport:{width:1920,height:1080}});await context.addInitScript(()=>{const native=requestAnimationFrame.bind(window);window.pairedFrames=0;window.requestAnimationFrame=callback=>native(now=>{window.pairedFrames++;callback(now);});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:5232/${mode}/overlay.html#ws=ws%3A%2F%2F127.0.0.1%3A4632&token=paired`);await expect(page.locator('[data-key="87"]')).toBeAttached();
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
  const sample=async(name,ms,expectedIdle=false)=>{await page.evaluate(()=>window.pairedFrames=0);const before=await metrics(),start=performance.now(),startCount=count;await delay(ms);const seconds=(performance.now()-start)/1000,after=await metrics(),frames=await page.evaluate(()=>window.pairedFrames),record={generation:mode,name,seconds,transportHz:(count-startCount)/seconds,mainThreadBusyPercent:100*(after.TaskDuration-before.TaskDuration)/seconds,scriptMsPerSecond:1000*(after.ScriptDuration-before.ScriptDuration)/seconds,frames};if(expectedIdle&&mode==='current')expect(frames).toBe(0);results.push(record);console.log('PASS '+mode+' '+name+' '+JSON.stringify(record));};
  await delay(1200);await sample('idle',3000,true);
  broadcast({event_type:'key_pressed',rawcode:87,sequence:++sequence});broadcast({event_type:'mouse_pressed',button:1,sequence:++sequence});await delay(1000);await sample('held',3000,true);
  broadcast({event_type:'input_reset',sequence:++sequence});await delay(250);active=true;await delay(1000);await sample('active-transport',5000);active=false;broadcast({event_type:'input_reset',sequence:++sequence});await delay(500);
  // Let the reset trail's final point expire before measuring button-only waits.
  await delay(1500);
  const p=document.profiles[0],keyboard=p.modules.find(module=>module.type==='keyboard');Object.assign(keyboard.appearance,{pressDelay:800,releaseDelay:1200,pressDuration:0,releaseDuration:0,motion:'None',lighting:'Fill'});revision++;broadcast({type:'studio_config',document:wire(document),revision:String(revision)});await delay(500);
  broadcast({event_type:'key_pressed',rawcode:87,sequence:++sequence});await delay(60);await sample('waiting-press-delay',450,true);await delay(700);broadcast({event_type:'key_released',rawcode:87,sequence:++sequence});await delay(60);await sample('waiting-release-delay',450,true);
  broadcast({event_type:'input_reset',sequence:++sequence});await cdp.detach();await context.close();
 }
 const baselineRate=results.find(r=>r.generation==='baseline'&&r.name==='active-transport').transportHz,currentRate=results.find(r=>r.generation==='current'&&r.name==='active-transport').transportHz;expect(Math.abs(currentRate/baselineRate-1)).toBeLessThan(.1);expect(errors).toEqual([]);
 await writeFile(new URL('results.json',artifacts),JSON.stringify({chromium:browser.version(),fixtureSha256:fingerprint,identicalVisualData:true,inputIntervalMs:16,baselineArchive:baseline,note:'Same machine/browser/data and input timer, serial runs. Renderer-main-thread CPU only; not hardware latency or whole-machine CPU.',results,errors},null,2));
}finally{clearInterval(input);clearInterval(heartbeat);for(const ws of sockets.clients)ws.terminate();await browser.close();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));}
