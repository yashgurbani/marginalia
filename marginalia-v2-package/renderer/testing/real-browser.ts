/** Real packaged rendering acceptance in an isolated, disposable Chromium profile. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'vite';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

type ProtocolResult = { sessionId?: string; targetId?: string; result?: { value?: unknown }; exceptionDetails?: unknown; data?: string };
type Frame = { theme: string; nodeBounds: { width: number; height: number }[]; edgeLength: number; background: string; sourceUnchanged: boolean };
export type RealBrowserPage = {
  send(method: string, params?: Record<string, unknown>): Promise<ProtocolResult>;
  evaluate<T>(expression: string): Promise<T>;
  key(key: string, code: number): Promise<void>;
  screenshot(path: string, fullPage?: boolean): Promise<void>;
};
export async function withRealBrowser<T>(executable: string, action: (page: RealBrowserPage) => Promise<T>, options: { width?: number; height?: number; zoom?: 1 | 2 } = {}): Promise<{ value: T; browserVersion: unknown }> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const server = await createServer({ configFile: false, root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'p07-fixture', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== '/__p07') { next(); return; }
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta charset="utf-8"><title>P07 rendering acceptance</title></head><body></body></html>');
    });
  } }] });
  let profile = ''; 
  let port: number;
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('No acceptance server address.');
    port = address.port;
    profile = await mkdtemp(join(tmpdir(), 'p07-browser-'));
    if (options.zoom === 2) {
      // Chromium's real default page zoom, confined to this newly created profile.
      // chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc uses partition key x for the default partition.
      await mkdir(join(profile, 'Default'));
      await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }));
    }
  } catch (error) {
    await server.close();
    if (profile && resolve(profile).startsWith(resolve(tmpdir()) + sep)) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
  const args = ['--headless=new', '--no-proxy-server', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'];
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
    const pending = new Map<number, { resolve(value: ProtocolResult): void; reject(error: Error): void }>();
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    });
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<ProtocolResult>((resolveResult, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(method + ' timed out')); }, 20_000);
      pending.set(requestId, { resolve: value => { clearTimeout(timeout); resolveResult(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
      ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const origin = `http://127.0.0.1:${port}/__p07`;
    const target = await send('Target.createTarget', { url: origin });
    sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    let loaded = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { loaded = (await send('Runtime.evaluate', { expression: `location.href === ${JSON.stringify(origin)} && document.readyState === 'complete'`, returnByValue: true })).result?.value === true; } catch { /* Navigation may replace the initial context. */ }
      if (loaded) break;
      await delay(20);
    }
    if (!loaded) throw new Error('Regression page did not load: ' + JSON.stringify(await send('Runtime.evaluate', { expression: 'JSON.stringify({href:location.href,ready:document.readyState,text:document.body?.innerText})', returnByValue: true })));
    await send('Emulation.setDeviceMetricsOverride', { width: options.width ?? 1000, height: options.height ?? 1400, deviceScaleFactor: 1, mobile: false });
    const page: RealBrowserPage = {
      send,
      async evaluate<T>(expression: string) {
        const outcome = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (outcome.exceptionDetails) throw new Error(JSON.stringify(outcome.exceptionDetails));
        return outcome.result?.value as T;
      },
      async key(key, code) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      },
      async screenshot(path, fullPage = true) {
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
        await writeFile(path, Buffer.from(screenshot.data!, 'base64'));
      },
    };
    return { value: await action(page), browserVersion: await send('Browser.getVersion') };
  } finally {
    socket?.close();
    if (browser.pid && browser.exitCode === null && browser.signalCode === null) { const stopped = once(browser, 'exit').catch(() => {}); browser.kill('SIGKILL'); await stopped; }
    await server.close();
    if (!resolve(profile).startsWith(resolve(tmpdir()) + sep) || !profile.includes('p07-browser-')) throw new Error('Unexpected temporary profile path.');
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export async function runRealBrowserAcceptance(executable: string, screenshotDirectory: string): Promise<{ frames: Frame[]; browserVersion: unknown }> {
  const result = await withRealBrowser(executable, async page => {
    const frames: Frame[] = [];
    await mkdir(screenshotDirectory, { recursive: true });
    for (const theme of ['light', 'dark']) {
      frames.push(await page.evaluate<Frame>(`import('/renderer/testing/real-browser-cases.ts').then(m => m.checkRealRenderer(${JSON.stringify(theme)}))`));
      await page.screenshot(join(screenshotDirectory, `${theme}.png`));
    }
    return frames;
  });
  return { frames: result.value, browserVersion: result.browserVersion };
}
