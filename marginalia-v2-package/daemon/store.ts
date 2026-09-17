import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { attachQuote, type ReaderMutation, type Thread, type Note, type QuoteAnchor, type SourceCapture, type SourceVersion, type SourceSection, type AttachmentRecord, type NoteVersionRef, type NoteVersion, type ReplyVersion, type ReplyViewState } from '../contracts/reader.ts';
import { canonicalReplyData, validateReply, type CandidateReply, type ReplyCapability } from '../contracts/reply.ts';
import { digestReply, runHostChecks } from '../contracts/host-checks.ts';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class ConflictError extends Error { override name = 'Conflict'; }
export class ReaderStore {
  db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = FULL');
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
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM migrations WHERE version=2').get()) return;
      this.db.exec(`
        ALTER TABLE source_versions ADD COLUMN title TEXT;
        ALTER TABLE source_versions ADD COLUMN pageType TEXT;
        ALTER TABLE source_versions ADD COLUMN metadataStatus TEXT NOT NULL DEFAULT 'legacy';
        ALTER TABLE attachments ADD COLUMN recordedAt TEXT;
        CREATE TABLE reply_versions(id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id), parentId TEXT REFERENCES reply_versions(id), supersedes TEXT REFERENCES reply_versions(id), json TEXT NOT NULL, hash TEXT NOT NULL, validation TEXT NOT NULL, answeredNote TEXT, createdAt TEXT NOT NULL, deletedAt TEXT, revision INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE reply_views(replyVersionId TEXT PRIMARY KEY REFERENCES reply_versions(id), parameters TEXT NOT NULL, view TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt TEXT NOT NULL);
        CREATE TRIGGER source_version_immutable BEFORE UPDATE ON source_versions BEGIN SELECT RAISE(ABORT, 'Source versions are immutable'); END;
        CREATE TRIGGER anchor_immutable BEFORE UPDATE ON anchors BEGIN SELECT RAISE(ABORT, 'Anchors are immutable'); END;
        CREATE TRIGGER note_version_immutable BEFORE UPDATE ON note_versions BEGIN SELECT RAISE(ABORT, 'Note versions are immutable'); END;
        CREATE TRIGGER reply_version_immutable BEFORE UPDATE OF threadId,parentId,supersedes,json,hash,validation,answeredNote,createdAt ON reply_versions BEGIN SELECT RAISE(ABORT, 'Reply versions are immutable'); END;
        INSERT INTO migrations(version) VALUES(2);
      `);
    })();
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=4').get()) {
      this.db.pragma('foreign_keys = OFF');
      try {
        this.db.transaction(() => {
          this.db.exec(`
            CREATE TABLE source_versions_v4(id TEXT PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES sources(id), hash TEXT NOT NULL, text TEXT NOT NULL, capturedAt TEXT NOT NULL, extractionVersion TEXT NOT NULL, title TEXT, pageType TEXT, metadataStatus TEXT NOT NULL DEFAULT 'legacy', sections TEXT NOT NULL DEFAULT '', UNIQUE(sourceId,hash,extractionVersion,sections));
            INSERT INTO source_versions_v4(id,sourceId,hash,text,capturedAt,extractionVersion,title,pageType,metadataStatus,sections)
              SELECT id,sourceId,hash,text,capturedAt,extractionVersion,title,pageType,metadataStatus,'' FROM source_versions;
            DROP TABLE source_versions;
            ALTER TABLE source_versions_v4 RENAME TO source_versions;
            CREATE TRIGGER source_version_immutable BEFORE UPDATE ON source_versions BEGIN SELECT RAISE(ABORT, 'Source versions are immutable'); END;
            INSERT INTO migrations(version) VALUES(4);
          `);
        })();
      } finally {
        this.db.pragma('foreign_keys = ON');
      }
    }
  }
  close() { this.db.close(); }
  private event(kind: string, value: unknown) {
    this.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)').run(kind, JSON.stringify(value), new Date().toISOString());
  }
  apply(mutation: ReaderMutation): { threadId: string; revision: number } {
    validateMutation(mutation);
    const fingerprint = digest(canonicalReplyData(JSON.parse(JSON.stringify(mutation))));
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT digest,result FROM mutation_receipts WHERE id=?').get(mutation.id) as { digest: string; result: string } | undefined;
      if (previous) {
        // Accept receipts made by v1, which hashed insertion-order JSON.
        if (previous.digest !== fingerprint && previous.digest !== digest(JSON.stringify(mutation))) throw new ConflictError('This change identifier was already used for different content.');
        return JSON.parse(previous.result) as { threadId: string; revision: number };
      }
      const now = new Date().toISOString();
      if (mutation.kind === 'keep') {
        const { capture, anchor } = mutation;
        if (this.get(mutation.threadId)) throw new ConflictError('This thread already exists. Review the saved version before applying your change.');
        if (capture.text.slice(anchor.start, anchor.end) !== anchor.exact) throw new Error('The selected passage does not match the captured page.');
        const versionId = this.captureVersion(capture);
        const anchorId = randomUUID();
        this.db.prepare('INSERT INTO anchors VALUES(?,?,?)').run(anchorId, versionId, JSON.stringify(anchor));
        this.db.prepare('INSERT INTO threads(id,anchorId,createdAt,updatedAt) VALUES(?,?,?,?)').run(mutation.threadId, anchorId, now, now);
        if (anchor.kind !== 'whole-page') this.db.prepare('INSERT INTO highlights VALUES(?,?,?,NULL)').run(randomUUID(), mutation.threadId, now);
        if (mutation.note) this.writeNote(mutation.id + '-note', mutation.threadId, mutation.note, 0, now);
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
  private captureVersion(capture: SourceCapture | { url: string; text: string }) {
    const provided = 'capturedAt' in capture;
    const sourceId = digest(capture.url), hash = digest(capture.text);
    const extractionVersion = provided ? capture.extractionVersion : '';
    const normalizedSections = provided && capture.sections?.length
      ? capture.sections.map(({ title, start, end }) => ({ title, start, end }))
      : [];
    const sections = normalizedSections.length ? JSON.stringify(normalizedSections) : '';
    const versionId = sections
      ? digest(canonicalReplyData(['source-version-sections-v1', sourceId, hash, extractionVersion, normalizedSections]))
      : digest(sourceId + hash + extractionVersion);
    if (provided) this.db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?,?)').run(sourceId, capture.url, capture.title, capture.pageType);
    this.db.prepare('INSERT OR IGNORE INTO source_versions(id,sourceId,hash,text,capturedAt,extractionVersion,title,pageType,metadataStatus,sections) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(versionId, sourceId, hash, capture.text, provided ? capture.capturedAt : '', extractionVersion, provided ? capture.title : null, provided ? capture.pageType : null, provided ? 'provided' : 'unavailable', sections);
    this.db.prepare('INSERT INTO search(entityId,kind,content) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM search WHERE entityId=? AND kind=?)').run(versionId, 'source', capture.text, versionId, 'source');
    return versionId;
  }
  sourceVersion(id: string): SourceVersion | undefined {
    const row = this.db.prepare('SELECT * FROM source_versions WHERE id=?').get(id) as (Omit<SourceVersion, 'sections'> & { sections: string }) | undefined;
    if (!row) return;
    const { sections, ...version } = row;
    return { ...version, capturedAt: version.capturedAt || null, extractionVersion: version.extractionVersion || null, ...(sections ? { sections: JSON.parse(sections) as SourceSection[] } : {}) };
  }
  noteVersion(ref: NoteVersionRef): NoteVersion | undefined {
    return this.db.prepare('SELECT * FROM note_versions WHERE noteId=? AND revision=?').get(ref.noteId, ref.revision) as NoteVersion | undefined;
  }
  private writeNote(id: string, threadId: string, text: string, expectedRevision: number, now: string) {
    const current = this.db.prepare('SELECT * FROM notes WHERE id=?').get(id) as Note | undefined;
    if ((current && current.threadId !== threadId) || (current?.revision ?? 0) !== expectedRevision) throw new ConflictError('This note changed elsewhere. Your draft has been preserved.');
    const revision = expectedRevision + 1;
    this.db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET text=excluded.text, revision=excluded.revision').run(id, threadId, text, revision, now);
    this.db.prepare('INSERT INTO note_versions VALUES(?,?,?,?)').run(id, revision, text, now);
    this.db.prepare('DELETE FROM search WHERE entityId=? AND kind=?').run(id, 'note');
    this.db.prepare('INSERT INTO search(entityId,kind,content) VALUES(?,?,?)').run(id, 'note', text);
  }
  get(id: string): Thread | undefined {
    const row = this.db.prepare(`SELECT t.*, a.sourceVersionId, a.json, s.url as sourceUrl, COALESCE(v.title,s.title) as sourceTitle FROM threads t JOIN anchors a ON a.id=t.anchorId JOIN source_versions v ON v.id=a.sourceVersionId JOIN sources s ON s.id=v.sourceId WHERE t.id=?`).get(id) as (Omit<Thread, 'anchor' | 'notes' | 'highlighted'> & { json: string }) | undefined;
    if (!row) return;
    const { json, ...thread } = row;
    return { ...thread, anchor: JSON.parse(json) as QuoteAnchor, notes: this.db.prepare('SELECT * FROM notes WHERE threadId=? ORDER BY createdAt,id').all(id) as Note[], highlighted: !!this.db.prepare('SELECT 1 FROM highlights WHERE threadId=? AND deletedAt IS NULL').get(id) };
  }
  list(url?: string, includeRemoved = false): Thread[] {
    const ids = this.db.prepare('SELECT id FROM threads ORDER BY createdAt,id').all() as { id: string }[];
    return ids.map(({ id }) => this.get(id)!).filter(t => (!url || t.sourceUrl === url) && (includeRemoved || !t.deletedAt)).sort((a, b) => a.anchor.start - b.anchor.start || a.createdAt.localeCompare(b.createdAt));
  }
  reattach(threadId: string, text: string, tabCapture: string, capture?: SourceCapture) {
    const thread = this.get(threadId);
    if (!thread) throw new Error('This thread is unavailable.');
    if (typeof text !== 'string' || text.length > 1000000 || typeof tabCapture !== 'string' || !tabCapture.length || tabCapture.length > 200) throw new Error('Invalid attachment capture.');
    if (capture) {
      validateCapture(capture);
      if (capture.url !== thread.sourceUrl || capture.text !== text) throw new Error('The target capture does not match this source.');
    }
    return this.db.transaction(() => {
      const result = attachQuote(thread.anchor, text);
      const targetVersionId = this.captureVersion(capture ?? { url: thread.sourceUrl, text });
      const id = digest(canonicalReplyData([thread.anchorId, targetVersionId, tabCapture]));
      const inserted = this.db.prepare('INSERT OR IGNORE INTO attachments(id,anchorId,targetVersionId,tabCapture,state,candidates,recordedAt) VALUES(?,?,?,?,?,?,?)').run(id, thread.anchorId, targetVersionId, tabCapture, result.state, JSON.stringify(result.candidates), new Date().toISOString());
      if (inserted.changes) this.event('attachment-recorded', { threadId, attachmentId: id, targetVersionId, state: result.state });
      return result;
    })();
  }
  attachments(threadId: string): AttachmentRecord[] {
    const rows = this.db.prepare('SELECT a.*, v.id IS NOT NULL AS targetAvailable FROM attachments a JOIN threads t ON t.anchorId=a.anchorId LEFT JOIN source_versions v ON v.id=a.targetVersionId WHERE t.id=? ORDER BY a.recordedAt,a.id').all(threadId) as (Omit<AttachmentRecord, 'candidates' | 'targetAvailable'> & { candidates: string; targetAvailable: number })[];
    return rows.map(row => ({ ...row, candidates: JSON.parse(row.candidates), targetAvailable: !!row.targetAvailable }));
  }
  /** Host-only commit seam. Provider candidates cannot supply their own validation report. */
  commitReply(input: { id: string; threadId: string; reply: CandidateReply; parentId?: string; supersedes?: string; answeredNote?: NoteVersionRef }, capabilities: readonly ReplyCapability[] = []): ReplyVersion {
    validateId(input.id); validateId(input.threadId);
    return this.db.transaction(() => {
      const thread = this.get(input.threadId);
      if (!thread) throw new Error('This thread is unavailable.');
      const validated = validateReply(input.reply, { sourceText: this.sourceVersion(thread.sourceVersionId)!.text, capabilities });
      if (!validated.ok) throw new Error(validated.errors.join('\n'));
      const reply = validated.value;
      let answeredNote: NoteVersion | null = null;
      if (input.answeredNote) {
        const note = thread.notes.find(note => note.id === input.answeredNote!.noteId);
        answeredNote = this.noteVersion(input.answeredNote) ?? null;
        if (!note || !answeredNote) throw new Error('The answered note version is unavailable in this thread.');
      }
      const previous = this.reply(input.id);
      if (previous) {
        if (previous.threadId !== input.threadId || previous.hash !== digestReply(reply) || previous.parentId !== (input.parentId ?? null) || previous.supersedes !== (input.supersedes ?? null) || canonicalReplyData(previous.answeredNote) !== canonicalReplyData(answeredNote)) throw new ConflictError('This reply identifier already contains a different version.');
        return previous;
      }
      if (thread.deletedAt) throw new ConflictError('Restore the thread before adding a reply.');
      for (const ref of [input.parentId, input.supersedes]) {
        if (ref && this.reply(ref)?.threadId !== thread.id) throw new Error('A related reply must belong to this thread.');
      }
      const parameters = Object.fromEntries(reply.parameters.map(p => [p.name, p.default]));
      const validation = runHostChecks(reply, parameters);
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO reply_versions(id,threadId,parentId,supersedes,json,hash,validation,answeredNote,createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(input.id, thread.id, input.parentId ?? null, input.supersedes ?? null, canonicalReplyData(reply), digestReply(reply), JSON.stringify(validation), answeredNote ? JSON.stringify(answeredNote) : null, now);
      this.db.prepare('INSERT INTO reply_views VALUES(?,?,?,?,?)').run(input.id, JSON.stringify(parameters), '{}', 1, now);
      this.db.prepare('INSERT INTO search(entityId,kind,content) VALUES(?,?,?)').run(input.id, 'reply', [reply.title, reply.summary, reply.staticFallback].join('\n'));
      this.event('reply-committed', { threadId: thread.id, replyVersionId: input.id });
      return this.reply(input.id)!;
    })();
  }
  reply(id: string): ReplyVersion | undefined {
    const row = this.db.prepare('SELECT * FROM reply_versions WHERE id=?').get(id) as (Omit<ReplyVersion, 'reply' | 'validation' | 'answeredNote'> & { json: string; validation: string; answeredNote: string | null }) | undefined;
    if (!row) return;
    const { json, validation, answeredNote, ...record } = row;
    return { ...record, reply: JSON.parse(json), validation: JSON.parse(validation), answeredNote: answeredNote ? JSON.parse(answeredNote) : null };
  }
  replies(threadId: string, includeRemoved = false): ReplyVersion[] {
    const rows = this.db.prepare('SELECT id FROM reply_versions WHERE threadId=? ORDER BY createdAt,id').all(threadId) as { id: string }[];
    return rows.map(row => this.reply(row.id)!).filter(reply => includeRemoved || !reply.deletedAt);
  }
  setReplyRemoved(change: { id: string; replyVersionId: string; removed: boolean; expectedRevision: number }): ReplyVersion {
    validateId(change.id); validateId(change.replyVersionId); validateRevision(change.expectedRevision);
    if (typeof change.removed !== 'boolean') throw new Error('Invalid removal.');
    return this.recordChange('reply-removal', change, () => {
      const reply = this.reply(change.replyVersionId);
      if (!reply) throw new Error('This reply is unavailable.');
      if (reply.revision !== change.expectedRevision) throw new ConflictError('This reply changed elsewhere.');
      this.db.prepare('UPDATE reply_versions SET deletedAt=?,revision=revision+1 WHERE id=?').run(change.removed ? new Date().toISOString() : null, reply.id);
      this.event('reply-removed', { threadId: reply.threadId, replyVersionId: reply.id, removed: change.removed });
      return this.reply(reply.id)!;
    });
  }
  replyView(replyVersionId: string): ReplyViewState | undefined {
    const row = this.db.prepare('SELECT * FROM reply_views WHERE replyVersionId=?').get(replyVersionId) as (Omit<ReplyViewState, 'parameters' | 'view'> & { parameters: string; view: string }) | undefined;
    return row ? { ...row, parameters: JSON.parse(row.parameters), view: JSON.parse(row.view) } : undefined;
  }
  saveReplyView(change: { id: string; replyVersionId: string; expectedRevision: number; parameters: ReplyViewState['parameters']; view: ReplyViewState['view'] }): ReplyViewState {
    validateId(change.id); validateId(change.replyVersionId); validateRevision(change.expectedRevision);
    validateView(change.view);
    if (!change.parameters || typeof change.parameters !== 'object' || Array.isArray(change.parameters) || Object.keys(change.parameters).length > 32 || Object.values(change.parameters).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid current parameter values.');
    return this.recordChange('reply-view', change, () => {
      const reply = this.reply(change.replyVersionId), current = this.replyView(change.replyVersionId);
      if (!reply || !current) throw new Error('This reply is unavailable.');
      if (reply.deletedAt || this.get(reply.threadId)?.deletedAt) throw new ConflictError('Restore the reply and thread before changing the view.');
      if (current.revision !== change.expectedRevision) throw new ConflictError('This view changed elsewhere.');
      const declared = reply.reply.parameters;
      if (!change.parameters || typeof change.parameters !== 'object' || Array.isArray(change.parameters) || Object.keys(change.parameters).length !== declared.length || declared.some(p => !Object.hasOwn(change.parameters, p.name) || !Number.isFinite(change.parameters[p.name]) || change.parameters[p.name] < p.min || change.parameters[p.name] > p.max)) throw new Error('Invalid current parameter values.');
      this.db.prepare('UPDATE reply_views SET parameters=?,view=?,revision=revision+1,updatedAt=? WHERE replyVersionId=?').run(canonicalReplyData(change.parameters), canonicalReplyData(change.view), new Date().toISOString(), reply.id);
      this.event('reply-view-changed', { threadId: reply.threadId, replyVersionId: reply.id, revision: current.revision + 1 });
      return this.replyView(reply.id)!;
    });
  }
  private recordChange<T>(kind: string, change: { id: string }, write: () => T): T {
    const fingerprint = digest(canonicalReplyData({ kind, change }));
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT digest,result FROM mutation_receipts WHERE id=?').get(change.id) as { digest: string; result: string } | undefined;
      if (previous) {
        if (previous.digest !== fingerprint) throw new ConflictError('This change identifier was already used for different content.');
        return JSON.parse(previous.result) as T;
      }
      const result = write();
      this.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?)').run(change.id, fingerprint, JSON.stringify(result));
      return result;
    })();
  }
  events(after = 0) { return this.db.prepare('SELECT seq,kind,payload,createdAt FROM events WHERE seq>? ORDER BY seq LIMIT 1000').all(after); }
  exportThread(id: string) {
    const thread = this.get(id);
    if (!thread) throw new Error('This thread is unavailable.');
    const source = this.sourceVersion(thread.sourceVersionId);
    const noteVersions = this.db.prepare('SELECT v.* FROM note_versions v JOIN notes n ON n.id=v.noteId WHERE n.threadId=? ORDER BY v.noteId,v.revision').all(id);
    const attachments = this.attachments(id);
    const targetVersions = [...new Set(attachments.map(a => a.targetVersionId))].map(version => this.sourceVersion(version)).filter(version => version !== undefined);
    const replies = this.replies(id, true);
    return { schema: 'marginalia.thread.v1', thread, source, noteVersions, attachments, targetVersions, replies, replyViews: replies.map(reply => this.replyView(reply.id)).filter(view => view !== undefined) };
  }
}

function validateMutation(m: ReaderMutation) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.threadId !== 'string' || !/^[\w-]{1,100}$/.test(m.id) || !/^[\w-]{1,100}$/.test(m.threadId)) throw new Error('Invalid change identifier.');
  if (m.kind === 'keep') {
    const c = m.capture, a = m.anchor;
    validateCapture(c);
    if (!a || (a.kind !== undefined && !['quote', 'section', 'whole-page'].includes(a.kind)) || typeof a.exact !== 'string' || a.exact.length > 16000 || typeof a.prefix !== 'string' || typeof a.suffix !== 'string' || a.prefix.length > 256 || a.suffix.length > 256 || !Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start < 0 || a.end < a.start || a.end > c.text.length) throw new Error('Invalid passage attachment.');
    if (a.kind === 'whole-page' ? (a.exact !== '' || a.prefix !== '' || a.suffix !== '' || a.start !== 0 || a.end !== 0) : (!a.exact.length || a.end - a.start !== a.exact.length)) throw new Error('Invalid passage attachment.');
    if (m.note !== undefined && (typeof m.note !== 'string' || m.note.length > 20000)) throw new Error('Note is too large.');
  } else {
    validateRevision(m.expectedRevision);
    if (m.kind === 'note') {
      if (typeof m.text !== 'string' || m.text.length > 20000 || typeof m.noteId !== 'string' || !/^[\w-]{1,100}$/.test(m.noteId)) throw new Error('Invalid note.');
    } else if (m.kind === 'thread-state') {
      if (!['open', 'parked', 'done', 'archived'].includes(m.state)) throw new Error('Invalid thread state.');
    } else if (m.kind === 'remove') { if (typeof m.removed !== 'boolean') throw new Error('Invalid removal.'); }
    else throw new Error('Unknown reader change.');
  }
}

function validateCapture(c: SourceCapture) {
  if (!c || typeof c.url !== 'string' || c.url.length > 8000 || !/^https?:$/.test(new URL(c.url).protocol) || new URL(c.url).username || new URL(c.url).password || typeof c.text !== 'string' || c.text.length > 1000000 || typeof c.title !== 'string' || c.title.length > 1000 || typeof c.pageType !== 'string' || c.pageType.length > 100 || typeof c.extractionVersion !== 'string' || !c.extractionVersion.length || c.extractionVersion.length > 100 || typeof c.capturedAt !== 'string' || !Number.isFinite(Date.parse(c.capturedAt))) throw new Error('Invalid source capture.');
  if (c.sections !== undefined) {
    if (!Array.isArray(c.sections) || c.sections.length > 2000) throw new Error('Invalid source sections.');
    let previousEnd = 0;
    for (const section of c.sections) {
      if (!section || typeof section !== 'object' || typeof section.title !== 'string' || !section.title.length || section.title.length > 1000 || !Number.isSafeInteger(section.start) || !Number.isSafeInteger(section.end) || section.start < previousEnd || section.end <= section.start || section.end > c.text.length) throw new Error('Invalid source sections.');
      previousEnd = section.end;
    }
  }
}
function validateId(id: string) { if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid change identifier.'); }
function validateRevision(revision: number) { if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid revision.'); }
function validateView(view: ReplyViewState['view']) {
  const seen = new Set<object>();
  let count = 0;
  const visit = (value: unknown, depth: number) => {
    if (++count > 4000 || depth > 12) throw new Error('View state is too large.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error('View state must contain only JSON data.');
    seen.add(value);
    for (const item of Object.values(value)) visit(item, depth + 1);
    seen.delete(value);
  };
  if (!view || typeof view !== 'object' || Array.isArray(view)) throw new Error('Invalid view state.');
  visit(view, 0);
  if (Buffer.byteLength(JSON.stringify(view)) > 64000) throw new Error('View state is too large.');
}
