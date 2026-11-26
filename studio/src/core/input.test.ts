import {describe,expect,it} from 'vitest';
import {decodeInput,InputEngine} from './input';

describe('flick statistics packets',()=>{
 const packet={type:'flick_values',profile_id:'profile-1',capture_running:true,values:{'flick-1':{session_best_mps:3.2,flick_count:2,peak_mps:2.8,path_cm:41.5,last_flick_mps:2.1,pulse:4}}};
 it('decodes bounded session and rolling-window values for the overlay runtime',()=>{
  const decoded=decodeInput(packet);expect(decoded).toMatchObject({event_type:'flick_values',profile_id:'profile-1',capture_running:true,values:{'flick-1':{sessionBestMps:3.2,flickCount:2,peakMps:2.8,pathCm:41.5,lastFlickMps:2.1,pulse:4}}});
  const engine=new InputEngine();engine.ingest(decoded!);expect(engine.flickValue('profile-1','flick-1')).toMatchObject({sessionBestMps:3.2,flickCount:2,pathCm:41.5,pulse:4});expect(engine.flickCaptureRunning).toBe(true);
 });
 it('rejects malformed or unbounded flick values instead of drawing them',()=>{
  expect(decodeInput({...packet,values:{'flick-1':{...packet.values['flick-1'],path_cm:-1}}})).toBeNull();
  expect(decodeInput({...packet,values:Object.fromEntries(Array.from({length:33},(_,index)=>[`flick-${index}`,packet.values['flick-1']]))})).toBeNull();
  expect(decodeInput({...packet,capture_running:'true'})).toBeNull();
 });
});
