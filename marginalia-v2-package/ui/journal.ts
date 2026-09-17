import type { ReaderMutation, Thread } from '../contracts/reader.ts';

export type JournalState = { threads: Thread[]; pending: ReaderMutation[]; conflicts: { change: ReaderMutation; message: string }[] };
export type Persistence = { load: () => Promise<JournalState | undefined>; save: (value: JournalState) => Promise<void> };
export class ReaderJournal {
  state: JournalState = { threads: [], pending: [], conflicts: [] };
  private persistence: Persistence;
  private operations: Promise<unknown> = Promise.resolve();
  constructor(persistence: Persistence) { this.persistence = persistence; }
  async load() { this.state = await this.persistence.load() ?? this.state; return this.state; }
  async change(m: ReaderMutation) {
    const operation = this.operations.then(async () => {
      const next = structuredClone(this.state);
      if (next.pending.some(change => change.id === m.id)) return;
      const now = new Date().toISOString();
      if (m.kind === 'keep') {
        if (next.threads.some(t => t.id === m.threadId)) throw new Error('This passage was already saved.');
        next.threads.push({ id: m.threadId, anchorId: m.threadId + '-anchor', sourceVersionId: '', sourceUrl: m.capture.url, sourceTitle: m.capture.title, state: 'open', revision: 1, createdAt: now, updatedAt: now, deletedAt: null, anchor: m.anchor, highlighted: true, notes: m.note ? [{ id: m.id + '-note', threadId: m.threadId, text: m.note, revision: 1, createdAt: now, deletedAt: null }] : [] });
      } else {
        const thread = next.threads.find(t => t.id === m.threadId);
        if (!thread) throw new Error('The saved passage could not be found.');
        if (m.kind === 'note') {
          const note = thread.notes.find(n => n.id === m.noteId);
          if ((note?.revision ?? 0) !== m.expectedRevision) throw new Error('The note changed. Keep your draft and reopen the saved version.');
          if (note) { note.text = m.text; note.revision++; }
          else thread.notes.push({ id: m.noteId, threadId: m.threadId, text: m.text, revision: 1, createdAt: now, deletedAt: null });
        } else {
          if (thread.revision !== m.expectedRevision) throw new Error('This thread changed. Reopen it before applying the change.');
          if (m.kind === 'thread-state') thread.state = m.state;
          else thread.deletedAt = m.removed ? now : null;
        }
        thread.revision++; thread.updatedAt = now;
      }
      next.pending.push(m);
      await this.persistence.save(next); this.state = next;
    });
    this.operations = operation.catch(() => {});
    await operation;
  }
  async sync(send: (change: ReaderMutation) => Promise<void>, list: () => Promise<Thread[]>) {
    const operation = this.operations.then(async () => {
      while (this.state.pending.length) {
        const change = this.state.pending[0];
        try { await send(change); }
        catch (error) {
          if (error instanceof Error && error.name === 'Conflict') {
            this.state.conflicts.push({ change, message: error.message });
            await this.persistence.save(this.state);
          }
          throw error;
        }
        const next = { ...this.state, pending: this.state.pending.slice(1) };
        await this.persistence.save(next); this.state = next;
      }
      const remote = await list();
      const next = { ...this.state, threads: remote };
      await this.persistence.save(next); this.state = next;
    });
    this.operations = operation.catch(() => {});
    await operation;
  }
}
