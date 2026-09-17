import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildProviderPacket } from '../daemon/jobs/packet.ts';
import { fitOutgoingPacket, OUTGOING_PREVIEW_BYTES, prefixCharacters, suffixCharacters, utf8Prefix } from '../daemon/jobs/outgoing-budget.ts';
import { frozenFollowup } from '../daemon/jobs/followup-context.ts';
import type { JobSnapshot, StartJobInput, ProviderJobPacket } from '../contracts/jobs.ts';
import type { SourceVersion } from '../contracts/reader.ts';

const input: StartJobInput = { id: 'child', idempotencyKey: 'child-key', threadId: 'thread', intent: 'simulate', question: 'Why?',
  provider: 'app-server', model: 'test', mode: 'workspace-files', policyKey: 'a'.repeat(64), grantId: 'grant', preparedPayloadDigest: 'b'.repeat(64), capabilities: ['samples'] };
function packet(): ProviderJobPacket {
  return { schema: 'marginalia.job-packet.v1', intent: 'simulate', question: 'Explain precisely',
    source: { url: 'https://example.org', title: 'Source', pageType: null, capturedAt: null, sourceHash: 'hash', sourceVersionId: 'source' },
    selection: { exact: 'Passage', prefix: '', suffix: '', start: 3, end: 10, originalEnd: 10, omittedCharacters: 0 },
    adjacentContext: { before: '', after: '', basis: 'bounded-character-context' }, availableCapabilities: [], omissions: [] };
}
const bytes = (parts: readonly { text: string }[]) => parts.reduce((sum, part) => sum + Buffer.byteLength(part.text), 0);
// Measures actual serialization including escaping/duplication; no estimate substitutes for it.
const envelope = (p: ProviderJobPacket) => ({ outgoing: [{ text: JSON.stringify(p) }, { text: 'Instructions: ' + JSON.stringify(p) }, { text: 'schema'.repeat(1500) }] });

test('UTF-8 and UTF-16 coordinate bounds never introduce a split code point', () => {
  const text = 'A\u6f22\ud83d\ude42B';
  for (let n = 0; n <= 12; n++) {
    const s = utf8Prefix(text, n); assert.ok(Buffer.byteLength(s) <= n); assert.equal(Buffer.from(s).toString('utf8'), s);
    for (const t of [prefixCharacters(text, n), suffixCharacters(text, n)]) {
      assert.ok(t.length <= n); assert.equal(Buffer.from(t).toString('utf8'), t);
    }
  }
  assert.equal(suffixCharacters(text, 0), ''); assert.throws(() => utf8Prefix(text, -1));
});

test('complete duplicated UTF-8 envelope is deterministic, non-mutating and idempotently fitted', () => {
  for (const text of ['\u6f22'.repeat(6000), '\ud83d\ude42'.repeat(5000), '\u0000\n"\\'.repeat(3000)]) {
    const p = packet(); p.adjacentContext.before = text; p.adjacentContext.after = text;
    const before = structuredClone(p), a = fitOutgoingPacket(p, envelope), b = fitOutgoingPacket(p, envelope);
    assert.deepEqual(a, b); assert.deepEqual(p, before); assert.ok(bytes(a.prepared.outgoing) <= OUTGOING_PREVIEW_BYTES);
    assert.ok(OUTGOING_PREVIEW_BYTES < 64 * 1024); assert.ok(a.packet.omissions.some(v => v.startsWith('UTF-8 preview budget')));
    assert.deepEqual(fitOutgoingPacket(a.packet, envelope), a);
    assert.equal(a.packet.question, p.question); assert.deepEqual(a.packet.source, p.source);
  }
});

test('bounded parent/note/selection omissions retain essential context and exact totals', () => {
  const p = packet(); p.parentReply = { replyVersionId: 'reply', attribution: 'Prior generated work, not source evidence.', excerpt: '\u6f22'.repeat(4000), omittedBytes: 100 };
  p.answeredNote = { noteId: 'note', revision: 7, text: '\ud83d\ude42'.repeat(4000), originalCharacters: 8500, omittedCharacters: 500 };
  p.selection.exact = '\u6f22'.repeat(4000); p.selection.originalEnd = p.selection.end = 4003;
  const fitted = fitOutgoingPacket(p, envelope);
  assert.ok(bytes(fitted.prepared.outgoing) <= OUTGOING_PREVIEW_BYTES);
  assert.equal(fitted.packet.parentReply!.omittedBytes, 100 + Buffer.byteLength(p.parentReply.excerpt) - Buffer.byteLength(fitted.packet.parentReply!.excerpt));
  assert.equal(fitted.packet.answeredNote!.omittedCharacters, 8500 - fitted.packet.answeredNote!.text.length);
  assert.equal(fitted.packet.selection.omittedCharacters, 4003 - fitted.packet.selection.end);
  assert.ok(Buffer.byteLength(fitted.packet.parentReply!.excerpt) >= 510);
  assert.throws(() => fitOutgoingPacket(p, q => ({ outgoing: [{ text: 'x'.repeat(70_000) }, { text: JSON.stringify(q) }] })), /Nothing was prepared or sent/);
});

test('follow-up freezes parent source/note and attributes immutable reply without carrying an old provider lease on fork', () => {
  const p = packet(), text = JSON.stringify({ title: 'Parent', content: '\u6f22'.repeat(3000) });
  const parent = { id: 'parent', threadId: 'thread', state: 'succeeded', latestAttemptId: 'parent-attempt', replyVersionId: 'reply',
    context: { threadId: 'thread', sourceVersionId: 'old-source', sourceUrl: 'https://example.org', sourceTitle: 'Original', sourceHash: 'old-hash',
      sourceText: 'Original source only', passage: { exact: 'source', start: 9, end: 15, prefix: '', suffix: '' },
      answeredNote: { noteId: 'note', revision: 3, text: 'Original note' }, question: 'Old question', intent: 'simulate', outgoing: p,
      modelSettingsRevision: 1, modelCompatibilityKey: 'old', preparedPayloadDigest: 'old' } } as JobSnapshot;
  const before = structuredClone(parent);
  for (const resume of [true, false]) {
    const result = frozenFollowup(parent, { ...input, parentReplyId: 'reply' }, { settingsRevision: 9, compatibilityKey: 'new' }, 'reply', text, resume);
    assert.equal(result.sourceText, parent.context.sourceText); assert.equal(result.sourceVersionId, 'old-source'); assert.deepEqual(result.answeredNote, parent.context.answeredNote);
    assert.equal(result.question, 'Why?'); assert.deepEqual(result.outgoing.availableCapabilities, ['samples']);
    assert.equal(result.parentAttemptId, resume ? 'parent-attempt' : undefined); assert.equal(result.parentJobId, 'parent');
    assert.equal(result.outgoing.parentReply!.sha256, createHash('sha256').update(text).digest('hex'));
    assert.equal(result.outgoing.parentReply!.attribution, 'Prior generated work, not source evidence.');
    assert.equal(result.outgoing.parentReply!.omittedBytes, Buffer.byteLength(text) - Buffer.byteLength(result.outgoing.parentReply!.excerpt));
    assert.ok(Buffer.byteLength(result.outgoing.parentReply!.excerpt) <= 4000);
    result.answeredNote!.text = 'cannot mutate parent';
  }
  assert.deepEqual(parent, before);
  assert.throws(() => frozenFollowup(parent, { ...input, parentReplyId: 'other' }, { settingsRevision: 9, compatibilityKey: 'new' }, 'reply', text, true), /identity/);
});

test('packet uses recorded sections, reports legacy fallback, bounds Unicode and reports current capabilities', () => {
  const text = 'Before '.repeat(1000) + 'Selected' + '\ud83d\ude42'.repeat(9000);
  const source = { id: 'source', hash: 'hash', text, pageType: null, capturedAt: null,
    sections: [{ start: 0, end: 7000 }, { start: 7000, end: text.length }] } as SourceVersion;
  const anchor = { exact: 'Selected', start: 7000, end: 7008, prefix: '', suffix: '' };
  const p = buildProviderPacket(input, anchor, source, 'https://example.org', 'Source', { noteId: 'note', revision: 9, text: 'x'.repeat(3999) + '\ud83d\ude42' });
  assert.equal(p.adjacentContext.basis, 'section-adjacent-context'); assert.ok(p.adjacentContext.before.length + p.adjacentContext.after.length <= 12000);
  assert.equal(p.answeredNote!.text.length, 3999); assert.equal(p.answeredNote!.omittedCharacters, 2); assert.deepEqual(p.availableCapabilities, ['samples']);
  assert.equal(Buffer.from(p.adjacentContext.after).toString('utf8'), p.adjacentContext.after);
  const fallback = buildProviderPacket(input, anchor, { ...source, sections: [] }, 'https://example.org', 'Source');
  assert.equal(fallback.adjacentContext.basis, 'bounded-character-context'); assert.ok(fallback.omissions.some(x => x.includes('Section boundaries')));
});
