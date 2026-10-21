import { z } from 'zod';
import { writeFile, readFile } from 'node:fs/promises';
import { currentDocumentSchema, initialDocument } from '../src/core/config.ts';
const target = new URL('../../ws-server/src-tauri/schema/studio-v2.json', import.meta.url);
const text = JSON.stringify(z.toJSONSchema(currentDocumentSchema, { io: 'input' }), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')).replaceAll('\r\n', '\n') !== text) throw Error('Native schema contract is stale. Run node scripts/schema-contract.mjs');
} else {
  await writeFile(target, text);
  await writeFile(new URL('../../ws-server/src-tauri/schema/default-v2.json', import.meta.url), JSON.stringify(initialDocument()));
}
