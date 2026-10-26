// Stable v1 field list. New builtin fields belong to their own current schema.
export const legacyBuiltinFields=['accent','background','radius','effect','appearance','image','buttonStyles','buttonGeometry','buttonImages','trailAppearance','wheelDuration','mouseBodyShapeId','textLayout','keys','layout','gap','mouseMode','buttons','buttonLabels','trailStyle','position','scaleMode','scale','duration','thickness','glow','grid','center','marker','clickEffects','originX','originY','unit','decimals','caption','sensitivityStyle','showGame','showDpi','showSens','showEdpi','showCm'] as const;
export const surfaceFields=['accent','background','radius','effect','appearance','textLayout'] as const;
export const builtinConfigFields={
 distance:[...surfaceFields,'unit','decimals','caption'],
 sensitivity:[...surfaceFields,'sensitivityStyle','showGame','showDpi','showSens','showEdpi','showCm'],
 trail:[...surfaceFields,'trailAppearance','trailStyle','position','scaleMode','scale','duration','thickness','glow','grid','center','marker','clickEffects','originX','originY'],
 mouse:[...surfaceFields,'image','gap','mouseMode','buttons','buttonLabels','buttonStyles','buttonGeometry','buttonImages','wheelDuration','mouseBodyShapeId'],
 keyboard:[...surfaceFields,'image','gap','keys','layout'],
} as const;
export type BuiltinModuleType=keyof typeof builtinConfigFields;

// One version declaration for canonical codecs, size guards and manifests.
export const builtinConfigVersions={distance:2,sensitivity:2,trail:2,mouse:2,keyboard:2} as const;
