import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { ReaderStore, ConflictError } from './store.ts';
import { Pairing } from './pairing.ts';
import type { ReaderMutation } from '../contracts/reader.ts';
import { createDiagnostics } from './diagnostics.ts';
import { JobConflictError } from './jobs/store.ts';
import { JobService, JobUnavailableError, type JobServiceOptions } from './jobs/service.ts';
import type { AuthorizedRuntimeFactory } from './jobs/runtime.ts';
import type { FollowupJobInput, PrepareFollowupJobInput, PrepareJobInput, PrepareRetryJobInput, RetryJobInput, StartJobInput } from '../contracts/jobs.ts';
import { runHostChecks } from '../contracts/host-checks.ts';
import { LibrarySettingsService } from './library.ts';
import { ConsentSessionService, handleConsentDecision, handleConsentSettingsChange, handleConsentSettingsRead, prepareConsentForTrustedHost } from './consent/index.ts';

export async function startServer(options: { database: string; port?: number; webRoot?: string; diagnostics?: (refresh?: boolean) => unknown;
  jobWorkspaceRoot?: string; runtimeFactory?: AuthorizedRuntimeFactory;
  runtimeFactoryBuilder?: (input: { store: ReaderStore; consent: ConsentSessionService }) => Promise<AuthorizedRuntimeFactory | undefined>;
  jobDefaults?: JobServiceOptions['defaults'];
  jobTimeoutMs?: number }) {
  const store = new ReaderStore(options.database);
  const library = new LibrarySettingsService(store);
  const consent = new ConsentSessionService(store);
  let runtimeFactory = options.runtimeFactory, runtimeInitializationError: string | undefined;
  if (!runtimeFactory && options.runtimeFactoryBuilder) {
    try { runtimeFactory = await options.runtimeFactoryBuilder({ store, consent }); }
    catch (error) { runtimeInitializationError = error instanceof Error ? error.message.slice(0, 300) : 'authorized-runtime-initialization-failed'; }
  }
  const jobs = new JobService({ reader: store, workspaceRoot: options.jobWorkspaceRoot ?? resolve(dirname(options.database), 'jobs'),
    runtimeFactory, defaults: options.jobDefaults, timeoutMs: options.jobTimeoutMs, library });
  void jobs.recover().catch(() => { /* Per-job recovery records its own honest outcome. */ });
  const pairing = new Pairing(store);
  const challenge = pairing.issue();
  let origin = '';
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const diagnostics = options.diagnostics ?? createDiagnostics();
  const allowedOrigin = (value: string | undefined) => !!value && (value === origin || /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value));
  const tokenFrom = (request: IncomingMessage) => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
  const sessions = new Map<WebSocket, { token: string; origin: string; after: number }>();
  function deliver(ws: WebSocket, initial = false) {
    const session = sessions.get(ws);
    if (!session || ws.readyState !== WebSocket.OPEN) return;
    if (!pairing.valid(session.token, session.origin)) { ws.close(1008, 'Pairing required'); return; }
    // Disconnect slow readers; their last received sequence can be replayed durably.
    if (ws.bufferedAmount > 1024 * 1024) { ws.close(1013, 'Reconnect to resume'); return; }
    const events = store.events(session.after) as { seq: number }[];
    if (events.length || initial) ws.send(JSON.stringify({ type: 'events', events }));
    if (events.length) session.after = events[events.length - 1].seq;
  }
  const send = (response: ServerResponse, status: number, data: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify(data));
  };
  async function body(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) throw new Error('Request is too large.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function emptyBody(request: IncomingMessage) {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) { length += chunk.length; if (length > 1024) throw new Error('Request is too large.'); chunks.push(chunk); }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (text && (text !== '{}' || JSON.parse(text) === null)) throw new Error('This action accepts only an empty object.');
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) return send(response, 403, { error: 'This address is not allowed.' });
      const requestOrigin = request.headers.origin;
      if (requestOrigin && !allowedOrigin(requestOrigin)) return send(response, 403, { error: 'This page cannot connect to the local helper.' });
      if (requestOrigin) {
        response.setHeader('Access-Control-Allow-Origin', requestOrigin);
        response.setHeader('Vary', 'Origin');
      }
      const url = new URL(request.url ?? '/', origin);
      if (request.method === 'OPTIONS') {
        if (!requestOrigin) return send(response, 403, { error: 'Origin required.' });
        response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        response.writeHead(204); response.end(); return;
      }
      if (url.pathname === '/health' && request.method === 'GET') return send(response, 200, { status: 'ready', storage: 'ready' });
      if (url.pathname === '/pair' && request.method === 'POST') {
        if (!requestOrigin) return send(response, 403, { error: 'Origin required.' });
        const input = await body(request);
        try {
          const token = pairing.exchange(input?.challenge, requestOrigin);
          let codex: unknown;
          try { codex = await diagnostics(true); } catch { codex = { status: 'unavailable', login: 'unknown' }; }
          return send(response, 200, { token, codex });
        }
        catch (error) { return send(response, 403, { error: (error as Error).message }); }
      }
      if (url.pathname.startsWith('/api/')) {
        // Browser same-origin GETs omit Origin. Fetch Metadata cannot be set by
        // page JavaScript, and the token must still be bound to this exact host.
        const authOrigin = requestOrigin ?? (request.method === 'GET' && request.headers['sec-fetch-site'] === 'same-origin' ? origin : undefined);
        const token = tokenFrom(request);
        const requireCurrentPairing = () => !!authOrigin && pairing.valid(token, authOrigin);
        if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to reopen saved work.' });
        const principal = { surface: authOrigin === origin ? 'localhost-settings' as const : 'browser-owned-margin' as const,
          pairingId: token, origin: authOrigin! };
        if (url.pathname === '/api/revoke' && request.method === 'POST') {
          await emptyBody(request);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to revoke this session.' });
          pairing.revoke(token);
          for (const [ws, session] of sessions) if (session.token === token) ws.close(1008, 'Pairing revoked');
          return send(response, 200, { revoked: true });
        }
        if (url.pathname === '/api/threads' && request.method === 'GET') return send(response, 200, { threads: store.list(url.searchParams.get('url') ?? undefined, url.searchParams.get('removed') === 'true') });
        if (url.pathname === '/api/change' && request.method === 'POST') {
          const input = await body(request) as ReaderMutation;
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to reopen saved work.' });
          return send(response, 200, store.apply(input));
        }
        if (url.pathname === '/api/reattach' && request.method === 'POST') {
          const input = await body(request);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to reopen saved work.' });
          if (typeof input.threadId !== 'string' || typeof input.text !== 'string' || input.text.length > 1000000 || typeof input.tabCapture !== 'string' || input.tabCapture.length > 100) throw new Error('Invalid page capture.');
          return send(response, 200, store.reattach(input.threadId, input.text, input.tabCapture, input.capture));
        }
        if (url.pathname === '/api/export' && request.method === 'GET') return send(response, 200, store.exportThread(url.searchParams.get('thread') ?? ''));
        if (url.pathname === '/api/events' && request.method === 'GET') {
          const after = Number(url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid replay position.');
          return send(response, 200, { events: store.events(after) });
        }
        if (url.pathname === '/api/replies' && request.method === 'GET') {
          const threadId = url.searchParams.get('threadId');
          if (!threadId || !/^[\w-]{1,100}$/.test(threadId)) throw new Error('Invalid thread identifier.');
          const thread = store.get(threadId);
          if (!thread || thread.deletedAt) return send(response, 404, { error: 'This thread is unavailable.' });
          const replies = store.replies(threadId, true), source = store.sourceVersion(thread.sourceVersionId);
          return send(response, 200, { replies, source, views: replies.map(reply => store.replyView(reply.id)).filter(view => view !== undefined) });
        }
        if (url.pathname === '/api/reply-view' && request.method === 'GET') {
          const threadId = url.searchParams.get('threadId'), replyId = url.searchParams.get('replyVersionId');
          if (!threadId || !replyId) throw new Error('Reply identity is required.');
          const reply = store.reply(replyId);
          if (!reply || reply.threadId !== threadId || reply.deletedAt || store.get(threadId)?.deletedAt) return send(response, 404, { error: 'This reply is unavailable.' });
          return send(response, 200, { view: store.replyView(reply.id) });
        }
        if (url.pathname === '/api/reply-view' && request.method === 'POST') {
          const input = await body(request), reply = store.reply(input?.replyVersionId);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to save this view.' });
          if (!reply || reply.threadId !== input?.threadId || reply.deletedAt || store.get(reply.threadId)?.deletedAt) throw new Error('The saved view does not match an active reply.');
          const view = store.saveReplyView({ id: input.id, replyVersionId: reply.id, expectedRevision: input.expectedRevision,
            parameters: input.parameters, view: input.view });
          return send(response, 200, { view });
        }
        if (url.pathname === '/api/reply-check' && request.method === 'POST') {
          const input = await body(request), reply = store.reply(input?.replyVersionId);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to check this reply.' });
          if (!reply || reply.threadId !== input?.threadId || reply.deletedAt || store.get(reply.threadId)?.deletedAt) throw new Error('The check request does not match an active reply.');
          validateReplyParameters(reply.reply.parameters, input.parameters);
          return send(response, 200, { report: runHostChecks(reply.reply, input.parameters) });
        }
        if (url.pathname === '/api/settings/models' && request.method === 'GET') return send(response, 200, { models: library.models() });
        if (url.pathname === '/api/settings/models' && request.method === 'POST') {
          const input = await body(request);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to change model choices.' });
          return send(response, 200, { models: library.saveModels(input) });
        }
        if (url.pathname === '/api/vocabulary' && request.method === 'GET') return send(response, 200, { vocabulary: library.vocabulary() });
        if (url.pathname === '/api/vocabulary/delete' && request.method === 'POST') {
          const input = await body(request);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to change vocabulary.' });
          return send(response, 200, library.deleteVocabulary(input?.term));
        }
        if (url.pathname === '/api/consent/settings' && request.method === 'GET') {
          const result = handleConsentSettingsRead(consent, principal); return send(response, result.status, result.body);
        }
        if (url.pathname === '/api/consent/settings' && request.method === 'POST') {
          const input = await body(request);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to change permissions.' });
          const result = handleConsentSettingsChange(consent, principal, input); return send(response, result.status, result.body);
        }
        if (url.pathname === '/api/consent/decision' && request.method === 'POST') {
          const input = await body(request);
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to approve this request.' });
          const result = handleConsentDecision(consent, principal, input); return send(response, result.status, result.body);
        }
        if (url.pathname === '/api/jobs' && request.method === 'GET') {
          return send(response, 200, { configured: jobs.configured, available: jobs.available,
            ...((runtimeInitializationError ?? jobs.unavailableReason) ? { unavailableReason: runtimeInitializationError ?? jobs.unavailableReason } : {}),
            jobs: jobs.list(url.searchParams.get('thread') ?? undefined) });
        }
        if (url.pathname === '/api/jobs/prepare' && request.method === 'POST') {
          const input = await body(request) as PrepareJobInput;
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to review outgoing content.' });
          const prepared = await jobs.prepare(input, requireCurrentPairing), result = prepareConsentForTrustedHost(consent, prepared.consent);
          return send(response, result.status, { ...(result.body as Record<string, unknown>), job: prepared.job });
        }
        if (url.pathname === '/api/jobs' && request.method === 'POST') {
          const input = await body(request) as StartJobInput;
          if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to ask for help.' });
          return send(response, 202, await jobs.create(input, requireCurrentPairing));
        }
        const jobRoute = /^\/api\/jobs\/([\w-]{1,100})(?:\/(cancel|retry|followups|prepare-retry|prepare-followup))?$/.exec(url.pathname);
        if (jobRoute) {
          const [, jobId, action] = jobRoute;
          if (!action && request.method === 'GET') {
            const job = jobs.get(jobId);
            return job ? send(response, 200, job) : send(response, 404, { error: 'This work is unavailable.' });
          }
          if (request.method === 'POST' && action === 'cancel') {
            await body(request);
            if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to change this work.' });
            return send(response, 200, await jobs.cancel(jobId));
          }
          if (request.method === 'POST' && action === 'retry') {
            const input = await body(request) as RetryJobInput;
            if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to try this work again.' });
            return send(response, 202, await jobs.retry(jobId, input, requireCurrentPairing));
          }
          if (request.method === 'POST' && action === 'prepare-retry') {
            const input = await body(request) as PrepareRetryJobInput;
            if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to review this retry.' });
            const prepared = await jobs.prepareRetry(jobId, input, requireCurrentPairing), result = prepareConsentForTrustedHost(consent, prepared.consent);
            return send(response, result.status, { ...(result.body as Record<string, unknown>), job: prepared.job });
          }
          if (request.method === 'POST' && action === 'followups') {
            const input = await body(request) as FollowupJobInput;
            if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to continue this thread.' });
            return send(response, 202, await jobs.followup(jobId, input, requireCurrentPairing));
          }
          if (request.method === 'POST' && action === 'prepare-followup') {
            const input = await body(request) as PrepareFollowupJobInput;
            if (!requireCurrentPairing()) return send(response, 401, { error: 'Pair with the local helper to review this follow-up.' });
            const prepared = await jobs.prepareFollowup(jobId, input, requireCurrentPairing), result = prepareConsentForTrustedHost(consent, prepared.consent);
            return send(response, result.status, { ...(result.body as Record<string, unknown>), job: prepared.job });
          }
        }
        return send(response, 404, { error: 'This action is unavailable.' });
      }
      if (request.method === 'GET' && options.webRoot) {
        const file = resolve(options.webRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(resolve(options.webRoot) + sep)) return send(response, 403, { error: 'Invalid path.' });
        const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
        try {
          const bytes = await readFile(file);
          response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' });
          response.end(bytes); return;
        } catch { return send(response, 404, { error: 'This page is unavailable.' }); }
      }
      send(response, 404, { error: 'This page is unavailable.' });
    } catch (error) {
      if (error instanceof JobUnavailableError) return send(response, 503, { error: error.message });
      const conflict = error instanceof ConflictError || error instanceof JobConflictError;
      send(response, conflict ? 409 : 400, { error: conflict ? error.message : 'The request could not be saved. Check its content and try again.' });
    }
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.host !== new URL(origin).host || !allowedOrigin(request.headers.origin) || request.url !== '/events' || sockets.clients.size >= 64) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => {
      const timer = setTimeout(() => ws.close(1008, 'Pairing required'), 5000);
      timer.unref();
      ws.on('error', () => ws.terminate());
      ws.on('message', data => {
        try {
          const message = JSON.parse(data.toString());
          if (!message || !pairing.valid(message.token, request.headers.origin!)) { ws.close(1008, 'Pairing required'); return; }
          const after = message.after ?? 0;
          const latest = (store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get() as { seq: number }).seq;
          if (!Number.isSafeInteger(after) || after < 0 || after > latest) throw new Error('Invalid replay position');
          clearTimeout(timer);
          sessions.set(ws, { token: message.token, origin: request.headers.origin!, after });
          deliver(ws, true);
        } catch { ws.close(1008, 'Invalid request'); }
      });
      ws.on('close', () => { clearTimeout(timer); sessions.delete(ws); });
    });
  });
  try {
    await new Promise<void>((resolveReady, reject) => { server.once('error', reject); server.listen(options.port ?? 43120, '127.0.0.1', resolveReady); });
  } catch (error) { sockets.close(); await jobs.close(); store.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local helper did not bind.');
  origin = `http://127.0.0.1:${address.port}`;
  // Poll the committed outbox so changes from future job/store writers are also
  // delivered, without coupling event delivery to any one HTTP mutation route.
  const delivery = setInterval(() => {
    for (const ws of sessions.keys()) {
      try { deliver(ws); } catch { ws.close(1011, 'Reconnect to resume'); }
    }
  }, 100);
  delivery.unref();
  return { origin, challenge, store, jobs, library, consent, pairing, close: async () => { clearInterval(delivery); for (const client of sockets.clients) client.terminate(); sockets.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); await jobs.close(); store.close(); } };
}

function validateReplyParameters(declared: { name: string; min: number; max: number }[], value: unknown): asserts value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reply parameters.');
  const parameters = value as Record<string, unknown>;
  if (Object.keys(parameters).length !== declared.length) throw new Error('Invalid reply parameters.');
  for (const parameter of declared) {
    const candidate = parameters[parameter.name];
    if (!Object.hasOwn(parameters, parameter.name) || typeof candidate !== 'number' ||
      !Number.isFinite(candidate) || candidate < parameter.min || candidate > parameter.max) {
      throw new Error('Invalid reply parameters.');
    }
  }
}
