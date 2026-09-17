import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './server.ts';
import { createInterface } from 'node:readline';
import { createDiagnostics } from './diagnostics.ts';

const dataDir = resolve(process.env.MARGINALIA_DATA_DIR ?? '.local');
mkdirSync(dataDir, { recursive: true });
const port = Number(process.env.MARGINALIA_PORT ?? 43120);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MARGINALIA_PORT must be between 1 and 65535.');
const diagnostics = createDiagnostics();
const server = await startServer({ database: resolve(dataDir, 'marginalia.sqlite'), port, webRoot: resolve('webapp/dist'), diagnostics });
console.log(`Marginalia local helper: ${server.origin}`);
console.log(`Pairing code: ${server.challenge} (valid for five minutes, one use)`);
console.log('Reading and notes are ready. Codex execution has not yet been verified.');
console.log('Enter pair here to renew the pairing code. This replaces any unused code.');
void diagnostics().then(result => console.log(`Codex: ${result.status}; sign-in: ${result.login}. Execution remains unverified.`));
const terminal = createInterface({ input: process.stdin });
terminal.on('line', line => {
  if (line.trim() === 'pair') console.log(`Pairing code: ${server.pairing.issue()} (valid for five minutes, one use)`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { terminal.close(); await server.close(); process.exit(0); });
