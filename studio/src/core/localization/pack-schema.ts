import {z} from 'zod';
import {parseLocalePack,packageIdPattern} from './registry.ts';
const key=z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/).refine(value=>!['constructor','prototype','__proto__'].includes(value));
export const localePackSchema=z.strictObject({version:z.literal(1),locale:z.string().max(64).regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/),id:z.string().regex(packageIdPattern).optional(),origin:z.enum(['builtin','custom']).optional(),author:z.string().min(1).max(100).optional(),translationVersion:z.string().min(1).max(40).optional(),name:z.string().min(1).max(100).optional(),direction:z.enum(['ltr','rtl']).optional(),namespaces:z.record(z.string().max(64).regex(/^[a-z][a-z0-9-]*$/),z.record(key,z.string().min(1).max(4000)))}).superRefine((value,ctx)=>{try{parseLocalePack(value);}catch{ctx.addIssue({code:'custom',message:'Invalid localization package'});}});
export const localePackagesSchema=z.array(localePackSchema).max(8).superRefine((packs,ctx)=>{
 const identities=packs.map(p=>p.id?.toLowerCase()??`legacy:${p.locale.toLowerCase()}`);
 if(packs.some(p=>p.origin==='builtin'||(p.id!==undefined&&p.origin!=='custom'))||new Set(identities).size!==packs.length||new TextEncoder().encode(JSON.stringify(packs)).length>1_000_000)ctx.addIssue({code:'custom',message:'Language library exceeds safe limits or contains duplicate package IDs.'});
});
