import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, normalize } from 'node:path';
const destination = new URL('../../ws-server/src/studio/', import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
// Only this generated directory may be removed; never follow a computed path outside the repo.
if (normalize(relative(root, fileURLToPath(destination))).replace(/[\\/]$/, '') !== normalize('ws-server/src/studio')) throw Error('Unsafe staging destination');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL('../dist/', import.meta.url), destination, { recursive: true });
console.log('Studio staged into Tauri assets. HTTP assets embed the same build.');
