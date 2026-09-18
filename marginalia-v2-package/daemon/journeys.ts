import { createHash } from 'node:crypto';
import type { JournalDay } from '../contracts/journal.ts';
import type { JourneyMember, JourneyReason, SuggestedJourney } from '../contracts/journeys.ts';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const key = (member: JourneyMember) => JSON.stringify([member.sourceVersionId, member.threadId]);
const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
const contains = (text: string, term: string) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}+#])${escaped}(?![\\p{L}\\p{N}\\p{M}+#])`, 'u').test(text);
};
type Evidence = { member: JourneyMember; url: string; title: string; terms: Set<string>; times: number[] };

/** Literal saved evidence only. Time adds weight to an existing relationship;
 * generated reply prose and inferred browsing history provide no topic evidence.
 * Complete-link membership keeps a bridge passage from joining unrelated topics. */
export function suggestJourneys(day: JournalDay, vocabulary: readonly string[]): SuggestedJourney[] {
  const terms = [...new Set(vocabulary.map(normalize).filter(Boolean))].sort(compare);
  const entries = new Map<string, Evidence>();
  for (const source of day.sources) for (const item of source.items) {
    const member = { threadId: item.threadId, sourceVersionId: source.id }, id = key(member);
    let entry = entries.get(id);
    if (!entry) { entry = { member, url: source.url, title: source.title, terms: new Set(), times: [] }; entries.set(id, entry); }
    const at = Date.parse(item.at);
    if (!Number.isFinite(at)) throw new Error('A saved journey date needs review.');
    entry.times.push(at);
    // Keep source and note boundaries separate, so a term cannot span two texts.
    const texts = [normalize(item.anchor.exact), ...(item.note ? [normalize(item.note.text)] : [])];
    for (const term of terms) if (texts.some(text => contains(text, term))) entry.terms.add(term);
  }
  const relation = (a: Evidence, b: Evidence): JourneyReason => {
    const sharedTerms = [...a.terms].filter(term => b.terms.has(term)).sort(compare);
    const sameAddress = a.url.length > 0 && a.url === b.url;
    const nearbySavedActivity = a.times.some(left => b.times.some(right => Math.abs(left - right) <= 30 * 60 * 1000));
    const topical = (sameAddress ? 4 : 0) + sharedTerms.length * 2;
    return { left: a.member, right: b.member, sharedTerms, sameAddress, nearbySavedActivity, score: topical + (topical > 0 && nearbySavedActivity ? 1 : 0) };
  };
  const groups: Evidence[][] = [];
  for (const entry of [...entries.values()].sort((a, b) => compare(key(a.member), key(b.member)))) {
    const candidates = groups.map((group, index) => ({ index, scores: group.map(other => relation(other, entry).score) }))
      .filter(candidate => candidate.scores.every(score => score >= 4))
      .sort((a, b) => Math.min(...b.scores) - Math.min(...a.scores) || a.index - b.index);
    if (candidates.length) groups[candidates[0].index].push(entry); else groups.push([entry]);
  }
  return groups.map(group => {
    const members = group.map(entry => entry.member), reasons: JourneyReason[] = [];
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) reasons.push(relation(group[i], group[j]));
    const shared = terms.filter(term => group.every(entry => entry.terms.has(term)));
    const name = shared.slice(0, 2).join(' · ') || group[0].title || 'Saved passages';
    const id = createHash('sha256').update(JSON.stringify([day.date, day.timeZone, members])).digest('hex');
    return { id, name, members, reasons, origin: 'local', algorithm: 'saved-activity-complete-link.v1' };
  });
}
