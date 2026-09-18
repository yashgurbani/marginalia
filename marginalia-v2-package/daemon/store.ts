import { validReaderSkill, skillReplyAllowed } from './reader-skills.ts';
import type { ReaderSkillProvenance } from '../contracts/reader-skills.ts';
import { assessShelf, prepareOpen, type OpenShelfItemRequest } from '../contracts/explore.ts';
import { readJournal } from './reading-journal.ts';
import { reconcileEvidence } from './transforms/evidence/reconcile.ts';
import type { EvidenceRetrieval, BoundSourceVersion } from '../contracts/evidence.ts';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { attachQuote, isHighlightColour, validateQuoteAnchor, validateReaderMutation, validateSourceCapture, type JsonValue, type ReaderMutation, type Thread, type Note, type QuoteAnchor, type SourceCapture, type SourceVersion, type SourceSection, type AttachmentRecord, type NoteVersionRef, type NoteVersion, type ReplyVersion, type ReplyViewState } from '../contracts/reader.ts';
import { canonicalReplyData, validateReply, type CandidateReply, type ReplyCapability } from '../contracts/reply.ts';
import { digestReply, runHostChecks } from '../contracts/host-checks.ts';
import { isDigest } from '../contracts/digest.ts';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class ConflictError extends Error { override name = 'Conflict'; }
const HIGHLIGHT_COLOUR_PREFIX = 'highlight-colour:';
export class ReaderStore {
  db: Database.Database;
  private readonly listStatements = new Map<string, Database.Statement>();
  constructor(filename: string) {
    const diskPath = filename === ':memory:' || filename === '' ? undefined : resolve(filename);
    // Inspect existing files read-only before opening a writer or setting journal_mode.
    if (diskPath && existsSync(diskPath)) {
      const preflight = new Database(diskPath, { readonly: true, fileMustExist: true });
      try { inspectReaderSchema(preflight); } finally { preflight.close(); }
    }
    this.db = new Database(diskPath ?? filename);
    let backup: string | undefined;
    try {
      if (needsReaderMigration(inspectReaderSchema(this.db))) {
        this.db.pragma('synchronous = FULL');
        this.db.pragma('foreign_keys = OFF');
        this.db.transaction(() => {
          // The write reservation prevents another connection changing the source between
          // the independent read-only snapshot and the complete migration transaction.
          const schema = inspectReaderSchema(this.db);
          if (!needsReaderMigration(schema)) return;
          if (diskPath && schema.hasSchema) backup = createPreUpgradeBackup(diskPath, schema);
          this.migrate();
          verifySqliteIntegrity(this.db);
          if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source migration would leave invalid references.');
        }).immediate();
      }
      this.db.exec('CREATE TABLE IF NOT EXISTS reply_reader_skills(replyId TEXT PRIMARY KEY REFERENCES reply_versions(id), json TEXT NOT NULL)');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = FULL');
      this.db.pragma('journal_mode = WAL');
      if (backup) finishRoutineBackup(backup);
    } catch (error) {
      this.db.close();
      if (backup) throw new ReaderMigrationError('Opening saved work failed. The verified pre-upgrade backup is retained for recovery.', backup, true, error);
      throw error;
    }
  }

  /** Explicit host action after recovery is resolved; never restores or edits the database. */
  static resolveRecoveryBackup(filename: string, backupName: string): string {
    if (filename === ':memory:' || filename === '' || !/^recovery-[0-9]+-[0-9a-f-]{36}$/.test(backupName)) throw new Error('Invalid recovery backup.');
    const root = backupDirectory(resolve(filename));
    requireDirectory(root);
    const directory = join(root, backupName);
    verifyBackup(directory);
    return finishRoutineBackup(directory);
  }

  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);`);
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=18001').get()) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS instant_usage(
        requestId TEXT PRIMARY KEY, pageKeyHash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('prepare','selection')),
        periodStart TEXT NOT NULL, timezone TEXT NOT NULL, model TEXT NOT NULL,
        inputTokens INTEGER, cachedInputTokens INTEGER, outputTokens INTEGER, totalTokens INTEGER,
        reservedTokens INTEGER NOT NULL CHECK(reservedTokens>=0), state TEXT NOT NULL CHECK(state IN ('reserved','settled')),
        createdAt TEXT NOT NULL, settledAt TEXT,
        CHECK(inputTokens IS NULL OR inputTokens>=0), CHECK(outputTokens IS NULL OR outputTokens>=0),
        CHECK(totalTokens IS NULL OR totalTokens>=0),
        CHECK(cachedInputTokens IS NULL OR (inputTokens IS NOT NULL AND cachedInputTokens>=0 AND cachedInputTokens<=inputTokens))
      );
      CREATE INDEX IF NOT EXISTS instant_usage_period ON instant_usage(periodStart,timezone);
      INSERT INTO migrations(version) VALUES(18001);`);
    }
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=18002').get()) {
      this.db.exec(`
        CREATE TABLE instant_usage_v2(
          requestId TEXT PRIMARY KEY, pageKeyHash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('prepare','selection','auto-definition')),
          periodStart TEXT NOT NULL, timezone TEXT NOT NULL, model TEXT NOT NULL,
          inputTokens INTEGER, cachedInputTokens INTEGER, outputTokens INTEGER, totalTokens INTEGER,
          reservedTokens INTEGER NOT NULL CHECK(reservedTokens>=0), state TEXT NOT NULL CHECK(state IN ('reserved','settled')),
          createdAt TEXT NOT NULL, settledAt TEXT,
          CHECK(inputTokens IS NULL OR inputTokens>=0), CHECK(outputTokens IS NULL OR outputTokens>=0),
          CHECK(totalTokens IS NULL OR totalTokens>=0),
          CHECK(cachedInputTokens IS NULL OR (inputTokens IS NOT NULL AND cachedInputTokens>=0 AND cachedInputTokens<=inputTokens))
        );
        INSERT INTO instant_usage_v2 SELECT * FROM instant_usage;
        DROP TABLE instant_usage;
        ALTER TABLE instant_usage_v2 RENAME TO instant_usage;
        CREATE INDEX instant_usage_period ON instant_usage(periodStart,timezone);
        CREATE TABLE auto_assist_events(
          eventId TEXT PRIMARY KEY, candidateId TEXT NOT NULL, pageKeyHash TEXT NOT NULL,
          scorerMethod TEXT NOT NULL CHECK(scorerMethod IN ('frequency-page-v0','causal-lm-v1')), scorerVersion TEXT NOT NULL,
          scoreBand INTEGER NOT NULL CHECK(scoreBand BETWEEN 0 AND 3), rankInBand INTEGER NOT NULL CHECK(rankInBand>=0),
          reasonBits INTEGER NOT NULL CHECK(reasonBits>=0), posture TEXT NOT NULL CHECK(posture IN ('flow','balanced','learning')),
          bandIndex INTEGER NOT NULL CHECK(bandIndex>=0),
          event TEXT NOT NULL CHECK(event IN ('nominated','shown','definition-ready','definition-opened','dismissed-familiar','kept','asked')),
          elapsedBucket TEXT CHECK(elapsedBucket IN ('<2s','2-10s','10-60s','>60s')), createdAt TEXT NOT NULL
        );
        CREATE INDEX auto_assist_events_candidate ON auto_assist_events(candidateId,createdAt,eventId);
        CREATE INDEX auto_assist_events_created ON auto_assist_events(createdAt,eventId);
        INSERT INTO migrations(version) VALUES(18002);
      `);
    }
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
      -- Search holds a second copy of captured text and must be included in erasure.
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
    }
    // T07-scoped migration number; existing T06/T13 markers remain untouched.
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=7001').get()) {
      this.db.transaction(() => {
          this.db.exec(`
            CREATE TABLE source_versions_metadata(id TEXT PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES sources(id), hash TEXT NOT NULL, text TEXT NOT NULL, capturedAt TEXT NOT NULL, extractionVersion TEXT NOT NULL, title TEXT, pageType TEXT, metadataStatus TEXT NOT NULL DEFAULT 'legacy', sections TEXT NOT NULL DEFAULT '');
            INSERT INTO source_versions_metadata SELECT id,sourceId,hash,text,capturedAt,extractionVersion,title,pageType,metadataStatus,sections FROM source_versions;
            DROP TABLE source_versions;
            ALTER TABLE source_versions_metadata RENAME TO source_versions;
            CREATE UNIQUE INDEX source_versions_material_identity ON source_versions(
              sourceId,hash,extractionVersion,sections,metadataStatus,
              title IS NULL,COALESCE(title,''),pageType IS NULL,COALESCE(pageType,''));
            CREATE TRIGGER source_version_immutable BEFORE UPDATE ON source_versions BEGIN SELECT RAISE(ABORT, 'Source versions are immutable'); END;
            INSERT INTO migrations(version) VALUES(7001);
          `);
          if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source migration would leave invalid references.');
      })();
    }
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=33001').get()) {
      this.db.exec(`
        ALTER TABLE source_versions ADD COLUMN author TEXT;
        ALTER TABLE source_versions ADD COLUMN publicationDate TEXT;
        ALTER TABLE source_versions ADD COLUMN venue TEXT;
        DROP INDEX source_versions_material_identity;
        CREATE UNIQUE INDEX source_versions_material_identity ON source_versions(
          sourceId,hash,extractionVersion,sections,metadataStatus,
          title IS NULL,COALESCE(title,''),pageType IS NULL,COALESCE(pageType,''),
          author IS NULL,COALESCE(author,''),publicationDate IS NULL,COALESCE(publicationDate,''),venue IS NULL,COALESCE(venue,''));
        INSERT INTO migrations(version) VALUES(33001);
      `);
    }
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=7002').get()) {
      this.db.exec(`ALTER TABLE sources ADD COLUMN position TEXT; INSERT INTO migrations(version) VALUES(7002);`);
    }
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=7004').get()) {
      const hasReplies = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reply_versions'").get();
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS threads_list ON threads(deletedAt,createdAt,id);
        CREATE INDEX IF NOT EXISTS threads_by_anchor ON threads(anchorId,deletedAt,createdAt,id);
        CREATE INDEX IF NOT EXISTS anchors_by_source_version ON anchors(sourceVersionId);
        CREATE INDEX IF NOT EXISTS notes_by_thread ON notes(threadId,createdAt,id);
        CREATE INDEX IF NOT EXISTS highlights_by_thread ON highlights(threadId,deletedAt);
        CREATE INDEX IF NOT EXISTS attachments_by_anchor ON attachments(anchorId,recordedAt,id);
        ${hasReplies ? 'CREATE INDEX IF NOT EXISTS replies_by_thread ON reply_versions(threadId,createdAt,id);' : ''}
        INSERT INTO migrations(version) VALUES(7004);
      `);
    }
    if (!this.db.prepare('SELECT 1 FROM migrations WHERE version=22001').get()) {
      const alreadyUpgraded = (this.db.prepare('PRAGMA table_info(vocabulary)').all() as { name: string }[]).some(column => column.name === 'termKey');
      if (!alreadyUpgraded) {
        this.db.transaction(() => {
          const historical = this.db.prepare('SELECT term,origin,status,firstSeen,lastSeen FROM vocabulary').all() as Array<{ term: string; origin: string; status: string; firstSeen: string; lastSeen: string }>;
          this.db.exec(`
            CREATE TABLE vocabulary_v2(termKey TEXT PRIMARY KEY,term TEXT NOT NULL,status TEXT NOT NULL,firstSeen TEXT NOT NULL,lastSeen TEXT NOT NULL);
            CREATE TABLE vocabulary_origins(operationId TEXT PRIMARY KEY,termKey TEXT NOT NULL REFERENCES vocabulary_v2(termKey) ON DELETE CASCADE,origin TEXT NOT NULL,observedAt TEXT NOT NULL,sourceKind TEXT NOT NULL,sourceId TEXT,sourceRevision INTEGER);
            CREATE INDEX vocabulary_origins_by_term ON vocabulary_origins(termKey,observedAt,operationId);
            CREATE TABLE vocabulary_operations(operationId TEXT PRIMARY KEY,digest TEXT NOT NULL,termKey TEXT REFERENCES vocabulary_v2(termKey) ON DELETE SET NULL,createdAt TEXT NOT NULL,deletedAt TEXT);
          `);
          for (const row of historical) {
            const term = normalizeHistoricalVocabularyTerm(row.term), termKey = vocabularyTermKey(term);
            const current = this.db.prepare('SELECT status,firstSeen,lastSeen FROM vocabulary_v2 WHERE termKey=?').get(termKey) as { status: string; firstSeen: string; lastSeen: string } | undefined;
            if (!current) this.db.prepare('INSERT INTO vocabulary_v2 VALUES(?,?,?,?,?)').run(termKey, term, row.status, row.firstSeen, row.lastSeen);
            else if (current.status !== row.status) throw new Error('Historical vocabulary statuses conflict after normalization. Nothing was migrated.');
            else this.db.prepare('UPDATE vocabulary_v2 SET firstSeen=?,lastSeen=? WHERE termKey=?').run(row.firstSeen < current.firstSeen ? row.firstSeen : current.firstSeen, row.lastSeen > current.lastSeen ? row.lastSeen : current.lastSeen, termKey);
            // Older builds used the shorter lookup/note labels. Preserve those
            // attributable observations before dropping the legacy table; only
            // an origin we cannot interpret becomes legacy.
            const origin = row.origin === 'lookup' ? 'looked-up' : row.origin === 'note' ? 'used'
              : ['used', 'looked-up', 'stated', 'legacy'].includes(row.origin) ? row.origin : 'legacy';
            const operationId = `legacy-${digest(JSON.stringify([row.term, row.firstSeen, row.lastSeen, row.origin]))}`;
            this.db.prepare('INSERT OR IGNORE INTO vocabulary_origins VALUES(?,?,?,?,?,?,?)').run(operationId, termKey, origin, row.firstSeen, 'reader', null, null);
          }
          this.db.exec(`DROP TABLE vocabulary; ALTER TABLE vocabulary_v2 RENAME TO vocabulary;`);
        })();
      }
      this.db.prepare('INSERT INTO migrations(version) VALUES(22001)').run();
    }
  }
  close() { this.db.close(); }
  readingJournal(timeZone: string) { return readJournal(this, timeZone); }
  private event(kind: string, value: unknown) {
    this.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)').run(kind, JSON.stringify(value), new Date().toISOString());
  }
  apply(mutation: ReaderMutation): { threadId: string; revision: number } {
    validateReaderMutation(mutation);
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
        const versionId = this.captureVersion(capture);
        const anchorId = randomUUID();
        this.db.prepare('INSERT INTO anchors VALUES(?,?,?)').run(anchorId, versionId, JSON.stringify(anchor));
        this.db.prepare('INSERT INTO threads(id,anchorId,createdAt,updatedAt) VALUES(?,?,?,?)').run(mutation.threadId, anchorId, now, now);
        if (mutation.note) this.writeNote(mutation.id + '-note', mutation.threadId, mutation.note, 0, now);
      } else {
        const thread = this.get(mutation.threadId);
        if (!thread) throw new Error('This thread is unavailable.');
        if (mutation.kind === 'note') {
          if (thread.deletedAt) throw new ConflictError('Restore the thread before editing it.');
          this.writeNote(mutation.noteId, mutation.threadId, mutation.text, mutation.expectedRevision, now);
        } else if (mutation.kind === 'note-remove') {
          if (thread.deletedAt) throw new ConflictError('Restore the thread before changing its notes.');
          const note = thread.notes.find(candidate => candidate.id === mutation.noteId);
          if (!note || note.revision !== mutation.expectedRevision) throw new ConflictError('This note changed elsewhere. Review the saved version before applying your change.');
          this.db.prepare('UPDATE notes SET deletedAt=?,revision=revision+1 WHERE id=?').run(mutation.removed ? now : null, mutation.noteId);
          this.replaceSearch(mutation.noteId, 'note', mutation.removed ? null : note.text);
        } else if (mutation.kind === 'highlight') {
          if (thread.deletedAt) throw new ConflictError('Restore the thread before changing its highlight.');
          if (thread.anchor.kind === 'whole-page' && mutation.highlighted) throw new ConflictError('A whole-page thread cannot be highlighted.');
          if (thread.revision !== mutation.expectedRevision) throw new ConflictError('This thread changed elsewhere. Review the saved version before applying your change.');
          if (mutation.highlighted && !thread.highlighted) this.db.prepare('INSERT INTO highlights VALUES(?,?,?,NULL)').run(randomUUID(), mutation.threadId, now);
          if (!mutation.highlighted && thread.highlighted) this.db.prepare('UPDATE highlights SET deletedAt=? WHERE threadId=? AND deletedAt IS NULL').run(now, mutation.threadId);
          if (mutation.highlighted && mutation.highlightColour !== undefined) this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(HIGHLIGHT_COLOUR_PREFIX + mutation.threadId, mutation.highlightColour);
          if (!mutation.highlighted) this.db.prepare('DELETE FROM settings WHERE key=?').run(HIGHLIGHT_COLOUR_PREFIX + mutation.threadId);
        } else {
          if (thread.revision !== mutation.expectedRevision) throw new ConflictError('This thread changed elsewhere. Review the saved version before applying your change.');
          if (mutation.kind === 'thread-state') this.db.prepare('UPDATE threads SET state=? WHERE id=?').run(mutation.state, mutation.threadId);
          else {
            this.db.prepare('UPDATE threads SET deletedAt=? WHERE id=?').run(mutation.removed ? now : null, mutation.threadId);
            this.syncThreadSearch(mutation.threadId, mutation.removed);
          }
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
    const title = provided ? capture.title : null, pageType = provided ? capture.pageType : null;
    const author = provided ? capture.author ?? null : null;
    const publicationDate = provided ? capture.publicationDate ?? null : null;
    const venue = provided ? capture.venue ?? null : null;
    const metadataStatus = provided ? 'provided' : 'unavailable';
    // Reuse old IDs only when their actual immutable metadata also matches. Capture time
    // alone does not create a new version, and legacy/unavailable facts are never upgraded.
    const existing = this.db.prepare(`SELECT id FROM source_versions WHERE sourceId=? AND hash=? AND extractionVersion=? AND sections=? AND metadataStatus=? AND title IS ? AND pageType IS ? AND author IS ? AND publicationDate IS ? AND venue IS ?`)
      .get(sourceId, hash, extractionVersion, sections, metadataStatus, title, pageType, author, publicationDate, venue) as { id: string } | undefined;
    const versionId = existing?.id ?? digest(canonicalReplyData([
      'source-version-metadata-v1', sourceId, hash, extractionVersion, normalizedSections, metadataStatus, title, pageType,
      ...(author !== null || publicationDate !== null || venue !== null ? [author, publicationDate, venue] : []),
    ]));
    if (provided) this.db.prepare('INSERT OR IGNORE INTO sources(id,url,title,pageType) VALUES(?,?,?,?)').run(sourceId, capture.url, capture.title, capture.pageType);
    this.db.prepare('INSERT OR IGNORE INTO source_versions(id,sourceId,hash,text,capturedAt,extractionVersion,title,pageType,metadataStatus,sections,author,publicationDate,venue) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(versionId, sourceId, hash, capture.text, provided ? capture.capturedAt : '', extractionVersion, title, pageType, metadataStatus, sections, author, publicationDate, venue);
    this.db.prepare('INSERT INTO search(entityId,kind,content) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM search WHERE entityId=? AND kind=?)').run(versionId, 'source', capture.text, versionId, 'source');
    return versionId;
  }
  sourceVersion(id: string): SourceVersion | undefined {
    const row = this.db.prepare('SELECT * FROM source_versions WHERE id=?').get(id) as (Omit<SourceVersion, 'sections' | 'author' | 'publicationDate' | 'venue'> & { sections: string; author: string | null; publicationDate: string | null; venue: string | null }) | undefined;
    if (!row) return;
    const { sections, author, publicationDate, venue, ...version } = row;
    return { ...version, ...(author !== null ? { author } : {}), ...(publicationDate !== null ? { publicationDate } : {}), ...(venue !== null ? { venue } : {}), capturedAt: version.capturedAt || null, extractionVersion: version.extractionVersion || null, ...(sections ? { sections: JSON.parse(sections) as SourceSection[] } : {}) };
  }
  readerPosition(url: string): QuoteAnchor | undefined {
    const row = this.db.prepare('SELECT position FROM sources WHERE url=?').get(url) as { position: string | null } | undefined;
    return row?.position ? JSON.parse(row.position) as QuoteAnchor : undefined;
  }
  saveReaderPosition(capture: SourceCapture, anchor: QuoteAnchor): QuoteAnchor {
    validateSourceCapture(capture); validateQuoteAnchor(anchor, capture.text);
    const sourceId = digest(capture.url);
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO sources(id,url,title,pageType) VALUES(?,?,?,?)').run(sourceId, capture.url, capture.title, capture.pageType);
      this.db.prepare('UPDATE sources SET position=? WHERE url=?').run(JSON.stringify(anchor), capture.url);
    })();
    return anchor;
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
    this.replaceSearch(id, 'note', text);
  }
  private replaceSearch(id: string, kind: string, content: string | null) {
    this.db.prepare('DELETE FROM search WHERE entityId=? AND kind=?').run(id, kind);
    if (content !== null) this.db.prepare('INSERT INTO search(entityId,kind,content) VALUES(?,?,?)').run(id, kind, content);
  }
  private syncThreadSearch(threadId: string, removed: boolean) {
    this.db.prepare(`DELETE FROM search WHERE kind IN ('note','reply') AND entityId IN (
      SELECT id FROM notes WHERE threadId=? UNION SELECT id FROM reply_versions WHERE threadId=?)`).run(threadId, threadId);
    this.db.prepare(`DELETE FROM search WHERE kind='source' AND entityId IN (
      SELECT a.sourceVersionId FROM threads t JOIN anchors a ON a.id=t.anchorId WHERE t.id=?
      UNION SELECT x.targetVersionId FROM threads t JOIN attachments x ON x.anchorId=t.anchorId WHERE t.id=?)
      AND entityId NOT IN (SELECT a.sourceVersionId FROM threads t JOIN anchors a ON a.id=t.anchorId WHERE t.deletedAt IS NULL
      UNION SELECT x.targetVersionId FROM threads t JOIN attachments x ON x.anchorId=t.anchorId WHERE t.deletedAt IS NULL)`).run(threadId, threadId);
    if (removed) return;
    this.db.prepare(`INSERT INTO search(entityId,kind,content)
      SELECT id,'note',text FROM notes WHERE threadId=? AND deletedAt IS NULL
      UNION ALL SELECT id,'reply',json_extract(json,'$.title') || char(10) || json_extract(json,'$.summary') || char(10) || json_extract(json,'$.staticFallback') FROM reply_versions WHERE threadId=? AND deletedAt IS NULL
      UNION ALL SELECT v.id,'source',v.text FROM source_versions v WHERE v.id IN (
        SELECT a.sourceVersionId FROM threads t JOIN anchors a ON a.id=t.anchorId WHERE t.id=?
        UNION SELECT x.targetVersionId FROM threads t JOIN attachments x ON x.anchorId=t.anchorId WHERE t.id=?)
        AND NOT EXISTS(SELECT 1 FROM search WHERE entityId=v.id AND kind='source')`).run(threadId, threadId, threadId, threadId);
  }
  get(id: string): Thread | undefined {
    const row = this.db.prepare(`SELECT t.*, a.sourceVersionId, a.json, s.url as sourceUrl, COALESCE(v.title,s.title) as sourceTitle FROM threads t JOIN anchors a ON a.id=t.anchorId JOIN source_versions v ON v.id=a.sourceVersionId JOIN sources s ON s.id=v.sourceId WHERE t.id=?`).get(id) as (Omit<Thread, 'anchor' | 'notes' | 'highlighted'> & { json: string }) | undefined;
    if (!row) return;
    const { json, ...thread } = row;
    const highlighted = !!this.db.prepare('SELECT 1 FROM highlights WHERE threadId=? AND deletedAt IS NULL').get(id);
    const savedColour = highlighted ? (this.db.prepare('SELECT value FROM settings WHERE key=?').get(HIGHLIGHT_COLOUR_PREFIX + id) as { value: string } | undefined)?.value : undefined;
    if (savedColour !== undefined && !isHighlightColour(savedColour)) throw new Error('Saved highlight colour is invalid.');
    return { ...thread, anchor: JSON.parse(json) as QuoteAnchor, notes: this.db.prepare('SELECT * FROM notes WHERE threadId=? ORDER BY createdAt,id').all(id) as Note[], highlighted, ...(savedColour !== undefined ? { highlightColour: savedColour } : {}) };
  }
  list(url?: string, includeRemoved = false): Thread[] {
    const key = `${url ? 'url' : 'all'}:${includeRemoved ? 'removed' : 'active'}`;
    let statement = this.listStatements.get(key);
    if (!statement) {
      statement = this.db.prepare(`SELECT t.id FROM threads t JOIN anchors a ON a.id=t.anchorId
        JOIN source_versions v ON v.id=a.sourceVersionId JOIN sources s ON s.id=v.sourceId
        ${url || !includeRemoved ? `WHERE ${url ? 's.url=?' : ''}${url && !includeRemoved ? ' AND ' : ''}${!includeRemoved ? 't.deletedAt IS NULL' : ''}` : ''}
        ORDER BY t.createdAt,t.id`);
      this.listStatements.set(key, statement);
    }
    const ids = (url ? statement.all(url) : statement.all()) as { id: string }[];
    return ids.map(({ id }) => this.get(id)!).sort((a, b) => a.anchor.start - b.anchor.start || a.createdAt.localeCompare(b.createdAt));
  }
  reattach(threadId: string, text: string, tabCapture: string, capture?: SourceCapture) {
    const thread = this.get(threadId);
    if (!thread) throw new Error('This thread is unavailable.');
    if (typeof text !== 'string' || text.length > 1000000 || typeof tabCapture !== 'string' || !tabCapture.length || tabCapture.length > 200) throw new Error('Invalid attachment capture.');
    if (capture) {
      validateSourceCapture(capture);
      if (capture.url !== thread.sourceUrl || capture.text !== text) throw new Error('The target capture does not match this source.');
    }
    return this.db.transaction(() => {
      const result = attachQuote(thread.anchor, text);
      const targetVersionId = this.captureVersion(capture ?? { url: thread.sourceUrl, text });
      const id = digest(canonicalReplyData([thread.anchorId, targetVersionId, tabCapture]));
      const inserted = this.db.prepare('INSERT OR IGNORE INTO attachments(id,anchorId,targetVersionId,tabCapture,state,candidates,recordedAt) VALUES(?,?,?,?,?,?,?)').run(id, thread.anchorId, targetVersionId, tabCapture, result.state, JSON.stringify(result.candidates), new Date().toISOString());
      if (thread.deletedAt) this.syncThreadSearch(threadId, true);
      if (inserted.changes) this.event('attachment-recorded', { threadId, attachmentId: id, targetVersionId, state: result.state });
      return result;
    })();
  }
  attachments(threadId: string): AttachmentRecord[] {
    const rows = this.db.prepare('SELECT a.*, v.id IS NOT NULL AS targetAvailable FROM attachments a JOIN threads t ON t.anchorId=a.anchorId LEFT JOIN source_versions v ON v.id=a.targetVersionId WHERE t.id=? ORDER BY a.recordedAt,a.id').all(threadId) as (Omit<AttachmentRecord, 'candidates' | 'targetAvailable'> & { candidates: string; targetAvailable: number })[];
    return rows.map(row => ({ ...row, candidates: JSON.parse(row.candidates), targetAvailable: !!row.targetAvailable }));
  }
  /** Host-only commit seam. Provider candidates cannot supply their own validation report. */
  commitReply(input: { id: string; threadId: string; reply: CandidateReply; parentId?: string; supersedes?: string; answeredNote?: NoteVersionRef; readerSkill?: ReaderSkillProvenance }, capabilities: readonly ReplyCapability[] = [], evidence?: EvidenceRetrieval & { boundSourceVersion: BoundSourceVersion }): ReplyVersion {
    validateId(input.id); validateId(input.threadId);
    if (input.readerSkill && (!validReaderSkill(input.readerSkill, true) || !skillReplyAllowed(input.reply))) throw new Error('Invalid reader skill provenance or reply.');
    return this.db.transaction(() => {
      const thread = this.get(input.threadId);
      if (!thread) throw new Error('This thread is unavailable.');
      const validated = validateReply(input.reply, { sourceText: this.sourceVersion(thread.sourceVersionId)!.text, capabilities, requireOrigins: true });
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
        if (previous.threadId !== input.threadId || previous.hash !== digestReply(reply) || previous.parentId !== (input.parentId ?? null) || previous.supersedes !== (input.supersedes ?? null) || canonicalReplyData(previous.answeredNote) !== canonicalReplyData(answeredNote) || canonicalReplyData(previous.readerSkill ?? null) !== canonicalReplyData(input.readerSkill ?? null)) throw new ConflictError('This reply identifier already contains a different version.');
        return previous;
      }
      if (thread.deletedAt) throw new ConflictError('Restore the thread before adding a reply.');
      for (const ref of [input.parentId, input.supersedes]) {
        if (ref && this.reply(ref)?.threadId !== thread.id) throw new Error('A related reply must belong to this thread.');
      }
      const parameters = Object.fromEntries(reply.parameters.map(p => [p.name, p.default]));
      const validation = runHostChecks(reply, parameters);
      if (evidence && ['evidence', 'explore'].includes(reply.intent)) {
        const source = this.sourceVersion(thread.sourceVersionId)!;
        if (evidence.boundSourceVersion.id !== source.id || evidence.boundSourceVersion.hash !== source.hash) throw new ConflictError('The source differs from the frozen request.');
      }
      if (reply.intent === 'evidence') {
        const source = this.sourceVersion(thread.sourceVersionId)!;
        const boundSourceVersion = { id: source.id, hash: source.hash, capturedAt: source.capturedAt };
        validation.evidence = reconcileEvidence(reply, {
          sessionScope: evidence?.sessionScope ?? 'open-session', retrievalComplete: evidence?.retrievalComplete ?? false,
          observed: evidence?.observed ?? [], boundSourceVersion, boundSourceText: source.text, boundSourceUrl: thread.sourceUrl,
        });
      }
      if (reply.intent === 'explore') {
        const source = this.sourceVersion(thread.sourceVersionId)!;
        validation.explore = assessShelf(reply, { sessionScope: evidence?.sessionScope ?? 'open-session', returnTo: {
          threadId: thread.id, sourceVersionId: source.id, sourceHash: source.hash, sourceUrl: thread.sourceUrl,
          anchor: structuredClone(thread.anchor),
        } });
      }
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO reply_versions(id,threadId,parentId,supersedes,json,hash,validation,answeredNote,createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(input.id, thread.id, input.parentId ?? null, input.supersedes ?? null, canonicalReplyData(reply), digestReply(reply), JSON.stringify(validation), answeredNote ? JSON.stringify(answeredNote) : null, now);
      if (input.readerSkill) this.db.prepare('INSERT INTO reply_reader_skills(replyId,json) VALUES(?,?)').run(input.id, JSON.stringify(input.readerSkill));
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
    const skillRow = this.db.prepare('SELECT json FROM reply_reader_skills WHERE replyId=?').get(id) as { json: string } | undefined;
    const readerSkill = skillRow ? JSON.parse(skillRow.json) : undefined;
    if (readerSkill !== undefined && !validReaderSkill(readerSkill, true)) throw new Error('Invalid saved reader skill provenance.');
    // UNION deduplicates shared ancestry and terminates even for damaged cyclic data.
    // Superseding a descendant does not prove that its inherited dependencies were repaired.
    const corrections = this.db.prepare(`WITH RECURSIVE lineage(id) AS (
      SELECT id FROM reply_versions WHERE id=?
      UNION
      SELECT parent.id FROM reply_versions child JOIN lineage ON child.id=lineage.id
        JOIN reply_versions parent ON parent.id=child.parentId OR parent.id=child.supersedes
    ) SELECT ancestor.id AS ancestorId, json_extract(ancestor.json,'$.title') AS ancestorTitle,
      correction.id AS correctionId, correction.createdAt AS correctedAt
      FROM lineage JOIN reply_versions ancestor ON ancestor.id=lineage.id
      JOIN reply_versions correction ON correction.supersedes=ancestor.id
      ORDER BY correction.createdAt,correction.id,ancestor.id`).all(id) as NonNullable<ReplyVersion['corrections']>;
    return { ...record, ...(readerSkill ? { readerSkill } : {}), reply: JSON.parse(json), validation: JSON.parse(validation), answeredNote: answeredNote ? JSON.parse(answeredNote) : null, corrections };
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
      this.replaceSearch(reply.id, 'reply', change.removed || this.get(reply.threadId)?.deletedAt ? null : [reply.reply.title, reply.reply.summary, reply.reply.staticFallback].join('\n'));
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
  /** Records navigation intent only. The caller opens the URL after this durable commit. */
  openShelfItem(change: { id: string; threadId: string; replyVersionId: string; blockId: string; itemId: string }): OpenShelfItemRequest {
    for (const value of Object.values(change)) validateId(value);
    return this.db.transaction(() => {
      const reply = this.reply(change.replyVersionId), thread = this.get(change.threadId);
      if (!reply || !thread || reply.threadId !== thread.id || reply.deletedAt || thread.deletedAt || reply.reply.status !== 'complete' || reply.reply.intent !== 'explore') throw new ConflictError('This saved reading is unavailable.');
      const assessment = reply.validation.explore, source = this.sourceVersion(thread.sourceVersionId);
      if (!assessment || !source || assessment.returnTo.threadId !== thread.id || assessment.returnTo.sourceVersionId !== source.id ||
        assessment.returnTo.sourceHash !== source.hash || reply.validation.replyDigest !== digestReply(reply.reply) ||
        canonicalReplyData(assessment.returnTo.anchor) !== canonicalReplyData(thread.anchor)) throw new ConflictError('This saved shelf needs its original source record.');
      const result = prepareOpen(assessment, change.itemId, undefined, change.blockId);
      if (!result.ok) throw new ConflictError(result.error);
      const authored = reply.reply.blocks.find(block => block.type === 'shelf' && block.id === change.blockId);
      if (authored?.type !== 'shelf' || !authored.items.some(item => item.id === change.itemId && item.url === result.open.url)) throw new ConflictError('This link differs from its saved shelf.');
      return this.recordChange('shelf-open', change, () => {
        this.event('shelf-opened', { ...change, open: result.open });
        return result.open;
      });
    })();
  }
  shelfReturns(threadId: string): { id: string; replyVersionId: string; blockId: string; itemId: string; open: OpenShelfItemRequest; recordedAt: string }[] {
    const thread = this.get(threadId);
    if (!thread || thread.deletedAt) return [];
    const rows = this.db.prepare("SELECT payload,createdAt FROM events WHERE kind='shelf-opened' AND json_extract(payload,'$.threadId')=? ORDER BY seq DESC LIMIT 100").all(threadId) as { payload: string; createdAt: string }[];
    return rows.flatMap(row => {
      const value = JSON.parse(row.payload);
      const reply = this.reply(value.replyVersionId);
      return reply && !reply.deletedAt && reply.threadId === threadId ? [{ id: value.id, replyVersionId: value.replyVersionId, blockId: value.blockId, itemId: value.itemId, open: value.open, recordedAt: row.createdAt }] : [];
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
    return this.db.transaction(() => {
      const thread = this.get(id);
      if (!thread) throw new Error('This thread is unavailable.');
      const source = this.sourceVersion(thread.sourceVersionId);
      const noteVersions = this.db.prepare('SELECT v.* FROM note_versions v JOIN notes n ON n.id=v.noteId WHERE n.threadId=? ORDER BY v.noteId,v.revision').all(id);
      const attachments = this.attachments(id);
      const targetVersions = [...new Set(attachments.map(a => a.targetVersionId))].map(version => this.sourceVersion(version)).filter(version => version !== undefined);
      const replies = this.replies(id, true);
      return { schema: 'marginalia.thread.v1', thread, source, noteVersions, attachments, targetVersions, replies,
        replyViews: replies.map(reply => this.replyView(reply.id)).filter(view => view !== undefined), shelfReturns: this.shelfReturns(id), execution: this.exportExecution(id) };
    })();
  }
  private exportExecution(threadId: string) {
    // Positive column lists exclude account configuration, raw provider output and workspace
    // state. These are historical host records, not permission to dispatch or host-check seals.
    const tables = ['jobs', 'job_attempts', 'consent_attempt_authorizations', 'egress_events'];
    const present = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
    const missingTables = tables.filter(table => !present.has(table));
    const jobs = present.has('jobs') ? this.db.prepare(`SELECT id,threadId,idempotencyKey,packetDigest,requestDigest,preparedPayloadDigest,provider,model,mode,policyKey,grantId,state,cancelRequested,latestAttemptId,replyVersionId,reason,createdAt,updatedAt,context,capabilities FROM jobs WHERE threadId=? ORDER BY createdAt,id`).all(threadId) as HistoryRow[] : [];
    const associated = (table: string, columns: string, order: string): HistoryRow[] => present.has('jobs') && present.has(table)
      ? this.db.prepare(`SELECT ${columns} FROM ${table} r JOIN jobs j ON j.id=r.jobId WHERE j.threadId=? ORDER BY ${order}`).all(threadId) as HistoryRow[] : [];
    const attempts = associated('job_attempts', 'r.id,r.jobId,r.number,r.state,r.revision,r.dispatchClaimed,r.handoffMarked,r.workspacePrepared,r.predecessorAttemptId,r.authorizationFingerprint,r.startedAt,r.deadlineAt,r.endedAt,r.reason,r.providerHandle', 'r.jobId,r.number,r.id').map((row): ExportedAttempt => {
      const { providerHandle, ...attempt } = row;
      return { ...attempt, dispatchClaimed: !!row.dispatchClaimed, handoffMarked: !!row.handoffMarked, workspacePrepared: !!row.workspacePrepared,
        providerObservation: providerHandle === null ? null : historyFields(JSON.parse(String(providerHandle)), ['threadId', 'turnId', 'state', 'revision', 'tombstone']) };
    });
    const authorizations = associated('consent_attempt_authorizations', 'r.id,r.jobId,r.attemptId,r.grantId,r.grantRevision,r.sitePermissionEpoch,r.site,r.scope,r.recipient,r.provider,r.policyKey,r.bindingDigest,r.permissionFingerprint,r.egressEventId,r.createdAt,r.dispatchedAt,r.acceptedAt,r.outcome', 'r.createdAt,r.id');
    const egress = associated('egress_events', 'r.id,r.jobId,r.attemptId,r.grantId,r.grantRevision,r.recipient,r.scope,r.provider,r.policyKey,r.contextHashes,r.permissionFingerprint,r.approvedAt,r.dispatchedAt,r.outcome,r.fetched,r.complete,r.updatedAt', 'r.approvedAt,r.id').map((row): ExportedEgress => {
      const { fetched, contextHashes, complete, ...event } = row;
      const hashes: unknown = JSON.parse(String(contextHashes));
      if (!Array.isArray(hashes) || hashes.some(hash => typeof hash !== 'string' || !isDigest(hash))) throw new Error('Saved context hashes are invalid.');
      return { ...event, contextHashes: hashes as string[], fetched: exportFetches(String(fetched)), retrievalComplete: !!complete };
    });
    return { authority: 'host-recorded' as const, missingTables, jobs: jobs.map((row): ExportedJob => {
      const { context, capabilities, ...job } = row;
      return { ...job, cancelRequested: !!job.cancelRequested, request: exportRequest(String(context)), capabilities: historyStrings(JSON.parse(String(capabilities))) };
    }), attempts, authorizations, egress };
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

type HistoryRow = Record<string, JsonValue>;
type ExportedJob = HistoryRow & { cancelRequested: boolean; request: HistoryRow; capabilities: string[] };
type ExportedAttempt = HistoryRow & { providerObservation: HistoryRow | null };
type ExportedEgress = HistoryRow & { contextHashes: string[]; fetched: HistoryRow[]; retrievalComplete: boolean };
function historyFields(value: unknown, fields: readonly string[]): HistoryRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved execution history is invalid.');
  const record = value as Record<string, unknown>, result: HistoryRow = {};
  for (const key of fields) {
    if (!Object.hasOwn(record, key)) continue;
    const item = record[key];
    if (item !== null && typeof item !== 'string' && typeof item !== 'boolean' && !(typeof item === 'number' && Number.isFinite(item))) throw new Error('Saved execution history is invalid.');
    result[key] = item as JsonValue;
  }
  return result;
}
function exportFetches(serialized: string): HistoryRow[] {
  const records: unknown = JSON.parse(serialized);
  if (!Array.isArray(records)) throw new Error('Saved fetched-resource history is invalid.');
  return records.map(value => {
    const record = historyFields(value, ['requestedUrl', 'finalUrl', 'status', 'contentType', 'sha256', 'bytes', 'fetchedAt', 'outcome']);
    if (!Array.isArray(value.redirects)) throw new Error('Saved redirects are invalid.');
    const redirects = value.redirects.map((hop: unknown) => historyFields(hop, ['url', 'status', 'location']));
    const redacted: string[] = [];
    const cleanUrl = (item: HistoryRow, key: string, label: string) => {
      if (typeof item[key] !== 'string') return;
      try {
        const url = new URL(item[key]);
        if (url.username || url.password) {
          url.username = ''; url.password = ''; item[key] = url.href; redacted.push(label);
        }
      } catch { item[key] = null; redacted.push(label); }
    };
    for (const key of ['requestedUrl', 'finalUrl']) cleanUrl(record, key, key);
    redirects.forEach((hop: HistoryRow, index: number) => {
      cleanUrl(hop, 'url', `redirects.${index}.url`); cleanUrl(hop, 'location', `redirects.${index}.location`);
    });
    return { ...record, redirects, ...(redacted.length ? { redactedUrls: redacted } : {}) };
  });
}

function historyStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Saved execution history is invalid.');
  return value;
}
function exportRequest(serialized: string): HistoryRow {
  const value = JSON.parse(serialized);
  const request = historyFields(value, ['threadId', 'sourceVersionId', 'sourceUrl', 'sourceTitle', 'sourcePageType', 'sourceCapturedAt', 'sourceHash', 'question', 'intent', 'parentReplyId', 'parentJobId', 'parentAttemptId', 'retryOfJobId', 'preparedPayloadDigest', 'modelSettingsRevision', 'modelCompatibilityKey']);
  if (value.passage) request.passage = historyFields(value.passage, ['kind', 'exact', 'prefix', 'suffix', 'start', 'end']);
  if (value.answeredNote) request.answeredNote = historyFields(value.answeredNote, ['noteId', 'revision', 'text', 'createdAt']);
  if (value.outgoing) {
    const packet = value.outgoing, outgoing = historyFields(packet, ['schema', 'intent', 'question', 'parentReplyId']);
    outgoing.source = historyFields(packet.source, ['url', 'title', 'pageType', 'capturedAt', 'sourceHash', 'sourceVersionId']);
    outgoing.selection = historyFields(packet.selection, ['exact', 'prefix', 'suffix', 'start', 'end', 'originalEnd', 'omittedCharacters']);
    outgoing.adjacentContext = historyFields(packet.adjacentContext, ['before', 'after', 'basis']);
    if (packet.answeredNote) outgoing.answeredNote = historyFields(packet.answeredNote, ['noteId', 'revision', 'text', 'originalCharacters', 'omittedCharacters']);
    outgoing.availableCapabilities = historyStrings(packet.availableCapabilities);
    outgoing.omissions = historyStrings(packet.omissions);
    request.outgoing = outgoing;
  }
  return request;
}

// Membership, not MAX(version): T06/T13 share this database but own their migrations.
function normalizeHistoricalVocabularyTerm(value: string): string {
  const term = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ') : '';
  if (!term) throw new Error('A historical vocabulary term is invalid. Nothing was migrated.');
  return term;
}
function vocabularyTermKey(value: string): string { return value.normalize('NFC').trim().replace(/\s+/gu, ' '); }

const READER_MIGRATIONS = [1, 2, 4, 7001, 7002, 7004, 18001, 18002, 22001, 33001] as const;
const KNOWN_MIGRATIONS = new Set<number>([...READER_MIGRATIONS, 3, 13]);
type ReaderSchema = { versions: number[]; hasSchema: boolean; vocabularyV2: boolean };
type BackupManifest = { schema: 'marginalia.reader-backup.v1'; createdAt: string; versions: number[]; sha256: string };

export class UnsupportedReaderSchemaError extends Error {
  override name = 'UnsupportedReaderSchema';
}
export class ReaderMigrationError extends Error {
  override name = 'ReaderMigration';
  readonly backupPath: string;
  readonly backupVerified: boolean;
  constructor(message: string, backupPath: string, backupVerified: boolean, cause: unknown) {
    super(message, { cause });
    this.backupPath = backupPath;
    this.backupVerified = backupVerified;
  }
}

function inspectReaderSchema(db: Database.Database): ReaderSchema {
  // These product-owned pragma markers are unused (zero) in this build. SQLite's
  // automatic schema_version counter is deliberately NOT a product version marker.
  if (db.pragma('user_version', { simple: true }) !== 0 || db.pragma('application_id', { simple: true }) !== 0) {
    throw new UnsupportedReaderSchemaError('This database has an unsupported schema marker. Open it with the matching newer build. Nothing was migrated.');
  }
  const objects = db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as { name: string; type: string }[];
  const hasSchema = objects.length > 0;
  if (!objects.some(object => object.name === 'migrations' && object.type === 'table')) {
    if (hasSchema) throw new UnsupportedReaderSchemaError('This database has no recognized migration history. Nothing was migrated.');
    return { versions: [], hasSchema: false, vocabularyV2: false };
  }
  const columns = db.prepare('PRAGMA table_info(migrations)').all() as { name: string; type: string; pk: number }[];
  if (columns.length !== 1 || columns[0].name !== 'version' || columns[0].type.toUpperCase() !== 'INTEGER' || columns[0].pk !== 1) {
    throw new UnsupportedReaderSchemaError('The migration history has an unsupported shape. Nothing was migrated.');
  }
  const versions = (db.prepare('SELECT version FROM migrations ORDER BY version').all() as { version: number }[]).map(row => row.version);
  if (versions.some(version => !Number.isSafeInteger(version) || !KNOWN_MIGRATIONS.has(version)) || (!versions.length && objects.some(object => object.name !== 'migrations'))) {
    throw new UnsupportedReaderSchemaError('This database contains a newer or unknown migration. Open it with a compatible build. Nothing was migrated.');
  }
  const vocabularyV2 = objects.some(object => object.name === 'vocabulary' && object.type === 'table')
    && (db.prepare('PRAGMA table_info(vocabulary)').all() as { name: string }[]).some(column => column.name === 'termKey');
  if (versions.includes(22001) && !vocabularyV2) throw new UnsupportedReaderSchemaError('The vocabulary migration marker does not match its schema. Nothing was migrated.');
  if (versions.includes(18001)) {
    const columns = (db.prepare('PRAGMA table_info(instant_usage)').all() as { name: string }[]).map(column => column.name);
    if (!['requestId', 'pageKeyHash', 'kind', 'periodStart', 'timezone', 'model', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'reservedTokens', 'state', 'createdAt', 'settledAt'].every(name => columns.includes(name))) {
      throw new UnsupportedReaderSchemaError('The instant usage migration marker does not match its schema. Nothing was migrated.');
    }
  }
  if (versions.includes(18002)) {
    const instantSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='instant_usage'").get() as { sql: string } | undefined)?.sql ?? '';
    const columns = (db.prepare('PRAGMA table_info(auto_assist_events)').all() as { name: string }[]).map(column => column.name);
    if (!instantSql.includes("'auto-definition'") || !['eventId', 'candidateId', 'pageKeyHash', 'scorerMethod', 'scorerVersion', 'scoreBand', 'rankInBand', 'reasonBits', 'posture', 'bandIndex', 'event', 'elapsedBucket', 'createdAt'].every(name => columns.includes(name))) {
      throw new UnsupportedReaderSchemaError('The auto assist migration marker does not match its schema. Nothing was migrated.');
    }
  }
  return { versions, hasSchema, vocabularyV2 };
}
function needsReaderMigration(schema: ReaderSchema) {
  return READER_MIGRATIONS.some(version => !schema.versions.includes(version)) || !schema.vocabularyV2;
}
function verifySqliteIntegrity(db: Database.Database) {
  const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
  if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('SQLite integrity verification failed.');
}
function backupDirectory(filename: string) {
  // Resolve symlinked source files to one sibling backup location where possible.
  return `${existsSync(filename) ? realpathSync(filename) : filename}.backups`;
}
function requireDirectory(directory: string) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Backup location must be an ordinary directory.');
}
function syncFile(filename: string) {
  const fd = openSync(filename, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(directory: string) {
  // Node does not expose a portable Windows directory-fsync handle. SQLite and the
  // file fsync still flush the snapshot; POSIX also flushes directory entries.
  if (process.platform === 'win32') return;
  const fd = openSync(directory, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function backupDigest(filename: string) {
  const fd = openSync(filename, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes: number;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
    return hash.digest('hex');
  } finally { closeSync(fd); }
}
function verifyBackup(directory: string): BackupManifest {
  requireDirectory(directory);
  const filename = join(directory, 'reader.sqlite'), metadata = join(directory, 'verified.json');
  for (const file of [filename, metadata]) if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Backup files must be ordinary files.');
  const manifest = JSON.parse(readFileSync(metadata, 'utf8')) as BackupManifest;
  if (manifest.schema !== 'marginalia.reader-backup.v1' || !Array.isArray(manifest.versions) || !Number.isFinite(Date.parse(manifest.createdAt)) || !isDigest(manifest.sha256) || backupDigest(filename) !== manifest.sha256) {
    throw new Error('Backup verification record does not match the snapshot.');
  }
  const check = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    verifySqliteIntegrity(check);
    if (JSON.stringify(inspectReaderSchema(check).versions) !== JSON.stringify(manifest.versions)) throw new Error('Backup migration history does not match.');
  } finally { check.close(); }
  return manifest;
}
function createPreUpgradeBackup(filename: string, schema: ReaderSchema): string {
  const root = backupDirectory(filename);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  requireDirectory(root);
  // Recovery is the default disposition, including interruption before verification.
  // Only a successfully completed opening makes a snapshot eligible for rotation.
  const directory = join(root, `recovery-${Date.now()}-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  syncDirectory(root);
  const snapshot = join(directory, 'reader.sqlite');
  try {
    const reader = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      reader.pragma('synchronous = FULL');
      reader.prepare('VACUUM main INTO ?').run(snapshot);
    } finally { reader.close(); }
    chmodSync(snapshot, 0o600);
    syncFile(snapshot);
    const check = new Database(snapshot, { readonly: true, fileMustExist: true });
    try {
      verifySqliteIntegrity(check);
      if (JSON.stringify(inspectReaderSchema(check).versions) !== JSON.stringify(schema.versions)) throw new Error('Source changed while making the backup.');
    } finally { check.close(); }
    const manifest: BackupManifest = { schema: 'marginalia.reader-backup.v1', createdAt: new Date().toISOString(), versions: schema.versions, sha256: backupDigest(snapshot) };
    const metadata = join(directory, 'verified.json');
    writeFileSync(metadata, JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
    syncFile(metadata);
    syncDirectory(directory);
    syncDirectory(root);
    verifyBackup(directory);
    return directory;
  } catch (error) {
    throw new ReaderMigrationError('A verified pre-upgrade backup could not be completed. Nothing was migrated; the recovery files were retained.', directory, false, error);
  }
}
function finishRoutineBackup(directory: string): string {
  verifyBackup(directory);
  const root = dirname(directory);
  const routine = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^routine-[0-9]+-[0-9a-f-]{36}$/.test(entry.name))
    .map(entry => join(root, entry.name));
  const verified: { directory: string; createdAt: string }[] = [];
  for (const entry of routine) {
    try { verified.push({ directory: entry, createdAt: verifyBackup(entry).createdAt }); }
    catch {
      // Corrupt/unverifiable copies are recovery material too, never routine deletion.
      renameSync(entry, join(root, `recovery-${Date.now()}-${randomUUID()}`));
    }
  }
  verified.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.directory.localeCompare(b.directory));
  // The new verified copy is still protected while pruning, so an error never makes
  // three routine backups or destroys the only verified pre-upgrade snapshot.
  for (const old of verified.slice(0, Math.max(0, verified.length - 1))) rmSync(old.directory, { recursive: true });
  const destination = join(root, basename(directory).replace(/^recovery-/, 'routine-'));
  renameSync(directory, destination);
  try { syncDirectory(root); }
  catch (error) {
    // A failed finalization must not make this opening's backup eligible for pruning.
    renameSync(destination, directory);
    throw error;
  }
  return destination;
}
