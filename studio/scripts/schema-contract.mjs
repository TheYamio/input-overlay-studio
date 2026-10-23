import { z } from 'zod';
import { writeFile, readFile } from 'node:fs/promises';
import { currentDocumentSchema, profileSchema, presetSchema, moduleViewSchema } from '../src/core/config-schema.ts';
import { persistedDocumentSchema, moduleConfigurations } from '../src/core/module-format.ts';
import { moduleExtensionSchema } from '../src/core/module-envelope.ts';
const model=z.object({...currentDocumentSchema.shape,profiles:z.array(z.object({...profileSchema.shape,modules:z.array(moduleViewSchema).max(32)})).min(1).max(50),presets:z.array(z.object({...presetSchema.shape,modules:z.array(moduleViewSchema).max(32)})).max(50)});
const targets={
 'studio-model.json':z.toJSONSchema(model,{io:'input'}),
 'studio-current.json':z.toJSONSchema(persistedDocumentSchema,{io:'input',override:({zodSchema,jsonSchema})=>{if(zodSchema===moduleExtensionSchema.shape.config)Object.assign(jsonSchema,{type:'object',additionalProperties:{}});}}),
 'module-configurations.json':Object.fromEntries(moduleConfigurations.all().map(definition=>[definition.type,{schemaVersion:definition.schemaVersion,builtinType:definition.builtinType,schema:z.toJSONSchema(definition.schema,{io:'input'})}]))
};
for(const [name,schema] of Object.entries(targets)){
 const target=new URL(`../../ws-server/src-tauri/schema/${name}`,import.meta.url),text=JSON.stringify(schema,null,2)+'\n';
 if(process.argv.includes('--check')){if((await readFile(target,'utf8')).replaceAll('\r\n','\n')!==text)throw Error(`Native schema contract ${name} is stale. Run node scripts/schema-contract.mjs`);}
 else await writeFile(target,text);
}
if(!process.argv.includes('--check')){const {initialDocument,encodeDocument}=await import('../src/core/config.ts');const document=initialDocument();await writeFile(new URL('../../ws-server/src-tauri/schema/default-model.json',import.meta.url),JSON.stringify(document,null,2)+'\n');await writeFile(new URL('../../ws-server/src-tauri/schema/default-current.json',import.meta.url),JSON.stringify(encodeDocument(document),null,2)+'\n');}
