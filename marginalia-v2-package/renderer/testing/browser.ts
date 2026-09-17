/** Opt-in real-DOM regressions. No browser package or production dependency added.
 * CSS and unused KaTeX/Dagre imports are test doubles; their rendering is NOT tested.
 * A supplied Chromium must be able to run headlessly. No provider or helper is used.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import type { CandidateReply } from '../../contracts/reply.ts';
import type { HostCheckReport } from '../../contracts/host-checks.ts';

export type HostFixture = { reply: CandidateReply; reports: HostCheckReport[] };
export type BrowserResult = { name: string; error?: string };
export async function runBrowserRegressions(executable: string, fixture: HostFixture): Promise<BrowserResult[]> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url!, 'http://localhost').pathname;
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"katex":"/__unused.js","katex/dist/katex.min.css":"/__unused.css","@dagrejs/dagre":"/__unused.js"}}</script><body></body>');
      } else if (path.endsWith('.css')) {
        response.setHeader('Content-Type', 'text/javascript'); response.end('export {};');
      } else if (path === '/__unused.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end('export default new Proxy({}, {get(){throw new Error("This regression suite must not invoke KaTeX or Dagre");}});');
      } else {
        const file = resolve(root, '.' + path);
        if (!file.startsWith(resolve(root) + sep) || !path.endsWith('.ts')) { response.writeHead(404).end(); return; }
        const source = await readFile(file, 'utf8');
        response.setHeader('Content-Type', 'text/javascript');
        response.end(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText);
      }
    } catch { response.writeHead(500).end('Module unavailable'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No regression server address.');
  const profile = await mkdtemp(join(tmpdir(), 't18-browser-'));
  const args = ['--headless=new', '--no-proxy-server', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'];
  if (process.env.T18_CHROMIUM_NO_SANDBOX === '1') args.unshift('--no-sandbox');
  const browser = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
      let stderr = '';
      const timeout = setTimeout(() => reject(new Error('Chromium startup timed out: ' + stderr)), 15_000);
      browser.once('error', error => { clearTimeout(timeout); reject(error); });
      browser.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chromium exited ${code}: ${stderr}`)); });
      browser.stderr!.on('data', data => {
        stderr = (stderr + data.toString()).slice(-65_536);
        const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1];
        if (endpoint) { clearTimeout(timeout); resolveEndpoint(endpoint); }
      });
    });
    const ws = socket = new WebSocket(endpoint); await once(ws, 'open');
    let id = 0, sessionId: string | undefined;
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    });
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolveResult, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(method + ' timed out')); }, 20_000);
      pending.set(requestId, { resolve: value => { clearTimeout(timeout); resolveResult(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
      ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const origin = `http://127.0.0.1:${address.port}/`;
    const target = await send('Target.createTarget', { url: origin });
    sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    let loaded = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { loaded = (await send('Runtime.evaluate', { expression: `location.href === ${JSON.stringify(origin)} && document.readyState === 'complete'`, returnByValue: true })).result?.value === true; } catch { /* Navigation may replace the initial context. */ }
      if (loaded) break;
      await delay(20);
    }
    if (!loaded) throw new Error('Regression page did not load: ' + JSON.stringify(await send('Runtime.evaluate', { expression: 'JSON.stringify({href:location.href,ready:document.readyState,text:document.body?.innerText})', returnByValue: true })));
    const outcome = await send('Runtime.evaluate', {
      expression: `import('/renderer/testing/browser-cases.ts').then(m => m.runRendererRegressions(${JSON.stringify(fixture)}))`,
      awaitPromise: true, returnByValue: true,
    });
    if (outcome.exceptionDetails) throw new Error(JSON.stringify(outcome.exceptionDetails));
    return outcome.result.value as BrowserResult[];
  } finally {
    socket?.close();
    if (browser.pid && browser.exitCode === null && browser.signalCode === null) { const stopped = once(browser, 'exit').catch(() => {}); browser.kill('SIGKILL'); await stopped; }
    await new Promise<void>(done => server.close(() => done()));
    await rm(profile, { recursive: true, force: true });
  }
}
