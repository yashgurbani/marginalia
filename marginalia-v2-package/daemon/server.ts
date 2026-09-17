import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { ReaderStore, ConflictError } from './store.ts';
import { Pairing } from './pairing.ts';
import type { ReaderMutation } from '../contracts/reader.ts';
import { createDiagnostics } from './diagnostics.ts';

export async function startServer(options: { database: string; port?: number; webRoot?: string; diagnostics?: (refresh?: boolean) => unknown }) {
  const store = new ReaderStore(options.database);
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
      if (url.pathname === '/health' && request.method === 'GET') return send(response, 200, { status: 'ready', storage: 'ready', codex: await diagnostics() });
      if (url.pathname === '/pair' && request.method === 'POST') {
        if (!requestOrigin) return send(response, 403, { error: 'Origin required.' });
        const input = await body(request);
        try {
          const token = pairing.exchange(input?.challenge, requestOrigin);
          return send(response, 200, { token, codex: await diagnostics(true) });
        }
        catch (error) { return send(response, 403, { error: (error as Error).message }); }
      }
      if (url.pathname.startsWith('/api/')) {
        // Browser same-origin GETs omit Origin. Fetch Metadata cannot be set by
        // page JavaScript, and the token must still be bound to this exact host.
        const authOrigin = requestOrigin ?? (request.method === 'GET' && request.headers['sec-fetch-site'] === 'same-origin' ? origin : undefined);
        if (!authOrigin || !pairing.valid(tokenFrom(request), authOrigin)) return send(response, 401, { error: 'Pair with the local helper to reopen saved work.' });
        if (url.pathname === '/api/revoke' && request.method === 'POST') {
          const token = tokenFrom(request);
          pairing.revoke(token);
          for (const [ws, session] of sessions) if (session.token === token) ws.close(1008, 'Pairing revoked');
          return send(response, 200, { revoked: true });
        }
        if (url.pathname === '/api/threads' && request.method === 'GET') return send(response, 200, { threads: store.list(url.searchParams.get('url') ?? undefined, url.searchParams.get('removed') === 'true') });
        if (url.pathname === '/api/change' && request.method === 'POST') return send(response, 200, store.apply(await body(request) as ReaderMutation));
        if (url.pathname === '/api/reattach' && request.method === 'POST') {
          const input = await body(request);
          if (typeof input.threadId !== 'string' || typeof input.text !== 'string' || input.text.length > 1000000 || typeof input.tabCapture !== 'string' || input.tabCapture.length > 100) throw new Error('Invalid page capture.');
          return send(response, 200, store.reattach(input.threadId, input.text, input.tabCapture));
        }
        if (url.pathname === '/api/export' && request.method === 'GET') return send(response, 200, store.exportThread(url.searchParams.get('thread') ?? ''));
        if (url.pathname === '/api/events' && request.method === 'GET') {
          const after = Number(url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid replay position.');
          return send(response, 200, { events: store.events(after) });
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
    } catch (error) { send(response, error instanceof ConflictError ? 409 : 400, { error: error instanceof ConflictError ? error.message : 'The request could not be saved. Check its content and try again.' }); }
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
  } catch (error) { sockets.close(); store.close(); throw error; }
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
  return { origin, challenge, store, pairing, close: async () => { clearInterval(delivery); for (const client of sockets.clients) client.terminate(); sockets.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); store.close(); } };
}
