import {z} from 'zod';
import {moduleLabel, surfaceConfiguration} from './shared.ts';

export const counterModes = ['CPS', 'APM', 'KPM', 'Custom'] as const;
export const statisticsWindow = z.number().int().min(1).max(60);
export const counterFields = {
  counterMode: z.enum(counterModes).default('CPS'),
  counterWindow: statisticsWindow.default(5),
  counterIncrement: z.number().int().min(1).max(255).default(107),
  counterDecrement: z.number().int().min(0).max(255).default(109),
  counterPersist: z.boolean().default(false),
};
export const flickFields = {
  flickWindow: statisticsWindow.default(10),
  flickThreshold: z.number().min(.1).max(10).default(1),
  flickMinDistance: z.number().min(.1).max(20).default(.5),
  flickUnit: z.enum(['cm', 'm']).default('cm'),
};
const metric = {...surfaceConfiguration, caption: moduleLabel.default('')};

export const counterConfiguration = z.strictObject({...metric, ...counterFields}).refine(
  config => config.counterMode !== 'Custom' || config.counterIncrement !== config.counterDecrement,
  {path: ['counterDecrement'], message: 'Choose different keys for increment and decrement.'},
);
export const flicksConfiguration = z.strictObject({...metric, ...flickFields});
