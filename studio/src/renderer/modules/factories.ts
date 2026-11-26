import {distanceFactory,sensitivityFactory} from './metrics';
import {trailFactory} from './trail';
import {keyboardFactory,mouseFactory} from './caps';
import {counterFactory,flicksFactory} from './counter';
export const builtinVisualFactories={'overlay.distance':distanceFactory,'overlay.sensitivity':sensitivityFactory,'overlay.trail':trailFactory,'overlay.mouse':mouseFactory,'overlay.keyboard':keyboardFactory,'overlay.counter':counterFactory,'overlay.flicks':flicksFactory} as const;
