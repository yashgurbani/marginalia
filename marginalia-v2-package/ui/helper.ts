import { validateSourceCapture, type ReaderMutation, type ReattachRequest, type ReattachResponse, type Thread, type ReplyVersion, type ReplyViewState, type SourceVersion } from '../contracts/reader.ts';
import type { HostCheckReport } from '../contracts/host-checks.ts';
import type { ConsentGrant, SiteExclusion } from '../contracts/consent.ts';
import type { ModelSettings, VocabularyEntry } from '../contracts/library.ts';
import type { SolverExecuteRequest, SolverOutcome, SolverPlanOutcome, SolverPlanRequest } from '../contracts/solver.ts';
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

export function pairingCode(text: string): string {
  const code = text.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code shown by the local helper.');
  return code; // Text, not a number: leading zeroes are significant.
}

class HelperConnectionChangedError extends Error {
  constructor() { super('The helper connection changed. The earlier request outcome is unconfirmed.'); this.name = 'HelperConnectionChanged'; }
}

const attachmentStates = new Set(['exact', 'moved', 'unsure', 'lost']);
const readerId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
function invalidAttachmentResponse(): never { throw new HelperTransportError('response-unknown'); }

/** Hash only the captured text for local observation-cache keys. The source
 * URL and source-document generation are kept as separate identity fields. */
export async function attachmentTextHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateReattachResponse(value: unknown, request: ReattachRequest): ReattachResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidAttachmentResponse();
  const result = value as Record<string, unknown>;
  // Newer helpers may echo these fields. A legacy response is still tied to
  // this request by the authenticated request/response lifetime, but any
  // supplied identity must agree before it can reach the reader.
  if (result.threadId !== undefined && result.threadId !== request.threadId) return invalidAttachmentResponse();
  if (result.sourceGeneration !== undefined && result.sourceGeneration !== request.tabCapture) return invalidAttachmentResponse();
  if (result.sourceUrl !== undefined && result.sourceUrl !== request.capture.url) return invalidAttachmentResponse();
  if (typeof result.state !== 'string' || !attachmentStates.has(result.state)) return invalidAttachmentResponse();
  if (!Array.isArray(result.candidates) || result.candidates.length > 100) return invalidAttachmentResponse();
  const candidates = result.candidates.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return invalidAttachmentResponse();
    const range = candidate as Record<string, unknown>;
    const start = range.start, end = range.end;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > request.text.length) return invalidAttachmentResponse();
    return { start, end };
  });
  return { state: result.state as ReattachResponse['state'], candidates, threadId: request.threadId, sourceGeneration: request.tabCapture, sourceUrl: request.capture.url };
}

function validateReattachRequest(request: ReattachRequest): void {
  if (!request || typeof request !== 'object' || Array.isArray(request) || !readerId(request.threadId) || typeof request.text !== 'string' || request.text.length > 1_000_000 || typeof request.tabCapture !== 'string' || !request.tabCapture.length || request.tabCapture.length > 100) throw new Error('Invalid attachment request.');
  validateSourceCapture(request.capture);
  if (request.capture.text !== request.text) throw new Error('The target capture does not match this source.');
}

export class HelperClient {
  readonly origin: string;
  private credential = '';
  private epoch = 0;
  private permissionsEpoch = 0;
  get permissionVersion() { return this.permissionsEpoch; }
  permissionsChanged() { this.permissionsEpoch++; }
  private connection = new AbortController();
  private disconnecting: number | undefined;
  get token() { return this.credential; }
  set token(value: string) {
    this.invalidate(); this.credential = value; this.disconnecting = undefined;
  }
  get connectionVersion() { return this.epoch; }
  private invalidate() { this.connection.abort(); this.connection = new AbortController(); this.epoch++; }
  constructor(origin: string) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Use the local helper address.');
    this.origin = url.origin;
  }
  async request(path: string, body?: unknown, externalSignal?: AbortSignal) {
    if (!path.startsWith('/') || path.startsWith('//') || new URL(path, this.origin).origin !== this.origin) throw new Error('Use a local helper path.');
    if (this.disconnecting !== undefined && path !== '/pair') throw new HelperConnectionChangedError();
    const epoch = this.epoch;
    const signal = AbortSignal.any([this.connection.signal, AbortSignal.timeout(8000), ...(externalSignal ? [externalSignal] : [])]);
    const assertCurrent = () => { if (epoch !== this.epoch || externalSignal?.aborted) throw new HelperConnectionChangedError(); };
    assertCurrent();
    const options: RequestInit = { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, cache: 'no-store', credentials: 'omit' };
    let response: Response;
    try { response = await fetch(this.origin + path, options); }
    catch (error) {
      assertCurrent();
      // Do not expose raw transport errors, request headers or credentials.
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
        || signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
      throw new HelperTransportError(timedOut ? 'timeout' : 'network');
    }
    assertCurrent();
    let data;
    try { data = await response.json(); }
    catch {
      assertCurrent();
      if (!response.ok) throw new HelperHttpError(response.status);
      throw new HelperTransportError('response-unknown');
    }
    assertCurrent();
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
  async pair(challenge: string, signal?: AbortSignal) {
    const epoch = this.epoch;
    const result = await this.request('/pair', { challenge: pairingCode(challenge) }, signal);
    if (epoch !== this.epoch || signal?.aborted) throw new HelperConnectionChangedError();
    if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.token)) throw new HelperTransportError('response-unknown');
    this.token = result.token;
    return this.token;
  }
  async disconnect(forgetPairing: () => Promise<void>): Promise<'revoked' | 'unconfirmed' | 'not-paired' | 'replaced'> {
    const token = this.token;
    // Fence late replies and ordinary sends immediately, but do not claim local
    // removal or revoke remotely until the local credential deletion commits.
    this.invalidate(); const removalEpoch = this.epoch; this.disconnecting = removalEpoch;
    try { await forgetPairing(); }
    catch (error) { if (this.epoch === removalEpoch) this.disconnecting = undefined; throw error; }
    if (this.epoch === removalEpoch) this.token = '';
    if (!token) return this.token ? 'replaced' : 'not-paired';
    // Only this final revocation request retains the old credential. Ordinary
    // helper actions stop using it as soon as local removal is durable.
    const previous = new HelperClient(this.origin); previous.token = token;
    try {
      const result = await previous.request('/api/revoke', {});
      return this.token ? 'replaced' : result.revoked === true ? 'revoked' : 'unconfirmed';
    } catch { return this.token ? 'replaced' : 'unconfirmed'; }
  }
  async change(change: ReaderMutation): Promise<void> { await this.request('/api/change', change); }
  async reattach(request: ReattachRequest, signal?: AbortSignal): Promise<ReattachResponse> {
    const snapshot = structuredClone(request);
    validateReattachRequest(snapshot);
    const result = await this.request('/api/reattach', snapshot, signal);
    return validateReattachResponse(result, snapshot);
  }
  async list(): Promise<Thread[]> { return (await this.read('/api/threads?removed=true')).threads; }
  async exportThread(id: string): Promise<{ thread: Thread; source: SourceVersion; replies: ReplyVersion[]; replyViews: ReplyViewState[]; [key: string]: unknown }> {
    return this.request('/api/export?thread=' + encodeURIComponent(id));
  }
  async models(): Promise<ModelSettings> { return (await this.request('/api/settings/models')).models; }
  async saveModels(change: { fast: string; deep: string; expectedRevision: number }): Promise<ModelSettings> { return (await this.request('/api/settings/models', change)).models; }
  async vocabulary(): Promise<VocabularyEntry[]> { return (await this.request('/api/vocabulary')).vocabulary; }
  async deleteVocabulary(term: string): Promise<void> { await this.request('/api/vocabulary/delete', { term }); }
  async permissions(signal: AbortSignal): Promise<{ grants: ConsentGrant[]; exclusions: SiteExclusion[] }> { return this.request('/api/consent/settings', undefined, signal); }
  async revokeGrant(grant: ConsentGrant, signal: AbortSignal): Promise<ConsentGrant> {
    const result = await this.request('/api/consent/settings', { action: 'revoke-grant', grantId: grant.id, expectedRevision: grant.revision }, signal); this.permissionsChanged(); return result.grant;
  }
  async setExcluded(site: string, excluded: boolean, expectedRevision: number | undefined, signal: AbortSignal): Promise<SiteExclusion> {
    const result = await this.request('/api/consent/settings', { action: 'set-exclusion', site, excluded, ...(expectedRevision === undefined ? {} : { expectedRevision }) }, signal); this.permissionsChanged(); return result.exclusion;
  }
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
  async prepareSolver(request: SolverPlanRequest, signal?: AbortSignal): Promise<SolverPlanOutcome> {
    return (await this.request('/api/solver/prepare', request, signal)).outcome;
  }
  async executeSolver(request: SolverExecuteRequest, signal?: AbortSignal): Promise<SolverOutcome> {
    return (await this.request('/api/solver/recompute', request, signal)).outcome;
  }
  async solverResult(requestId: string, signal?: AbortSignal): Promise<SolverOutcome | null> {
    return (await this.request('/api/solver/result?requestId=' + encodeURIComponent(requestId), undefined, signal)).outcome ?? null;
  }
}
// A library and a retained margin use one connection lifetime. Disconnect fences both.
const clients = new Map<string, HelperClient>();
export function documentHelper(namespace: string, origin: string): HelperClient {
  const normalized = new HelperClient(origin);
  const key = JSON.stringify([namespace, normalized.origin]);
  let client = clients.get(key);
  if (!client) { client = normalized; clients.set(key, client); }
  return client;
}

/** Adapters for the existing localhost library contract, not substitute settings. */
export function libraryAdapters(
  connection: () => HelperClient,
  restore: (client: HelperClient, thread: Thread) => Promise<Thread>,
  callbacks: Pick<import('./library/index.ts').MountLibraryOptions, 'onOpenThread' | 'onClose'>,
): import('./library/index.ts').MountLibraryOptions {
  return {
    ...callbacks,
    listThreads: () => connection().list(),
    exportThread: id => connection().exportThread(id),
    restoreThread: thread => restore(connection(), thread),
    loadModels: () => connection().models(),
    saveModels: change => connection().saveModels(change),
    listVocabulary: () => connection().vocabulary(),
    deleteVocabulary: term => connection().deleteVocabulary(term),
    permissions: {
      load: signal => connection().permissions(signal),
      revoke: (grant, signal) => connection().revokeGrant(grant, signal),
      setExcluded: (site, excluded, revision, signal) => connection().setExcluded(site, excluded, revision, signal),
    },
  };
}

/** Caller holds the same pairing-storage lock as Pair. Never erase a newer
 * credential that won that lock while an older Disconnect was in flight. */
export async function forgetPairingIfCurrent(
  io: { read<T>(key: string): Promise<T | undefined>; write(key: string, value: unknown): Promise<void> },
  origin: string, token: string,
): Promise<boolean> {
  const saved = await io.read<{ origin: string; token: string }>('pairing');
  if (saved && (saved.origin !== origin || saved.token !== token)) return false;
  await io.write('pairing', undefined);
  return true;
}

/** A broadcast carries a one-way predecessor identity, never a bearer token. */
export async function pairingIdentity(origin: string, token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([origin, token])));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
