import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './server.ts';

const dataDir = resolve(process.env.MARGINALIA_DATA_DIR ?? '.local');
mkdirSync(dataDir, { recursive: true });
const server = await startServer({ database: resolve(dataDir, 'marginalia.sqlite'), webRoot: resolve('webapp/dist') });
console.log(`Marginalia local helper: ${server.origin}`);
console.log(`Pairing code: ${server.challenge} (valid for five minutes, one use)`);
console.log('Reading and notes are ready. Codex execution has not yet been verified.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await server.close(); process.exit(0); });
