import { afterEach,describe,expect,it,vi } from 'vitest';
import { initialDocument } from '../../core/config';
import { ModuleResources,SceneResources } from './resources';
afterEach(()=>vi.unstubAllGlobals());
describe('shared artwork geometry across registered runtimes',()=>{
 it('shares one group region per scene update, invalidates geometry changes and isolates separate scenes',()=>{
  vi.stubGlobal('document',{createElement:()=>({getContext:()=>({canvas:{width:0,height:0}})})});
  const doc=initialDocument(),members=doc.profiles[0].modules.filter(module=>module.type==='keyboard'||module.type==='mouse');for(const module of members)module.image.groupId='shared';
  const pool=new SceneResources();pool.update(doc,members);const a=new ModuleResources(pool),b=new ModuleResources(pool),before=a.artworkRegion(members[0]);expect(b.artworkRegion(members[1])).toBe(before);
  members[0].x+=100;pool.update(doc,members);const after=a.artworkRegion(members[0]);expect(after).not.toBe(before);expect(after.x).not.toBe(before.x);expect(b.artworkRegion(members[1])).toBe(after);
  const isolated=new SceneResources();isolated.update(doc,members.map(module=>({...module,x:module.x+300})));const c=new ModuleResources(isolated);expect(c.artworkRegion(members[0]).x).toBe(after.x+300);
  a.dispose();b.dispose();c.dispose();pool.dispose();isolated.dispose();
 });
});
