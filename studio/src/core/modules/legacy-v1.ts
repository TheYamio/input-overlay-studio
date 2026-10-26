import {z} from 'zod';
import schema from './legacy-v1.schema.json' with {type:'json'};
// Frozen historical constraints and defaults. Updating current visual schemas
// must never change how a saved v1 module is validated or interpreted.
export const legacyBuiltinConfiguration=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
