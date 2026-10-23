import { builtinCatalog } from '../../core/architecture/builtins';
import { VisualRuntimeRegistry } from './registry';
import { distanceFactory,sensitivityFactory } from './metrics';
import { trailFactory } from './trail';
import { keyboardFactory,mouseFactory } from './caps';

export function createVisualRuntimeRegistry(){
 const registry=new VisualRuntimeRegistry(builtinCatalog);
 for(const [id,factory] of [['overlay.distance',distanceFactory],['overlay.sensitivity',sensitivityFactory],['overlay.trail',trailFactory],['overlay.mouse',mouseFactory],['overlay.keyboard',keyboardFactory]] as const)registry.register(id,factory);
 return registry;
}
export const visualRuntimeRegistry=createVisualRuntimeRegistry();
