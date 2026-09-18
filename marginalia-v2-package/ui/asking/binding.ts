import type { ConsentChoice, ConsentGrant, ConsentPreview } from '../../contracts/consent.ts';
import { isDigest } from '../../contracts/digest.ts';
import type { JobSnapshot, PrepareJobInput, ProviderJobPacket } from '../../contracts/jobs.ts';
import type { NoteVersion, SourceVersion, Thread } from '../../contracts/reader.ts';
import type { CandidateReply } from '../../contracts/reply.ts';
import type { AskingBinding, AskingPreparation, AskingValidator, PageDefinition, SavedAskingReply } from './types.ts';

export const isId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && (empty || value.length > 0) && value.length <= max;
const readerSkill = (value: unknown, provenance = false): value is { name: string; catalogRevision: string; execution?: 'requested' } =>
  record(value) && text(value.name, 128) && text(value.catalogRevision, 1000) && (!provenance || value.execution === 'requested');
export class AskingBindingError extends Error {
  constructor() { super('The response does not match this saved passage, note, and request. Review the current context again.'); this.name = 'AskingBindingError'; }
}
function requireMatch(value: unknown): asserts value { if (!value) throw new AskingBindingError(); }

/** Detach JSON-shaped host responses and bound work before traversing them. No schema/policy authority. */
export function hostCopy<T>(value: T): T {
  let items = 0;
  const ancestors = new Set<object>();
  const check = (node: unknown, depth: number) => {
    requireMatch(depth <= 24 && ++items <= 50_000);
    if (node === undefined || node === null || typeof node === 'boolean') return;
    if (typeof node === 'string') { requireMatch(node.length <= 4_000_000); return; }
    if (typeof node === 'number') { requireMatch(Number.isFinite(node)); return; }
    requireMatch(typeof node === 'object' && !ancestors.has(node));
    requireMatch(Array.isArray(node) || Object.getPrototypeOf(node) === Object.prototype || Object.getPrototypeOf(node) === null);
    ancestors.add(node);
    for (const item of Object.values(node)) check(item, depth + 1);
    ancestors.delete(node);
  };
  check(value, 0);
  const encoded = JSON.stringify(value);
  requireMatch(typeof encoded === 'string' && encoded.length <= 8_000_000);
  return JSON.parse(encoded) as T;
}

/** Exact JSON-shaped equality, independent of object key insertion order. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameData(v, b[i]));
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter(k => x[k] !== undefined);
  return keys.length === Object.keys(y).filter(k => y[k] !== undefined).length && keys.every(k => Object.hasOwn(y, k) && sameData(x[k], y[k]));
}

export function assertBinding(b: AskingBinding): void {
  requireMatch(b && isId(b.threadId) && isId(b.anchorId) && isId(b.captureId) && isId(b.sourceVersionId) && isDigest(b.sourceHash));
  requireMatch(text(b.sourceUrl, 8000));
  let url: URL; try { url = new URL(b.sourceUrl); } catch { throw new AskingBindingError(); }
  requireMatch(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
  requireMatch(text(b.sourceText, 1_000_000, true) && text(b.sourceTitle, 1000, true) &&
    (b.sourcePageType === null || text(b.sourcePageType, 100, true)) && (b.sourceCapturedAt === null || date(b.sourceCapturedAt)));
  const a = b.anchor;
  requireMatch(a && (a.kind === undefined || ['quote', 'section', 'whole-page'].includes(a.kind)) &&
    text(a.exact, 16000, true) && text(a.prefix, 256, true) && text(a.suffix, 256, true) &&
    Number.isSafeInteger(a.start) && Number.isSafeInteger(a.end) && a.start >= 0 && a.end >= a.start && a.end <= b.sourceText.length &&
    b.sourceText.slice(a.start, a.end) === a.exact);
  requireMatch(a.kind === 'whole-page' ? !a.exact && !a.prefix && !a.suffix && a.start === 0 && a.end === 0 : a.exact.length > 0);
  if (b.answeredNote) requireMatch(isId(b.answeredNote.noteId) && Number.isSafeInteger(b.answeredNote.revision) && b.answeredNote.revision > 0 && text(b.answeredNote.text, 20000, true));
}

/** Use host-acknowledged identities; passing a historic note version must be a deliberate T05 choice. */
export function bindAskingThread(thread: Thread, source: SourceVersion, captureId: string, note?: NoteVersion): AskingBinding {
  requireMatch(thread && source && !thread.deletedAt && thread.sourceVersionId === source.id);
  if (note) requireMatch(thread.notes.some(n => n.id === note.noteId));
  const binding: AskingBinding = {
    threadId: thread.id, anchorId: thread.anchorId, captureId, sourceVersionId: source.id, sourceHash: source.hash,
    sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle, sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt,
    sourceText: source.text, anchor: structuredClone(thread.anchor),
    ...(note ? { answeredNote: { noteId: note.noteId, revision: note.revision, text: note.text } } : {}),
  };
  assertBinding(binding); return binding;
}

/** Abstain on generic "X is ...", ambiguity and paraphrases. Return only original page bytes/positions. */
export function definitionFromPage(term: string, source: string): PageDefinition | undefined {
  if (typeof term !== 'string' || typeof source !== 'string') return;
  const word = term.trim();
  if (!word || word.length > 80 || word.split(/\s+/).length > 5 || source.length > 1_000_000) return;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[.!?]\\s+|\\n)(${escaped}\\s+(?:means|refers to|is defined as)\\s+[^.!?\\n]{3,300}\\.)`, 'gi');
  const match = pattern.exec(source);
  if (!match) return;
  // Reuse the terminator as the next sentence boundary; do not miss adjacent conflicting definitions.
  pattern.lastIndex--;
  if (pattern.exec(source)) return;
  const quote = match[1], start = match.index + match[0].length - quote.length;
  return { text: source.slice(start, start + quote.length), start, end: start + quote.length, label: 'from this page' };
}

export type ExpectedRequest = {
  input: PrepareJobInput;
  kind: 'initial' | 'retry' | 'followup' | 'note-followup';
  parentJobId?: string;
  parentAttemptId?: string;
  retryOfJobId?: string;
};
function assertPacket(packet: ProviderJobPacket, b: AskingBinding, intent: string, question: string, parentReplyId?: string): void {
  requireMatch(packet && packet.schema === 'marginalia.job-packet.v1' && packet.intent === intent && packet.question === question &&
    packet.source?.sourceVersionId === b.sourceVersionId && packet.source.sourceHash === b.sourceHash && packet.source.url === b.sourceUrl &&
    packet.source.title === b.sourceTitle && packet.source.pageType === b.sourcePageType && packet.source.capturedAt === b.sourceCapturedAt && packet.parentReplyId === parentReplyId);
  const s = packet.selection, a = b.anchor;
  requireMatch(s && text(s.exact, 16000, true) && a.exact.startsWith(s.exact) && s.start === a.start && s.end === a.start + s.exact.length &&
    s.originalEnd === a.end && s.omittedCharacters === a.exact.length - s.exact.length && s.prefix === a.prefix && s.suffix === a.suffix);
  const n = packet.answeredNote, note = b.answeredNote;
  requireMatch(note ? n && n.noteId === note.noteId && n.revision === note.revision && typeof n.text === 'string' && note.text.startsWith(n.text) &&
    n.originalCharacters === note.text.length && n.omittedCharacters === note.text.length - n.text.length : !n);
  const context = packet.adjacentContext;
  requireMatch(context && ['section-adjacent-context', 'bounded-character-context', 'whole-page-opening'].includes(context.basis) &&
    text(context.before, 12000, true) && text(context.after, 12000, true));
  // The host alone chooses bounds. We check that supplied context is really adjacent to the frozen selection.
  if (context.basis === 'whole-page-opening') requireMatch(a.kind === 'whole-page' && !context.before && b.sourceText.startsWith(context.after));
  else requireMatch(b.sourceText.slice(0, a.start).endsWith(context.before) && b.sourceText.slice(a.end).startsWith(context.after));
  requireMatch(Array.isArray(packet.omissions) && packet.omissions.length <= 64 && packet.omissions.every(x => text(x, 4000)) &&
    Array.isArray(packet.availableCapabilities) && packet.availableCapabilities.length <= 16);
  if (parentReplyId) requireMatch(packet.parentReply && packet.parentReply.replyVersionId === parentReplyId &&
    packet.parentReply.attribution === 'Prior generated work, not source evidence.' && text(packet.parentReply.excerpt, 4000) &&
    Number.isSafeInteger(packet.parentReply.omittedBytes) && packet.parentReply.omittedBytes >= 0);
  else requireMatch(!packet.parentReply);
}

export function assertPreparation(p: AskingPreparation, expected: ExpectedRequest, b: AskingBinding, now: number): void {
  requireMatch(p && p.job && p.preview);
  const j = p.job, v = p.preview, input = expected.input;
  requireMatch(j.id === input.id && j.idempotencyKey === input.idempotencyKey && j.threadId === b.threadId && j.intent === input.intent &&
    j.question === input.question && j.parentReplyId === input.parentReplyId && sameData(j.readerSkill, input.readerSkill));
  requireMatch(input.readerSkill ? input.intent === 'unsure' && readerSkill(input.readerSkill) : !j.readerSkill);
  const noteExpected = expected.kind === 'initial' || expected.kind === 'note-followup';
  requireMatch(noteExpected ? sameData(j.answeredNote, input.answeredNote) : !j.answeredNote);
  const allowed = new Set(['id', 'idempotencyKey', 'threadId', 'intent', 'question', 'provider', 'model', 'mode', 'policyKey', 'preparedPayloadDigest', 'answeredNote', 'parentReplyId', 'capabilities', 'readerSkill']);
  requireMatch(Object.keys(j).every(k => allowed.has(k)) && isId(v.id) && Number.isSafeInteger(v.revision) && v.revision > 0 &&
    v.requestId === j.id && isDigest(j.preparedPayloadDigest) && v.bindingDigest === j.preparedPayloadDigest && isDigest(v.payloadDigest) &&
    isDigest(j.policyKey) && v.policyKey === j.policyKey && v.provider === j.provider && ['app-server', 'mcp-server'].includes(j.provider) &&
    ['structured-final', 'workspace-files'].includes(j.mode) && text(j.model, 100) && /^[A-Za-z0-9._-]+$/.test(j.model) &&
    text(v.recipient, 1000) && text(v.recipientLabel, 1000) && text(v.scopeLabel, 1000) && v.site === new URL(b.sourceUrl).origin &&
    v.scope === (['evidence', 'explore'].includes(input.intent) ? 'open-session' : 'cloud-inference') &&
    ['ready', 'denied', 'excluded'].includes(v.state) && date(v.expiresAt) && Date.parse(v.expiresAt) > now);
  requireMatch(Array.isArray(v.outgoing) && v.outgoing.length > 0 && v.outgoing.length <= 16 &&
    v.outgoing.every(part => part && text(part.label, 1000) && text(part.text, 1_000_000, true) && isDigest(part.sha256)));
  const packets = v.outgoing.filter(part => part.label === 'Bounded reading packet');
  requireMatch(packets.length === 1);
  let packet: ProviderJobPacket;
  try { packet = hostCopy(JSON.parse(packets[0].text)); } catch { throw new AskingBindingError(); }
  assertPacket(packet, b, input.intent, input.question, input.parentReplyId);
  requireMatch(sameData(packet.availableCapabilities, j.capabilities ?? []));
}

export function assertGrant(g: ConsentGrant, v: ConsentPreview, choice: ConsentChoice): void {
  requireMatch(g && isId(g.id) && g.site === v.site && g.scope === v.scope && g.recipient === v.recipient && !g.revokedAt &&
    Number.isSafeInteger(g.revision) && g.revision > 0 && date(g.createdAt) &&
    g.decision === ({ 'this-time': 'allow-once', 'always-site': 'allow-site', 'never-site': 'deny-site' } as const)[choice]);
  if (g.decision === 'allow-once') requireMatch(g.requestId === v.requestId && g.bindingDigest === v.bindingDigest);
}

const states = new Set(['queued', 'preparing', 'sending', 'running', 'validating', 'succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown', 'cancel_requested']);
export function assertJob(j: JobSnapshot, b: AskingBinding, requestId: string, expected?: ExpectedRequest, preparation?: AskingPreparation): void {
  const c = j?.context;
  requireMatch(j && c && j.id === requestId && isId(j.idempotencyKey) && j.threadId === b.threadId && isDigest(j.preparedPayloadDigest) && isDigest(j.packetDigest) &&
    isDigest(j.policyKey) && isId(j.grantId) && ['app-server', 'mcp-server'].includes(j.provider) && text(j.model, 100) &&
    ['structured-final', 'workspace-files'].includes(j.mode) && states.has(j.state) && typeof j.cancelRequested === 'boolean' && date(j.createdAt) && date(j.updatedAt));
  requireMatch(c.threadId === b.threadId && c.sourceVersionId === b.sourceVersionId && c.sourceHash === b.sourceHash && c.sourceUrl === b.sourceUrl &&
    c.sourceText === b.sourceText && c.sourceTitle === b.sourceTitle && c.sourcePageType === b.sourcePageType && c.sourceCapturedAt === b.sourceCapturedAt &&
    c.preparedPayloadDigest === j.preparedPayloadDigest && text(c.question, 4000) && ['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure'].includes(c.intent));
  requireMatch(c.readerSkill === undefined || c.intent === 'unsure' && readerSkill(c.readerSkill, true));
  if (j.unformatted !== undefined) requireMatch(j.state === 'failed' && !j.replyVersionId && c.readerSkill && readerSkill(j.unformatted.readerSkill, true) &&
    sameData(j.unformatted.readerSkill, c.readerSkill) && j.unformatted.schema === 'marginalia.skill-output.v1' &&
    j.unformatted.reason === 'reply-validation-failed' && typeof j.unformatted.text === 'string' &&
    new TextEncoder().encode(j.unformatted.text).byteLength <= 256 * 1024 && isDigest(j.unformatted.sha256));
  const note = b.answeredNote;
  // noteVersion() may include createdAt. Compare exact content, not incidental metadata keys.
  requireMatch(note ? c.answeredNote && c.answeredNote.noteId === note.noteId && c.answeredNote.revision === note.revision && c.answeredNote.text === note.text : !c.answeredNote);
  requireMatch(c.passage && ['exact', 'prefix', 'suffix', 'start', 'end'].every(k => c.passage[k as keyof typeof c.passage] === b.anchor[k as keyof typeof b.anchor]));
  assertPacket(c.outgoing, b, c.intent, c.question, c.parentReplyId);
  requireMatch(Array.isArray(j.attempts) && j.attempts.length <= 64 && new Set(j.attempts.map(a => a?.id)).size === j.attempts.length);
  for (const a of j.attempts) requireMatch(a && isId(a.id) && a.id !== j.id && a.jobId === j.id && states.has(a.state) &&
    Number.isSafeInteger(a.revision) && a.revision >= 0 && Number.isSafeInteger(a.number) && a.number > 0 &&
    typeof a.dispatchClaimed === 'boolean' && typeof a.handoffMarked === 'boolean' && typeof a.workspacePrepared === 'boolean' &&
    (a.startedAt === undefined || date(a.startedAt)) && (a.endedAt === undefined || date(a.endedAt)));
  requireMatch(j.latestAttemptId ? isId(j.latestAttemptId) && j.attempts.some(a => a.id === j.latestAttemptId) : j.state === 'queued' || j.state === 'failed');
  if (j.state === 'succeeded') requireMatch(isId(j.replyVersionId) && !!j.latestAttemptId);
  if (expected) {
    const input = expected.input;
    requireMatch(j.idempotencyKey === input.idempotencyKey && c.intent === input.intent && c.question === input.question && c.parentReplyId === input.parentReplyId);
    requireMatch(input.readerSkill ? input.intent === 'unsure' && c.readerSkill?.execution === 'requested' && sameData(input.readerSkill, { name: c.readerSkill.name, catalogRevision: c.readerSkill.catalogRevision }) : !c.readerSkill);
    if (expected.kind === 'retry') requireMatch(c.retryOfJobId === expected.retryOfJobId && !c.parentJobId && !c.parentAttemptId);
    if (expected.kind === 'followup') requireMatch(c.parentJobId === expected.parentJobId && (!c.parentAttemptId || c.parentAttemptId === expected.parentAttemptId));
    if (expected.kind === 'note-followup' || expected.kind === 'initial') requireMatch(!c.retryOfJobId && !c.parentJobId && !c.parentAttemptId);
  }
  if (preparation) requireMatch(j.preparedPayloadDigest === preparation.job.preparedPayloadDigest && j.provider === preparation.job.provider &&
    j.model === preparation.job.model && j.mode === preparation.job.mode && j.policyKey === preparation.job.policyKey);
}

/** Uses the shared browser validator injection, never an inferred seal or a duplicate reply schema. */
export function checkedCandidate(raw: unknown, b: AskingBinding, validate: AskingValidator, status: 'partial' | 'complete'): CandidateReply {
  const copy = hostCopy(raw);
  requireMatch(record(copy) && copy.status === status && copy.schema === 'marginalia.reply.v1');
  const result = validate(copy, { sourceText: b.sourceText });
  requireMatch(result && result.ok && result.value.status === status && sameData(result.value, copy));
  return hostCopy(result.value);
}

export function assertSavedReply(saved: SavedAskingReply, j: JobSnapshot, b: AskingBinding, validate: AskingValidator): CandidateReply {
  const r = saved?.reply, s = saved?.source;
  requireMatch(r && s && j.state === 'succeeded' && j.latestAttemptId && r.id === j.replyVersionId && r.threadId === b.threadId &&
    r.parentId === (j.context.parentReplyId ?? null) && !r.deletedAt && isDigest(r.hash) && Number.isSafeInteger(r.revision) && r.revision > 0 && date(r.createdAt) &&
    s.id === b.sourceVersionId && s.hash === b.sourceHash && s.text === b.sourceText && s.capturedAt === b.sourceCapturedAt && s.pageType === b.sourcePageType);
  const n = b.answeredNote;
  requireMatch(n ? r.answeredNote && r.answeredNote.noteId === n.noteId && r.answeredNote.revision === n.revision && r.answeredNote.text === n.text : !r.answeredNote);
  const reply = checkedCandidate(r.reply, b, validate, 'complete');
  requireMatch(j.context.readerSkill ? sameData(r.readerSkill, j.context.readerSkill) : !r.readerSkill);
  requireMatch(reply.intent === j.context.intent && r.validation?.schema === 'marginalia.host-report.v1' && r.validation.checkVersion === 'host-checks.v1' &&
    isDigest(r.validation.replyDigest) && r.validation.replyDigest === r.hash && isDigest(r.validation.parameterDigest) && Array.isArray(r.validation.results) && r.validation.results.length <= 64);
  // Check the report's transport shape, not the scientific truth or headline authority it reports.
  requireMatch(r.validation.results.every(result => record(result) && text(result.requestId, 100) && text(result.criterion, 100) &&
    text(result.model, 100) && text(result.classification, 100) && ['pass', 'fail', 'unsupported'].includes(result.status) &&
    text(result.reason, 4000, true) && (result.headline === undefined || text(result.headline, 4000, true))));
  if (saved.view) requireMatch(saved.view.replyVersionId === r.id && Number.isSafeInteger(saved.view.revision) && saved.view.revision >= 0 &&
    record(saved.view.parameters) && Object.values(saved.view.parameters).every(x => typeof x === 'number' && Number.isFinite(x)) && record(saved.view.view));
  return reply;
}
