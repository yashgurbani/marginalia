import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { digest, type ReaderStore } from './store.ts';

export interface PairedBrowserRecord {
  id: string;
  origin: string;
  createdAt: string;
  revoked: boolean;
}

export type PairedBrowserRevocation = 'revoked' | 'already-revoked' | 'not-found';

export type PairedSession = {
  sessionId: string;
  origin: string;
  threadId?: string;
};

const stableIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class Pairing {
  private challengeHash = '';
  private expires = 0;
  private attempts = 0;
  private store: ReaderStore;
  constructor(store: ReaderStore) {
    this.store = store;
    store.db.exec('CREATE TABLE IF NOT EXISTS pairing_tokens(hash TEXT PRIMARY KEY, origin TEXT NOT NULL, createdAt TEXT NOT NULL, revokedAt TEXT, id TEXT NOT NULL, sessionId TEXT, currentThreadId TEXT)');
    store.db.transaction(() => {
      const columns = store.db.prepare('PRAGMA table_info(pairing_tokens)').all() as { name: string }[];
      if (!columns.some(column => column.name === 'id')) store.db.exec('ALTER TABLE pairing_tokens ADD COLUMN id TEXT');
      if (!columns.some(column => column.name === 'sessionId')) store.db.exec('ALTER TABLE pairing_tokens ADD COLUMN sessionId TEXT');
      if (!columns.some(column => column.name === 'currentThreadId')) store.db.exec('ALTER TABLE pairing_tokens ADD COLUMN currentThreadId TEXT');
      const rows = store.db.prepare("SELECT hash,id FROM pairing_tokens WHERE id IS NULL OR id=''").all() as { hash: string; id: string | null }[];
      const used = new Set((store.db.prepare("SELECT id FROM pairing_tokens WHERE id IS NOT NULL AND id<>''").all() as { id: string }[]).map(row => row.id));
      const backfill = store.db.prepare('UPDATE pairing_tokens SET id=? WHERE hash=?');
      for (const row of rows) {
        let id: string;
        do { id = randomUUID(); } while (used.has(id));
        used.add(id);
        backfill.run(id, row.hash);
      }
      const sessions = store.db.prepare("SELECT hash,sessionId FROM pairing_tokens WHERE sessionId IS NULL OR sessionId=''").all() as { hash: string; sessionId: string | null }[];
      const usedSessions = new Set((store.db.prepare("SELECT sessionId FROM pairing_tokens WHERE sessionId IS NOT NULL AND sessionId<>''").all() as { sessionId: string }[]).map(row => row.sessionId));
      const backfillSession = store.db.prepare('UPDATE pairing_tokens SET sessionId=? WHERE hash=?');
      for (const row of sessions) {
        let sessionId: string;
        do { sessionId = randomUUID(); } while (usedSessions.has(sessionId));
        usedSessions.add(sessionId);
        backfillSession.run(sessionId, row.hash);
      }
      store.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS pairing_tokens_stable_id ON pairing_tokens(id)');
      store.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS pairing_tokens_session_id ON pairing_tokens(sessionId)');
    })();
  }
  issue(now = Date.now()) {
    let challenge: string;
    do { challenge = String(randomInt(0, 1000000)).padStart(6, '0'); } while (digest(challenge) === this.challengeHash);
    this.challengeHash = digest(challenge); this.expires = now + 5 * 60 * 1000; this.attempts = 0;
    return challenge;
  }
  exchange(challenge: unknown, origin: string, now = Date.now()) {
    if (now >= this.expires || !this.challengeHash || this.attempts >= 5) throw new Error('Pairing expired. Request a new code from the local helper.');
    this.attempts++;
    if (typeof challenge !== 'string' || !/^\d{6}$/.test(challenge) || !timingSafeEqual(Buffer.from(digest(challenge)), Buffer.from(this.challengeHash))) throw new Error('Pairing code did not match.');
    const token = randomBytes(32).toString('base64url');
    this.store.db.prepare('INSERT INTO pairing_tokens(hash,origin,createdAt,revokedAt,id,sessionId,currentThreadId) VALUES(?,?,?,NULL,?,?,NULL)')
      .run(digest(token), origin, new Date(now).toISOString(), randomUUID(), randomUUID());
    this.challengeHash = ''; this.expires = 0;
    return token;
  }
  valid(token: unknown, origin: string): token is string {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    return !!this.store.db.prepare('SELECT 1 FROM pairing_tokens WHERE hash=? AND origin=? AND revokedAt IS NULL').get(digest(token), origin);
  }
  session(token: unknown, origin: string): PairedSession | undefined {
    if (!this.valid(token, origin)) return;
    const row = this.store.db.prepare('SELECT sessionId,origin,currentThreadId FROM pairing_tokens WHERE hash=? AND origin=? AND revokedAt IS NULL')
      .get(digest(token), origin) as { sessionId: string; origin: string; currentThreadId: string | null } | undefined;
    return row ? { sessionId: row.sessionId, origin: row.origin, ...(row.currentThreadId ? { threadId: row.currentThreadId } : {}) } : undefined;
  }
  bindThread(token: unknown, origin: string, threadId: string): PairedSession | undefined {
    if (typeof threadId !== 'string' || !/^[\w-]{1,100}$/.test(threadId) || !this.valid(token, origin)) return;
    return this.store.db.transaction(() => {
      const updated = this.store.db.prepare(`UPDATE pairing_tokens SET currentThreadId=?
        WHERE hash=? AND origin=? AND revokedAt IS NULL`)
        .run(threadId, digest(token as string), origin);
      return updated.changes === 1 ? this.session(token, origin) : undefined;
    })();
  }
  revoke(token: string) { this.store.db.prepare('UPDATE pairing_tokens SET revokedAt=? WHERE hash=? AND revokedAt IS NULL').run(new Date().toISOString(), digest(token)); }
  listPairedBrowsers(): PairedBrowserRecord[] {
    const rows = this.store.db.prepare('SELECT id,origin,createdAt,revokedAt FROM pairing_tokens ORDER BY createdAt,id')
      .all() as { id: string; origin: string; createdAt: string; revokedAt: string | null }[];
    return rows.map(({ id, origin, createdAt, revokedAt }) => ({ id, origin, createdAt, revoked: revokedAt !== null }));
  }
  revokePairedBrowser(id: unknown, now = Date.now()): PairedBrowserRevocation {
    if (typeof id !== 'string' || !stableIdPattern.test(id)) return 'not-found';
    const result = this.store.db.prepare('UPDATE pairing_tokens SET revokedAt=? WHERE id=? AND revokedAt IS NULL')
      .run(new Date(now).toISOString(), id);
    if (result.changes === 1) return 'revoked';
    return this.store.db.prepare('SELECT 1 FROM pairing_tokens WHERE id=?').get(id) ? 'already-revoked' : 'not-found';
  }
}
