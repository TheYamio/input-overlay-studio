import { cp, mkdir } from 'node:fs/promises';
const destination = new URL('../../ws-server/src/studio/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('../dist/', import.meta.url), destination, { recursive: true });
console.log('Studio staged into Tauri assets. HTTP assets embed the same build.');
