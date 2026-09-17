import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { attachQuote, type ReaderMutation, type Thread, type Note, type QuoteAnchor } from '../contracts/reader.ts';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class ConflictError extends Error {}
export class ReaderStore {
  db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, title TEXT NOT NULL, pageType TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_versions(id TEXT PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES sources(id), hash TEXT NOT NULL, text TEXT NOT NULL, capturedAt TEXT NOT NULL, extractionVersion TEXT NOT NULL, UNIQUE(sourceId,hash,extractionVersion));
      CREATE TABLE IF NOT EXISTS anchors(id TEXT PRIMARY KEY, sourceVersionId TEXT NOT NULL REFERENCES source_versions(id), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, anchorId TEXT NOT NULL REFERENCES anchors(id), targetVersionId TEXT NOT NULL, tabCapture TEXT NOT NULL, state TEXT NOT NULL, candidates TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY, anchorId TEXT NOT NULL REFERENCES anchors(id), state TEXT NOT NULL DEFAULT 'open', revision INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, deletedAt TEXT);
      CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id), text TEXT NOT NULL, revision INTEGER NOT NULL, createdAt TEXT NOT NULL, deletedAt TEXT);
      CREATE TABLE IF NOT EXISTS note_versions(noteId TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL, PRIMARY KEY(noteId,revision));
      CREATE TABLE IF NOT EXISTS highlights(id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id), createdAt TEXT NOT NULL, deletedAt TEXT);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mutation_receipts(id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, site TEXT NOT NULL, scope TEXT NOT NULL, recipient TEXT NOT NULL, decision TEXT NOT NULL, createdAt TEXT NOT NULL, revokedAt TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vocabulary(term TEXT PRIMARY KEY, origin TEXT NOT NULL, status TEXT NOT NULL, firstSeen TEXT NOT NULL, lastSeen TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(entityId UNINDEXED, kind UNINDEXED, content);
      INSERT OR IGNORE INTO migrations(version) VALUES(1);
    `);
  }
  close() { this.db.close(); }
  private event(kind: string, value: unknown) {
    this.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)').run(kind, JSON.stringify(value), new Date().toISOString());
  }
  apply(mutation: ReaderMutation): { threadId: string; revision: number } {
    validateMutation(mutation);
    const fingerprint = digest(JSON.stringify(mutation));
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT digest,result FROM mutation_receipts WHERE id=?').get(mutation.id) as { digest: string; result: string } | undefined;
      if (previous) {
        if (previous.digest !== fingerprint) throw new ConflictError('This change identifier was already used for different content.');
        return JSON.parse(previous.result) as { threadId: string; revision: number };
      }
      const now = new Date().toISOString();
      if (mutation.kind === 'keep') {
        const { capture, anchor } = mutation;
        if (capture.text.slice(anchor.start, anchor.end) !== anchor.exact) throw new Error('The selected passage does not match the captured page.');
        const sourceId = digest(capture.url);
        const hash = digest(capture.text);
        const versionId = digest(sourceId + hash + capture.extractionVersion);
        this.db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?,?)').run(sourceId, capture.url, capture.title, capture.pageType);
        this.db.prepare('INSERT OR IGNORE INTO source_versions VALUES(?,?,?,?,?,?)').run(versionId, sourceId, hash, capture.text, capture.capturedAt, capture.extractionVersion);
        const anchorId = randomUUID();
        this.db.prepare('INSERT INTO anchors VALUES(?,?,?)').run(anchorId, versionId, JSON.stringify(anchor));
        this.db.prepare('INSERT INTO threads(id,anchorId,createdAt,updatedAt) VALUES(?,?,?,?)').run(mutation.threadId, anchorId, now, now);
        this.db.prepare('INSERT INTO highlights VALUES(?,?,?,NULL)').run(randomUUID(), mutation.threadId, now);
        if (mutation.note) this.writeNote(mutation.id + '-note', mutation.threadId, mutation.note, 0, now);
        this.db.prepare('INSERT INTO search(entityId,kind,content) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM search WHERE entityId=?)').run(versionId, 'source', capture.text, versionId);
      } else {
        const thread = this.get(mutation.threadId);
        if (!thread) throw new Error('This thread is unavailable.');
        if (mutation.kind === 'note') {
          if (thread.deletedAt) throw new ConflictError('Restore the thread before editing it.');
          this.writeNote(mutation.noteId, mutation.threadId, mutation.text, mutation.expectedRevision, now);
        } else {
          if (thread.revision !== mutation.expectedRevision) throw new ConflictError('This thread changed elsewhere. Review the saved version before applying your change.');
          if (mutation.kind === 'thread-state') this.db.prepare('UPDATE threads SET state=? WHERE id=?').run(mutation.state, mutation.threadId);
          else this.db.prepare('UPDATE threads SET deletedAt=? WHERE id=?').run(mutation.removed ? now : null, mutation.threadId);
        }
        this.db.prepare('UPDATE threads SET revision=revision+1,updatedAt=? WHERE id=?').run(now, mutation.threadId);
      }
      const result = { threadId: mutation.threadId, revision: this.get(mutation.threadId)!.revision };
      this.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?)').run(mutation.id, fingerprint, JSON.stringify(result));
      this.event('reader-changed', result);
      return result;
    })();
  }
  private writeNote(id: string, threadId: string, text: string, expectedRevision: number, now: string) {
    const current = this.db.prepare('SELECT * FROM notes WHERE id=?').get(id) as Note | undefined;
    if ((current && current.threadId !== threadId) || (current?.revision ?? 0) !== expectedRevision) throw new ConflictError('This note changed elsewhere. Your draft has been preserved.');
    const revision = expectedRevision + 1;
    this.db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET text=excluded.text, revision=excluded.revision').run(id, threadId, text, revision, now);
    this.db.prepare('INSERT INTO note_versions VALUES(?,?,?,?)').run(id, revision, text, now);
    this.db.prepare('DELETE FROM search WHERE entityId=?').run(id);
    this.db.prepare('INSERT INTO search(entityId,kind,content) VALUES(?,?,?)').run(id, 'note', text);
  }
  get(id: string): Thread | undefined {
    const row = this.db.prepare(`SELECT t.*, a.sourceVersionId, a.json, s.url as sourceUrl, s.title as sourceTitle FROM threads t JOIN anchors a ON a.id=t.anchorId JOIN source_versions v ON v.id=a.sourceVersionId JOIN sources s ON s.id=v.sourceId WHERE t.id=?`).get(id) as (Omit<Thread, 'anchor' | 'notes' | 'highlighted'> & { json: string }) | undefined;
    if (!row) return;
    const { json, ...thread } = row;
    return { ...thread, anchor: JSON.parse(json) as QuoteAnchor, notes: this.db.prepare('SELECT * FROM notes WHERE threadId=? ORDER BY createdAt,id').all(id) as Note[], highlighted: !!this.db.prepare('SELECT 1 FROM highlights WHERE threadId=? AND deletedAt IS NULL').get(id) };
  }
  list(url?: string, includeRemoved = false): Thread[] {
    const ids = this.db.prepare('SELECT id FROM threads ORDER BY createdAt,id').all() as { id: string }[];
    return ids.map(({ id }) => this.get(id)!).filter(t => (!url || t.sourceUrl === url) && (includeRemoved || !t.deletedAt)).sort((a, b) => a.anchor.start - b.anchor.start || a.createdAt.localeCompare(b.createdAt));
  }
  reattach(threadId: string, text: string, tabCapture: string) {
    const thread = this.get(threadId);
    if (!thread) throw new Error('This thread is unavailable.');
    const result = attachQuote(thread.anchor, text);
    const targetVersionId = digest(text);
    this.db.prepare('INSERT OR REPLACE INTO attachments VALUES(?,?,?,?,?,?)').run(digest(thread.anchorId + targetVersionId + tabCapture), thread.anchorId, targetVersionId, tabCapture, result.state, JSON.stringify(result.candidates));
    return result;
  }
  events(after = 0) { return this.db.prepare('SELECT seq,kind,payload,createdAt FROM events WHERE seq>? ORDER BY seq LIMIT 1000').all(after); }
  exportThread(id: string) {
    const thread = this.get(id);
    if (!thread) throw new Error('This thread is unavailable.');
    const source = this.db.prepare('SELECT * FROM source_versions WHERE id=?').get(thread.sourceVersionId);
    const noteVersions = this.db.prepare('SELECT v.* FROM note_versions v JOIN notes n ON n.id=v.noteId WHERE n.threadId=? ORDER BY v.noteId,v.revision').all(id);
    return { schema: 'marginalia.thread.v1', thread, source, noteVersions };
  }
}

function validateMutation(m: ReaderMutation) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.threadId !== 'string' || !/^[\w-]{1,100}$/.test(m.id) || !/^[\w-]{1,100}$/.test(m.threadId)) throw new Error('Invalid change identifier.');
  if (m.kind === 'keep') {
    const c = m.capture, a = m.anchor;
    if (!c || !a || typeof c.url !== 'string' || !/^https?:$/.test(new URL(c.url).protocol) || new URL(c.url).username || new URL(c.url).password || typeof c.text !== 'string' || c.text.length > 1000000 || typeof c.title !== 'string' || c.title.length > 1000 || typeof c.pageType !== 'string' || typeof c.extractionVersion !== 'string' || c.extractionVersion.length > 100 || !Number.isFinite(Date.parse(c.capturedAt))) throw new Error('Invalid source capture.');
    if (typeof a.exact !== 'string' || !a.exact.length || a.exact.length > 16000 || typeof a.prefix !== 'string' || typeof a.suffix !== 'string' || a.prefix.length > 256 || a.suffix.length > 256 || !Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start < 0 || a.end < a.start || a.end > c.text.length) throw new Error('Invalid passage attachment.');
    if (m.note !== undefined && (typeof m.note !== 'string' || m.note.length > 20000)) throw new Error('Note is too large.');
  } else {
    if (!Number.isInteger(m.expectedRevision) || m.expectedRevision < 0) throw new Error('Invalid revision.');
    if (m.kind === 'note') {
      if (typeof m.text !== 'string' || m.text.length > 20000 || typeof m.noteId !== 'string' || !/^[\w-]{1,100}$/.test(m.noteId)) throw new Error('Invalid note.');
    } else if (m.kind === 'thread-state') {
      if (!['open', 'parked', 'done', 'archived'].includes(m.state)) throw new Error('Invalid thread state.');
    } else if (m.kind === 'remove') { if (typeof m.removed !== 'boolean') throw new Error('Invalid removal.'); }
    else throw new Error('Unknown reader change.');
  }
}
