import {afterEach,describe,expect,it} from 'vitest';
import {SettingsError} from '../settings/events';
import {SettingsService,type SettingsTransport} from '../settings/service';
import {initialDocument} from '../config';
import {trError} from './messages';
import {studioLocalization} from './builtins';
afterEach(()=>studioLocalization.setLocale('en'));
describe('structured settings errors',()=>{
 it('translates stable codes regardless of diagnostic wording',()=>{studioLocalization.setLocale('ru');expect(trError(new SettingsError('invalid-setting','Diagnostic copy can change',{id:'my.counter.gain'}))).toBe('Некорректное значение my.counter.gain');});
 it('snapshots parameters and never re-interpolates user text',()=>{const params={id:'{{secret}}'};const error=new SettingsError('unknown-setting','debug',params);params.id='changed';expect(Object.isFrozen(error.params)).toBe(true);expect(trError(error)).toBe('Unknown setting: {{secret}}');});
 it('falls back to the diagnostic for an unknown extension code',()=>{const error=new SettingsError('extension.example','A module-specific failure');expect(trError(error)).toBe(error.message);});
 it('exposes a setting ID without the rejected value',()=>{const doc=initialDocument(),transport={connect:()=>{},stop:()=>{},publish:()=>false} as unknown as SettingsTransport;const service=new SettingsService({load:()=>({document:doc,warning:''}),save:()=>{},backup:()=>doc},transport,'synthetic://errors');try{service.set('profiles.game.dpi',{scope:'game-profile',profileId:doc.gameProfiles[0].id},'synthetic-secret');throw Error('Expected validation failure');}catch(error){expect(error).toBeInstanceOf(SettingsError);expect((error as SettingsError).params).toEqual({id:'profiles.game.dpi'});expect(JSON.stringify((error as SettingsError).params)).not.toContain('synthetic-secret');}finally{service.dispose();}});
});
