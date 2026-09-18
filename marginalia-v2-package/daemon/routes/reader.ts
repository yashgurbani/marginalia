import type { WebSocket } from 'ws';
import { validateReplyRemovalChange, type ReaderMutation, type ReplyRemovalChange } from '../../contracts/reader.ts';
import { runHostChecks } from '../../contracts/host-checks.ts';
import type { ReaderStore } from '../store.ts';
import type { Pairing } from '../pairing.ts';
import type { LibrarySettingsService } from '../library.ts';
import { ConsentSessionService, handleConsentDecision, handleConsentSettingsChange, handleConsentSettingsRead } from '../consent/index.ts';
import type { ApiRouteContext } from './types.ts';
import { JourneyEditsStore } from '../journey-edits.ts';

export function createReaderRoutes(input: { store: ReaderStore; pairing: Pairing; library: LibrarySettingsService;
  consent: ConsentSessionService; sessions: Map<WebSocket, { token: string; origin: string; after: number }> }) {
  const { store, pairing, library, consent, sessions } = input;
  const journeys = new JourneyEditsStore(store);
  return async (context: ApiRouteContext) => {
    const { request, response, url, requestOrigin, token, principal, requireCurrentPairing, send, body, emptyBody } = context;
    if (url.pathname === '/api/position' && request.method === 'POST') {
      const value = await body(request);
      if (value?.capture !== undefined || value?.anchor !== undefined) {
        if (!value?.capture || !value?.anchor) throw new Error('A page capture and position anchor are required.');
        send(response, 200, { anchor: store.saveReaderPosition(value.capture, value.anchor) }); return true;
      }
      if (typeof value?.url !== 'string' || value.url.length > 8000) throw new Error('A page address is required.');
      send(response, 200, { anchor: store.readerPosition(value.url) ?? null }); return true;
    }
    let readOperation: 'threads' | 'replies' | 'reply-view' | 'library-search' | 'library-related' | 'library-journal' | 'export' | 'auto-assist' | 'vocabulary' | undefined;
    // Job reads share this prefix but are handled by the following job router.
    if (url.pathname === '/api/read/skills') return false;
    if (url.pathname === '/api/read/instant/settings' || url.pathname === '/api/read/ambient/policy') return false;
    if (/^\/api\/read\/jobs(?:\/[\w-]{1,100})?$/.test(url.pathname)) return false;
    if (url.pathname.startsWith('/api/read/')) {
      if (url.pathname === '/api/read/threads') readOperation = 'threads';
      else if (url.pathname === '/api/read/replies') readOperation = 'replies';
      else if (url.pathname === '/api/read/reply-view') readOperation = 'reply-view';
      else if (url.pathname === '/api/read/library-search') readOperation = 'library-search';
      else if (url.pathname === '/api/read/library-related') readOperation = 'library-related';
      else if (url.pathname === '/api/read/library-journal') readOperation = 'library-journal';
      else if (url.pathname === '/api/read/export') readOperation = 'export';
      else if (url.pathname === '/api/read/settings/auto-assist') readOperation = 'auto-assist';
      else if (url.pathname === '/api/read/vocabulary') readOperation = 'vocabulary';
      else { send(response, 404, { error: 'Unknown read operation.' }); return true; }
      if (request.method !== 'POST') { send(response, 405, { error: 'Use POST for this read operation.' }); return true; }
      if (!requestOrigin) { send(response, 401, { error: 'Origin required.' }); return true; }
      await emptyBody(request, true);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to reopen saved work.' }); return true; }
    } else if (request.method === 'GET') {
      if (url.pathname === '/api/threads') readOperation = 'threads';
      else if (url.pathname === '/api/replies') readOperation = 'replies';
      else if (url.pathname === '/api/reply-view') readOperation = 'reply-view';
      else if (url.pathname === '/api/library-search') readOperation = 'library-search';
      else if (url.pathname === '/api/library-related') readOperation = 'library-related';
      else if (url.pathname === '/api/library-journal') readOperation = 'library-journal';
    }
    if (url.pathname === '/api/revoke' && request.method === 'POST') {
      await emptyBody(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to revoke this session.' }); return true; }
      pairing.revoke(token);
      for (const [ws, session] of sessions) if (session.token === token) ws.close(1008, 'Pairing revoked');
      send(response, 200, { revoked: true }); return true;
    }
    if (readOperation === 'threads') { send(response, 200, { threads: store.list(url.searchParams.get('url') ?? undefined, url.searchParams.get('removed') === 'true') }); return true; }
    if (readOperation === 'library-journal') { send(response, 200, { journal: journeys.journal(url.searchParams.get('timeZone') ?? 'UTC', library.vocabulary().map(entry => entry.term)) }); return true; }
    if (url.pathname === '/api/journeys' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to save journeys.' }); return true; }
      send(response, 200, { journeys: journeys.save(value) }); return true;
    }
    if (readOperation === 'library-search') { send(response, 200, { results: library.search(url.searchParams.get('q') ?? '') }); return true; }
    if (readOperation === 'library-related') { send(response, 200, { results: library.related(url.searchParams.get('thread') ?? '') }); return true; }
    if (url.pathname === '/api/change' && request.method === 'POST') {
      const value = await body(request) as ReaderMutation;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to reopen saved work.' }); return true; }
      send(response, 200, store.apply(value)); return true;
    }
    if (url.pathname === '/api/reattach' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to reopen saved work.' }); return true; }
      if (typeof value.threadId !== 'string' || typeof value.text !== 'string' || value.text.length > 1000000 || typeof value.tabCapture !== 'string' || value.tabCapture.length > 100) throw new Error('Invalid page capture.');
      send(response, 200, store.reattach(value.threadId, value.text, value.tabCapture, value.capture)); return true;
    }
    if (readOperation === 'export' || (url.pathname === '/api/export' && request.method === 'GET')) { send(response, 200, store.exportThread(url.searchParams.get('thread') ?? '')); return true; }
    if (url.pathname === '/api/events' && request.method === 'GET') {
      const after = Number(url.searchParams.get('after') ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid replay position.');
      send(response, 200, { events: store.events(after) }); return true;
    }
    if (readOperation === 'replies') {
      const threadId = url.searchParams.get('threadId');
      if (!threadId || !/^[\w-]{1,100}$/.test(threadId)) throw new Error('Invalid thread identifier.');
      const thread = store.get(threadId);
      if (!thread || thread.deletedAt) { send(response, 404, { error: 'This thread is unavailable.' }); return true; }
      const replies = store.replies(threadId, true), source = store.sourceVersion(thread.sourceVersionId);
      send(response, 200, { replies, source, views: replies.map(reply => store.replyView(reply.id)).filter(view => view !== undefined) }); return true;
    }
    if (readOperation === 'reply-view') {
      const threadId = url.searchParams.get('threadId'), replyId = url.searchParams.get('replyVersionId');
      if (!threadId || !replyId) throw new Error('Reply identity is required.');
      const reply = store.reply(replyId);
      if (!reply || reply.threadId !== threadId || reply.deletedAt || store.get(threadId)?.deletedAt) { send(response, 404, { error: 'This reply is unavailable.' }); return true; }
      send(response, 200, { view: store.replyView(reply.id) }); return true;
    }
    if (url.pathname === '/api/reply-view' && request.method === 'POST') {
      const value = await body(request), reply = store.reply(value?.replyVersionId);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to save this view.' }); return true; }
      if (!reply || reply.threadId !== value?.threadId || reply.deletedAt || store.get(reply.threadId)?.deletedAt) throw new Error('The saved view does not match an active reply.');
      const view = store.saveReplyView({ id: value.id, replyVersionId: reply.id, expectedRevision: value.expectedRevision, parameters: value.parameters, view: value.view });
      send(response, 200, { view }); return true;
    }
    if (url.pathname === '/api/shelf-open' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to keep your return passage.' }); return true; }
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5 ||
        ['id', 'threadId', 'replyVersionId', 'blockId', 'itemId'].some(key => typeof value[key] !== 'string')) throw new Error('A saved shelf item is required.');
      send(response, 200, { open: store.openShelfItem(value) }); return true;
    }
    if (url.pathname === '/api/reply-removal' && request.method === 'POST') {
      const value = await body(request) as ReplyRemovalChange;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to save reply changes.' }); return true; }
      validateReplyRemovalChange(value);
      const reply = store.reply(value.replyVersionId);
      if (!reply || reply.threadId !== value.threadId || store.get(value.threadId)?.deletedAt) throw new Error('The reply removal does not match an active thread.');
      const { id, replyVersionId, removed, expectedRevision } = value;
      send(response, 200, { reply: store.setReplyRemoved({ id, replyVersionId, removed, expectedRevision }) }); return true;
    }
    if (url.pathname === '/api/reply-check' && request.method === 'POST') {
      const value = await body(request), reply = store.reply(value?.replyVersionId);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to check this reply.' }); return true; }
      if (!reply || reply.threadId !== value?.threadId || reply.deletedAt || store.get(reply.threadId)?.deletedAt) throw new Error('The check request does not match an active reply.');
      validateReplyParameters(reply.reply.parameters, value.parameters);
      send(response, 200, { report: runHostChecks(reply.reply, value.parameters) }); return true;
    }
    if (readOperation === 'auto-assist' || (url.pathname === '/api/settings/auto-assist' && request.method === 'GET')) {
      send(response, 200, { autoAssist: library.autoAssist() }); return true;
    }
    if (url.pathname === '/api/settings/auto-assist' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to change automatic help.' }); return true; }
      send(response, 200, { autoAssist: library.saveAutoAssist(value) }); return true;
    }
    if (url.pathname === '/api/settings/models' && request.method === 'GET') { send(response, 200, { models: library.models() }); return true; }
    if (url.pathname === '/api/settings/models' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to change model choices.' }); return true; }
      send(response, 200, { models: library.saveModels(value) }); return true;
    }
    if (readOperation === 'vocabulary' || (url.pathname === '/api/vocabulary' && request.method === 'GET')) { send(response, 200, { vocabulary: library.vocabulary() }); return true; }
    if (url.pathname === '/api/settings/vocabulary-gathering' && request.method === 'GET') {
      send(response, 200, { gathering: library.vocabularyGathering() }); return true;
    }
    if (url.pathname === '/api/settings/vocabulary-gathering' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to change vocabulary gathering.' }); return true; }
      send(response, 200, { gathering: library.saveVocabularyGathering(value) }); return true;
    }
    if (url.pathname === '/api/vocabulary/observe' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to remember a word.' }); return true; }
      send(response, 200, library.recordVocabularyObservation(value)); return true;
    }
    if (url.pathname === '/api/vocabulary/delete' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to change vocabulary.' }); return true; }
      send(response, 200, library.deleteVocabulary(value?.term)); return true;
    }
    if (url.pathname === '/api/consent/settings' && request.method === 'GET') {
      const result = handleConsentSettingsRead(consent, principal); send(response, result.status, result.body); return true;
    }
    if (url.pathname === '/api/consent/settings' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to change permissions.' }); return true; }
      const result = handleConsentSettingsChange(consent, principal, value); send(response, result.status, result.body); return true;
    }
    if (url.pathname === '/api/consent/decision' && request.method === 'POST') {
      const value = await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to approve this request.' }); return true; }
      const result = handleConsentDecision(consent, principal, value); send(response, result.status, result.body); return true;
    }
    return false;
  };
}

function validateReplyParameters(declared: { name: string; min: number; max: number }[], value: unknown): asserts value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reply parameters.');
  const parameters = value as Record<string, unknown>;
  if (Object.keys(parameters).length !== declared.length) throw new Error('Invalid reply parameters.');
  for (const parameter of declared) {
    const candidate = parameters[parameter.name];
    if (!Object.hasOwn(parameters, parameter.name) || typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < parameter.min || candidate > parameter.max) throw new Error('Invalid reply parameters.');
  }
}

