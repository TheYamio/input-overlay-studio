export class MigrationError extends Error {
  readonly code:'invalid-version'|'unsupported-version'|'future-version'|'missing-step'|'invalid-step'|'validation-failed';
  readonly sourceVersion?:number;
  constructor(code:MigrationError['code'],message:string,sourceVersion?:number) {super(message);this.name='MigrationError';this.code=code;this.sourceVersion=sourceVersion;}
}
export interface MigrationStep {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly migrate: (copy: unknown) => unknown;
}
export function configurationVersion(value: unknown): number {
  const version=value && typeof value==='object' && !Array.isArray(value) ? (value as Record<string,unknown>).version : undefined;
  if(typeof version!=='number'||!Number.isSafeInteger(version)||version<1)throw new MigrationError('invalid-version','Configuration has no supported integer version.');
  return version;
}

// Pure planning: no storage access, UUID allocation, or module execution. Every
// step gets a copy; callers commit only a completely validated result.
export class MigrationEngine {
  private readonly steps: ReadonlyMap<number, MigrationStep>;
  readonly currentVersion:number;
  readonly minimumVersion:number;
  constructor(currentVersion:number, steps:readonly MigrationStep[],minimumVersion=4) {
    this.currentVersion=currentVersion;this.minimumVersion=minimumVersion;
    if(!Number.isSafeInteger(currentVersion)||currentVersion<minimumVersion)throw new MigrationError('invalid-step','Invalid target version.');
    const map=new Map<number,MigrationStep>(),ids=new Set<string>();
    for(const step of steps) {
      if(!step.id||ids.has(step.id)||map.has(step.from)||!Number.isSafeInteger(step.from)||step.from<minimumVersion||step.to!==step.from+1||step.to>currentVersion)throw new MigrationError('invalid-step','Migration IDs and forward steps must be unique and contiguous.');
      map.set(step.from,Object.freeze({...step}));ids.add(step.id);
    }
    for(let version=minimumVersion;version<currentVersion;version++)if(!map.has(version))throw new MigrationError('missing-step',`Missing migration from version ${version}.`);
    this.steps=map;
  }
  checkVersion(source:unknown) {
    const from=configurationVersion(source);
    if(from>this.currentVersion)throw new MigrationError('future-version',`Configuration version ${from} requires a newer Input Overlay Studio. The original is preserved.`,from);
    if(from<this.minimumVersion)throw new MigrationError('unsupported-version','Configuration predates the supported baseline.',from);
    return from;
  }
  prepare<T>(source:unknown, validate:(value:unknown)=>T) {
    const from=this.checkVersion(source);
    let value=structuredClone(source);const applied:string[]=[];
    for(let version=from;version<this.currentVersion;version++) {
      const step=this.steps.get(version);if(!step)throw new MigrationError('missing-step',`Missing migration from version ${version}.`,from);
      value=step.migrate(structuredClone(value));
      if(value && typeof (value as {then?:unknown}).then==='function')throw new MigrationError('invalid-step','Migration steps must be synchronous.',from);
      if(configurationVersion(value)!==step.to)throw new MigrationError('invalid-step',`Migration ${step.id} produced the wrong version.`,from);
      applied.push(step.id);
    }
    const result=validate(structuredClone(value));
    if(configurationVersion(result)!==this.currentVersion)throw new MigrationError('validation-failed','Validated result has the wrong configuration version.',from);
    return {value:result,from,to:this.currentVersion,applied:Object.freeze(applied),migrated:applied.length>0};
  }
}
