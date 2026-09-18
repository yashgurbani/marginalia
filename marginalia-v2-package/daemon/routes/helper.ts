import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pairing } from '../pairing.ts';
import type { ReadBody, ReadEmptyBody, SendJson } from './types.ts';

export const tokenFrom = (request: IncomingMessage) =>
  /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1] ?? '';

export const sendJson: SendJson = (response, status, data) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(data));
};

export const readBody: ReadBody = async request => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

export const readEmptyBody: ReadEmptyBody = async (request, requireObject = false) => {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 1024) throw new Error('Request is too large.'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (requireObject) {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new Error('This action accepts only an empty object.');
  } else if (text && (text !== '{}' || JSON.parse(text) === null)) throw new Error('This action accepts only an empty object.');
};

export async function handleHelperRoute(input: { request: IncomingMessage; response: ServerResponse; url: URL;
  requestOrigin: string | undefined; pairing: Pairing; diagnostics: (refresh?: boolean) => unknown; send: SendJson; body: ReadBody }) {
  const { request, response, url, requestOrigin, pairing, diagnostics, send, body } = input;
  if (url.pathname === '/health' && request.method === 'GET') { send(response, 200, { status: 'ready', storage: 'ready' }); return true; }
  if (url.pathname !== '/pair' || request.method !== 'POST') return false;
  if (!requestOrigin) { send(response, 403, { error: 'Origin required.' }); return true; }
  const value = await body(request);
  try {
    const token = pairing.exchange(value?.challenge, requestOrigin);
    let codex: unknown;
    try { codex = await diagnostics(true); } catch { codex = { status: 'unavailable', login: 'unknown' }; }
    send(response, 200, { token, codex });
  } catch (error) { send(response, 403, { error: (error as Error).message }); }
  return true;
}

