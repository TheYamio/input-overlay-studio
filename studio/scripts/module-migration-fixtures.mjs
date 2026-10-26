import {writeFile,readFile} from 'node:fs/promises';
import {initialDocument,encodeDocument,parseDocument,makeModule} from '../src/core/config.ts';
import {configurationReferences,commonFields} from '../src/core/module-envelope.ts';
import {legacyBuiltinFields} from '../src/core/modules/fields.ts';
const asset=JSON.parse(await readFile(new URL('../../ws-server/src-tauri/schema/test-artwork.json',import.meta.url),'utf8'));
const shape={name:'Migration contour',viewBox:[0,0,10,10],paths:[{d:'M0 0L10 10H0Z',matrix:[1,0,0,1,0,0],fill:true,fillRule:'nonzero',strokeWidth:0,linecap:'butt',linejoin:'miter',opacity:1}]};
const cases=[];
for(const type of ['distance','sensitivity','trail','mouse','keyboard']){
 const document=initialDocument();document.gameProfiles[0].id='migration-game';document.profiles=[{...document.profiles[0],id:'migration-profile',gameProfileId:'migration-game',modules:[]}];document.activeProfileId='migration-profile';document.performance.fps='30';document.performance.reducedMotion=true;document.assets={'migration-paint':asset};document.shapes={'migration-shape':shape,'retained-shape':{...shape,name:'Retained contour'}};
 const module=makeModule(type,0,`migration-${type}`);Object.assign(module,{x:80,y:60,w:type==='trail'?500:type==='sensitivity'?780:400,h:type==='trail'?380:type==='sensitivity'?160:360,effect:'Instant'});module.appearance.shapeId='migration-shape';module.keys[0].style={shapeId:type==='keyboard'?'migration-shape':'retained-shape'};module.mouseBodyShapeId=type==='mouse'?'migration-shape':'retained-shape';module.image.assetId='migration-paint';module.image.enabled=type==='keyboard'||type==='mouse';module.caption='距離 · Distance';module.trailStyle='Clean Line';module.position='Fixed Field';module.showEdpi=true;module.sensitivityStyle='Detailed';
 const common=Object.fromEntries(commonFields.map(key=>[key,module[key]])),config=JSON.parse(JSON.stringify(Object.fromEntries(legacyBuiltinFields.filter(key=>Object.hasOwn(module,key)).map(key=>[key,module[key]]))));
 const legacy={id:module.id,type:`overlay.${type}`,schemaVersion:1,enabled:true,common,config,resources:configurationReferences(type,config,true)};
 const unknown={id:'migration-unknown',type:'future.retained',schemaVersion:7,enabled:false,common:{...common,name:'Opaque resources',visible:false},config:{caption:'日本語 العربية',unknown:{retain:[1,true,'value']}},resources:{assets:['migration-paint'],shapes:['retained-shape']}};
 const wire=encodeDocument(document);wire.profiles[0].modules=[legacy,unknown];
 const {id,common:opaqueCommon,...extension}=unknown;document.profiles[0].modules=[module,{...makeModule('distance',0,id),...opaqueCommon,extension}];
 cases.push({type,legacy:wire,current:encodeDocument(parseDocument(JSON.stringify(wire))),model:document});
}
await writeFile(new URL('../../ws-server/src-tauri/test-fixtures/module-migrations.json',import.meta.url),JSON.stringify(cases,null,2)+'\n');
