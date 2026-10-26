import {chromium,expect} from './test-browser.mjs';
import {createServer} from 'vite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const cases=JSON.parse(await readFile(new URL('../../ws-server/src-tauri/test-fixtures/module-migrations.json',import.meta.url),'utf8'));
const artifacts=new URL('../artifacts/module-migrations/',import.meta.url);await mkdir(artifacts,{recursive:true});
const vite=await createServer({server:{host:'127.0.0.1',port:5295,strictPort:true},plugins:[{name:'module-migration-probe',configureServer(server){server.middlewares.use('/__module_migrations.html',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__module_migrations.html','<html><body><script type="module" src="/scripts/fixtures/module-migrations.ts"></script></body></html>'));});}}]});await vite.listen();
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1000,height:600}}),results=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto('http://127.0.0.1:5295/__module_migrations.html');await expect.poll(()=>page.evaluate(()=>!!window.migrationProbe)).toBe(true);
 for(const source of cases){
  const modes=['Idle','Pressed',...(source.type==='keyboard'?['Analog']:source.type==='mouse'?['Scroll up']:[])];
  for(const mode of modes){
   const old=await page.evaluate(({source,mode})=>window.migrationProbe.render(source,false,mode),{source,mode});expect(old.failures).toEqual([]);expect(old.visible).toBe(1);
   const before=await page.locator('#migration-scene').screenshot({path:fileURLToPath(new URL(`${source.type}-${mode}-v1.png`,artifacts)),omitBackground:true,animations:'disabled'});
   const current=await page.evaluate(({source,mode})=>window.migrationProbe.render(source,true,mode),{source,mode});expect(current).toEqual(old);
   const after=await page.locator('#migration-scene').screenshot({path:fileURLToPath(new URL(`${source.type}-${mode}-v2.png`,artifacts)),omitBackground:true,animations:'disabled'});
   expect(after.equals(before),`${source.type} ${mode}: render pixels changed`).toBe(true);results.push(`${source.type} ${mode}`);console.log(`PASS ${source.type} ${mode}: v1/v2 render matches`);
  }
 }
 expect(errors).toEqual([]);await writeFile(new URL('results.json',artifacts),JSON.stringify({passed:results.length,results,errors},null,2));
}finally{await browser.close();await vite.close();}
