import type { IncomingMessage } from 'node:http';
import type { Pairing } from './pairing.ts';

const prefix = '/api/helper-management';
const paths = new Set([`${prefix}/pairing-code`, `${prefix}/browsers`, `${prefix}/revoke`]);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Result = { status: number; body: unknown };
const failure = (status: number, error: string): Result => ({ status, body: { error } });

/** This authority belongs to script on the helper's own page, including before
 * the first extension pairing. A bearer or a caller-supplied origin hint cannot
 * substitute for browser-controlled Origin and Fetch Metadata. */
function trustedPage(request: IncomingMessage, origin: string) {
  return request.headers.host === new URL(origin).host
    && request.headers.origin === origin
    && request.headers['sec-fetch-site'] === 'same-origin'
    && ['cors', 'same-origin'].includes(String(request.headers['sec-fetch-mode']))
    && request.headers['sec-fetch-dest'] === 'empty';
}

/** Called before ordinary CORS/preflight and paired API dispatch. Returns
 * undefined only outside this reserved namespace; never adds CORS privileges. */
export async function handleHelperManagement(request: IncomingMessage, url: URL, origin: string,
  pairing: Pairing, closeRevokedSessions: () => void): Promise<Result | undefined> {
  if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return undefined;
  if (!trustedPage(request, origin)) return failure(403, 'Use the helper page on this computer.');
  if (!paths.has(url.pathname)) return failure(404, 'Unknown helper action.');
  if (request.method !== 'POST') return failure(405, 'Use POST for this helper action.');
  if (url.search) return failure(400, 'This helper action does not accept query parameters.');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
    || request.headers['content-encoding']) return failure(415, 'Use an uncompressed JSON object.');

  try {
    const chunks: Buffer[] = [];
    let length = 0;
    // Keep the HTTP stream usable for the fixed error response on overflow.
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      length += chunk.length;
      if (length > 1024) { request.resume(); return failure(413, 'Helper action is too large.'); }
      chunks.push(Buffer.from(chunk));
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return failure(400, 'Invalid helper action.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure(400, 'Invalid helper action.');
    const record = input as Record<string, unknown>;
    const revoke = url.pathname === `${prefix}/revoke`;
    if (revoke ? Object.keys(record).length !== 1 || typeof record.id !== 'string' || !idPattern.test(record.id)
      : Object.keys(record).length !== 0) return failure(400, 'Invalid helper action.');

    // No authority snapshot crosses the body await. No await separates this
    // final check from the synchronous pairing operation and socket fence.
    if (!trustedPage(request, origin)) return failure(403, 'Use the helper page on this computer.');
    if (url.pathname === `${prefix}/pairing-code`) {
      return { status: 200, body: { code: pairing.issue(), expiresInSeconds: 300, singleUse: true } };
    }
    if (url.pathname === `${prefix}/browsers`) return { status: 200, body: { browsers: pairing.listPairedBrowsers() } };
    const result = pairing.revokePairedBrowser(record.id);
    if (result === 'not-found') return failure(404, 'Paired browser was not found.');
    closeRevokedSessions();
    return { status: 200, body: { result } };
  } catch {
    return failure(500, 'The helper action could not be completed.');
  }
}
