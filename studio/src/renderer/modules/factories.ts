import {distanceFactory,sensitivityFactory} from './metrics';
import {trailFactory} from './trail';
import {keyboardFactory,mouseFactory} from './caps';
export const builtinVisualFactories={'overlay.distance':distanceFactory,'overlay.sensitivity':sensitivityFactory,'overlay.trail':trailFactory,'overlay.mouse':mouseFactory,'overlay.keyboard':keyboardFactory} as const;
