import type { AutoAssistElapsedBucket, AutoAssistEvent, AutoAssistEventKind, AutoAssistPosture, DifficultyMethod } from '../contracts/auto-assist.ts';
import { isDigest } from '../contracts/digest.ts';
import { ConflictError, type ReaderStore } from './store.ts';

const METHODS = new Set<DifficultyMethod>(['frequency-page-v0', 'causal-lm-v1']);
const POSTURES = new Set<AutoAssistPosture>(['flow', 'balanced', 'learning']);
const EVENTS = new Set<AutoAssistEventKind>(['nominated', 'shown', 'definition-ready', 'definition-opened', 'dismissed-familiar', 'kept', 'asked']);
const BUCKETS = new Set<AutoAssistElapsedBucket>([null, '<2s', '2-10s', '10-60s', '>60s']);
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Text-free local outcome records. Rows are append-only and carry no page payload. */
export class AutoAssistStore {
  readonly reader: ReaderStore;
  constructor(reader: ReaderStore) { this.reader = reader; }

  record(input: AutoAssistEvent): AutoAssistEvent {
    const event = validateEvent(input);
    const previous = this.reader.db.prepare('SELECT * FROM auto_assist_events WHERE eventId=?').get(event.eventId) as AutoAssistEvent | undefined;
    if (previous) {
      if (!sameEvent(previous, event)) throw new ConflictError('This auto assist event identifier was already used for different content.');
      return previous;
    }
    this.reader.db.prepare(`INSERT INTO auto_assist_events(
      eventId,candidateId,pageKeyHash,scorerMethod,scorerVersion,scoreBand,rankInBand,reasonBits,posture,bandIndex,event,elapsedBucket,createdAt
    ) VALUES(@eventId,@candidateId,@pageKeyHash,@scorerMethod,@scorerVersion,@scoreBand,@rankInBand,@reasonBits,@posture,@bandIndex,@event,@elapsedBucket,@createdAt)`).run(event);
    return event;
  }

  list(candidateId?: string): AutoAssistEvent[] {
    if (candidateId !== undefined && !isDigest(candidateId)) throw new Error('Invalid auto assist candidate identifier.');
    return (candidateId === undefined
      ? this.reader.db.prepare('SELECT * FROM auto_assist_events ORDER BY createdAt,eventId').all()
      : this.reader.db.prepare('SELECT * FROM auto_assist_events WHERE candidateId=? ORDER BY createdAt,eventId').all(candidateId)) as AutoAssistEvent[];
  }
}

function validateEvent(value: AutoAssistEvent): AutoAssistEvent {
  if (!value || typeof value !== 'object') throw new Error('Invalid auto assist event.');
  const keys = Object.keys(value).sort();
  const expected = ['bandIndex', 'candidateId', 'createdAt', 'elapsedBucket', 'event', 'eventId', 'pageKeyHash', 'posture', 'rankInBand', 'reasonBits', 'scoreBand', 'scorerMethod', 'scorerVersion'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error('Invalid auto assist event fields.');
  if (typeof value.eventId !== 'string' || !EVENT_ID.test(value.eventId)) throw new Error('Invalid auto assist event identifier.');
  if (!isDigest(value.candidateId) || !isDigest(value.pageKeyHash)) throw new Error('Invalid auto assist opaque identifier.');
  if (!METHODS.has(value.scorerMethod) || typeof value.scorerVersion !== 'string' || !value.scorerVersion || value.scorerVersion.length > 100) throw new Error('Invalid auto assist scorer.');
  if (![0, 1, 2, 3].includes(value.scoreBand) || !whole(value.rankInBand) || !whole(value.reasonBits) || !whole(value.bandIndex)) throw new Error('Invalid auto assist ranking.');
  if (!POSTURES.has(value.posture) || !EVENTS.has(value.event) || !BUCKETS.has(value.elapsedBucket)) throw new Error('Invalid auto assist outcome.');
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid auto assist event time.');
  return structuredClone(value);
}

function whole(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function sameEvent(left: AutoAssistEvent, right: AutoAssistEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
