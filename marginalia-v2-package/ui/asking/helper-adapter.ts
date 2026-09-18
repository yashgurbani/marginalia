import type { AskingDisclosure, AskingHost, AskingPreparation, SavedAskingReply } from './types.ts';
import type { ConsentGrant } from '../../contracts/consent.ts';
import type { JobSnapshot } from '../../contracts/jobs.ts';
import type { ReplyVersion, ReplyViewState, SourceVersion } from '../../contracts/reader.ts';
import { hostCopy, isId } from './binding.ts';

export type AskingTransport = {
  /** Existing HelperClient.request. Mutating routes below always supply an explicit body. */
  request(path: string, body: unknown): Promise<unknown>;
  /** Actual authenticated GET. At the base there is no /api/read/jobs bridge. Never synthesize Origin. */
  get(path: string): Promise<unknown>;
  /** Existing HelperClient.replies, using its authenticated POST read bridge. */
  replies(threadId: string): Promise<{ replies: ReplyVersion[]; source: SourceVersion; views?: ReplyViewState[] }>;
};
function requireObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The local helper returned an unreadable response.');
}
function disclosure(value: Record<string, unknown>): AskingDisclosure {
  if (!Array.isArray(value.unverified) || !value.unverified.every(item => typeof item === 'string') ||
      !(value.disclosureVersion === null || typeof value.disclosureVersion === 'string' && value.disclosureVersion.length > 0))
    throw new Error('The local helper returned unreadable disclosure information.');
  return { unverified: [...value.unverified], disclosureVersion: value.disclosureVersion };
}
const route = (id: string) => {
  if (!isId(id)) throw new Error('Invalid saved work identifier.');
  return '/api/jobs/' + encodeURIComponent(id);
};
/** Abort fences consumers, not transport delivery. An aborted submitted request may still have been accepted. */
export function createAskingHost(transport: AskingTransport): AskingHost {
  async function run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const value = await work();
    signal.throwIfAborted();
    return hostCopy(value);
  }
  async function post(path: string, body: unknown, signal: AbortSignal) {
    const value = await run(() => transport.request(path, hostCopy(body)), signal);
    requireObject(value); return value;
  }
  async function get(path: string, signal: AbortSignal) {
    const value = await run(() => transport.get(path), signal); requireObject(value); return value;
  }
  async function prepare(path: string, input: unknown, signal: AbortSignal): Promise<AskingPreparation> {
    const value = await post(path, input, signal); requireObject(value.job); requireObject(value.preview);
    return { ...value, ...disclosure(value) } as unknown as AskingPreparation;
  }
  return {
    availability: async signal => {
      const value = await get('/api/jobs', signal);
      if (typeof value.configured !== 'boolean' || typeof value.available !== 'boolean' || value.available && !value.configured)
        throw new Error('Execution availability could not be confirmed.');
      return { configured: value.configured, available: value.available, ...disclosure(value),
        ...(typeof value.unavailableReason === 'string' ? { unavailableReason: value.unavailableReason.slice(0, 1000) } : {}) };
    },
    prepare: (input, signal) => prepare('/api/jobs/prepare', input, signal),
    prepareRetry: (id, input, signal) => prepare(route(id) + '/prepare-retry', input, signal),
    prepareFollowup: (id, input, signal) => prepare(route(id) + '/prepare-followup', input, signal),
    decide: async (input, signal) => {
      const value = await post('/api/consent/decision', input, signal); requireObject(value.grant);
      return value.grant as unknown as ConsentGrant;
    },
    start: async (input, signal) => await post('/api/jobs', input, signal) as unknown as JobSnapshot,
    retry: async (id, input, signal) => await post(route(id) + '/retry', input, signal) as unknown as JobSnapshot,
    followup: async (id, input, signal) => await post(route(id) + '/followups', input, signal) as unknown as JobSnapshot,
    cancel: async (id, signal) => await post(route(id) + '/cancel', {}, signal) as unknown as JobSnapshot,
    inspect: async (id, signal) => await get(route(id), signal) as unknown as JobSnapshot,
    listJobs: async (threadId, signal) => {
      if (!isId(threadId)) throw new Error('Invalid thread identifier.');
      const value = await get('/api/jobs?thread=' + encodeURIComponent(threadId), signal);
      if (!Array.isArray(value.jobs) || value.jobs.length > 10_000) throw new Error('The saved requests could not be read.');
      return value.jobs as JobSnapshot[];
    },
    readReply: async (threadId, replyVersionId, signal): Promise<SavedAskingReply> => {
      if (!isId(threadId) || !isId(replyVersionId)) throw new Error('Invalid saved reply identifier.');
      const value = await run(() => transport.replies(threadId), signal);
      if (!value || !Array.isArray(value.replies) || value.replies.length > 10_000) throw new Error('Saved replies could not be read.');
      const matches = value.replies.filter(r => r && r.id === replyVersionId && r.threadId === threadId && !r.deletedAt);
      if (matches.length !== 1) throw new Error('The exact completed reply is unavailable in this thread.');
      const views = value.views ?? [];
      if (!Array.isArray(views)) throw new Error('The saved view could not be read.');
      const matchingViews = views.filter(v => v && v.replyVersionId === replyVersionId);
      if (matchingViews.length > 1) throw new Error('The saved view is ambiguous.');
      return { reply: matches[0], source: value.source, ...(matchingViews[0] ? { view: matchingViews[0] } : {}) };
    },
  };
}
