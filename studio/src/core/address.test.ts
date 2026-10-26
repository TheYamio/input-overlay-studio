import {it,expect} from 'vitest';
import corpus from '../../../ws-server/src-tauri/test-fixtures/addresses.json';
import {bindHost,clientHost,localEndpoint,validBindHost} from './address';
for(const example of corpus)it(`address contract: ${example.host||'(empty)'}`,()=>{
 expect(validBindHost(example.host)).toBe(example.valid);
 if(example.valid){expect(bindHost(example.host)).toBe(example.bind);expect(clientHost(example.host)).toBe(example.client);expect(localEndpoint('ws',example.host,4455)).toBe(example.ws);expect(localEndpoint('http',example.host,4456,'/studio/overlay.html')).toBe(example.http);}
 else expect(()=>localEndpoint('ws',example.host,4455)).toThrow();
});
it('rejects invalid client ports before building a URL',()=>{for(const port of [0,65536,1.5,NaN])expect(()=>localEndpoint('ws','127.0.0.1',port)).toThrow();});
