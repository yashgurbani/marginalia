import type { ReaderMutation, Thread, ReplyVersion, ReplyViewState, SourceVersion } from '../contracts/reader.ts';
import type { HostCheckReport } from '../contracts/host-checks.ts';
import type { ReplyViewChange } from './persistence.ts';

const readRoutes = new Map([
  ['/api/threads', '/api/read/threads'],
  ['/api/replies', '/api/read/replies'],
  ['/api/reply-view', '/api/read/reply-view'],
]);

export class HelperTransportError extends Error {
  kind: 'network' | 'timeout' | 'response-unknown';
  constructor(kind: HelperTransportError['kind']) {
    const detail = kind === 'timeout' ? 'The local helper did not reply in time.'
      : kind === 'response-unknown' ? 'The local helper’s reply could not be read.'
      : 'The local helper could not be reached.';
    super(`${detail} Check that it is running. The result of this request is unconfirmed.`);
    this.name = 'HelperTransportError'; this.kind = kind;
  }
}

export class HelperHttpError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message || `The local helper rejected this request (HTTP ${status}).`);
    this.name = status === 409 ? 'Conflict' : 'HelperHttpError'; this.status = status;
  }
}

export class HelperClient {
  origin: string;
  token = '';
  constructor(origin: string) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Use the local helper address.');
    this.origin = url.origin;
  }
  async request(path: string, body?: unknown) {
    const signal = AbortSignal.timeout(8000);
    const options: RequestInit = { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, cache: 'no-store', credentials: 'omit' };
    let response: Response;
    try { response = await fetch(this.origin + path, options); }
    catch (error) {
      // Do not expose raw transport errors, request headers or credentials.
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
        || signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
      throw new HelperTransportError(timedOut ? 'timeout' : 'network');
    }
    let data;
    try { data = await response.json(); }
    catch {
      if (!response.ok) throw new HelperHttpError(response.status);
      throw new HelperTransportError('response-unknown');
    }
    if (!response.ok) throw new HelperHttpError(response.status, typeof data?.error === 'string' ? data.error : undefined);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HelperTransportError('response-unknown');
    return data;
  }
  async read(path: string) {
    const queryStart = path.indexOf('?');
    const pathname = queryStart < 0 ? path : path.slice(0, queryStart);
    const route = readRoutes.get(pathname);
    if (!route) throw new Error('This helper read has no supported transport.');
    // Browser POST supplies the real Origin; never synthesize it from the token.
    return this.request(route + (queryStart < 0 ? '' : path.slice(queryStart)), {});
  }
  async pair(challenge: string) { this.token = (await this.request('/pair', { challenge })).token; return this.token; }
  async disconnect(forgetPairing: () => Promise<void>): Promise<'revoked' | 'unconfirmed' | 'not-paired' | 'replaced'> {
    const token = this.token;
    await forgetPairing();
    if (this.token === token) this.token = '';
    if (!token) return 'not-paired';
    // Only this final revocation request retains the old credential. Ordinary
    // helper actions stop using it as soon as local removal is durable.
    const previous = new HelperClient(this.origin); previous.token = token;
    try {
      const result = await previous.request('/api/revoke', {});
      return this.token ? 'replaced' : result.revoked === true ? 'revoked' : 'unconfirmed';
    } catch { return this.token ? 'replaced' : 'unconfirmed'; }
  }
  async change(change: ReaderMutation) { await this.request('/api/change', change); }
  async list(): Promise<Thread[]> { return (await this.read('/api/threads?removed=true')).threads; }
  async replies(threadId: string): Promise<{ replies: ReplyVersion[]; source: SourceVersion; views: ReplyViewState[] }> {
    return this.read('/api/replies?threadId=' + encodeURIComponent(threadId));
  }
  async replyView(threadId: string, replyVersionId: string): Promise<ReplyViewState> {
    return (await this.read('/api/reply-view?' + new URLSearchParams({ threadId, replyVersionId }))).view;
  }
  async saveReplyView(threadId: string, change: ReplyViewChange): Promise<ReplyViewState> {
    return (await this.request('/api/reply-view', { threadId, ...change })).view;
  }
  async checkReply(threadId: string, replyVersionId: string, parameters: Readonly<Record<string, number>>): Promise<HostCheckReport> {
    return (await this.request('/api/reply-check', { threadId, replyVersionId, parameters })).report;
  }
}
