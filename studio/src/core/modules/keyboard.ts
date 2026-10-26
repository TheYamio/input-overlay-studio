import {z} from 'zod';
import {surfaceConfiguration,moduleLabel} from './shared.ts';
import {imageSettingsSchema,defaultImageSettings,elementStyleSchema} from '../visual.ts';
const key=z.object({id:z.string().min(1).max(80),code:z.number().int().min(1).max(255),label:moduleLabel,x:z.number().min(0).max(1000),y:z.number().min(0).max(1000),w:z.number().positive().max(1000),h:z.number().positive().max(1000),style:elementStyleSchema.optional(),imageEnabled:z.boolean().optional()});
export const keyboardConfiguration=z.strictObject({...surfaceConfiguration,image:imageSettingsSchema.default(defaultImageSettings),gap:z.number().min(0).max(30),keys:z.array(key).max(100),layout:z.enum(['WASD','WASD + modifiers','FPS Extended','Custom'])});
