import type { ReaderMutation, Thread, ReplyVersion, ReplyViewState, SourceVersion } from '../contracts/reader.ts';
import type { HostCheckReport } from '../contracts/host-checks.ts';
import type { ReplyViewChange } from './persistence.ts';

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
  async pair(challenge: string) { this.token = (await this.request('/pair', { challenge })).token; return this.token; }
  async change(change: ReaderMutation) { await this.request('/api/change', change); }
  async list(): Promise<Thread[]> { return (await this.request('/api/threads?removed=true')).threads; }
  async replies(threadId: string): Promise<{ replies: ReplyVersion[]; source: SourceVersion; views: ReplyViewState[] }> {
    return this.request('/api/replies?threadId=' + encodeURIComponent(threadId));
  }
  async replyView(threadId: string, replyVersionId: string): Promise<ReplyViewState> {
    return (await this.request('/api/reply-view?' + new URLSearchParams({ threadId, replyVersionId }))).view;
  }
  async saveReplyView(threadId: string, change: ReplyViewChange): Promise<ReplyViewState> {
    return (await this.request('/api/reply-view', { threadId, ...change })).view;
  }
  async checkReply(threadId: string, replyVersionId: string, parameters: Readonly<Record<string, number>>): Promise<HostCheckReport> {
    return (await this.request('/api/reply-check', { threadId, replyVersionId, parameters })).report;
  }
}
