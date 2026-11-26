import {builtinConfigFields,builtinConfigVersions} from './fields.ts';
import {distanceConfiguration} from './distance.ts';
import {sensitivityConfiguration} from './sensitivity.ts';
import {trailConfiguration} from './trail.ts';
import {mouseConfiguration} from './mouse.ts';
import {keyboardConfiguration} from './keyboard.ts';
import {counterConfiguration} from './counter.ts';
import {flicksConfiguration} from './flicks.ts';
import type {ConfigurationDefinition} from '../module-envelope.ts';
export {legacyBuiltinConfiguration} from './legacy-v1.ts';
import {legacyBuiltinConfiguration} from './legacy-v1.ts';
const schemas={distance:distanceConfiguration,sensitivity:sensitivityConfiguration,trail:trailConfiguration,mouse:mouseConfiguration,keyboard:keyboardConfiguration,counter:counterConfiguration,flicks:flicksConfiguration};
export const builtinConfigurations=Object.entries(schemas).map(([type,schema]):ConfigurationDefinition=>{
 const fields=builtinConfigFields[type as keyof typeof builtinConfigFields];
 const version=builtinConfigVersions[type as keyof typeof builtinConfigVersions];
 return {type:`overlay.${type}`,builtinType:type,schemaVersion:version,schema,fields,...(version>1?{migrations:[{from:1,to:2,source:legacyBuiltinConfiguration,recipe:{kind:'pick-config',fields}}]}:{})};
});
