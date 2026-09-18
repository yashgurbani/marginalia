import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SendJson } from './types.ts';

export async function handleStaticRoute(input: { request: IncomingMessage; response: ServerResponse; url: URL; webRoot?: string; send: SendJson }) {
  const { request, response, url, webRoot, send } = input;
  if (request.method !== 'GET' || !webRoot) return false;
  const file = resolve(webRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(resolve(webRoot) + sep)) { send(response, 403, { error: 'Invalid path.' }); return true; }
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' });
    response.end(bytes);
  } catch { send(response, 404, { error: 'This page is unavailable.' }); }
  return true;
}

