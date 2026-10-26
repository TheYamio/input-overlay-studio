import {builtinConfigFields,builtinConfigVersions} from './fields.ts';
import {distanceConfiguration} from './distance.ts';
import {sensitivityConfiguration} from './sensitivity.ts';
import {trailConfiguration} from './trail.ts';
import {mouseConfiguration} from './mouse.ts';
import {keyboardConfiguration} from './keyboard.ts';
import type {ConfigurationDefinition} from '../module-envelope.ts';
export {legacyBuiltinConfiguration} from './legacy-v1.ts';
import {legacyBuiltinConfiguration} from './legacy-v1.ts';
const schemas={distance:distanceConfiguration,sensitivity:sensitivityConfiguration,trail:trailConfiguration,mouse:mouseConfiguration,keyboard:keyboardConfiguration};
export const builtinConfigurations=Object.entries(schemas).map(([type,schema]):ConfigurationDefinition=>{
 const fields=builtinConfigFields[type as keyof typeof builtinConfigFields];
 return {type:`overlay.${type}`,builtinType:type,schemaVersion:builtinConfigVersions[type as keyof typeof builtinConfigVersions],schema,fields,migrations:[{from:1,to:2,source:legacyBuiltinConfiguration,recipe:{kind:'pick-config',fields}}]};
});
