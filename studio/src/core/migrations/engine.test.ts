import {describe,it,expect} from 'vitest';
import {MigrationEngine} from './engine';
import {encodeDocument,initialDocument,parseDocument} from '../config';
describe('future migrations from the current baseline',()=>{
 it('runs future steps on copies and validates atomically',()=>{const source={version:4,items:['keep']};const engine=new MigrationEngine(6,[{id:'future.4-to-5',from:4,to:5,migrate:input=>({...input as object,version:5})},{id:'future.5-to-6',from:5,to:6,migrate:input=>({...input as object,version:6})}]);expect(engine.prepare(source,v=>v).value).toEqual({version:6,items:['keep']});expect(source.version).toBe(4);});
 it('rejects missing, duplicate and nonforward steps',()=>{expect(()=>new MigrationEngine(5,[])).toThrow();expect(()=>new MigrationEngine(6,[{id:'skip',from:4,to:6,migrate:v=>v}])).toThrow();});
 it('rejects old versions and protects future versions',()=>{const engine=new MigrationEngine(4,[]);for(const version of [1,2,3,5,99])expect(()=>engine.prepare({version},v=>v)).toThrow();});
 it('rejects partial and dishonest transformations',()=>{const source={version:4};const engine=new MigrationEngine(5,[{id:'broken.step',from:4,to:5,migrate:v=>{(v as {version:number}).version=5;throw Error('failed');}}]);expect(()=>engine.prepare(source,v=>v)).toThrow('failed');expect(source.version).toBe(4);});
 it('only imports the current canonical format',()=>{const original=initialDocument(),wire=encodeDocument(original);expect(parseDocument(JSON.stringify(wire))).toEqual(original);for(const version of [1,2,3,5])expect(()=>parseDocument(JSON.stringify({...wire,version}))).toThrow();});
});