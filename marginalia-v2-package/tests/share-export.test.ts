import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShareHtml, renderShareMarkdown, renderShareText, shareRecord, type ShareRecord } from '../daemon/share.ts';
import { createShareRoutes } from '../daemon/routes/share.ts';
import type { ReaderStore } from '../daemon/store.ts';

const hostileQuote = '<script>window.pwned()</script> & ``` markdown ``` \u202e hidden';
const source = {
  id: 'source-version-1', hash: 'source-hash-123', text: `CAPTURED BODY SHOULD NEVER APPEAR\n${hostileQuote}`,
  title: 'A source <title>',
};
const thread = {
  id: 'thread-1', sourceVersionId: 'source-version-1', sourceUrl: 'https://example.test/read?q=1&x=2', sourceTitle: 'A source <title>',
  state: 'parked', highlighted: true, anchor: { kind: 'quote', exact: hostileQuote, prefix: 'before & ', suffix: ' after <tag>', start: 10, end: 10 + hostileQuote.length },
  notes: [{ id: 'note-1', revision: 2, text: 'Reader note & <b>literal</b> ```\nline two\u0007', createdAt: '2026-09-18T12:00:00.000Z', deletedAt: null },
    { id: 'removed-note', revision: 1, text: 'must not be exported', createdAt: '2026-09-18T12:01:00.000Z', deletedAt: '2026-09-18T12:02:00.000Z' }],
  deletedAt: null,
};
const exported = {
  schema: 'marginalia.thread.v1', thread, source, noteVersions: [{ text: 'history must not be exported' }], attachments: [{ tabCapture: 'private path' }],
  targetVersions: [{ text: 'target source must not be exported' }], execution: { token: 'SECRET', jobs: [{ provider: 'private' }] }, replyViews: [{ view: { secret: true } }],
  replies: [
    { id: 'reply-1', createdAt: '2026-09-18T12:03:00.000Z', deletedAt: null, reply: { title: 'Reply <one>', blocks: [{ id: 'text-1', type: 'text', md: 'Saved reply & <script>literal</script>\n``` fence' }, { id: 'model', type: 'model', state: ['secret'] }] } },
    { id: 'removed-reply', createdAt: '2026-09-18T12:04:00.000Z', deletedAt: '2026-09-18T12:05:00.000Z', reply: { title: 'Removed', blocks: [{ type: 'text', md: 'removed' }] } },
  ],
};

test('shareRecord keeps source identity, anchor, current notes and supported reply text only', () => {
  const record = shareRecord(exported);
  assert.deepEqual(record.source, { url: thread.sourceUrl, hash: source.hash, versionId: source.id, title: thread.sourceTitle });
  assert.deepEqual(record.thread, { id: thread.id, state: thread.state, anchor: thread.anchor, highlighted: true });
  assert.deepEqual(record.notes, [{ id: 'note-1', revision: 2, text: thread.notes[0].text, createdAt: thread.notes[0].createdAt }]);
  assert.equal(record.replies.length, 1);
  assert.equal(record.replies[0].id, 'reply-1');
  assert.match(record.replies[0].text, /Saved reply/);
  assert.match(record.replies[0].text, /omitted from this local copy/);
  assert.doesNotMatch(JSON.stringify(record), /CAPTURED BODY|history must not|target source|SECRET|private path|provider/);
  assert.doesNotMatch(JSON.stringify(record), /execution|attachments|targetVersions|replyViews/);
});

test('all renderers preserve hostile data as data and HTML has no executable or remote surface', () => {
  const record = shareRecord(exported);
  const markdown = renderShareMarkdown(record), html = renderShareHtml(record), text = renderShareText(record);
  assert.match(markdown, /<script>window\.pwned\(\)<\/script>/);
  assert.match(text, /\u202e hidden/);
  assert.match(html, /&lt;script&gt;window\.pwned\(\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.test\/read\?q=1&amp;x=2"/);
  assert.doesNotMatch(html, /<script|on[a-z]+\s*=|<iframe|<form|<img|url\s*\(/i);
  assert.doesNotMatch(html, /CAPTURED BODY|SECRET|private path|target source/);
  assert.ok(Buffer.byteLength(markdown) < 256 * 1024);
  assert.ok(Buffer.byteLength(html) < 256 * 1024);
  assert.ok(Buffer.byteLength(text) < 256 * 1024);
});

test('shareRecord bounds hostile collections before rendering and rejects unsafe URLs', () => {
  const huge = structuredClone(exported) as unknown as {
    thread: { notes: Array<{ id: string; revision: number; text: string; createdAt: string; deletedAt: string | null }> };
    replies: unknown[];
  };
  huge.thread.notes = Array.from({ length: 100 }, (_, index) => ({ id: `n-${index}`, revision: 1, text: 'x'.repeat(100_000), createdAt: '2026-09-18', deletedAt: null }));
  huge.replies = Array.from({ length: 100 }, (_, index) => ({ id: `r-${index}`, createdAt: '2026-09-18', deletedAt: null, reply: { title: `Reply ${index}`, blocks: [{ type: 'text', md: 'y'.repeat(100_000) }] } }));
  const record = shareRecord(huge);
  assert.ok(Buffer.byteLength(JSON.stringify(record)) <= 196 * 1024);
  assert.ok(Buffer.byteLength(renderShareHtml(record)) <= 256 * 1024);
  assert.throws(() => shareRecord({ ...exported, thread: { ...thread, sourceUrl: 'javascript:alert(1)' } }), /URL is invalid/);
  assert.throws(() => shareRecord({ ...exported, thread: { ...thread, sourceUrl: 'https://user:pass@example.test/' } }), /URL is invalid/);
});

type FakeResponse = { statusCode?: number; headers: Record<string, unknown>; body?: string; setHeader(name: string, value: unknown): void; writeHead(status: number): void; end(body?: string): void };
function response(): FakeResponse {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, writeHead(status) { this.statusCode = status; }, end(body) { this.body = body; } };
}
function context(path: string, result: unknown, paired = true) {
  const output = response(), calls = { pairing: 0, exports: 0 };
  const route = createShareRoutes({ exportThread(id) { calls.exports++; assert.equal(id, 'thread-1'); return result as ReturnType<ReaderStore['exportThread']>; } });
  return { output, calls, route, context: { request: { method: 'GET' }, response: output, url: new URL(`http://127.0.0.1${path}`), requestOrigin: undefined, authOrigin: 'http://127.0.0.1', token: 'paired', principal: {} as never, requireCurrentPairing() { calls.pairing++; return paired; }, send(res: FakeResponse, status: number, body: unknown) { res.writeHead(status); res.end(JSON.stringify(body)); }, body: async () => ({}), emptyBody: async () => {} } };
}

test('share route delegates pairing, serves all content types, and never accepts POST', async () => {
  for (const [format, contentType] of [['markdown', 'text/markdown; charset=utf-8'], ['html', 'text/html; charset=utf-8'], ['text', 'text/plain; charset=utf-8']] as const) {
    const fixture = context(`/api/share/thread?thread=thread-1&format=${format}`, exported);
    assert.equal(await fixture.route(fixture.context as never), true);
    assert.equal(fixture.output.statusCode, 200);
    assert.equal(fixture.output.headers['content-type'], contentType);
    assert.equal(fixture.output.headers['cache-control'], 'no-store');
    assert.match(String(fixture.output.headers['content-disposition']), new RegExp(`attachment; filename="marginalia-thread-thread-1\\.${format}"`));
    assert.equal(fixture.calls.pairing, 1);
    assert.equal(fixture.calls.exports, 1);
    assert.ok(fixture.output.body);
  }
  const post = context('/api/share/thread?thread=thread-1&format=text', exported);
  post.context.request = { method: 'POST' };
  assert.equal(await post.route(post.context as never), true);
  assert.equal(post.output.statusCode, 405);
  assert.equal(post.calls.pairing, 0);
  assert.equal(post.calls.exports, 0);
});

test('share route rejects unpaired, unknown-format, missing and removed threads without reading them', async () => {
  const unpaired = context('/api/share/thread?thread=thread-1&format=text', exported, false);
  assert.equal(await unpaired.route(unpaired.context as never), true);
  assert.equal(unpaired.output.statusCode, 401);
  assert.equal(unpaired.calls.exports, 0);

  const unknown = context('/api/share/thread?thread=thread-1&format=json', exported);
  assert.equal(await unknown.route(unknown.context as never), true);
  assert.equal(unknown.output.statusCode, 400);
  assert.equal(unknown.calls.exports, 0);

  const missing = context('/api/share/thread?thread=thread-1&format=text', undefined);
  assert.equal(await missing.route(missing.context as never), true);
  assert.equal(missing.output.statusCode, 404);
  const removed = context('/api/share/thread?thread=thread-1&format=text', { ...exported, thread: { ...thread, deletedAt: '2026-09-18T12:06:00.000Z' } });
  assert.equal(await removed.route(removed.context as never), true);
  assert.equal(removed.output.statusCode, 404);
});

test('share renderers retain their exact public shape', () => {
  const record = shareRecord(exported);
  assert.equal(record.schema, 'marginalia.share.v1');
  assert.deepEqual(Object.keys(record).sort(), ['notes', 'replies', 'schema', 'source', 'thread']);
  assert.ok((record as ShareRecord).thread.anchor.exact.includes('```'));
});
