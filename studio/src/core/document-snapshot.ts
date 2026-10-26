import {documentSchema,type StudioDocument} from './config';
import {moduleConfigurations,upgradeDocumentModules} from './module-format';
import {z} from 'zod';
import {immutable} from './settings/events';
const validated=new WeakMap<StudioDocument,number>();
export function parseModuleDocument(input:unknown,registry=moduleConfigurations){
 let result=documentSchema.safeParse(input);
 if(result.success&&registry!==moduleConfigurations){try{
  const upgraded=upgradeDocumentModules(result.data,registry);if(upgraded!==result.data)result=documentSchema.safeParse(upgraded);
 }catch(error){return {success:false,error:new z.ZodError([{code:'custom',path:[],message:error instanceof Error?error.message:'Invalid module configuration.'}])} as const;}}
 return result;
}
export function checkDocumentSnapshot(input:unknown,registry=moduleConfigurations){
 const result=parseModuleDocument(input,registry);if(result.success){immutable(result.data);validated.set(result.data,moduleConfigurations.getSnapshot());}return result;
}
export function documentSnapshot(document:StudioDocument,registry=moduleConfigurations){
 if(registry===moduleConfigurations&&validated.get(document)===moduleConfigurations.getSnapshot())return document;
 const result=checkDocumentSnapshot(document,registry);if(!result.success)throw result.error;return result.data;
}
