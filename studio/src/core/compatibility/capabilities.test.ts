import {describe,it,expect} from 'vitest';
import contract from './contract.json';
import {localCapabilities,negotiate,readIssue,writeIssue} from './capabilities';
import {initialDocument,encodeDocument} from '../config';
const modern=()=>({protocol:5,studio_capabilities:{...structuredClone(contract),role:'capture'}});
describe('current capability contract',()=>{
 it('separates protocol, document and module versions',()=>{expect(localCapabilities('studio')).toMatchObject({protocolVersion:5,document:{read:[4],write:[4]}});expect(localCapabilities('runtime').document.write).toEqual([]);});
 it('rejects missing or malformed contracts even with old feature flags',()=>{for(const packet of [{protocol:4,studio_revisions:true},{...modern(),studio_capabilities:{contractVersion:99}}])expect(writeIssue(negotiate(packet),initialDocument(),'studio')).not.toBe('');});
 it('accepts unknown declarative module versions without executing them',()=>{const packet=modern();packet.studio_capabilities.moduleSchemas['overlay.keyboard']=99;expect(readIssue(negotiate(packet),encodeDocument(initialDocument()))).toBe('');});
 it('requires current read and write ranges separately',()=>{const packet=modern();packet.studio_capabilities.document.read=[];expect(writeIssue(negotiate(packet),initialDocument(),'studio')).not.toBe('');packet.studio_capabilities.document.read=[4];packet.studio_capabilities.document.write=[];expect(readIssue(negotiate(packet),encodeDocument(initialDocument()))).not.toBe('');});
 it('protects runtime writes and future document generations',()=>{expect(writeIssue(negotiate(modern()),initialDocument(),'runtime')).toContain('read-only');for(const version of [1,2,3,5])expect(readIssue(negotiate(modern()),{version})).not.toBe('');});
 it('rejects contradictory protocol declarations',()=>{expect(negotiate({...modern(),protocol:6}).issue).not.toBe('');});
 it('requires explicit game links and envelope support',()=>{const packet=modern();delete (packet.studio_capabilities.features as Record<string,unknown>)['profiles.game-links'];expect(writeIssue(negotiate(packet),initialDocument(),'studio')).toContain('profiles.game-links');});
 it('blocks older locale-only localization contracts before a document can be overwritten',()=>{const packet=modern();packet.studio_capabilities.features['visual.localization']=1;expect(writeIssue(negotiate(packet),initialDocument(),'studio')).toContain('visual.localization');expect(readIssue(negotiate(packet),encodeDocument(initialDocument()))).not.toBe('');});
});
