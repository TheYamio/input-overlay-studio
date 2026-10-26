// Isolated Chromium and a copy of a document. Reports remain in the private archive.
import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initialDocument,encodeDocument} from '../src/core/config.ts';
const archive=process.env.STUDIO_HOT_PATH_ARCHIVE||fileURLToPath(new URL('../artifacts/hot-path-benchmark/',import.meta.url));await mkdir(archive,{recursive:true});
const label=process.env.STUDIO_HOT_PATH_LABEL||'before';if(!/^[a-z-]+$/.test(label))throw Error('Invalid label');
const vite=await createServer({server:{host:'127.0.0.1',port:5293,strictPort:true},plugins:[{name:'hot-path',configureServer(server){server.middlewares.use('/__hot_path.html',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__hot_path.html','<html><body><script type="module" src="/scripts/fixtures/hot-path.ts"></script></body></html>'));});}}]});await vite.listen();
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5293/__hot_path.html');await expect.poll(()=>page.evaluate(()=>!!window.hotPath)).toBe(true);
 let real=encodeDocument(initialDocument());try{real=JSON.parse(await readFile(archive+'/real-document.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const documents=await page.evaluate(real=>window.hotPath.prepare(real),real);await writeFile(archive+'/large-document.json',JSON.stringify(documents.large));
 const results=[];
 for(const [name,document] of Object.entries(documents))for(const gesture of [false,true]){
  const runs=[];for(let i=0;i<3;i++)runs.push(await page.evaluate(({document,gesture})=>window.hotPath.measure(document,gesture),{document,gesture}));
  results.push({name,bytes:Buffer.byteLength(JSON.stringify(document)),profiles:document.profiles.length,modules:document.profiles.reduce((n,p)=>n+p.modules.length,0),gesture,runs});
 }
 await writeFile(archive+`/frontend-${label}.json`,JSON.stringify({label,results},null,2));
 for(const result of results)console.log(JSON.stringify({...result,runs:result.runs.map(r=>({ms:r.totalMs,p95:r.transactionMs.p95,serializations:r.serializations,writes:r.writes}))}));
}finally{await browser.close();await vite.close();}
