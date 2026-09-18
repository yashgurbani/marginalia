import type { ReaderStore } from './store.ts';
import type { NoteVersion } from '../contracts/reader.ts';
import type { JournalDay, JournalItem, ReadingJournal } from '../contracts/journal.ts';

/** A read-only snapshot of dated saved activity. Never infer a visit from an edit. */
export function readJournal(store: ReaderStore, timeZone: string): ReadingJournal {
  if (typeof timeZone !== 'string' || timeZone.length > 100) throw new Error('Choose a valid journal time zone.');
  let calendar: Intl.DateTimeFormat;
  try { calendar = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { throw new Error('Choose a valid journal time zone.'); }
  const zone = calendar.resolvedOptions().timeZone;
  const dayOf = (at: string) => {
    const date = new Date(at);
    if (!Number.isFinite(date.getTime())) throw new Error('A saved journal date needs review.');
    const parts = calendar.formatToParts(date), part = (name: string) => parts.find(p => p.type === name)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  return store.db.transaction((): ReadingJournal => {
    const days = new Map<string, JournalDay>();
    for (const thread of store.list()) {
      const source = store.sourceVersion(thread.sourceVersionId);
      if (!source) throw new Error('A saved journal source is unavailable.');
      const append = (item: JournalItem) => {
        const date = dayOf(item.at);
        let day = days.get(date);
        if (!day) { day = { date, timeZone: zone, sources: [] }; days.set(date, day); }
        let group = day.sources.find(value => value.id === source.id);
        if (!group) { group = { id: source.id, hash: source.hash, url: thread.sourceUrl, title: source.title ?? thread.sourceTitle, items: [] }; day.sources.push(group); }
        group.items.push(item);
      };
      const base = { threadId: thread.id, anchor: thread.anchor };
      append({ ...base, id: `thread:${thread.id}`, kind: thread.anchor.kind === 'whole-page' ? 'bookmark' : 'passage', at: thread.createdAt });
      for (const note of thread.notes.filter(note => !note.deletedAt)) {
        const versions = store.db.prepare('SELECT noteId,revision,text,createdAt FROM note_versions WHERE noteId=? ORDER BY revision').all(note.id) as NoteVersion[];
        // The day's last authored revision preserves history without showing every keystroke/save.
        const latestPerDay = new Map<string, NoteVersion>();
        for (const version of versions) latestPerDay.set(dayOf(version.createdAt), version);
        for (const version of latestPerDay.values()) append({ ...base, id: `note:${note.id}:${version.revision}`, kind: 'note', at: version.createdAt, note: version, currentNoteRevision: note.revision });
      }
      const highlights = store.db.prepare('SELECT id,createdAt FROM highlights WHERE threadId=? AND deletedAt IS NULL ORDER BY createdAt,id').all(thread.id) as { id: string; createdAt: string }[];
      for (const highlight of highlights) append({ ...base, id: `highlight:${highlight.id}`, kind: 'highlight', at: highlight.createdAt });
      for (const reply of store.replies(thread.id)) append({ ...base, id: `reply:${reply.id}`, kind: 'reply', at: reply.createdAt, reply });
    }
    const compare = (a: JournalItem, b: JournalItem) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id);
    for (const day of days.values()) {
      for (const source of day.sources) source.items.sort(compare);
      day.sources.sort((a, b) => compare(a.items[0], b.items[0]) || a.id.localeCompare(b.id));
    }
    return { schema: 'marginalia.journal.v1', coverage: 'saved-activity', timeZone: zone, days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)) };
  })();
}
