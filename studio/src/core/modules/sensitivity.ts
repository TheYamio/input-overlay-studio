import {z} from 'zod';
import {surfaceConfiguration} from './shared.ts';
export const sensitivityConfiguration=z.strictObject({...surfaceConfiguration,sensitivityStyle:z.enum(['Minimal','Standard','Detailed']),showGame:z.boolean(),showDpi:z.boolean(),showSens:z.boolean(),showEdpi:z.boolean(),showCm:z.boolean()});
