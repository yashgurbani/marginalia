import type { QuoteAnchor, ThreadState } from '../contracts/reader.ts';

export type ShareRecord = {
  schema: 'marginalia.share.v1';
  source: { url: string; hash: string; versionId: string; title: string };
  thread: { id: string; state: ThreadState; anchor: QuoteAnchor; highlighted: boolean };
  notes: Array<{ id: string; revision: number; text: string; createdAt: string }>;
  replies: Array<{ id: string; title: string; text: string; createdAt: string }>;
};

const MAX_RECORD_BYTES = 196 * 1024;
const MAX_RENDER_BYTES = 256 * 1024;
const MAX_ID_BYTES = 100;
const MAX_URL_BYTES = 8_000;
const MAX_TITLE_BYTES = 1_000;
const MAX_HASH_BYTES = 512;
const MAX_VERSION_BYTES = 512;
const MAX_DATE_BYTES = 128;
const MAX_ANCHOR_EXACT_BYTES = 16_000;
const MAX_ANCHOR_CONTEXT_BYTES = 256;
const MAX_NOTE_BYTES = 4_096;
const MAX_REPLY_BYTES = 8_192;
const MAX_NOTES = 12;
const MAX_REPLIES = 12;

const REPLY_OMISSION = '[Some saved reply content was omitted from this local copy because it is not plain text.]';
const REPLY_EMPTY = '[This saved reply has no plain-text block to include in the local copy.]';

type RecordLike = Record<string, unknown>;

export function shareRecord(exported: unknown): ShareRecord {
  const root = asRecord(exported, 'The saved thread export is unavailable.');
  const rawThread = asRecord(root.thread, 'The saved thread is unavailable.');
  const rawSource = asRecord(root.source, 'The saved source is unavailable.');
  if (rawThread.deletedAt !== undefined && rawThread.deletedAt !== null) throw new Error('This thread is unavailable.');

  const state = threadState(rawThread.state);
  const sourceUrl = sourceString(rawThread.sourceUrl, rawSource.url, 'The saved source URL is unavailable.');
  validateSourceUrl(sourceUrl);
  const sourceTitle = boundedString(sourceString(rawThread.sourceTitle, rawSource.title, 'The saved source title is unavailable.'), MAX_TITLE_BYTES, 'source title');
  const sourceHash = boundedString(stringValue(rawSource.hash, 'source hash'), MAX_HASH_BYTES, 'source hash');
  const threadVersionId = optionalString(rawThread.sourceVersionId);
  const sourceVersionId = optionalString(rawSource.id);
  if (threadVersionId && sourceVersionId && threadVersionId !== sourceVersionId) throw new Error('The saved source version does not match the thread.');
  const versionId = boundedString(threadVersionId ?? sourceVersionId ?? fail('source version id'), MAX_VERSION_BYTES, 'source version id');

  const threadId = boundedString(stringValue(rawThread.id, 'thread id'), MAX_ID_BYTES, 'thread id');
  const highlighted = rawThread.highlighted;
  if (typeof highlighted !== 'boolean') throw new Error('The saved highlight state is invalid.');

  const record: ShareRecord = {
    schema: 'marginalia.share.v1',
    source: { url: sourceUrl, hash: sourceHash, versionId, title: sourceTitle },
    thread: { id: threadId, state, anchor: shareAnchor(rawThread.anchor), highlighted },
    notes: shareNotes(rawThread.notes),
    replies: shareReplies(root.replies),
  };
  if (byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES) throw new Error('This local copy is too large.');
  return record;
}

export function renderShareMarkdown(record: ShareRecord): string {
  const fence = markdownFence([
    record.thread.anchor.exact, record.thread.anchor.prefix, record.thread.anchor.suffix,
    ...record.notes.map(note => note.text), ...record.replies.map(reply => reply.text),
  ]);
  const lines = [
    `# ${markdownInline(record.source.title)}`,
    '',
    `Source URL: ${record.source.url}`,
    `Source version: ${markdownInline(record.source.versionId)}`,
    `Source hash: ${markdownInline(record.source.hash)}`,
    `Thread: ${markdownInline(record.thread.id)}`,
    `State: ${record.thread.state}`,
    `Highlighted: ${record.thread.highlighted ? 'yes' : 'no'}`,
    '',
    '## Anchor',
    '',
    `Kind: ${record.thread.anchor.kind ?? 'quote'}`,
    `Start: ${record.thread.anchor.start}`,
    `End: ${record.thread.anchor.end}`,
    '',
    'Prefix:',
    fence,
    record.thread.anchor.prefix,
    fence,
    '',
    'Quote:',
    fence,
    record.thread.anchor.exact,
    fence,
    '',
    'Suffix:',
    fence,
    record.thread.anchor.suffix,
    fence,
    '',
    '## Notes',
    '',
  ];
  if (!record.notes.length) lines.push('_No reader notes were saved._', '');
  for (const note of record.notes) {
    lines.push(`### Note ${markdownInline(note.id)}`, '', `Revision: ${note.revision}`, `Created: ${markdownInline(note.createdAt)}`, '', fence, note.text, fence, '');
  }
  lines.push('## Replies', '');
  if (!record.replies.length) lines.push('_No saved replies were retained._', '');
  for (const reply of record.replies) {
    lines.push(`### ${markdownInline(reply.title)}`, '', `Reply: ${markdownInline(reply.id)}`, `Created: ${markdownInline(reply.createdAt)}`, '', fence, reply.text, fence, '');
  }
  return boundedRendered(lines.join('\n').replace(/\n+$/, '\n'));
}

export function renderShareHtml(record: ShareRecord): string {
  const e = escapeHtml;
  const anchor = record.thread.anchor;
  const noteMarkup = record.notes.length
    ? record.notes.map(note => `<article><h3>${e(note.id)}</h3><p>Revision ${note.revision}. Created ${e(note.createdAt)}</p><pre>${e(note.text)}</pre></article>`).join('')
    : '<p>No reader notes were saved.</p>';
  const replyMarkup = record.replies.length
    ? record.replies.map(reply => `<article><h3>${e(reply.title)}</h3><p>Reply ${e(reply.id)}. Created ${e(reply.createdAt)}</p><pre>${e(reply.text)}</pre></article>`).join('')
    : '<p>No saved replies were retained.</p>';
  const output = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${e(record.source.title)} · Marginalia thread</title>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${e(record.source.title)}</h1>`,
    `<p>Source: <a href="${e(record.source.url)}">${e(record.source.url)}</a></p>`,
    `<p>Source version: ${e(record.source.versionId)}<br>Source hash: ${e(record.source.hash)}</p>`,
    `<p>Thread: ${e(record.thread.id)}<br>State: ${e(record.thread.state)}<br>Highlighted: ${record.thread.highlighted ? 'yes' : 'no'}</p>`,
    '<section>',
    '<h2>Anchor</h2>',
    `<p>Kind: ${e(anchor.kind ?? 'quote')}<br>Start: ${anchor.start}<br>End: ${anchor.end}</p>`,
    `<h3>Prefix</h3><pre>${e(anchor.prefix)}</pre>`,
    '<h3>Quote</h3>',
    `<blockquote><pre>${e(anchor.exact)}</pre></blockquote>`,
    `<h3>Suffix</h3><pre>${e(anchor.suffix)}</pre>`,
    '</section>',
    '<section>',
    '<h2>Notes</h2>',
    noteMarkup,
    '</section>',
    '<section>',
    '<h2>Replies</h2>',
    replyMarkup,
    '</section>',
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return boundedRendered(output);
}

export function renderShareText(record: ShareRecord): string {
  const anchor = record.thread.anchor;
  const lines = [
    'Marginalia thread copy',
    `Source title: ${record.source.title}`,
    `Source URL: ${record.source.url}`,
    `Source version: ${record.source.versionId}`,
    `Source hash: ${record.source.hash}`,
    `Thread: ${record.thread.id}`,
    `State: ${record.thread.state}`,
    `Highlighted: ${record.thread.highlighted ? 'yes' : 'no'}`,
    '',
    'Anchor',
    `Kind: ${anchor.kind ?? 'quote'}`,
    `Start: ${anchor.start}`,
    `End: ${anchor.end}`,
    `Prefix: ${anchor.prefix}`,
    `Quote: ${anchor.exact}`,
    `Suffix: ${anchor.suffix}`,
    '',
    'Notes',
  ];
  if (!record.notes.length) lines.push('No reader notes were saved.');
  for (const note of record.notes) lines.push(`Note ${note.id} (revision ${note.revision}, created ${note.createdAt}):`, note.text, '');
  lines.push('Replies');
  if (!record.replies.length) lines.push('No saved replies were retained.');
  for (const reply of record.replies) lines.push(`${reply.title} [${reply.id}, created ${reply.createdAt}]:`, reply.text, '');
  return boundedRendered(lines.join('\n').replace(/\n+$/, '\n'));
}

function shareAnchor(value: unknown): QuoteAnchor {
  const anchor = asRecord(value, 'The saved passage anchor is unavailable.');
  const kind = anchor.kind;
  if (kind !== undefined && kind !== 'quote' && kind !== 'section' && kind !== 'whole-page') throw new Error('The saved passage anchor is invalid.');
  const exact = boundedString(stringValue(anchor.exact, 'anchor quote'), MAX_ANCHOR_EXACT_BYTES, 'anchor quote');
  const prefix = boundedString(stringValue(anchor.prefix, 'anchor prefix'), MAX_ANCHOR_CONTEXT_BYTES, 'anchor prefix');
  const suffix = boundedString(stringValue(anchor.suffix, 'anchor suffix'), MAX_ANCHOR_CONTEXT_BYTES, 'anchor suffix');
  const start = safeInteger(anchor.start, 'anchor start'), end = safeInteger(anchor.end, 'anchor end');
  if (start < 0 || end < start) throw new Error('The saved passage anchor is invalid.');
  if (kind === 'whole-page' && (exact || prefix || suffix || start !== 0 || end !== 0)) throw new Error('The saved passage anchor is invalid.');
  if (kind !== 'whole-page' && end - start !== exact.length) throw new Error('The saved passage anchor is invalid.');
  return { ...(kind === undefined ? {} : { kind }), exact, prefix, suffix, start, end };
}

function shareNotes(value: unknown): ShareRecord['notes'] {
  if (!Array.isArray(value)) return [];
  const notes: ShareRecord['notes'] = [];
  for (const candidate of value) {
    if (notes.length >= MAX_NOTES) break;
    const note = asOptionalRecord(candidate);
    if (!note || note.deletedAt !== undefined && note.deletedAt !== null) continue;
    if (typeof note.id !== 'string' || typeof note.text !== 'string' || typeof note.createdAt !== 'string' || typeof note.revision !== 'number' || !Number.isSafeInteger(note.revision) || note.revision < 0) continue;
    notes.push({ id: boundedString(note.id, MAX_ID_BYTES, 'note id'), revision: note.revision, text: boundedText(note.text, MAX_NOTE_BYTES), createdAt: boundedString(note.createdAt, MAX_DATE_BYTES, 'note date') });
  }
  return notes;
}

function shareReplies(value: unknown): ShareRecord['replies'] {
  if (!Array.isArray(value)) return [];
  const replies: ShareRecord['replies'] = [];
  for (const candidate of value) {
    if (replies.length >= MAX_REPLIES) break;
    const version = asOptionalRecord(candidate);
    if (!version || version.deletedAt !== undefined && version.deletedAt !== null) continue;
    const reply = asOptionalRecord(version.reply);
    if (!reply || typeof version.id !== 'string' || typeof version.createdAt !== 'string' || typeof reply.title !== 'string') continue;
    const blocks = Array.isArray(reply.blocks) ? reply.blocks : [];
    const textBlocks: string[] = [];
    let omitted = false;
    for (const candidateBlock of blocks) {
      const block = asOptionalRecord(candidateBlock);
      if (block?.type === 'text' && typeof block.md === 'string') textBlocks.push(block.md);
      else omitted = true;
    }
    let text = textBlocks.join('\n\n');
    if (omitted) text = text ? `${text}\n\n${REPLY_OMISSION}` : REPLY_OMISSION;
    if (!text) text = REPLY_EMPTY;
    replies.push({ id: boundedString(version.id, MAX_ID_BYTES, 'reply id'), title: boundedString(reply.title, MAX_TITLE_BYTES, 'reply title'), text: boundedText(text, MAX_REPLY_BYTES), createdAt: boundedString(version.createdAt, MAX_DATE_BYTES, 'reply date') });
  }
  return replies;
}

function sourceString(primary: unknown, fallback: unknown, message: string): string {
  if (typeof primary === 'string') return boundedString(primary, MAX_URL_BYTES, 'source URL');
  if (typeof fallback === 'string') return boundedString(fallback, MAX_URL_BYTES, 'source URL');
  return fail(message);
}

function validateSourceUrl(value: string): void {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('The saved source URL is invalid.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('The saved source URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('The saved source URL is invalid.');
}

function threadState(value: unknown): ThreadState {
  if (value === 'open' || value === 'parked' || value === 'done' || value === 'archived') return value;
  throw new Error('The saved thread state is invalid.');
}

function boundedText(value: string, limit: number): string {
  if (byteLength(value) <= limit) return value;
  const suffix = '\n[Local copy shortened to preserve its size.]';
  const target = Math.max(0, limit - byteLength(suffix));
  let result = '';
  for (const character of value) {
    if (byteLength(result + character) > target) break;
    result += character;
  }
  return result + suffix;
}

function boundedString(value: string, limit: number, label: string): string {
  if (byteLength(value) > limit) throw new Error(`The saved ${label} is too large.`);
  if (/\u0000/.test(value)) throw new Error(`The saved ${label} is invalid.`);
  return value;
}

function markdownFence(values: string[]): string {
  let ticks = 0, tildes = 0;
  for (const value of values) {
    for (const match of value.matchAll(/`+/g)) ticks = Math.max(ticks, match[0].length);
    for (const match of value.matchAll(/~+/g)) tildes = Math.max(tildes, match[0].length);
  }
  const character = ticks <= tildes ? '`' : '~';
  return character.repeat(Math.max(3, (character === '`' ? ticks : tildes) + 1));
}

function markdownInline(value: string): string {
  return value.replace(/[\\`*_[\]{}()#+\-.!|<>]/g, character => `\\${character}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function boundedRendered(value: string): string {
  if (byteLength(value) > MAX_RENDER_BYTES) throw new Error('This local copy is too large.');
  return value;
}

function asRecord(value: unknown, message: string): RecordLike {
  const result = asOptionalRecord(value);
  if (!result) throw new Error(message);
  return result;
}

function asOptionalRecord(value: unknown): RecordLike | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : undefined;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`The saved ${label} is unavailable.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`The saved ${label} is invalid.`);
  return value as number;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function fail(message: string): never {
  throw new Error(`The saved ${message} is unavailable.`);
}
