import {CompiledModuleHost,type CompiledModuleManifest} from '../../core/architecture/manifest';
import {builtinManifests} from '../../core/architecture/builtin-manifests';
import {builtinVisualFactories} from './factories';

export function createVisualModuleEnvironment(extra:readonly CompiledModuleManifest[]=[]){return new CompiledModuleHost('obs').install(...builtinManifests(builtinVisualFactories),...extra);}
export function createVisualRuntimeRegistry(){return createVisualModuleEnvironment().runtime;}
export const visualRuntimeRegistry=createVisualRuntimeRegistry();
