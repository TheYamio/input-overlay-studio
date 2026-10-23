import { MigrationError, MigrationEngine } from './migrations/engine.ts';
export const CURRENT_DOCUMENT_VERSION=4;
export const documentFormats=new MigrationEngine(CURRENT_DOCUMENT_VERSION,[]);
export function checkDocumentVersion(value:unknown){
 const version=value&&typeof value==='object'&&!Array.isArray(value)?(value as {version?:unknown}).version:undefined;
 if(typeof version!=='number'||!Number.isSafeInteger(version)||version<1)throw new MigrationError('invalid-version','Configuration has no valid integer version.');
 if(version>CURRENT_DOCUMENT_VERSION)throw new MigrationError('future-version',`Configuration version ${version} requires a newer Input Overlay Studio. The original is preserved.`,version);
 if(version<CURRENT_DOCUMENT_VERSION)throw new MigrationError('unsupported-version','This configuration predates the current profile format. Create or import a current configuration.',version);
 return documentFormats.checkVersion(value);
}
