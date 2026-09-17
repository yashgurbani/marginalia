import type { QuoteAnchor, ReaderMutation, SourceCapture, Thread } from '../contracts/reader.ts';
import { wholePageAnchor, attachQuote } from '../contracts/reader.ts';
import { el, button } from './dom.ts';
import { localPersistence, documentJournal, documentDraft, documentQuestion, sourceBoundJournal, unsavedDrafts, unsavedQuestions,
  retryDraftMutation, draftAfterResolution, keepDeviceConflict, resolveHelperConflict, replySaveLifecycle, type MarginDraft, type CachedReply } from './persistence.ts';
import { anchorAt, orderedThreads, sourceLocation, pageDefinition, displayPosition } from './margin-model.ts';
import { HelperClient, documentHelper, forgetPairingIfCurrent, pairingIdentity } from './helper.ts';
import { mountHelperManagement } from './helper-management.ts';
import { mountNoteEditor, type AttachmentChoice } from './note-editor.ts';
import { createT08Mount, type AskingMountFactory, type AskingSelection } from './asking-host.ts';
import type { MountedReply } from '../renderer/index.ts';
import { canonicalReplyData, validateReply, type SourceBinding, type Intent } from '../contracts/reply.ts';

export type MarginSection = { title: string; start: number; end: number };
export type MarginOptions = {
  capture?: SourceCapture; sections?: MarginSection[];
  /** Supply a source only when it belongs to this trusted document. Extension hosts use callbacks. */
  sourceRoot?: HTMLElement; onSource?: (anchor: QuoteAnchor) => void; onHighlight?: (anchor: QuoteAnchor | null) => void;
  helperOrigin?: string; storageName?: string; initialOpen?: boolean;
  /** Only the top-level localhost app opts in; the component independently checks its document. */
  helperManagement?: boolean;
  /** Disable all credential reads and helper actions in page-embedded, clickjackable hosts. */
  allowHelper?: boolean;
  authorizeHelperSend?: (sourceUrl: string) => Promise<void>;
  /** Authenticated library snapshot for viewing, never a second authoritative journal. */
  savedThread?: Thread; draftScope?: string; onLibrary?: () => void;
  askingMount?: AskingMountFactory;
};
const id = () => crypto.randomUUID();
const excerpt = (text: string, length = 82) => text.length > length ? text.slice(0, length) + '\u2026' : text;
const label = (text: string, input: HTMLElement) => { const node = el('label', text); node.append(input); return node; };
const actions = (...children: HTMLElement[]) => { const row = el('div', undefined, 'm-actions'); row.append(...children); return row; };
const mountedMargins = new WeakMap<HTMLElement, { destroy(): void; drain(): Promise<unknown> }>();
export const threadContentKey = (thread: Thread) => canonicalReplyData(thread);
export function sectionIndexAt(sections: MarginSection[], position: number): number {
  const match = sections.findIndex(section => position >= section.start && position < section.end);
  if (match >= 0) return match;
  // EOF and gaps are UI positions, not source attachment guesses.
  for (let index = sections.length - 1; index >= 0; index--) if (position >= sections[index].start) return index;
  return 0;
}
export const composerOffset = (draft: MarginDraft | undefined, position: number) => draft?.position ?? draft?.anchor.start ?? position;
export function marginItemSize(section: number, current: number, expanded: boolean, focused: boolean): 'full' | 'line' | 'tick' {
  return section < 0 || section === current || expanded || focused ? 'full' : Math.abs(section - current) === 1 ? 'line' : 'tick';
}
export function sectionMapState(sections: MarginSection[], threads: Thread[], capture: SourceCapture, current: number) {
  const ordered = orderedThreads(threads, capture);
  return sections.map((section, index) => {
    const here = ordered.filter(thread => { const at = displayPosition(thread.anchor, capture); return at !== undefined && at >= section.start && at < section.end; });
    const marked = here.filter(thread => thread.highlighted), length = Math.max(1, section.end - section.start);
    return { index, notes: here.reduce((sum, thread) => sum + thread.notes.filter(note => !note.deletedAt).length, 0),
      marks: marked.length, markPositions: marked.map(thread => Math.max(0, Math.min(1, ((displayPosition(thread.anchor, capture) ?? section.start) - section.start) / length))),
      threads: here.length, length, current: index === current };
  });
}

/** Mount in a trusted document. Recovery and source data remain in the existing reader store. */
export async function mountMargin(root: HTMLElement, options: MarginOptions = {}) {
  const previous = mountedMargins.get(root); previous?.destroy();
  const predecessorDrain = previous?.drain() ?? Promise.resolve();
  let destroyed = false, suspended = false;
  const pendingOperations = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> { pendingOperations.add(work); void work.finally(() => pendingOperations.delete(work)).catch(() => {}); return work; }
  const alive = () => !destroyed;
  const instance = 'm-' + id(), namespace = options.storageName ?? 'marginalia-reader';
  const persistence = localPersistence(namespace), journal = documentJournal(namespace, persistence.journal);
  const abort = new AbortController(), signal = abort.signal;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(namespace) : null;
  let source = options.sourceRoot;
  root.classList.add('m-app'); if (options.capture) root.classList.add('m-host-only');
  const workspace = el('div', undefined, 'm-workspace');
  if (!options.capture) { const page = demoPage(); source = page.article; options.capture = page.capture; options.sections = page.sections; workspace.append(source); }
  const capture = structuredClone(options.capture);
  const recordedSections = options.sections ?? capture.sections;
  const sections = recordedSections?.length ? structuredClone(recordedSections) : [{ title: 'Whole page', start: 0, end: capture.text.length }];
  const shell = el('aside', undefined, 'mg'); shell.id = instance; shell.setAttribute('aria-label', 'Marginalia');
  const rail = el('div', undefined, 'm-rail'), panel = el('div', undefined, 'm-panel'), bar = el('div', undefined, 'm-bar');
  const heading = el('header', undefined, 'm-head');
  const resume = button('You were here', () => {
    const latest = orderedThreads(threadsNow(), capture).filter(thread => displayPosition(thread.anchor, capture) !== undefined).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) { expanded.add(latest.id); hold(sectionFor(displayPosition(latest.anchor, capture)!)); renderPosition(); sourceAction(latest.anchor); }
  }); resume.hidden = true;
  heading.append(el('h1', capture.title), el('p', `${capture.pageType} \u00b7 ${new URL(capture.url).hostname}`, 'm-meta'), resume);
  const compose = el('div', undefined, 'm-compose'), mapSlot = el('div', undefined, 'm-map-slot');
  const map = el('nav', undefined, 'm-map'); map.setAttribute('aria-label', 'Page map: sections, notes, marks and reading position'); mapSlot.append(map);
  const reading = el('div', undefined, 'm-reading'), selectionCard = el('section', undefined, 'm-selection'); selectionCard.hidden = true;
  const threadList = el('div', undefined, 'm-threads'), footer = el('footer', undefined, 'm-footer');
  const status = el('p', '', 'm-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const toast = el('div', undefined, 'm-toast'); toast.hidden = true;
  const setup = el('section', undefined, 'm-settings'); setup.hidden = true;
  const settingsBody = el('div'), managementHost = el('div'); setup.append(settingsBody, managementHost);
  const scroll = el('div', undefined, 'm-scroll'); scroll.append(mapSlot, reading, selectionCard, threadList, footer);
  panel.append(bar, heading, setup, scroll, status, toast); shell.append(rail, panel); workspace.append(shell); root.append(workspace);
  const management = options.helperManagement && options.allowHelper !== false ? mountHelperManagement(managementHost) : undefined;
  const updateManagement = () => { if (alive() && !suspended && !setup.hidden && !shell.classList.contains('is-collapsed')) management?.open(); else management?.close(); };
  let readingPosition = 0, lastReadingPosition = 0, sectionIndex = 0, held = false;
  let helper: HelperClient | undefined, storageReady = false, saving = false, syncing = false, pairingDraft = '';
  let editorGeneration = 0, needsReconciliation = false, pendingNoteCommitted = false;
  let selected: QuoteAnchor | undefined, lastOpener: HTMLElement | null = null;
  let tabKey: string;
  try { tabKey = sessionStorage.getItem('marginalia-draft-tab') ?? id(); sessionStorage.setItem('marginalia-draft-tab', tabKey); }
  catch { tabKey = id(); }
  const scope = (options.draftScope ? ':' + options.draftScope : '');
  const draftKey = 'draft:' + tabKey + ':' + capture.url + scope, questionKey = 'question:' + tabKey + ':' + capture.url + scope;
  const draftBuffer = documentDraft(namespace, draftKey, capture, { read: () => persistence.read(draftKey), write: value => persistence.write(draftKey, value) });
  const questionBuffer = documentQuestion(namespace, questionKey, capture.url, { read: () => persistence.read(questionKey), write: value => persistence.write(questionKey, value) });
  let draft = draftBuffer.get(), questionDraft = questionBuffer.get();
  const expanded = new Set<string>(), replyLoads = new Map<string, number>();
  const threadNodes = new Map<string, { signature: string; node: HTMLElement }>();
  const replyMounts = new Map<string, { threadId: string; replyId: string; node: HTMLElement; mounted: MountedReply; flush(): Promise<void>; close(): void }>();
  function threadsNow(): Thread[] {
    const saved = options.savedThread;
    if (!saved || journal.state.threads.some(thread => thread.id === saved.id)) return journal.state.threads;
    // A deliberately retained device absence must never be undone by a library fallback.
    const known = [...journal.state.pending, ...journal.state.conflicts.map(item => item.change), ...(journal.state.resolutions ?? []).map(item => item.change)].some(change => change.threadId === saved.id);
    return known ? journal.state.threads : [...journal.state.threads, saved];
  }
  const currentThread = (threadId: string) => threadsNow().find(thread => thread.id === threadId);
  const displayAnchor = (anchor: QuoteAnchor) => anchor.kind === 'whole-page' ? 'Whole page' : anchor.exact;
  const announce = (message: string) => { if (alive()) status.textContent = message; };
  const changed = () => { if (alive()) channel?.postMessage({ type: 'changed' }); };
  const fail = (error: unknown) => {
    if (!alive()) return;
    if (error instanceof Error && error.message.startsWith('Local storage changed elsewhere.')) needsReconciliation = true;
    announce(needsReconciliation ? 'Another tab saved work. Recover unsaved changes in Settings; your draft is still here.' : pendingNoteCommitted ? 'Your note is saved. Retry saving in Settings to clear its separate draft.' : journal.unsaved ? 'Not saved yet. Retry saving or export before closing this document.' : error instanceof Error ? error.message : 'The action could not finish. Your draft is retained.');
    renderCompose(); renderSettings();
  };
  async function locked<T>(operation: () => Promise<T>): Promise<T> {
    if (!navigator.locks) throw new Error('Safe local saving needs Web Locks support. Your draft can still be exported.');
    return await navigator.locks.request(namespace, operation);
  }
  const safely = (operation: () => Promise<void>) => !alive() ? Promise.resolve() : track(operation().catch(fail));
  async function change(mutation: ReaderMutation) {
    if (!alive()) throw new Error('This margin has closed.');
    if (!storageReady) throw new Error('Local saving is unavailable. Export your memory-only draft before closing.');
    if (journal.unsaved) throw new Error('Retry saving in Settings before making another change.');
    if (mutation.kind !== 'keep' && !journal.state.threads.some(thread => thread.id === mutation.threadId)) throw new Error('Synchronize this saved helper thread explicitly before editing it.');
    try { await locked(async () => { await journal.load(); await journal.change(mutation); }); }
    finally { if (alive()) renderThreads(); }
    changed();
  }
  const sectionFor = (position: number) => sectionIndexAt(sections, position);
  const currentAnchor = () => anchorAt(capture.text, sections[sectionIndex].start, sections[sectionIndex].end);
  function hold(index = sectionIndex) { if (!alive()) return; held = true; if (index !== sectionIndex) readingPosition = sections[index].start; sectionIndex = index; renderPosition(); }
  function showPanel(focus = false) { if (!alive()) return; shell.classList.remove('is-collapsed'); mapSlot.append(map); updateManagement(); if (focus) writeButton.focus(); }
  function closePanel() { if (!alive()) return; shell.classList.add('is-collapsed'); rail.append(map); management?.close(); asking?.setVisible(false); openButton.focus(); }
  const openButton = button('Open margin', () => { showPanel(true); if (questionOpen) asking?.setVisible(true); }); openButton.className = 'm-open'; rail.append(openButton);
  const activity = el('span', '', 'm-activity'); activity.hidden = true; activity.setAttribute('role', 'status'); rail.append(activity);
  const settingsButton = button('Settings', () => { setup.hidden = !setup.hidden; updateManagement(); if (!setup.hidden) setup.querySelector<HTMLElement>('input,button')?.focus(); });
  bar.append(el('span', 'Marginalia', 'm-wordmark'), actions(button('Collapse', closePanel), settingsButton));
  const writeButton = button('Write here\u2026', () => beginDraft()); writeButton.className = 'm-write'; compose.append(writeButton);
  const editor = mountNoteEditor(compose, {
    edit(text) { if (!draft || saving || draft.mutation) return; draft.text = text; persistDraft(); },
    save: () => { void track(saveDraftNow()); },
    discard: () => { void safely(async () => { if (!draft || saving || draft.mutation) return; await draftBuffer.save(undefined); draft = undefined; editorGeneration++; renderCompose(); renderPosition(); writeButton.focus(); }); },
    ask: () => { void safely(async () => { const saved = await saveDraftNow(); if (saved && alive()) ask(saved.thread.anchor, saved.thread, saved.noteId); }); },
    attachments: () => attachmentChoices(),
  });
  const readingTitle = el('h2'); readingTitle.tabIndex = -1;
  const followingLabel = el('span', 'Reading', 'm-meta');
  const followButton = button('Follow reading', () => { held = false; readingPosition = lastReadingPosition; sectionIndex = sectionFor(readingPosition); updateReading(); renderPosition(); readingTitle.focus(); });
  reading.append(readingTitle, followingLabel, followButton);
  const footerCount = el('span', '', 'm-meta');
  const reopenQuestion = button('Return to your question', () => { if (questionDraft) openQuestion(questionDraft); }); reopenQuestion.hidden = !questionDraft;
  footer.append(footerCount, actions(button('Export JSON', () => { void safely(exportWork); }), reopenQuestion,
    ...(options.onLibrary ? [button('Library and settings', options.onLibrary)] : [])),
    actions(button('Think with it', () => ask(wholePageAnchor(), undefined, undefined, 'unsure')), button('Go further', () => ask(wholePageAnchor(), undefined, undefined, 'explore'))), el('span', 'Hear it \u00b7 not available yet', 'm-meta'));
  const skip = button('Go to margin', () => showPanel(true)); skip.className = 'm-skip'; root.prepend(skip);
  const markers = sections.map((section, index) => { const node = el('h3', section.title, 'm-section-marker'); node.dataset.sectionMarker = String(index); return node; });
  const questionSlot = el('section', undefined, 'm-question-slot'); questionSlot.hidden = true;
  questionSlot.addEventListener('focusin', () => hold(sectionFor(questionPosition)), { signal });
  const questionForm = el('div', undefined, 'm-question-form'), askingSlot = el('div'); questionSlot.append(questionForm, askingSlot);
  let asking: ReturnType<AskingMountFactory> | undefined, questionOpen = false;
  let questionPosition = 0, questionOpening = false;
  function placeItems() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = markers.map((node, index) => ({ node: node as HTMLElement, position: sections[index].start, rank: 0 }));
    items.push({ node: compose, position: composerOffset(draft, readingPosition), rank: 1 });
    for (const thread of orderedThreads(threadsNow(), capture)) { const node = threadNodes.get(thread.id)?.node; if (node) items.push({ node, position: displayPosition(thread.anchor, capture) ?? Infinity, rank: 2 }); }
    // At the same anchor, every reader note precedes the question/reply surface.
    items.push({ node: questionSlot, position: questionPosition, rank: 3 });
    items.sort((a, b) => a.position - b.position || a.rank - b.rank);
    items.forEach(({ node }, index) => { if (threadList.children[index] !== node) threadList.insertBefore(node, threadList.children[index] ?? null); });
    if (focused?.isConnected && threadList.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  function renderPosition() {
    if (!alive()) return;
    readingTitle.textContent = sections[sectionIndex].title; followButton.hidden = !held; followingLabel.hidden = held;
    for (const item of sectionMapState(sections, threadsNow(), capture, sectionIndex)) {
      const node = map.querySelector<HTMLElement>(`[data-section="${item.index}"]`)!;
      node.setAttribute('aria-current', String(item.current)); node.dataset.notes = String(item.notes);
      const text = `${sections[item.index].title}: ${item.notes} notes, ${item.marks} marks, ${item.threads} threads${item.current ? ', current reading position' : ''}`;
      node.title = text; node.setAttribute('aria-label', text);
      node.style.setProperty('--note-density', String(Math.min(1, item.notes / Math.max(1, item.length / 500))));
      const count = node.querySelector<HTMLElement>('.m-density')!; count.textContent = String(item.notes); count.hidden = !item.notes;
      const marks = node.querySelector('.m-map-marks')!;
      const identity = JSON.stringify(item.markPositions);
      if (marks.getAttribute('data-marks') !== identity) { marks.setAttribute('data-marks', identity); marks.replaceChildren(...item.markPositions.map(position => { const tick = el('span', '', 'm-map-mark'); tick.style.setProperty('--mark-position', `${position * 100}%`); return tick; })); }
      const cue = node.querySelector<HTMLElement>('.m-map-position')!; cue.hidden = !item.current; cue.style.setProperty('--reading-position', `${Math.min(1, Math.max(0, (readingPosition - sections[item.index].start) / item.length)) * 100}%`);
    }
    for (const thread of orderedThreads(threadsNow(), capture)) {
      const node = threadNodes.get(thread.id)?.node; if (!node) continue;
      const position = displayPosition(thread.anchor, capture), size = marginItemSize(position === undefined ? -1 : sectionFor(position), sectionIndex, expanded.has(thread.id), node.contains(document.activeElement));
      node.dataset.size = size; node.classList.toggle('is-compact', size !== 'full'); node.classList.toggle('is-tick', size === 'tick');
    }
    placeItems();
    if (!held && !draft && !suspended && !shell.classList.contains('is-collapsed')) scroll.scrollTop = Math.max(0, compose.offsetTop - scroll.offsetTop - 40);
  }
  sections.forEach((section, index) => {
    const segment = button('', () => { hold(index); showPanel(); sourceAction(anchorAt(capture.text, section.start, section.end)); });
    segment.dataset.section = String(index); segment.className = `m-segment m-colour-${index % 6 + 1}`; segment.style.flexGrow = String(Math.max(1, section.end - section.start));
    const count = el('span', '', 'm-density'), marks = el('span', '', 'm-map-marks'), cue = el('span', '', 'm-map-position');
    for (const part of [count, marks, cue]) part.setAttribute('aria-hidden', 'true'); segment.append(count, marks, cue); map.append(segment);
  });
  function persistDraft() { if (!draft || !alive()) return; editorGeneration++; void track(draftBuffer.save(draft)).catch(fail); }
  function beginDraft(explicit?: QuoteAnchor, thread?: Thread, noteId?: string) {
    if (!alive()) return;
    if (draft) { editor.focus(); announce('Finish or discard your current note before starting another.'); return; }
    if (thread && !journal.state.threads.some(t => t.id === thread.id)) { announce('Synchronize this saved helper thread explicitly before editing it.'); return; }
    const anchor = explicit ?? selected ?? currentAnchor(), note = thread?.notes.find(n => n.id === noteId);
    const position = explicit || selected ? displayPosition(anchor, capture) ?? readingPosition : readingPosition;
    draft = { anchor: structuredClone(anchor), source: structuredClone(capture), position, text: note?.text ?? '', ...(thread ? { threadId: thread.id, noteId: note?.id ?? id(), revision: note?.revision ?? 0 } : {}) };
    hold(sectionFor(position)); persistDraft(); renderCompose(true);
  }
  function attachmentChoices(): AttachmentChoice[] {
    const owner = draft;
    const choose = (anchor: QuoteAnchor, position: number) => () => { if (!alive() || draft !== owner || !draft || draft.mutation || draft.threadId || saving) return; draft.anchor = structuredClone(anchor); draft.source = structuredClone(capture); draft.position = position; persistDraft(); renderCompose(); renderPosition(); };
    return [...sections.map(section => ({ label: section.title, choose: choose({ ...anchorAt(capture.text, section.start, section.end), kind: 'section' }, section.start) })),
      { label: 'Whole page', choose: choose(wholePageAnchor(), readingPosition) },
      ...(selected ? [{ label: 'Selected passage', choose: choose(structuredClone(selected), selected.start) }] : [])];
  }
  function renderCompose(focus = false) {
    if (!alive()) return;
    writeButton.hidden = !!draft;
    editor.update(draft ? { text: draft.text, attachment: draft.anchor.kind === 'whole-page' ? 'Note on the whole page' : `Note on \u201c${excerpt(displayAnchor(draft.anchor), 66)}\u201d`,
      saving, locked: !!draft.mutation || pendingNoteCommitted, canChange: !draft.threadId,
      message: !storageReady ? 'Local storage is not available yet. This draft is in memory; export before closing.' : pendingNoteCommitted ? 'The note is saved; its separate draft still needs clearing.' : draft.mutation ? 'Retry this exact save or review its conflict in Settings. Your text is retained.' : draft.source && draft.source.text !== capture.text ? 'This draft keeps its original captured passage. Change is explicit.' : draftBuffer.unsaved() ? 'Latest draft is not yet confirmed saved. Retry or export before closing.' : 'Draft saved on this device.' } : undefined);
    placeItems(); if (focus) editor.focus();
  }
  async function saveDraftNow(): Promise<{ thread: Thread; noteId: string } | undefined> {
    if (!alive() || !draft || saving || !draft.text.trim()) return;
    saving = true; renderCompose();
    try {
      if (!storageReady) throw new Error('Local saving is unavailable. Export the draft before closing.');
      if (!draft.threadId && !draft.mutation && !draft.source) throw new Error('This older draft has no original capture. Choose its attachment explicitly before saving.');
      draft.mutation ??= draft.threadId ? { id: id(), kind: 'note', threadId: draft.threadId, noteId: draft.noteId!, text: draft.text, expectedRevision: draft.revision! }
        : { id: id(), kind: 'keep', threadId: id(), capture: draft.source!, anchor: structuredClone(draft.anchor), note: draft.text };
      const mutation = structuredClone(draft.mutation); await draftBuffer.save(draft);
      const result = await locked(() => retryDraftMutation(journal, draft!));
      if (result.kind === 'resolved') {
        draft = result.draft; pendingNoteCommitted = false; await draftBuffer.save(draft);
        announce('The conflict choice is saved. Your note text remains a draft; save it explicitly against the chosen version.'); changed(); renderThreads(); return;
      }
      pendingNoteCommitted = true; changed(); if (alive()) renderThreads();
      await draftBuffer.save(undefined); draft = undefined; editorGeneration++; pendingNoteCommitted = false;
      const thread = currentThread(mutation.threadId), noteId = mutation.kind === 'keep' ? mutation.id + '-note' : mutation.kind === 'note' ? mutation.noteId : '';
      if (alive()) { renderCompose(); renderPosition(); announce('Note saved on this device.'); }
      return thread ? { thread, noteId } : undefined;
    } catch (error) { fail(error); }
    finally { saving = false; if (alive()) { renderCompose(); renderSettings(); } }
  }
  async function keep(anchor: QuoteAnchor, parked = false) {
    await safely(async () => {
      const existing = orderedThreads(threadsNow(), capture).find(thread => canonicalReplyData(thread.anchor) === canonicalReplyData(anchor));
      const threadId = existing?.id ?? id();
      if (!existing) await change({ id: id(), kind: 'keep', threadId, capture, anchor: structuredClone(anchor) });
      if (parked) { const thread = currentThread(threadId)!; await change({ id: id(), kind: 'thread-state', threadId, state: 'parked', expectedRevision: thread.revision }); }
      announce(parked ? 'Passage parked on this device.' : 'Passage kept on this device.');
    });
  }
  function showSelection(anchor: QuoteAnchor) {
    if (!alive() || !anchor.exact.trim()) return;
    const attachment = attachQuote(anchor, capture.text);
    if (!['exact', 'moved'].includes(attachment.state) || attachment.candidates.length !== 1) { announce('This selection does not match the captured page unambiguously.'); return; }
    selected = structuredClone(anchor); lastOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    hold(sectionFor(attachment.candidates[0].start)); showPanel(); selectionCard.hidden = false;
    const definition = pageDefinition(anchor.exact, capture.text);
    selectionCard.replaceChildren(el('blockquote', displayAnchor(anchor)), el('p', definition ? `${definition} \u00b7 from this page` : 'No explicit definition found in the captured page.', 'm-meta'),
      actions(button('Keep', () => keep(anchor)), button('Ask', () => ask(anchor)), button('Park', () => keep(anchor, true)), button('Write a note', () => beginDraft(anchor)), button('Close selection', closeSelection)), el('p', 'Nothing sent.', 'm-meta'));
    announce('Selection in the margin. Nothing sent.');
  }
  function closeSelection() { if (!alive()) return; selectionCard.hidden = true; selected = undefined; if (lastOpener?.isConnected && selectionCard.contains(document.activeElement)) lastOpener.focus(); }
  selectionCard.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Escape') closeSelection();
    if (selected && event.key.toLowerCase() === 'k') { event.preventDefault(); void keep(selected); }
    if (selected && event.key.toLowerCase() === 'p') { event.preventDefault(); void keep(selected, true); }
    if (selected && event.key === '/') { event.preventDefault(); ask(selected); }
  });
  function retainQuestion(selection: AskingSelection) {
    questionDraft = structuredClone(selection); reopenQuestion.hidden = false;
    void track(questionBuffer.save(questionDraft)).catch(fail);
  }
  function ask(anchor: QuoteAnchor, thread?: Thread, noteId?: string, intent?: Intent) {
    if (!alive()) return;
    const note = noteId ? thread?.notes.find(n => n.id === noteId && !n.deletedAt) : thread?.notes.filter(n => !n.deletedAt).at(-1);
    const next: AskingSelection = { capture: structuredClone(capture), anchor: structuredClone(anchor), question: '', context: '', intent: intent ?? (note ? 'unsure' : 'define'),
      ...(thread ? { threadId: thread.id, sourceVersionId: thread.sourceVersionId } : {}), ...(note ? { answeredNote: { noteId: note.id, text: note.text, revision: note.revision } } : {}) };
    if (questionDraft && canonicalReplyData({ anchor: questionDraft.anchor, thread: questionDraft.threadId, note: questionDraft.answeredNote }) !== canonicalReplyData({ anchor: next.anchor, thread: next.threadId, note: next.answeredNote })) {
      openQuestion(questionDraft); announce('Your earlier question is retained. Finish it, or explicitly start a new question while keeping its history.'); return;
    }
    openQuestion(questionDraft ?? next);
  }
  function closeQuestion() {
    if (!alive()) return;
    questionOpen = false; questionSlot.hidden = true; asking?.setVisible(false);
    if (lastOpener?.isConnected && questionSlot.contains(document.activeElement)) lastOpener.focus({ preventScroll: true });
    announce('Question retained. Closing this view does not confirm cancellation of submitted work.');
  }
  function openQuestion(selection: AskingSelection) {
    if (!alive()) return;
    const same = questionDraft && canonicalReplyData(questionDraft) === canonicalReplyData(selection);
    questionDraft = structuredClone(selection); questionOpen = true;
    questionPosition = displayPosition(selection.anchor, capture) ?? readingPosition;
    hold(sectionFor(questionPosition)); showPanel(); questionSlot.hidden = false; selectionCard.hidden = true;
    if (same && questionForm.childElementCount) { asking?.setVisible(true); placeItems(); questionForm.querySelector('textarea')?.focus({ preventScroll: true }); return; }
    lastOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    asking?.destroy(); asking = undefined; askingSlot.replaceChildren(); questionForm.hidden = false;
    const question = el('textarea'); question.maxLength = 4000; question.value = selection.question; question.setAttribute('aria-label', 'Your question'); question.placeholder = 'What would help you here?';
    const context = el('textarea'); context.maxLength = 2000; context.value = selection.context; context.setAttribute('aria-label', 'Context to attach'); context.placeholder = 'Only what you choose to share';
    const extra = el('details'); extra.append(el('summary', 'Attach context'), label('Context to attach', context));
    const update = () => { if (!questionDraft) return; retainQuestion({ ...questionDraft, question: question.value, context: context.value }); };
    question.addEventListener('input', update); context.addEventListener('input', update);
    const suggestions: Array<{ text: string; intent: Intent }> = [
      { text: 'Define this in context', intent: 'define' }, { text: 'Show me an example', intent: 'instantiate' }, { text: 'Explain step by step', intent: 'derive' },
    ];
    const suggested = actions(...suggestions.map(item => button(item.text, () => { question.value = item.text; questionDraft!.intent = item.intent; update(); question.focus(); })));
    const more = el('details'); more.append(el('summary', 'More ideas'), actions(...[
      { text: 'Build a small model', intent: 'simulate' as const }, { text: 'Diagram this', intent: 'diagram' as const }, { text: 'Check this claim', intent: 'evidence' as const }, { text: 'Go further', intent: 'explore' as const },
    ].map(item => button(item.text + ' (takes longer)', () => { question.value = item.text; questionDraft!.intent = item.intent; update(); question.focus(); }))));
    const explanation = el('p', options.allowHelper === false ? 'Open the browser-owned margin to review and approve sending. Local notes and this draft remain available.' : 'Review prepares the exact outgoing text with the local helper. Pairing is not model readiness or permission to send.', 'm-meta');
    const review = button(selection.resumeJobId || selection.resumeReplyId ? 'Reopen saved request' : 'Review request', () => { update(); void safely(reviewQuestion); });
    const startNew = button('Start a new question; keep earlier history', () => { void safely(async () => {
      if (questionOpening) return;
      if (questionDraft) await persistence.write(questionKey + ':history:' + id(), questionDraft);
      asking?.destroy(); asking = undefined;
      await questionBuffer.save(undefined); questionDraft = undefined; questionForm.replaceChildren(); questionSlot.hidden = true; questionOpen = false;
      announce('Earlier question and request history retained. Choose a passage or note for a new question.');
    }); });
    questionForm.replaceChildren(el('blockquote', displayAnchor(selection.anchor)), ...(selection.answeredNote ? [el('p', `Your note, version ${selection.answeredNote.revision}: ${selection.answeredNote.text}`, 'm-note')] : []),
      suggested, question, extra, more, explanation,
      actions(review, ...(options.allowHelper !== false ? [button('Save pending local changes to helper', sync)] : []), button('Close question', closeQuestion), startNew));
    if (options.allowHelper === false) review.disabled = true;
    retainQuestion(questionDraft); placeItems(); question.focus({ preventScroll: true });
  }
  async function ensureContextSaved(selection: AskingSelection) {
    await locked(async () => {
      await journal.load();
      const thread = selection.threadId && currentThread(selection.threadId);
      if (journal.unsaved || !thread || thread.deletedAt || !thread.sourceVersionId || journal.state.pending.some(change => change.threadId === thread.id) || journal.state.conflicts.some(item => item.change.threadId === thread.id)) {
        throw new Error('This exact context is not yet confirmed saved to the helper. Save pending local changes explicitly, then review again. No model request was sent.');
      }
      if (thread.sourceUrl !== selection.capture.url || canonicalReplyData(thread.anchor) !== canonicalReplyData(selection.anchor)) throw new Error('This source binding changed. The earlier question is retained.');
    });
  }
  async function reviewQuestion() {
    if (!questionDraft || questionOpening || !alive()) return;
    questionOpening = true;
    try {
      if (options.allowHelper === false) throw new Error('Open the browser-owned margin to review sending.');
      let selection = structuredClone(questionDraft);
      if (!selection.question.trim() && !selection.resumeJobId && !selection.resumeReplyId) throw new Error('Write a question or choose a suggestion first.');
      if (!selection.threadId) {
        selection.keepMutation ??= { id: id(), kind: 'keep', threadId: id(), capture: structuredClone(selection.capture), anchor: structuredClone(selection.anchor) };
        retainQuestion(selection); await questionBuffer.save(selection); await change(selection.keepMutation);
        selection.threadId = selection.keepMutation.threadId;
      }
      const thread = currentThread(selection.threadId);
      if (!thread || thread.deletedAt) throw new Error('This saved thread is unavailable. Your question remains here.');
      selection.sourceVersionId = thread.sourceVersionId;
      retainQuestion(selection); await questionBuffer.save(selection); await ensureContextSaved(selection);
      asking ??= (options.askingMount ?? createT08Mount())(askingSlot, {
        helper: trustedHelper, signal, authorize: async url => { await helperForSource(url); }, currentThread,
        ensureContextSaved, persistence, track,
        read: key => persistence.read(questionKey + ':' + key),
        write: async (key, value) => {
          await locked(async () => {
            if (key.startsWith('request:')) { const previous = await persistence.read(questionKey + ':' + key); if (previous && canonicalReplyData(previous) !== canonicalReplyData(value)) throw new Error('This recorded request identity already belongs to other content.'); }
            await persistence.write(questionKey + ':' + key, value);
          });
        },
        highlight: (binding, original) => highlight(binding ? bindingAnchor(binding, original) ?? null : null),
        navigate: (binding, original) => { const anchor = bindingAnchor(binding, original); if (anchor) sourceAction(anchor); else announce('This source passage cannot be located unambiguously on the current page.'); },
        prepareReplyView: async (threadId, replyId) => {
          for (const [key, entry] of replyMounts) if (entry.threadId === threadId && entry.replyId === replyId) { await entry.flush(); entry.close(); entry.node.remove(); replyMounts.delete(key); }
        },
        retainedQuestion: retainQuestion,
        onCommitted: () => announce('Reply saved by the helper. Your notes remain above it.'),
        onClosed: () => { if (!alive()) return; questionForm.hidden = false; activity.hidden = true; },
        onState: state => { if (!alive()) return; const busy = ['preparing', 'submitting', 'queued', 'sending', 'working', 'provisional', 'validating', 'cancel_requested'].includes(state.phase); activity.hidden = !busy; activity.dataset.sending = String(state.phase === 'sending'); activity.setAttribute('aria-label', state.phase === 'sending' ? 'Sending reviewed request' : 'Working'); },
      });
      await asking.open(selection); if (!alive()) return; questionForm.hidden = true; asking.setVisible(!suspended && questionOpen);
    } finally { questionOpening = false; }
  }
  function renderThreads() {
    if (!alive()) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active?.dataset.focusKey, focusedThreadId = active?.closest<HTMLElement>('[data-thread]')?.dataset.thread;
    if (focusedThreadId) expanded.add(focusedThreadId);
    const threads = orderedThreads(threadsNow(), capture);
    for (const [key, entry] of threadNodes) if (!threads.some(thread => thread.id === key)) { closeReplies(key); replyLoads.set(key, (replyLoads.get(key) ?? 0) + 1); entry.node.remove(); threadNodes.delete(key); }
    for (const thread of threads) {
      let entry = threadNodes.get(thread.id); const signature = threadContentKey(thread);
      if (!entry || entry.signature !== signature) {
        const node = renderThread(thread);
        if (entry) {
          // Preserve the connected renderer subtree, including slider focus and buffers.
          entry.node.querySelector('.m-thread-content')!.replaceWith(node.querySelector('.m-thread-content')!);
          entry.node.querySelector('.m-excerpt')!.replaceWith(node.querySelector('.m-excerpt')!); entry.signature = signature;
        } else { entry = { node, signature }; threadNodes.set(thread.id, entry); void loadReplies(thread.id); }
      }
    }
    resume.hidden = !threads.some(thread => displayPosition(thread.anchor, capture) !== undefined);
    footerCount.textContent = threads.length ? `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'} on this page` : 'Keep a passage or write a note. Your work stays here without an account.';
    renderPosition(); paintHighlights();
    if (active?.isConnected && focusedThreadId && threadList.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    if (focusKey && active && !active.isConnected) (Array.from(threadList.querySelectorAll<HTMLElement>('[data-focus-key]')).find(node => node.dataset.focusKey === focusKey) ?? writeButton).focus({ preventScroll: true });
  }
  function renderThread(thread: Thread) {
    const node = el('section', undefined, 'm-thread'); node.id = instance + '-' + thread.id; node.dataset.thread = thread.id;
    const currentSection = () => sectionFor(displayPosition(currentThread(thread.id)?.anchor ?? thread.anchor, capture) ?? readingPosition);
    const preview = button(excerpt((thread.notes.find(note => !note.deletedAt)?.text ?? thread.anchor.exact) || 'Whole-page thread'), () => {
      expanded.add(thread.id); hold(currentSection()); renderPosition(); threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus({ preventScroll: true });
    }); preview.className = 'm-excerpt'; preview.dataset.focusKey = thread.id + ':excerpt'; preview.setAttribute('aria-label', 'Open thread: ' + (thread.notes.find(note => !note.deletedAt)?.text ?? displayAnchor(thread.anchor)));
    const body = el('div', undefined, 'm-thread-content');
    const sourceText = thread.anchor.kind === 'whole-page' ? 'Whole page' : `\u201c${excerpt(displayAnchor(thread.anchor))}\u201d`;
    const sourceButton = button(sourceText, () => { const live = currentThread(thread.id); if (live) sourceAction(live.anchor); }); sourceButton.className = 'm-source-action'; sourceButton.dataset.focusKey = thread.id + ':source'; sourceButton.setAttribute('aria-label', 'Source passage: ' + sourceText);
    sourceButton.addEventListener('mouseenter', () => highlight(currentThread(thread.id)?.anchor ?? null)); sourceButton.addEventListener('mouseleave', () => highlight(null));
    sourceButton.addEventListener('focus', () => highlight(currentThread(thread.id)?.anchor ?? null)); sourceButton.addEventListener('blur', () => highlight(null)); body.append(sourceButton);
    const location = sourceLocation(thread, capture); if (location.state !== 'exact') body.append(el('p', `Attachment ${location.state}. Saved quote preserved.`, 'm-meta'));
    for (const note of thread.notes.filter(note => !note.deletedAt)) {
      const edit = button('Edit note', () => { const live = currentThread(thread.id); if (live) beginDraft(live.anchor, live, note.id); }); edit.dataset.focusKey = thread.id + ':note:' + note.id;
      const askNote = button('Ask about this note', () => { const live = currentThread(thread.id); if (live) ask(live.anchor, live, note.id); });
      const noteBlock = el('div', undefined, 'm-reader-note'); noteBlock.append(el('p', note.text, 'm-note'), actions(edit, askNote)); body.append(noteBlock);
    }
    const state = el('select'); state.setAttribute('aria-label', 'Thread state');
    for (const value of ['open', 'parked', 'done', 'archived'] as const) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; state.append(option); } state.value = thread.state;
    state.addEventListener('change', () => { const chosen = state.value as Thread['state']; void safely(async () => { const live = currentThread(thread.id); if (!live) return; await change({ id: id(), kind: 'thread-state', threadId: live.id, expectedRevision: live.revision, state: chosen }); announce('Thread ' + chosen + '.'); }); });
    body.append(actions(button('Add note', () => { const live = currentThread(thread.id); if (live) beginDraft(live.anchor, live); }), button('Ask', () => { const live = currentThread(thread.id); if (live) ask(live.anchor, live); }), state, button('Remove', () => safely(async () => {
      const live = currentThread(thread.id); if (!live) return;
      await change({ id: id(), kind: 'remove', threadId: live.id, removed: true, expectedRevision: live.revision });
      if (!alive()) return;
      const undo = button('Undo', () => safely(async () => { const current = journal.state.threads.find(t => t.id === thread.id); if (!current) return; await change({ id: id(), kind: 'remove', threadId: current.id, removed: false, expectedRevision: current.revision }); toast.hidden = true; announce('Thread restored.'); threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); }));
      toast.hidden = false; toast.replaceChildren(el('span', 'Thread removed.'), undo); undo.focus();
    }))));
    if (!journal.state.threads.some(t => t.id === thread.id)) {
      for (const control of Array.from(body.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select'))) if (control !== sourceButton && !control.textContent?.startsWith('Ask')) control.disabled = true;
      body.append(el('p', 'Saved helper snapshot. Synchronize explicitly in Settings before editing it on this device.', 'm-meta'));
    }
    const replyArea = el('section', undefined, 'm-saved-replies'); replyArea.setAttribute('aria-label', 'Saved replies');
    const replyStatus = el('p', '', 'm-reply-status m-meta'); replyStatus.setAttribute('role', 'status');
    const replyList = el('div', undefined, 'm-reply-list');
    const replyActions = actions(button('Reload saved views', () => loadReplies(thread.id, false, true)), button('Export saved replies and views', () => exportReplies(thread.id)));
    if (options.allowHelper !== false) replyActions.append(button('Load replies from helper', () => loadReplies(thread.id, true)));
    replyArea.append(replyStatus, replyList, replyActions);
    const bodyGroup = el('div', undefined, 'm-thread-body'); bodyGroup.append(body, replyArea); node.append(preview, bodyGroup);
    for (const control of Array.from(node.querySelectorAll<HTMLElement>('button,select'))) control.dataset.focusKey ??= thread.id + ':' + (control.getAttribute('aria-label') ?? control.textContent);
    node.addEventListener('focusin', () => hold(currentSection())); return node;
  }
  function closeReplies(threadId?: string) {
    for (const [key, entry] of replyMounts) if (!threadId || entry.threadId === threadId) { entry.close(); entry.node.remove(); replyMounts.delete(key); }
  }
  function trustedHelper() {
    if (!alive() || options.allowHelper === false || !helper?.token) throw new Error('Pair in the browser-owned margin Settings to use the local helper.');
    return helper;
  }
  async function helperForSource(sourceUrl: string) {
    const client = trustedHelper(), epoch = client.connectionVersion, permissions = client.permissionVersion;
    await options.authorizeHelperSend?.(sourceUrl);
    // On the localhost surface use the real exclusion record; inference grants
    // still come only from T13's host-prepared review and decision endpoint.
    if (!options.authorizeHelperSend && typeof location !== 'undefined' && client.origin === location.origin) {
      const setting = await client.permissions(signal);
      if (!Array.isArray(setting.exclusions)) throw new Error('Site exclusions could not be checked. Nothing new was sent.');
      const site = new URL(sourceUrl).origin;
      if (setting.exclusions.some(item => item.excluded && item.site === site)) throw new Error('This site is excluded. Reading and local notes remain available.');
    }
    if (!alive() || suspended || helper !== client || epoch !== client.connectionVersion || permissions !== client.permissionVersion || !client.token) throw new Error('The helper connection or permissions changed. Earlier outcomes are unconfirmed.');
    return client;
  }
  async function replyClient(threadId: string) { const thread = currentThread(threadId); if (!thread || thread.deletedAt) throw new Error('This thread is unavailable.'); return helperForSource(thread.sourceUrl); }
  function bindingAnchor(binding: SourceBinding, original: string): QuoteAnchor | undefined {
    const selector = binding.selector;
    const match = attachQuote({ exact: selector.exact, prefix: selector.prefix ?? '', suffix: selector.suffix ?? '', start: 0, end: selector.exact.length }, original);
    if (!['exact', 'moved'].includes(match.state) || match.candidates.length !== 1) return;
    const { start, end } = match.candidates[0];
    const anchor = { kind: 'quote' as const, exact: selector.exact, start, end, prefix: original.slice(Math.max(0, start - 32), start), suffix: original.slice(end, end + 32) };
    const attachment = attachQuote(anchor, capture.text);
    return ['exact', 'moved'].includes(attachment.state) && attachment.candidates.length === 1 ? anchor : undefined;
  }
  async function loadReplies(threadId: string, remote = false, reopen = false) {
    const thread = currentThread(threadId); if (!alive() || !thread || thread.deletedAt) return;
    const generation = (replyLoads.get(threadId) ?? 0) + 1; replyLoads.set(threadId, generation);
    const current = () => alive() && replyLoads.get(threadId) === generation && !!threadNodes.get(threadId);
    const area = () => threadNodes.get(threadId)?.node.querySelector<HTMLElement>('.m-saved-replies');
    const message = (text: string) => { if (current()) { const node = area()?.querySelector('.m-reply-status'); if (node) node.textContent = text; } };
    try {
      if (remote) {
        message('Loading saved replies from the local helper...'); const client = await replyClient(threadId), epoch = client.connectionVersion;
        await persistence.replies.refresh(client.origin, threadId, async () => {
          if (!current()) return;
          if (await replyClient(threadId) !== client || client.connectionVersion !== epoch) throw new Error('The helper connection changed.');
          const bundle = await client.replies(threadId); if (!current()) return;
          if (bundle.source.id !== currentThread(threadId)?.sourceVersionId) throw new Error('The helper returned a different source version.');
          await persistence.replies.cache(client.origin, threadId, bundle.source, bundle.replies, bundle.views);
        });
      }
      if (!current()) return;
      if (reopen) { await Promise.all([...replyMounts.values()].filter(entry => entry.threadId === threadId).map(entry => entry.flush())); if (!current()) return; closeReplies(threadId); }
      const records = await persistence.replies.list(threadId); if (!current()) return;
      const visible = records.filter(record => !record.version.deletedAt); let unavailable = 0;
      const identity = (record: CachedReply) => JSON.stringify([record.origin, record.version.threadId, record.version.id]);
      for (const [key, entry] of replyMounts) if (entry.threadId === threadId && !visible.some(record => identity(record) === key)) { entry.close(); entry.node.remove(); replyMounts.delete(key); }
      for (const record of visible) {
        const key = identity(record); if (replyMounts.has(key)) continue;
        const session = await persistence.replies.open(record); if (!current()) return;
        const saved = session.record; if (saved.version.deletedAt) continue;
        if (!validateReply(saved.version.reply, { sourceText: saved.source.text }).ok) { unavailable++; continue; }
        const wrapper = el('section', undefined, 'm-saved-reply'); wrapper.dataset.replyVersion = saved.version.id;
        wrapper.append(el('p', `Saved reply \u00b7 ${saved.version.createdAt}${saved.version.parentId ? ' \u00b7 follow-up' : ''}${saved.version.supersedes ? ' \u00b7 revised version' : ''}`, 'm-meta'));
        if (saved.version.answeredNote) wrapper.append(el('p', `Answers your note, version ${saved.version.answeredNote.revision}: ${saved.version.answeredNote.text}`, 'm-reply-note-reference m-meta'));
        wrapper.append(el('p', saved.dirty ? 'View changes saved on this device.' : 'Saved view. Controls do not change the authored reply.', 'm-meta'));
        const viewStatus = el('p', saved.conflict ? 'This view changed elsewhere. Your local inputs are preserved.' : '', 'm-meta'); viewStatus.setAttribute('role', 'status');
        const canvas = el('div'); wrapper.append(canvas);
        let closed = false, reportRequest = 0, writer: ReturnType<typeof replySaveLifecycle> | undefined;
        const persistView = (state: ReturnType<MountedReply['getState']>) => !closed && writer ? track(writer.save(state)).catch(error => { if (!closed && alive()) viewStatus.textContent = error instanceof Error ? error.message : 'This view is not saved. Export it before closing.'; throw error; }) : Promise.resolve();
        const { mountReply } = await import('../renderer/index.ts'); if (!current()) return;
        const mounted: MountedReply = mountReply(canvas, saved.version.reply, {
          sourceText: saved.source.text, initialState: saved.local, capabilities: ['samples'],
          hostReport: saved.reports?.[canonicalReplyData(saved.local.parameters)] ?? saved.report ?? saved.version.validation,
          sampleGenerationRecords: saved.sampleGenerationRecords, onStateChange: persistView,
          onSourceHighlight: binding => { if (!closed && alive()) highlight(binding ? bindingAnchor(binding, saved.source.text) ?? null : null); },
          onSourceNavigate: binding => { if (closed || !alive()) return; const anchor = bindingAnchor(binding, saved.source.text); if (anchor) sourceAction(anchor); else announce('This saved source passage cannot be located unambiguously. The original reply is preserved.'); },
          ...(options.allowHelper !== false && helper?.token && helper.origin === saved.origin ? { resolveHostReport: async (parameters: Readonly<Record<string, number>>) => {
            if (closed) return undefined;
            const request = ++reportRequest, parameterKey = canonicalReplyData(parameters);
            const isCurrent = () => !closed && alive() && request === reportRequest && canonicalReplyData(mounted.getState().parameters) === parameterKey;
            const client = await replyClient(threadId); if (client.origin !== saved.origin) return undefined;
            const report = await client.checkReply(threadId, saved.version.id, parameters); if (!isCurrent()) return undefined;
            await persistence.replies.report(saved, parameters, report, isCurrent); return isCurrent() ? report : undefined;
          } } : {}),
        });
        writer = replySaveLifecycle(mounted.getState(), state => session.save(state));
        const entry = { threadId, replyId: saved.version.id, node: wrapper, mounted, flush: () => track(writer!.flush(mounted.getState())), close() {
          if (closed) return; const final = writer!.close(mounted.getState()); closed = true;
          void track(final).catch(fail); mounted.destroy();
        } }; replyMounts.set(key, entry);
        const controls = actions();
        if (options.allowHelper !== false) controls.append(button('Save view to helper', () => safely(async () => {
          if (closed) return; await entry.flush(); if (closed || !alive()) return;
          const client = await replyClient(threadId), epoch = client.connectionVersion;
          if (client.origin !== saved.origin) throw new Error('Pair with the helper that owns this reply.');
          await persistence.replies.sync(saved, async change => { if (closed || await replyClient(threadId) !== client || epoch !== client.connectionVersion) throw new Error('This reply view or connection changed.'); return client.saveReplyView(threadId, change); });
          const latest = (await persistence.replies.list(threadId)).find(record => record.origin === saved.origin && record.version.id === saved.version.id);
          if (!closed && alive()) viewStatus.textContent = latest?.dirty ? 'An earlier view reached the helper. Newer inputs remain on this device; save explicitly to send them.' : 'The saved view was sent to the local helper.';
        })), button('Use helper view', () => safely(async () => {
          if (closed) return; await entry.flush(); const client = await replyClient(threadId), epoch = client.connectionVersion;
          if (client.origin !== saved.origin) throw new Error('Pair with the helper that owns this reply.');
          await persistence.replies.useRemote(saved, mounted.getState(), async () => { if (closed || await replyClient(threadId) !== client || epoch !== client.connectionVersion) throw new Error('The reply view or connection changed.'); return client.replyView(threadId, saved.version.id); });
          if (closed || !alive()) return; entry.close(); replyMounts.delete(key); wrapper.remove(); await loadReplies(threadId);
          announce('Helper view restored. Previous local inputs remain in the recovery export.');
        })), button('Continue this reply', () => {
          const live = currentThread(threadId); if (!live) return;
          const note = saved.version.answeredNote;
          if (!saved.source.capturedAt || !saved.source.extractionVersion || saved.source.title === null || saved.source.pageType === null) { announce('This saved source has incomplete capture metadata. It remains exportable; no replacement metadata will be invented.'); return; }
          openQuestion({ capture: { url: live.sourceUrl, title: saved.source.title, pageType: saved.source.pageType,
            text: saved.source.text, capturedAt: saved.source.capturedAt, extractionVersion: saved.source.extractionVersion },
            anchor: structuredClone(live.anchor), threadId, sourceVersionId: saved.source.id, question: '', context: '', resumeReplyId: saved.version.id,
            ...(note ? { answeredNote: { noteId: note.noteId, revision: note.revision, text: note.text } } : {}) });
        }));
        wrapper.append(viewStatus, controls, el('p', 'Saved-solver execution and reply removal need their host actions; neither is simulated here.', 'm-meta'));
        area()?.querySelector('.m-reply-list')?.append(wrapper);
      }
      message(persistence.replies.unsaved(threadId).length ? 'Some view inputs remain only in memory. Export before closing.' : unavailable ? `${unavailable} saved replies could not be safely displayed. Original records remain exportable.` : visible.some(record => record.conflict) ? 'The helper has a different view. Local controls are preserved; adopt it explicitly.' : visible.length ? `${visible.length} saved replies. Notes stay above replies.` : 'No saved replies on this device.');
    } catch (error) { message(error instanceof Error ? error.message : 'Saved replies could not be loaded.'); }
  }
  function exportReplies(threadId: string) {
    return safely(async () => {
      await Promise.allSettled([...replyMounts.values()].filter(entry => entry.threadId === threadId).map(entry => entry.flush()));
      let records: CachedReply[] = []; const memoryOnly = persistence.replies.unsaved(threadId);
      try { records = await persistence.replies.list(threadId); } catch (error) { if (!memoryOnly.length) throw error; }
      if (alive()) download('marginalia-replies.json', { schema: 'marginalia.cached-replies.v1', threadId, records, memoryOnly });
    });
  }

  function sourceRange(anchor: QuoteAnchor): Range | null {
    if (!source || anchor.kind === 'whole-page') return null;
    const attachment = attachQuote(anchor, capture.text);
    if (!['exact', 'moved'].includes(attachment.state) || attachment.candidates.length !== 1) return null;
    const match = attachment.candidates[0], walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    const range = document.createRange(); let offset = 0, started = false, textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const end = offset + (textNode.textContent?.length ?? 0);
      if (!started && match.start >= offset && match.start < end) { range.setStart(textNode, match.start - offset); started = true; }
      if (started && match.end <= end) { range.setEnd(textNode, match.end - offset); return range; }
      offset = end;
    }
    return null;
  }
  function highlight(anchor: QuoteAnchor | null) {
    if (!alive()) return;
    options.onHighlight?.(anchor);
    const highlights = typeof CSS === 'undefined' ? undefined : (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (highlights && HighlightClass) { const range = anchor && sourceRange(anchor); highlights.set('marginalia-focus', new HighlightClass(...(range ? [range] : []))); }
  }
  function paintHighlights() {
    if (!alive() || suspended) return;
    const highlights = typeof CSS === 'undefined' ? undefined : (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (highlights && HighlightClass) highlights.set('marginalia-kept', new HighlightClass(...orderedThreads(threadsNow(), capture).map(thread => sourceRange(thread.anchor)).filter((range): range is Range => !!range)));
  }
  function sourceAction(anchor: QuoteAnchor) {
    if (!alive()) return;
    if (anchor.kind !== 'whole-page') {
      const attachment = attachQuote(anchor, capture.text);
      if (!['exact', 'moved'].includes(attachment.state) || attachment.candidates.length !== 1) { announce('This passage cannot be located unambiguously. The saved quote is unchanged.'); return; }
    }
    options.onSource?.(structuredClone(anchor));
    const node = anchor.kind === 'whole-page' ? source : sourceRange(anchor)?.startContainer.parentElement;
    node?.scrollIntoView({ block: 'center', behavior: 'instant' }); highlight(anchor);
    if (source && matchMedia('(max-width: 899px)').matches) closePanel();
  }
  function updateReading() {
    if (!source || !alive() || suspended) return;
    const blocks = Array.from(source.querySelectorAll<HTMLElement>('[data-reading-section]'));
    const index = blocks.reduce((chosen, node, i) => node.getBoundingClientRect().top <= innerHeight * .4 ? i : chosen, 0);
    lastReadingPosition = sections[Math.min(index, sections.length - 1)].start;
    if (!held) { readingPosition = lastReadingPosition; sectionIndex = sectionFor(readingPosition); renderPosition(); }
  }
  function captureSelection() {
    const selection = document.getSelection();
    if (!source || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!source.contains(range.startContainer) || !source.contains(range.endContainer)) return;
    const before = document.createRange(); before.selectNodeContents(source); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    showSelection(anchorAt(capture.text, start, start + range.toString().length));
  }
  source?.addEventListener('mouseup', captureSelection, { signal });
  source?.addEventListener('keyup', event => { if (event.key === 'Shift') captureSelection(); }, { signal });
  window.addEventListener('scroll', updateReading, { passive: true, signal });
  compose.addEventListener('focusin', () => { hold(); if (!draft && storageReady && document.activeElement === writeButton) beginDraft(); }, { signal });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || askingSlot.contains(event.target as Node)) return;
    if (questionOpen) { event.preventDefault(); closeQuestion(); }
    else if (!selectionCard.hidden) { event.preventDefault(); closeSelection(); }
    else if (matchMedia('(max-width: 899px)').matches) closePanel();
  }, { signal });
  async function sync() {
    if (!alive() || suspended || syncing) return;
    if (!helper?.token) { announce('Pair with the local helper first. Reading and notes remain available.'); return; }
    syncing = true; announce('Saving pending changes to the local helper...');
    try {
      const client = helper, epoch = client.connectionVersion, permission = client.permissionVersion;
      const current = () => { if (!alive() || suspended || client !== helper || !client.token || epoch !== client.connectionVersion || permission !== client.permissionVersion) throw new Error('The helper connection or permission changed. Earlier outcomes are unconfirmed; pending changes remain for explicit retry.'); };
      await locked(async () => {
        current(); await journal.load();
        await journal.sync(async mutation => {
          const url = mutation.kind === 'keep' ? mutation.capture.url : currentThread(mutation.threadId)?.sourceUrl;
          if (!url) throw new Error('This change has no recorded source address. It stays on this device.');
          await helperForSource(url); current(); await client.change(mutation);
        }, async () => { current(); return client.list(); });
      });
      changed(); renderThreads(); renderSettings();
      announce(journal.state.conflicts.length ? 'Some changes need review. Your drafts remain in Settings.' : 'Pending changes saved to the local helper. No model request was made.');
    } catch (error) { fail(error); }
    finally { syncing = false; }
  }
  async function releaseResolvedDraft() {
    const resolved = draftAfterResolution(journal, draft);
    if (resolved) { draft = resolved; pendingNoteCommitted = false; await draftBuffer.save(draft); renderCompose(); }
  }
  function renderSettings() {
    if (!alive()) return;
    const focused = settingsBody.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const pairingFocused = focused?.getAttribute('aria-label') === 'Pairing code';
    const selection = pairingFocused && focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : undefined;
    const focusText = focused?.textContent;
    settingsBody.replaceChildren(el('h2', 'Settings'));
    if (journal.unsaved && needsReconciliation) settingsBody.append(el('p', 'Another tab saved a different version. Recover keeps that version and retains your changes for review.', 'm-error'), button('Recover unsaved changes', () => safely(async () => {
      await locked(() => journal.reconcilePersistence()); needsReconciliation = false; pendingNoteCommitted = false;
      await releaseResolvedDraft(); changed(); renderThreads(); renderCompose(); renderSettings(); announce('Changes recovered for review. Your draft text remains here.');
    })));
    if (journal.unsaved || draftBuffer.unsaved() || draft?.mutation || pendingNoteCommitted || questionBuffer.unsaved()) settingsBody.append(
      el('p', 'Some work needs saving or conflict review. Memory-only recovery lasts in this document; export before closing.', 'm-error'),
      button('Retry saving', () => safely(async () => {
        if (draft?.mutation) await saveDraftNow();
        else { await locked(async () => { await journal.retryPersistence(); await journal.load(); }); await releaseResolvedDraft(); if (draftBuffer.unsaved()) await draftBuffer.flush(); }
        if (questionBuffer.unsaved()) await questionBuffer.save(questionDraft);
        needsReconciliation = journal.unsaved && needsReconciliation;
        changed(); renderThreads(); renderCompose(); renderSettings();
        if (!journal.unsaved && !draftBuffer.unsaved() && !draft?.mutation && !questionBuffer.unsaved()) announce('Changes saved on this device. No work was sent to a model.');
      })));
    if (options.allowHelper === false) settingsBody.append(el('p', 'Open the browser-owned margin to connect the local helper. This embedded margin cannot approve sending.', 'm-meta'));
    else {
      const code = el('input'); code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 16;
      code.setAttribute('aria-label', 'Pairing code'); code.placeholder = 'Six-digit code'; code.value = pairingDraft;
      code.addEventListener('input', () => { pairingDraft = code.value; });
      settingsBody.append(el('p', 'Reading and notes work without an account. Pairing does not establish model login or consent. Synchronization is a separate action.', 'm-meta'),
        label('Pairing code', code), actions(button('Pair', () => safely(async () => {
          if (!helper) throw new Error('Open the local helper page or trusted browser margin to pair.');
          const client = helper, priorToken = client.token, before = client.connectionVersion, previousIdentity = await pairingIdentity(client.origin, priorToken);
          if (!alive() || suspended || helper !== client || before !== client.connectionVersion) throw new Error('This pairing action was superseded.');
          await client.pair(pairingDraft, signal); const epoch = client.connectionVersion;
          await locked(async () => {
            if (!alive() || helper !== client || epoch !== client.connectionVersion || !client.token) throw new Error('Pairing changed before it could be saved.');
            await persistence.write('pairing', { origin: client.origin, token: client.token });
          });
          if (!alive() || client !== helper || epoch !== client.connectionVersion) return;
          pairingDraft = ''; code.value = ''; channel?.postMessage({ type: 'pairing-changed', origin: client.origin, previousIdentity });
          announce('Paired with the local helper. Nothing was synchronized or asked automatically.'); renderSettings();
        })), button('Save to local helper', () => track(sync())), button('Disconnect', () => safely(async () => {
          if (!helper) { announce('There is no active helper connection in this margin.'); return; }
          const client = helper, token = client.token, identity = pairingIdentity(client.origin, token);
          let removed = false;
          // Invalidate the live connection before awaiting the broadcast digest.
          const result = await client.disconnect(async () => {
            const previousIdentity = await identity;
            await locked(async () => { removed = await forgetPairingIfCurrent(persistence, client.origin, token); });
            if (removed) channel?.postMessage({ type: 'pairing-changed', origin: client.origin, previousIdentity });
          });
          announce(result === 'replaced' || !removed ? 'A newer pairing remains active. Revocation of the previous pairing may be unconfirmed.' : result === 'unconfirmed'
            ? 'Disconnected on this device. The helper did not confirm remote revocation. Earlier outcomes remain unconfirmed.' : 'Local pairing removed. ' + (result === 'revoked' ? 'The helper confirmed revocation.' : 'No remote token needed revocation.'));
        }))));
    }
    const theme = el('select'); theme.setAttribute('aria-label', 'Theme');
    for (const value of ['system', 'light', 'dark']) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; theme.append(option); }
    theme.value = document.documentElement.dataset.theme ?? 'system';
    theme.addEventListener('change', () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; void track(persistence.write('theme', theme.value)).catch(fail); });
    settingsBody.append(label('Theme', theme), el('p', 'Model permissions, exclusions and vocabulary are managed in Library and settings. Selecting text or preparing a draft grants no permission.', 'm-meta'),
      ...(options.onLibrary ? [button('Library and settings', options.onLibrary)] : []), button('Close settings', () => { setup.hidden = true; updateManagement(); settingsButton.focus(); }));
    const scoped = sourceBoundJournal(journal.state, capture.url, draft);
    for (const conflict of scoped.conflicts) {
      const detail = el('details'); detail.append(el('summary', 'Updated elsewhere: review your change'), el('p', conflict.message));
      const mutation = conflict.change;
      detail.append(el('pre', mutation.kind === 'note' ? mutation.text : mutation.kind === 'keep' ? mutation.note ?? mutation.anchor.exact : JSON.stringify(mutation)));
      detail.append(button('Keep device version; keep my change in history', () => safely(async () => {
        await keepDeviceConflict(journal, locked, mutation.id); await releaseResolvedDraft(); changed(); renderThreads(); renderSettings();
        announce('Current device version kept locally, including absence if removed. Nothing was uploaded or accepted on the helper. Your draft text remains available.');
      })));
      if (helper?.token && options.allowHelper !== false) detail.append(button('Use helper version; keep my change in history', () => safely(async () => {
        await resolveHelperConflict(journal, locked, mutation.id, async current => {
          const url = current.kind === 'keep' ? current.capture.url : currentThread(current.threadId)?.sourceUrl;
          if (!url) throw new Error('This change has no confirmed source address. Export before resolving.');
          const client = await helperForSource(url), epoch = client.connectionVersion, permission = client.permissionVersion;
          const remote = await client.list();
          if (!alive() || suspended || client !== helper || epoch !== client.connectionVersion || permission !== client.permissionVersion) throw new Error('The helper connection changed. Your change remains preserved.');
          return remote;
        });
        await releaseResolvedDraft(); changed(); renderThreads(); renderSettings(); announce('Helper version chosen. Earlier device work remains in history; the note draft was not silently applied.');
      })));
      settingsBody.append(detail);
    }
    if (scoped.resolutions.some(item => item.resolution === 'kept-device')) settingsBody.append(el('p', 'Device-version choices remain in local history and survive helper refresh. A kept choice is not a helper upload.', 'm-meta'));
    if (pairingFocused) {
      const next = settingsBody.querySelector<HTMLInputElement>('[aria-label="Pairing code"]'); next?.focus({ preventScroll: true });
      if (next && selection) next.setSelectionRange(selection[0], selection[1]);
    } else if (focused && focusText) Array.from(settingsBody.querySelectorAll('button')).find(control => control.textContent === focusText)?.focus({ preventScroll: true });
  }
  function download(name: string, value: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportWork() {
    // Current draft and failed journal data are exported even if persistent reads fail.
    const value = { version: 1, source: capture, ...sourceBoundJournal(journal.state, capture.url, draft), draft, questionDraft,
      journalDurable: !journal.unsaved, memoryOnlyDrafts: unsavedDrafts(namespace, capture.url), memoryOnlyQuestions: unsavedQuestions(namespace, capture.url),
      requestHistory: [] as unknown[], historyAvailable: false };
    try { value.requestHistory = await persistence.values(questionKey + ':'); value.historyAvailable = true; } catch { /* Exact current memory work above stays exportable. */ }
    if (alive()) download('marginalia-notes.json', value);
  }
  function destroy() {
    if (destroyed) return;
    if (draftBuffer.unsaved()) void track(draftBuffer.flush()).catch(() => {});
    asking?.destroy(); management?.destroy(); closeReplies(); highlight(null); destroyed = true; abort.abort(); channel?.close();
    workspace.remove(); skip.remove();
    if (mountedMargins.get(root)?.destroy === destroy) root.classList.remove('m-app', 'm-host-only');
  }
  const lifecycle = { destroy, async drain() { await predecessorDrain; while (pendingOperations.size) await Promise.allSettled([...pendingOperations]); } };
  mountedMargins.set(root, lifecycle);
  const api = {
    getThread(threadId: string) { const thread = currentThread(threadId); return thread && structuredClone(thread); },
    sourceUrl: capture.url, select: showSelection, connection: trustedHelper, exportWork, destroy, drain: lifecycle.drain,
    setReadingPosition(start: number) { if (!alive() || !Number.isFinite(start)) return; lastReadingPosition = Math.max(0, Math.min(capture.text.length, start)); if (!held) { readingPosition = lastReadingPosition; sectionIndex = sectionFor(readingPosition); renderPosition(); } },
    suspend() { suspended = true; management?.close(); asking?.setVisible(false); highlight(null); },
    resume() { if (!alive()) return; suspended = false; updateManagement(); paintHighlights(); if (questionOpen && !shell.classList.contains('is-collapsed')) asking?.setVisible(true); },
    focusThread(threadId: string) { const thread = currentThread(threadId); if (!thread || thread.deletedAt) return; expanded.add(threadId); hold(sectionFor(displayPosition(thread.anchor, capture) ?? 0)); renderThreads(); showPanel(); threadNodes.get(threadId)?.node.querySelector<HTMLElement>('.m-source-action')?.focus({ preventScroll: true }); },
  };
  renderCompose(); renderPosition(); renderSettings();
  const startupGeneration = editorGeneration;
  try {
    await predecessorDrain; if (!alive()) return api;
    if (options.allowHelper !== false) helper = documentHelper(namespace, options.helperOrigin ?? location.origin);
    const epoch = helper?.connectionVersion;
    await locked(() => journal.load()); storageReady = true;
    const [savedDraft, savedQuestion, pairing, theme] = await Promise.all([
      draftBuffer.load(), questionBuffer.load(), options.allowHelper === false ? undefined : persistence.read<{ origin: string; token: string }>('pairing'), persistence.read<string>('theme'),
    ]);
    if (!alive()) return api;
    if (startupGeneration === editorGeneration) draft = savedDraft;
    questionDraft = questionBuffer.get() ?? savedQuestion; reopenQuestion.hidden = !questionDraft;
    if (draft) { held = true; readingPosition = composerOffset(draft, 0); sectionIndex = sectionFor(readingPosition); }
    if (theme && ['light', 'dark'].includes(theme)) document.documentElement.dataset.theme = theme;
    if (helper && epoch === 0 && helper.connectionVersion === epoch && pairing?.origin === helper.origin) helper.token = pairing.token;
    announce(journal.unsaved || draftBuffer.unsaved() || questionBuffer.unsaved() ? 'Unsaved work recovered in this document. Retry saving or export before closing.' : 'Local storage is available. Asking checks the helper and requires an explicit review.');
  } catch { announce('Local storage could not be fully restored. Current drafts remain in this document; export before closing.'); }
  if (!alive()) return api;
  renderCompose(); renderThreads(); renderSettings();
  if (options.initialOpen === false || (options.initialOpen !== true && matchMedia('(max-width: 899px)').matches)) { shell.classList.add('is-collapsed'); rail.append(map); }
  channel?.addEventListener('message', event => {
    if (event.data?.type === 'pairing-changed') {
      if (options.allowHelper === false || !helper || event.data.origin !== helper.origin || typeof event.data.previousIdentity !== 'string') return;
      const client = helper, epoch = client.connectionVersion;
      void safely(async () => {
        if (await pairingIdentity(client.origin, client.token) !== event.data.previousIdentity || epoch !== client.connectionVersion) return;
        await locked(async () => { const saved = await persistence.read<{ origin: string; token: string }>('pairing'); if (alive() && helper === client && epoch === client.connectionVersion) client.token = saved?.origin === client.origin ? saved.token : ''; });
        announce('The helper pairing changed in another margin. Earlier outcomes are unconfirmed.');
      }); return;
    }
    if (event.data?.type === 'permissions-changed') { helper?.permissionsChanged(); return; }
    void safely(async () => { await locked(() => journal.load()); await releaseResolvedDraft(); renderThreads(); renderSettings(); announce(journal.unsaved ? 'Another tab saved work. Your unsaved changes remain here.' : 'Saved work refreshed. Your draft attachment and text are unchanged.'); });
  }, { signal });
  return api;
}

function demoPage() {
  const article = el('article', undefined, 'm-source'); article.tabIndex = -1;
  const content = [
    { title: 'A place beside the page', paragraphs: ['Reading is more than taking in a sentence. Sometimes a phrase is worth keeping. Sometimes you need to leave a question and carry on.', 'A margin gives those small acts a place. The source stays where it is; your thoughts sit beside it.'] },
    { title: 'Keep what catches you', paragraphs: ['Select a passage to open Keep and Ask. Keeping saves it on this device. Asking first lets you prepare a question and review what would leave the machine.', 'Selection alone sends nothing. You can read, highlight, and write without an account.'] },
    { title: 'Write in your own words', paragraphs: ['A note belongs to an explicit place in the text. Its attachment holds while you write. Changing that attachment is a separate choice.', 'A question can stay a question. Your own words remain above replies.'] },
    { title: 'Return to the thread', paragraphs: ['Saved work stays in page order. The map retains sections, marks, note density and your reading position.', 'Hovering a source passage does not navigate. Follow reading resumes the reading position when you choose it.'] },
    { title: 'What is available here', paragraphs: ['Reading, notes, keeping and parking are local. Pairing, synchronization, and asking are separate actions.', 'Asking availability is checked against your local setup. An unavailable or unknown result is not a successful request. Library and settings opens saved work without closing your drafts.'] },
  ];
  article.append(el('p', 'Marginalia: a reading page', 'm-source-meta'), el('h1', 'Leave room for your thoughts'), el('p', 'Select a sentence, or write beside the section you are reading.', 'm-source-intro'));
  const sections: MarginSection[] = [];
  for (const item of content) { const start = article.textContent!.length, node = el('section'); node.dataset.readingSection = String(sections.length); node.append(el('h2', item.title), ...item.paragraphs.map(text => el('p', text))); article.append(node); sections.push({ title: item.title, start, end: article.textContent!.length }); }
  const capture: SourceCapture = { url: 'https://marginalia.local/reading', title: 'Leave room for your thoughts', pageType: 'Reading page', text: article.textContent!, capturedAt: new Date().toISOString(), extractionVersion: 'text-content-v1', sections: structuredClone(sections) };
  return { article, capture, sections };
}
