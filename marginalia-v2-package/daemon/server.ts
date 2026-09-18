import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { ReaderStore, ConflictError } from './store.ts';
import { Pairing } from './pairing.ts';
import { handleHelperManagement } from './helper-management.ts';
import { createDiagnostics } from './diagnostics.ts';
import { JobConflictError } from './jobs/store.ts';
import { JobService, JobUnavailableError, JobAdmissionError, type JobServiceOptions } from './jobs/service.ts';
import type { AuthorizedRuntimeFactory } from './jobs/runtime.ts';
import { LibrarySettingsService } from './library.ts';
import { ConsentSessionService } from './consent/index.ts';
import type { SolverCommandTransport } from './solver/index.ts';
import type { RpcTransport } from './providers/stdio.ts';
import { handleHelperRoute, readBody, readEmptyBody, sendJson, tokenFrom } from './routes/helper.ts';
import { createReaderRoutes } from './routes/reader.ts';
import { createJobRoutes } from './routes/jobs.ts';
import { createServerSolver, createSolverRouteHandler } from './routes/solver.ts';
import { handleStaticRoute } from './routes/static.ts';
import type { ApiRouteContext } from './routes/types.ts';
import { createDiagnosticsRoute } from './routes/diagnostics.ts';
import { createInstantService, type InstantServiceOptions } from './instant/index.ts';
import { createInstantRoutes } from './routes/instant.ts';
import { createInstantForgetService } from './instant/forget.ts';
import { createInstantForgetRoute } from './routes/instant-forget.ts';
import { createRelatedRoutes } from './routes/related.ts';
import { createPreparedDefinitionRoutes } from './routes/prepared-definitions.ts';
import { createAmbientRoutes } from './routes/ambient.ts';
import { createJournalSummaryService } from './journal-synthesis.ts';
import { createJournalSummaryRoute } from './routes/journal-summary.ts';
import { createLibraryImportRoutes } from './routes/library-import.ts';
import { createShareRoutes } from './routes/share.ts';
import { createCollectionAnswerRoutes } from './routes/collection-answer.ts';

export async function startServer(options: { database: string; port?: number; webRoot?: string; diagnostics?: (refresh?: boolean) => unknown;
  jobWorkspaceRoot?: string; runtimeFactory?: AuthorizedRuntimeFactory;
  instant?: Omit<InstantServiceOptions, 'store'>;
  runtimeFactoryBuilder?: (input: { store: ReaderStore; consent: ConsentSessionService }) => Promise<AuthorizedRuntimeFactory | undefined>;
  solverTransport?: SolverCommandTransport; solverRpc?: Pick<RpcTransport, 'request'>; solverProbeRoot?: string;
  jobDefaults?: JobServiceOptions['defaults']; jobTimeoutMs?: number }) {
  const store = new ReaderStore(options.database), library = new LibrarySettingsService(store), consent = new ConsentSessionService(store);
  let runtimeFactory = options.runtimeFactory, runtimeInitializationError: string | undefined;
  if (!runtimeFactory && options.runtimeFactoryBuilder) {
    try { runtimeFactory = await options.runtimeFactoryBuilder({ store, consent }); }
    catch (error) { runtimeInitializationError = error instanceof Error ? error.message.slice(0, 300) : 'authorized-runtime-initialization-failed'; }
  }
  const jobs = new JobService({ reader: store, workspaceRoot: options.jobWorkspaceRoot ?? resolve(dirname(options.database), 'jobs'),
    runtimeFactory, defaults: options.jobDefaults ?? runtimeFactory?.jobDefaults, timeoutMs: options.jobTimeoutMs, library });
  const solver = createServerSolver({ database: options.database, store, jobs, consent, solverTransport: options.solverTransport,
    solverRpc: options.solverRpc, solverProbeRoot: options.solverProbeRoot });
  void jobs.recover().catch(() => { /* Per-job recovery records its own honest outcome. */ });
  const instant = createInstantService({ ...options.instant, store });
  const preparedDefinitions = createPreparedDefinitionRoutes(instant);
  const pairing = new Pairing(store), challenge = pairing.issue();
  let origin = '';
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const diagnostics = options.diagnostics ?? createDiagnostics();
  const allowedOrigin = (value: string | undefined) => !!value && (value === origin || /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value));
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
  // Preserve the original dispatch order, including solver prefix fallthrough.
  const apiRoutes = [
    createDiagnosticsRoute(options.database, diagnostics),
    createInstantForgetRoute(createInstantForgetService({ release: instant.forget.bind(instant), forgetPreparedDefinitions: preparedDefinitions.forget })),
    preparedDefinitions.handle,
    createInstantRoutes(instant),
    createSolverRouteHandler(solver, store, pairing),
    createRelatedRoutes(store),
    createAmbientRoutes({ readSettings: () => library.autoAssist(), readHostPolicy: sourceOrigin => {
      const host = new URL(sourceOrigin).hostname.toLowerCase().replace(/\.$/, '');
      const denied = [...consent.exclusions().filter(row => row.excluded), ...consent.grants(false).filter(row => row.decision === 'deny-site')];
      return { excluded: denied.some(row => {
        const other = new URL(row.site).hostname.toLowerCase().replace(/\.$/, '');
        return host === other || host.endsWith(`.${other}`);
      }) };
    } }),
    createJournalSummaryRoute(createJournalSummaryService(store, () => library.vocabulary().map(entry => entry.term))),
    createLibraryImportRoutes(store),
    createShareRoutes(store),
    createCollectionAnswerRoutes(store),
    createReaderRoutes({ store, pairing, library, consent, sessions }),
    createJobRoutes(jobs, consent, runtimeInitializationError),
  ];
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) return sendJson(response, 403, { error: 'This address is not allowed.' });
      const url = new URL(request.url ?? '/', origin);
      const management = await handleHelperManagement(request, url, origin, pairing, () => {
        preparedDefinitions.prune();
        for (const [ws, session] of sessions) if (!pairing.valid(session.token, session.origin)) ws.close(1008, 'Pairing revoked');
      });
      if (management) return sendJson(response, management.status, management.body);
      const requestOrigin = request.headers.origin;
      if (requestOrigin && !allowedOrigin(requestOrigin)) return sendJson(response, 403, { error: 'This page cannot connect to the local helper.' });
      if (requestOrigin) { response.setHeader('Access-Control-Allow-Origin', requestOrigin); response.setHeader('Vary', 'Origin'); }
      if (request.method === 'OPTIONS') {
        if (!requestOrigin) return sendJson(response, 403, { error: 'Origin required.' });
        response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        response.writeHead(204); response.end(); return;
      }
      if (await handleHelperRoute({ request, response, url, requestOrigin, pairing, diagnostics, send: sendJson, body: readBody })) return;
      if (url.pathname.startsWith('/api/')) {
        // Browser same-origin GETs omit Origin. Fetch Metadata cannot be set by
        // page JavaScript, and the token must still be bound to this exact host.
        const authOrigin = requestOrigin ?? (request.method === 'GET' && request.headers['sec-fetch-site'] === 'same-origin' ? origin : undefined);
        const token = tokenFrom(request), requireCurrentPairing = () => !!authOrigin && pairing.valid(token, authOrigin);
        if (!requireCurrentPairing()) return sendJson(response, 401, { error: 'Pair with the local helper to reopen saved work.' });
        const context: ApiRouteContext = { request, response, url, requestOrigin, authOrigin: authOrigin!, token,
          principal: { surface: authOrigin === origin ? 'localhost-settings' : 'browser-owned-margin', pairingId: token, origin: authOrigin! },
          requireCurrentPairing, send: sendJson, body: readBody, emptyBody: readEmptyBody };
        for (const route of apiRoutes) if (await route(context)) return;
        return sendJson(response, 404, { error: 'This action is unavailable.' });
      }
      if (await handleStaticRoute({ request, response, url, webRoot: options.webRoot, send: sendJson })) return;
      sendJson(response, 404, { error: 'This page is unavailable.' });
    } catch (error) {
      if (error instanceof JobAdmissionError) return sendJson(response, 401, { error: error.message });
      if (error instanceof JobUnavailableError) return sendJson(response, 503, { error: error.message });
      const conflict = error instanceof ConflictError || error instanceof JobConflictError;
      sendJson(response, conflict ? 409 : 400, { error: conflict ? error.message : 'The request could not be saved. Check its content and try again.' });
    }
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.host !== new URL(origin).host || !allowedOrigin(request.headers.origin) || request.url !== '/events' || sockets.clients.size >= 64) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => {
      const timer = setTimeout(() => ws.close(1008, 'Pairing required'), 5000); timer.unref();
      ws.on('error', () => ws.terminate());
      ws.on('message', data => {
        try {
          const message = JSON.parse(data.toString());
          if (!message || !pairing.valid(message.token, request.headers.origin!)) { ws.close(1008, 'Pairing required'); return; }
          const after = message.after ?? 0;
          const latest = (store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get() as { seq: number }).seq;
          if (!Number.isSafeInteger(after) || after < 0 || after > latest) throw new Error('Invalid replay position');
          clearTimeout(timer); sessions.set(ws, { token: message.token, origin: request.headers.origin!, after }); deliver(ws, true);
        } catch { ws.close(1008, 'Invalid request'); }
      });
      ws.on('close', () => { clearTimeout(timer); sessions.delete(ws); });
    });
  });
  try { await new Promise<void>((ready, reject) => { server.once('error', reject); server.listen(options.port ?? 43120, '127.0.0.1', ready); }); }
  catch (error) { preparedDefinitions.close(); instant.close(); sockets.close(); await jobs.close(); store.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local helper did not bind.');
  origin = `http://127.0.0.1:${address.port}`;
  // Poll the committed outbox so changes from future job/store writers are also
  // delivered, without coupling event delivery to any one HTTP mutation route.
  const delivery = setInterval(() => { for (const ws of sessions.keys()) try { deliver(ws); } catch { ws.close(1011, 'Reconnect to resume'); } }, 100);
  delivery.unref();
  return { origin, challenge, store, jobs, solver, library, consent, pairing, instant, close: async () => {
    clearInterval(delivery); preparedDefinitions.close(); instant.close(); solver.close(); for (const client of sockets.clients) client.terminate(); sockets.close();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); await jobs.close(); store.close();
  } };
}
