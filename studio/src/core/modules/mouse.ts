import {z} from 'zod';
import {surfaceConfiguration,moduleLabel} from './shared.ts';
import {imageSettingsSchema,defaultImageSettings,elementStyleSchema,mouseGeometrySchema} from '../visual.ts';
const buttonId=z.string().regex(/^[1-7]$/);
export const mouseConfiguration=z.strictObject({...surfaceConfiguration,image:imageSettingsSchema.default(defaultImageSettings),gap:z.number().min(0).max(30),mouseMode:z.enum(['Compact Buttons','Mouse Diagram']),buttons:z.array(z.number().int().min(1).max(7)).max(7),buttonLabels:z.array(moduleLabel).length(7),buttonStyles:z.record(buttonId,elementStyleSchema).default({}),buttonGeometry:z.record(buttonId,mouseGeometrySchema).default({}),buttonImages:z.record(buttonId,z.boolean()).default({}),wheelDuration:z.number().min(50).max(500).default(110),mouseBodyShapeId:z.string().max(80).optional()});
