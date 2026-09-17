import type { ReaderMutation, Thread, ReplyVersion, ReplyViewState, SourceVersion } from '../contracts/reader.ts';
import type { HostCheckReport } from '../contracts/host-checks.ts';
import type { ReplyViewChange } from './persistence.ts';

const readRoutes = new Map([
  ['/api/threads', '/api/read/threads'],
  ['/api/replies', '/api/read/replies'],
  ['/api/reply-view', '/api/read/reply-view'],
]);

export class HelperClient {
  origin: string;
  token = '';
  constructor(origin: string) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Use the local helper address.');
    this.origin = url.origin;
  }
  async request(path: string, body?: unknown) {
    const response = await fetch(this.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000), cache: 'no-store', credentials: 'omit' });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error ?? 'The local helper could not save this change.'); if (response.status === 409) error.name = 'Conflict'; throw error; }
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
