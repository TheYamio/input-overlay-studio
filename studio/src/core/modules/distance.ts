import {z} from 'zod';
import {surfaceConfiguration,moduleLabel} from './shared.ts';
export const distanceConfiguration=z.strictObject({...surfaceConfiguration,unit:z.enum(['Auto','cm','m']),decimals:z.number().int().min(0).max(3),caption:moduleLabel});
