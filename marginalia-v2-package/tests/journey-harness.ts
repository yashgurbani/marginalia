import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaderStore } from '../daemon/store.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import type { ReaderMutation } from '../contracts/reader.ts';
import type { CandidateReply, ReplyCapability } from '../contracts/reply.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

export const EXTENSION_ORIGIN = 'chrome-extension://' + 'a'.repeat(32);
export type RuntimeBehaviour = 'reply' | 'hang' | 'unknown-throw' | 'cancel';
export type RuntimeScript = { behaviour: RuntimeBehaviour; reply?: CandidateReply; savedSolver?: boolean };
export type RuntimeCall = { lifetime: string; at: string; kind: 'create' | 'start' | 'cancel' | 'inspect' | 'resume' | 'close'; jobId: string; attemptId?: string; workspace?: string; prompt?: string; requestKeys?: string[]; packetSha256?: string; model?: string; mode?: string; policyKey?: string };
export type Daemon = { origin: string; token: string; request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }>; stop(): Promise<void>; output(): string };
export type Journey = { root: string; database: string; port: number; start(lifetime: string): Promise<Daemon>; script(value: Record<string, RuntimeScript>): Promise<void>; calls(): Promise<RuntimeCall[]>; store<T>(read: (store: ReaderStore) => T): T; dispose(): Promise<void> };

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}

export async function journey(name: string, capabilities: ReplyCapability[] = []): Promise<Journey> {
  const root = await mkdtemp(join(tmpdir(), `marginalia-${name}-`));
  const data = join(root, 'data'), runtime = join(root, 'runtime'), database = join(data, 'marginalia.sqlite');
  const runtimeModule = join(root, 'fake-runtime.mjs'), scriptPath = join(runtime, 'script.json');
  await mkdir(runtime);
  await writeFile(runtimeModule, FAKE_RUNTIME_SOURCE.replace('capabilities: []', `capabilities: ${JSON.stringify(capabilities)}`), 'utf8');
  await writeFile(scriptPath, '{}', 'utf8');
  const port = await freePort();
  const children = new Set<Daemon>();
  const result: Journey = {
    root, database, port,
    async start(lifetime) {
      const env = { ...process.env };
      delete env.MARGINALIA_CODEX_EXECUTABLE; delete env.MARGINALIA_CODEX_HOME; delete env.CODEX_HOME;
      Object.assign(env, { MARGINALIA_DATA_DIR: data, MARGINALIA_PORT: String(port), MARGINALIA_AUTHORIZED_RUNTIME_MODULE: runtimeModule,
        MARGINALIA_TEST_RUNTIME_DIR: runtime, MARGINALIA_TEST_LIFETIME: lifetime });
      const child = spawn(process.execPath, [join(packageRoot, 'daemon', 'main.ts')], { cwd: packageRoot, stdio: ['pipe', 'pipe', 'pipe'], env });
      let output = '', stdout = '', origin: string | undefined, challenge: string | undefined, stopped: Promise<void> | undefined;
      const startup = new Promise<void>((ready, reject) => {
        const timer = setTimeout(() => reject(new Error(`Daemon startup timed out.\n${output}`)), 30_000);
        const finish = () => { if (origin && challenge) { clearTimeout(timer); ready(); } };
        child.stdout.on('data', chunk => {
          const text = chunk.toString(); output += text; stdout += text;
          const lines = stdout.split(/\r?\n/); stdout = lines.pop() ?? '';
          for (const line of lines) {
            origin ??= /^Marginalia local helper: (\S+)$/.exec(line)?.[1];
            challenge ??= /^Pairing code: (\S+) \(valid/.exec(line)?.[1];
          }
          finish();
        });
        child.stderr.on('data', chunk => { output += chunk.toString(); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', (code, signal) => { if (!origin || !challenge) { clearTimeout(timer); reject(new Error(`Daemon exited during startup (${code ?? signal}).\n${output}`)); } });
      });
      try { await startup; } catch (error) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); throw error; }
      assert(origin && challenge);
      const pair = await fetch(origin + '/pair', { method: 'POST', headers: { Origin: EXTENSION_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge }) });
      const paired = await pair.json() as Record<string, unknown>;
      assert.equal(pair.status, 200, `Pairing failed: ${JSON.stringify(paired)}\n${output}`);
      if (typeof paired.token !== 'string') throw new Error(`Pairing returned no token.\n${output}`);
      const token = paired.token;
      const daemon: Daemon = {
        origin, token,
        async request(method, path, body) {
          const response = await fetch(origin + path, { method, headers: { Origin: EXTENSION_ORIGIN, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) });
          return { status: response.status, body: await response.json() as Record<string, unknown> };
        },
        stop() {
          stopped ??= (async () => {
            if (child.exitCode === null && child.signalCode === null) {
              const exited = new Promise<void>(done => child.once('exit', () => done()));
              child.kill('SIGKILL'); await exited;
            }
            children.delete(daemon);
          })();
          return stopped;
        },
        output: () => output,
      };
      children.add(daemon);
      return daemon;
    },
    async script(value) {
      const temporary = scriptPath + '.tmp';
      await writeFile(temporary, JSON.stringify(value), 'utf8'); await rename(temporary, scriptPath);
    },
    async calls() {
      try { return (await readFile(join(runtime, 'calls.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as RuntimeCall); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    },
    store<T>(read: (store: ReaderStore) => T): T {
      assert.equal(children.size, 0, 'Stop every daemon before opening its SQLite database.');
      const store = new ReaderStore(database);
      try { return read(store); } finally { store.close(); }
    },
    async dispose() { await Promise.all([...children].map(child => child.stop())); await rm(root, { recursive: true, force: true, maxRetries: 5 }); },
  };
  return result;
}

export async function pollJob(daemon: Daemon, jobId: string, done: (job: JobSnapshot) => boolean, timeoutMs = 20_000): Promise<JobSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last: JobSnapshot | undefined;
  while (Date.now() < deadline) {
    const response = await daemon.request('GET', `/api/jobs/${encodeURIComponent(jobId)}`);
    if (response.status === 200) { last = response.body as unknown as JobSnapshot; if (done(last)) return last; }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out polling ${jobId}; last state: ${last?.state ?? 'unavailable'}\n${daemon.output().slice(-4000)}`);
}

export function keepMutation(threadId: string, id: string, text = 'Start with this passage.'): Extract<ReaderMutation, { kind: 'keep' }> {
  return { id, kind: 'keep', threadId, capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text,
    capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } };
}

export function scriptedReply(title = 'Contextual meaning'): CandidateReply {
  return withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'explore', status: 'complete', title, summary: 'Meaning in this passage',
    blocks: [{ id: 'meaning', type: 'text', md: 'Start with this passage.' }], sourceBindings: [], parameters: [], assumptions: [], checks: [], limitations: [], staticFallback: 'Start with this passage.' });
}

export const FAKE_RUNTIME_SOURCE = String.raw`import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const dir = process.env.MARGINALIA_TEST_RUNTIME_DIR;
const live = new Map();
const record = entry => appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ lifetime: process.env.MARGINALIA_TEST_LIFETIME, at: new Date().toISOString(), ...entry }) + '\n');
const scriptFor = jobId => JSON.parse(readFileSync(join(dir, 'script.json'), 'utf8'))[jobId] ?? { behaviour: 'reply' };
const current = handle => live.get(handle.jobId) ?? handle;

export function createAuthorizedRuntime({ consent }) {
  return { consent, dispatchReady: true,
    jobDefaults: { provider: 'app-server', mode: 'workspace-files', policyKey: 'a'.repeat(64), capabilities: [] },
    create: async (job, attemptId, workspace, hooks) => {
      record({ kind: 'create', jobId: job.id, attemptId, workspace, model: job.model, mode: job.mode, policyKey: job.policyKey });
      const runner = {
        capabilities: { interrupt: 'abandon-and-tombstone', recovery: 'thread-state', structuredFinal: false, schemaEnforced: false, liveEvents: false },
        async start(request) {
          record({ kind: 'start', jobId: job.id, attemptId: request.jobId, workspace: request.workspace, prompt: request.prompt,
            requestKeys: Object.keys(request).sort(), packetSha256: createHash('sha256').update(readFileSync(join(request.workspace, 'packet.json'), 'utf8')).digest('hex'),
            model: request.model, mode: request.mode, policyKey: request.policyKey });
          let handle = hooks.finalizeSend(request, { jobId: request.jobId, workspace: request.workspace, policyKey: request.policyKey,
            model: request.model, mode: request.mode, provider: 'app-server', providerInstanceId: 'journey-fake', state: 'starting', tombstone: false });
          handle = (await hooks.checkpoint({ ...handle, state: 'running' })) ?? { ...handle, state: 'running' };
          live.set(request.jobId, handle);
          const script = scriptFor(job.id);
          if (script.behaviour === 'unknown-throw') throw new Error('transport outcome unconfirmed');
          if (script.behaviour === 'hang' || script.behaviour === 'cancel') return handle;
          if (script.savedSolver) {
            mkdirSync(join(request.workspace, 'solver'), { recursive: true });
            writeFileSync(join(request.workspace, 'solver/main.js'), 'console.log(JSON.stringify({ y: 1 }));');
          }
          writeFileSync(join(request.workspace, 'reply.json'), JSON.stringify(script.reply));
          const done = (await hooks.checkpoint({ ...handle, state: 'completed' })) ?? { ...handle, state: 'completed' };
          live.set(request.jobId, done); return done;
        },
        async cancel(handle) {
          record({ kind: 'cancel', jobId: job.id, attemptId: handle.jobId, workspace: handle.workspace });
          const cancelled = (await hooks.checkpoint({ ...current(handle), state: 'cancelled', tombstone: true })) ?? { ...handle, state: 'cancelled', tombstone: true };
          live.set(handle.jobId, cancelled); return cancelled;
        },
        async inspect(handle) { record({ kind: 'inspect', jobId: job.id, attemptId: handle.jobId, workspace: handle.workspace }); return current(handle); },
        async resume(handle) { record({ kind: 'resume', jobId: job.id, attemptId: handle.jobId, workspace: handle.workspace }); throw new Error('Unexpected resume in the journey test.'); },
      };
      return { close: () => record({ kind: 'close', jobId: job.id }), runner };
    },
  };
}`;
