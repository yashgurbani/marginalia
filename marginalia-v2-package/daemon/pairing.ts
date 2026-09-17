import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { digest, type ReaderStore } from './store.ts';

export class Pairing {
  private challengeHash = '';
  private expires = 0;
  private attempts = 0;
  private store: ReaderStore;
  constructor(store: ReaderStore) {
    this.store = store;
    store.db.exec('CREATE TABLE IF NOT EXISTS pairing_tokens(hash TEXT PRIMARY KEY, origin TEXT NOT NULL, createdAt TEXT NOT NULL, revokedAt TEXT)');
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
    this.store.db.prepare('INSERT INTO pairing_tokens VALUES(?,?,?,NULL)').run(digest(token), origin, new Date(now).toISOString());
    this.challengeHash = ''; this.expires = 0;
    return token;
  }
  valid(token: unknown, origin: string): token is string {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    return !!this.store.db.prepare('SELECT 1 FROM pairing_tokens WHERE hash=? AND origin=? AND revokedAt IS NULL').get(digest(token), origin);
  }
  revoke(token: string) { this.store.db.prepare('UPDATE pairing_tokens SET revokedAt=? WHERE hash=?').run(new Date().toISOString(), digest(token)); }
}
