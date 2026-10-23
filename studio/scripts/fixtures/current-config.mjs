// Test authors use editing views; packets/files use the canonical current envelope.
// Deliberately avoids validation so negative fixtures reach the real boundary.
import {moduleEnvelopeData} from '../../src/core/module-envelope.ts';
export function wireJSON(value,space){return JSON.stringify(value,(_key,item)=>{
 if(item?.version===4&&Array.isArray(item.profiles)){const container=p=>({...p,modules:p.modules.map(m=>m.common?m:moduleEnvelopeData(m))});return {...item,profiles:item.profiles.map(container),presets:(item.presets??[]).map(container)};}
 return item;
},space);}
