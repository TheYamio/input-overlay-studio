import {z} from 'zod';
import {validUnicode} from '../unicode.ts';
import {appearanceSchema,defaultAppearance} from '../visual.ts';
export const moduleLabel=z.string().max(100).refine(validUnicode,'Invalid Unicode text');
export const surfaceConfiguration={
 accent:z.string().regex(/^#[0-9a-fA-F]{6}$/),background:z.string().regex(/^#[0-9a-fA-F]{6}$/),radius:z.number().min(0).max(100),
 effect:z.enum(['Instant','Soft Press','Glow','Pulse','Analog Fill']),appearance:appearanceSchema.default(defaultAppearance),textLayout:z.enum(['Horizontal','Vertical']).default('Horizontal'),
};
