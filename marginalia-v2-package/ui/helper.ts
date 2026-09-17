import type { ReaderMutation, Thread } from '../contracts/reader.ts';

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
}
