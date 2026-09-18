import { createHash } from 'node:crypto';
import { ConflictError, type ReaderStore } from './store.ts';
import type { JourneyEditChange, JourneyEdits, JourneyMember, ReaderJourney } from '../contracts/journeys.ts';
import { suggestJourneys } from './journeys.ts';
import type { ReadingJournal } from '../contracts/journal.ts';

const memberKey = (member: JourneyMember) => JSON.stringify([member.sourceVersionId, member.threadId]);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function partition(date: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid journey day.');
  if (!validText(timeZone, 100)) throw new Error('Choose a valid journey time zone.');
  let zone: string;
  try { zone = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone; }
  catch { throw new Error('Choose a valid journey time zone.'); }
  return { zone, key: `library.journeys.v1:${JSON.stringify([date, zone])}` };
}
function validate(journeys: ReaderJourney[]) {
  if (!Array.isArray(journeys) || journeys.length > 1000) throw new Error('Choose up to 1000 journeys.');
  const ids = new Set<string>(), members = new Set<string>();
  let count = 0;
  for (const journey of journeys) {
    if (!journey || !validText(journey.id, 200) || !validText(journey.name, 300) || ids.has(journey.id) || !Array.isArray(journey.members)) throw new Error('Review the journey names and identities.');
    ids.add(journey.id);
    for (const member of journey.members) {
      if (!member || !validText(member.threadId, 200) || !validText(member.sourceVersionId, 200) || ++count > 10000) throw new Error('Review the journey passages.');
      const key = memberKey(member);
      if (members.has(key)) throw new Error('Each saved passage belongs to one reader journey per day.');
      members.add(key);
    }
  }
}

/** Reader overlays store references and authored names, never content snapshots.
 * Fresh journal membership filters removals on every read, including retries. */
export class JourneyEditsStore {
  readonly reader: ReaderStore;
  constructor(reader: ReaderStore) { this.reader = reader; }

  journal(timeZone: string, vocabulary: readonly string[]): ReadingJournal {
    return this.reader.db.transaction(() => {
      const journal = this.reader.readingJournal(timeZone);
      const savedDays = this.reader.db.prepare("SELECT key FROM settings WHERE key LIKE 'library.journeys.v1:%'").all() as { key: string }[];
      for (const saved of savedDays) {
        const [date, zone] = JSON.parse(saved.key.slice('library.journeys.v1:'.length)) as [string, string];
        if (zone !== journal.timeZone || journal.days.some(day => day.date === date)) continue;
        partition(date, zone);
        if (this.stored(saved.key).journeys.length) journal.days.push({ date, timeZone: zone, sources: [] });
      }
      journal.days.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
      for (const day of journal.days) {
        const edits = this.read(day.date, journal.timeZone);
        const owned = new Set(edits.journeys.flatMap(journey => journey.members.map(memberKey)));
        const remaining = { ...day, sources: day.sources.map(source => ({ ...source, items: source.items.filter(item => !owned.has(memberKey({ threadId: item.threadId, sourceVersionId: source.id }))) })) };
        day.journeys = { ...edits, suggested: suggestJourneys(remaining, vocabulary) };
      }
      return journal;
    })();
  }

  private stored(key: string): JourneyEdits {
    const row = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    if (!row) return { revision: 0, journeys: [] };
    const value = JSON.parse(row.value) as JourneyEdits;
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Saved journey edits need review.');
    validate(value.journeys);
    return value;
  }

  read(date: string, timeZone: string): JourneyEdits {
    const { key, zone } = partition(date, timeZone);
    return this.reader.db.transaction(() => {
      const saved = this.stored(key), visible = this.visible(date, zone);
      return { revision: saved.revision, journeys: saved.journeys.map(journey => ({ ...journey, members: journey.members.filter(member => visible.has(memberKey(member))) })) };
    })();
  }

  private visible(date: string, zone: string) {
    const day = this.reader.readingJournal(zone).days.find(day => day.date === date);
    return new Set(day?.sources.flatMap(source => source.items.map(item => memberKey({ threadId: item.threadId, sourceVersionId: source.id }))) ?? []);
  }

  save(change: JourneyEditChange): JourneyEdits {
    const { key, zone } = partition(change.date, change.timeZone);
    if (!validText(change.operationId, 200) || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new Error('Review the journey operation and revision.');
    validate(change.journeys);
    // Canonical serialization ignores extra input fields and object key order.
    const journeys = change.journeys.map(journey => ({ id: journey.id, name: journey.name, members: journey.members.map(member => ({ threadId: member.threadId, sourceVersionId: member.sourceVersionId })) }));
    const hash = digest([change.date, zone, change.expectedRevision, journeys]);
    const receiptKey = `library.journey-operation.v1:${digest(change.operationId)}`;
    return this.reader.db.transaction(() => {
      const receipt = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(receiptKey) as { value: string } | undefined;
      if (receipt) {
        if (receipt.value !== hash) throw new ConflictError('This journey operation already has different content.');
        return this.read(change.date, zone);
      }
      const saved = this.stored(key);
      if (saved.revision !== change.expectedRevision) throw new ConflictError('Journeys changed elsewhere. Reload the day before saving.');
      if (saved.revision === Number.MAX_SAFE_INTEGER) throw new Error('The journey revision limit needs review.');
      const visible = this.visible(change.date, zone);
      if (journeys.some(journey => journey.members.some(member => !visible.has(memberKey(member))))) throw new ConflictError('A journey passage changed or was removed. Reload the day before saving.');
      const next = { revision: saved.revision + 1, journeys };
      this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(next));
      this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(receiptKey, hash);
      return next;
    })();
  }
}
