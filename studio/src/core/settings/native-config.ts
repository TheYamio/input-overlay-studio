import {SettingsError} from './events';
import {nativeConfigSchema,nativeConfigShape,nativeErrorMessages,type NativeConfig} from '../native-config';
export function nativeSettingsError(error:unknown){
 const source=error&&typeof error==='object'?error as {code?:unknown;field?:unknown}:{};
 let code=typeof source.code==='string'&&Object.hasOwn(nativeErrorMessages,source.code)?source.code as keyof typeof nativeErrorMessages:'native-storage';
 const field=typeof source.field==='string'&&Object.hasOwn(nativeConfigShape,source.field)?source.field:undefined;
 if(code==='native-invalid-field'&&!field)code='native-invalid-config';
 return new SettingsError(code,nativeErrorMessages[code],field?{field}:{});
}
export function parseNativeConfig(value:unknown):NativeConfig{
 const result=nativeConfigSchema.safeParse(value);if(result.success)return result.data;
 const issue=result.error.issues[0],code=issue.code==='custom'&&issue.params?.nativeCode|| (typeof issue.path[0]==='string'?'native-invalid-field':'native-invalid-config');
 throw nativeSettingsError({code,field:issue.path[0]});
}
