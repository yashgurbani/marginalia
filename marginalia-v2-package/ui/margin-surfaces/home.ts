import { el, button } from '../dom.ts';
import { mountNoteEditor } from '../note-editor.ts';
import type { SourceCapture, Thread } from '../../contracts/reader.ts';

type EditorView = {
  draft?: { text: string; wholePage: boolean; passage: string };
  saving: boolean; locked: boolean; canChange: boolean; hydrated: boolean; storageReady: boolean;
  attachmentSaveFailed: boolean; originalCapture: boolean; retainedMutation: boolean;
};
const excerpt = (text: string, length = 82) => text.length > length ? text.slice(0, length) + '…' : text;

type Note = Thread['notes'][number];
const actionButton = (key: string, text: string, run: () => unknown) => { const control = button(text, run); control.dataset.focusKey = key; return control; };
const actions = (...children: HTMLElement[]) => { const row = el('div', undefined, 'm-actions'); row.append(...children); return row; };

export function mountHomeSurface(capture: SourceCapture, instance: string) {
  const heading = el('header', undefined, 'm-head');
  const sourceTitle = el('h1', capture.title); sourceTitle.id = instance + '-source-title';
  heading.setAttribute('role', 'region'); heading.setAttribute('aria-labelledby', sourceTitle.id);
  const knownField = (value?: string) => Boolean(value && value.trim() && value.trim().toLowerCase() !== 'unknown');
  const sourceMetadata = el('p', [capture.pageType, capture.author, capture.publicationDate, capture.venue].filter(knownField).join(' · '), 'm-meta');
  sourceMetadata.id = instance + '-source-metadata';
  const headline = el('div', undefined, 'm-headline'); headline.append(sourceTitle);
  heading.append(headline, sourceMetadata);
  const compose = el('div', undefined, 'm-compose');
  const reading = el('div', undefined, 'm-reading');
  const groupLead = new Map<string, string>();
  let editor: ReturnType<typeof mountNoteEditor>;
  let writeButton: HTMLButtonElement, readingTitle: HTMLHeadingElement, followingLabel: HTMLSpanElement, followButton: HTMLButtonElement;
  return {
    heading, headline, sourceTitle, sourceMetadata, compose, reading, groupLead,
    mountReading(commands: { beginDraft(): void; canBeginDraft(): boolean; follow(): void }) {
      writeButton = button('Write here…', commands.beginDraft); writeButton.className = 'm-write'; compose.append(writeButton);
      writeButton.addEventListener('focus', () => { if (commands.canBeginDraft()) commands.beginDraft(); });
      readingTitle = el('h2'); readingTitle.tabIndex = -1;
      followingLabel = el('span', '', 'm-meta');
      followButton = button('Follow reading', () => { commands.follow(); readingTitle.focus(); });
      reading.append(readingTitle, followingLabel, followButton);
      return { writeButton, readingTitle, followingLabel, followButton };
    },
    mountEditor(commands: Parameters<typeof mountNoteEditor>[1]) { editor = mountNoteEditor(compose, commands); return editor; },
    updateEditor(view: EditorView) {
      editor.update(view.draft ? {
        text: view.draft.text, continuous: true,
        attachment: view.draft.wholePage ? 'Note on the whole page' : `Note on "${excerpt(view.draft.passage, 66)}"`,
        saving: view.saving, locked: view.locked, canChange: view.canChange,
        message: !view.storageReady ? 'Local storage is unavailable. Export this memory-only draft before closing.' : view.attachmentSaveFailed ? 'This attachment change is not saved yet. Retry saving in Settings; your text is retained.' : view.originalCapture ? 'The original captured passage is retained. Change explicitly adopts the current capture.' : view.retainedMutation ? 'This exact change is retained. Retry saving or resolve its conflict before editing.' : ''
      } : { text: '', attachment: '', saving: false, locked: !view.hydrated, canChange: false, message: '', continuous: true });
    },
    updateEmpty(threadList: HTMLElement, count: number) {
      const empty = threadList.querySelector('.m-empty'); empty?.remove();
      if (!count) threadList.append(el('p', 'Suggestions appear as you write. Your notes, highlights and replies get marked on the left.', 'm-empty'));
    },
    groupThreads(threads: Thread[], threadNodes: ReadonlyMap<string, { node: HTMLElement }>) {
      groupLead.clear();
      // Every note keeps its own page-order entry. Same quotation text never
      // creates a count disclosure or hides another independently saved note.
      for (const thread of threads) {
        const node = threadNodes.get(thread.id)?.node;
        const repeats = node && [...node.children].find((child): child is HTMLDetailsElement => child.classList.contains('m-thread-repeats'));
        if (!node || !repeats) continue;
        const summary = repeats.querySelector('summary')!;
        const followers = threads.filter(other => groupLead.get(other.id) === thread.id);
        if (!followers.length) { repeats.hidden = true; repeats.open = false; repeats.replaceChildren(summary); continue; }
        const notes = followers.reduce((sum, other) => sum + other.notes.filter(note => !note.deletedAt).length, 0);
        summary.textContent = '';
        repeats.hidden = false;
        repeats.replaceChildren(summary, ...followers.map(other => threadNodes.get(other.id)!.node));
      }
    },

    updateHydration(hydrated: boolean) { writeButton.hidden = true; writeButton.disabled = !hydrated; },
    updateReadingTitle(title: string) { readingTitle.textContent = title; },
    updateSection(index: number, count: number) {
      followButton.hidden = true; followingLabel.hidden = false;
      followingLabel.textContent = count > 1 ? `Section ${index + 1} of ${count}` : '';
    },
    noteBlocks(thread: Thread, commands: { edit(note: Note): unknown; read(note: Note): unknown; ask(note: Note): unknown; remove(note: Note): unknown }) {
      const noteBlocks: HTMLElement[] = [];
      for (const note of thread.notes.filter(note => !note.deletedAt)) {
        const edit = actionButton(thread.id + ':' + 'edit-note', 'Edit note', () => commands.edit(note)); edit.dataset.focusKey = thread.id + ':note:' + note.id;
        const remove = actionButton(thread.id + ':remove-note:' + note.id, 'Remove this note', () => commands.remove(note));
        const noteTools = actions(edit, actionButton(thread.id + ':ask-note:' + note.id, 'Ask about this note', () => commands.ask(note)), remove);
        noteTools.classList.add('m-thread-tools');
        const noteText = button(note.text, () => commands.read(note)); noteText.className = 'm-note';
        const noteBlock = el('div', undefined, 'm-reader-note'); noteBlock.append(noteText, noteTools); noteBlocks.push(noteBlock);
      }
      return noteBlocks;
    },
  };
}
