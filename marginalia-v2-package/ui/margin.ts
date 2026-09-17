import type { QuoteAnchor, ReaderMutation, SourceCapture, Thread } from '../contracts/reader.ts';
import { wholePageAnchor, attachQuote } from '../contracts/reader.ts';
import { el, button } from './dom.ts';
import { ReaderJournal } from './journal.ts';
import { localPersistence, type CachedReply } from './persistence.ts';
import { anchorAt, orderedThreads, outgoingPreview, sourceLocation, pageDefinition, displayPosition } from './margin-model.ts';
import { HelperClient } from './helper.ts';
import { mountReply, type MountedReply } from '../renderer/index.ts';
import { canonicalReplyData, validateReply, type SourceBinding } from '../contracts/reply.ts';

export type MarginSection = { title: string; start: number; end: number };
export type MarginOptions = {
  capture?: SourceCapture;
  sections?: MarginSection[];
  /** Supply a source only when it belongs to this trusted document. Extension hosts use callbacks. */
  sourceRoot?: HTMLElement;
  onSource?: (anchor: QuoteAnchor) => void;
  onHighlight?: (anchor: QuoteAnchor | null) => void;
  helperOrigin?: string;
  storageName?: string;
  initialOpen?: boolean;
  /** Disable authenticated helper access in page-embedded, clickjackable hosts. */
  allowHelper?: boolean;
  /** Trusted host policy recheck immediately before each local outbox send. */
  authorizeHelperSend?: (sourceUrl: string) => Promise<void>;
};
type Draft = { anchor: QuoteAnchor; text: string; threadId?: string; noteId?: string; revision?: number; mutation?: ReaderMutation };
const id = () => crypto.randomUUID();
const excerpt = (text: string, length = 82) => text.length > length ? text.slice(0, length) + '…' : text;
const label = (text: string, input: HTMLElement) => { const node = el('label', text); node.append(input); return node; };
const actions = (...children: HTMLElement[]) => { const row = el('div', undefined, 'm-actions'); row.append(...children); return row; };
const mountedMargins = new WeakMap<HTMLElement, { destroy(): void; drain(): Promise<unknown> }>();

/** Mount in a trusted local or extension document. No remote page receives private note markup. */
export async function mountMargin(root: HTMLElement, options: MarginOptions = {}) {
  const previous = mountedMargins.get(root); previous?.destroy();
  const predecessorDrain = previous?.drain() ?? Promise.resolve();
  let destroyed = false;
  const pendingOperations = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> { pendingOperations.add(work); void work.finally(() => pendingOperations.delete(work)).catch(() => {}); return work; }
  const alive = () => !destroyed;
  const instance = 'm-' + id();
  const persistence = localPersistence(options.storageName);
  const journal = new ReaderJournal(persistence.journal);
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(options.storageName ?? 'marginalia-reader') : null;
  const abort = new AbortController();
  const { signal } = abort;
  let source = options.sourceRoot;
  root.classList.add('m-app');
  if (options.capture) root.classList.add('m-host-only');
  const workspace = el('div', undefined, 'm-workspace');
  if (!options.capture) {
    const page = demoPage(); source = page.article;
    options.capture = page.capture; options.sections = page.sections;
    workspace.append(source);
  }
  const capture = options.capture;
  const sections = options.sections?.length ? options.sections : [{ title: 'Whole page', start: 0, end: capture.text.length }];
  const shell = el('aside', undefined, 'mg'); shell.setAttribute('aria-label', 'Marginalia'); shell.id = instance;
  const rail = el('nav', undefined, 'm-rail'); rail.setAttribute('aria-label', 'Page map');
  const panel = el('div', undefined, 'm-panel');
  const bar = el('div', undefined, 'm-bar');
  const heading = el('header', undefined, 'm-head');
  heading.append(el('h1', capture.title), el('p', `${capture.pageType} · ${new URL(capture.url).hostname}`, 'm-meta'));
  const compose = el('div', undefined, 'm-compose');
  const map = el('nav', undefined, 'm-map'); map.setAttribute('aria-label', 'Sections');
  const reading = el('div', undefined, 'm-reading');
  const selectionCard = el('section', undefined, 'm-selection'); selectionCard.hidden = true;
  const threadList = el('div', undefined, 'm-threads');
  const footer = el('footer', undefined, 'm-footer');
  const status = el('p', '', 'm-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const toast = el('div', undefined, 'm-toast'); toast.hidden = true;
  const setup = el('section', undefined, 'm-settings'); setup.hidden = true;
  const scroll = el('div', undefined, 'm-scroll'); scroll.append(map, reading, selectionCard, threadList, footer);
  panel.append(bar, heading, compose, setup, scroll, status, toast); shell.append(rail, panel); workspace.append(shell); root.append(workspace);
  let sectionIndex = 0, held = false, draft: Draft | undefined, selected: QuoteAnchor | undefined;
  let helper: HelperClient | undefined, storageReady = false, saving = false;
  let denied = false;
  let pendingNoteMutation: ReaderMutation | undefined;
  let pendingNoteCommitted = false;
  let needsReconciliation = false;
  let lastOpener: HTMLElement | null = null;
  const expanded = new Set<string>();
  const threadNodes = new Map<string, { revision: number; node: HTMLElement }>();
  const replyMounts = new Map<string, { threadId: string; node: HTMLElement; mounted: MountedReply; flush(): Promise<void>; close(): void }>();
  const replyLoads = new Map<string, number>();
  const sessionKey = 'marginalia-draft-tab';
  let tabKey = sessionStorage.getItem(sessionKey);
  if (!tabKey) { tabKey = id(); sessionStorage.setItem(sessionKey, tabKey); }
  const draftKey = 'draft:' + tabKey + ':' + capture.url;
  const displayAnchor = (anchor: QuoteAnchor) => {
    if (anchor.kind === 'whole-page') return 'Whole page';
    const section = sections.find(s => s.start === anchor.start && anchor.exact.startsWith(s.title));
    return section ? section.title + ' · ' + anchor.exact.slice(section.title.length).trimStart() : anchor.exact;
  };
  const announce = (message: string) => { if (alive()) status.textContent = message; };
  const changed = () => { if (alive()) channel?.postMessage('changed'); };
  const fail = (error: unknown) => {
    if (!alive()) return;
    if (error instanceof Error && error.message.startsWith('Local storage changed elsewhere.')) needsReconciliation = true;
    announce(needsReconciliation ? 'Another tab saved work. Use Recover unsaved changes in Settings; your draft is still here.' : journal.unsaved ? 'Not saved yet. Keep this page open and use Retry saving in Settings.' : pendingNoteCommitted ? 'Your note is saved. Use Retry saving in Settings to clear its draft.' : error instanceof Error ? error.message : 'Your work could not be saved. Keep this page open and try again.'); renderSettings();
  };
  async function locked<T>(operation: () => Promise<T>) {
    if (!navigator.locks) throw new Error('Safe local saving needs a browser with Web Locks support.');
    return navigator.locks.request(options.storageName ?? 'marginalia-reader', operation);
  }
  async function change(mutation: ReaderMutation) {
    if (!alive()) throw new Error('This margin has closed.');
    if (!storageReady) throw new Error('Local saving is unavailable. Keep your draft open.');
    if (journal.unsaved) throw new Error('Retry saving in Settings before making another change.');
    try { await locked(async () => { await journal.load(); await journal.change(mutation); }); }
    catch (error) { if (!journal.unsaved) renderThreads(); throw error; }
    changed(); renderThreads();
  }
  function safely(operation: () => Promise<void>) { if (!alive()) return Promise.resolve(); return track((async () => { try { await operation(); } catch (error) { fail(error); } })()); }
  function currentAnchor() { const section = sections[sectionIndex]; return anchorAt(capture.text, section.start, section.end); }
  function hold(index = sectionIndex) { if (!alive()) return; held = true; sectionIndex = index; renderPosition(); }
  function showPanel(focus = false) { if (!alive()) return; shell.classList.remove('is-collapsed'); if (focus) writeButton.focus(); }
  function closePanel() { if (!alive()) return; shell.classList.add('is-collapsed'); openButton.focus(); }
  const openButton = button('Open margin', () => showPanel(true)); openButton.className = 'm-open';
  rail.append(openButton);
  const collapse = button('Collapse', closePanel);
  const settingsButton = button('Settings', () => { setup.hidden = !setup.hidden; if (!setup.hidden) setup.querySelector<HTMLElement>('input')?.focus(); });
  bar.append(el('span', 'Marginalia', 'm-wordmark'), actions(collapse, settingsButton));
  const writeButton = button('Write here…', () => beginDraft()); writeButton.className = 'm-write'; compose.append(writeButton);
  const readingTitle = el('h2'); readingTitle.tabIndex = -1;
  const followingLabel = el('span', 'Reading', 'm-meta');
  const followButton = button('Follow reading', () => { held = false; updateReading(); renderPosition(); readingTitle.focus(); });
  reading.append(readingTitle, followingLabel, followButton);
  const footerCount = el('span', '', 'm-meta');
  footer.append(footerCount, actions(button('Export JSON', exportWork)), el('span', 'Hear it · not available yet', 'm-meta'));
  const skip = button('Go to margin', () => showPanel(true)); skip.className = 'm-skip'; root.prepend(skip);

  function renderPosition() {
    if (!alive()) return;
    readingTitle.textContent = sections[sectionIndex].title;
    followButton.hidden = !held; followingLabel.hidden = held;
    for (const container of [map, rail]) for (const node of Array.from(container.querySelectorAll<HTMLElement>('[data-section]'))) {
      const index = Number(node.dataset.section);
      node.setAttribute('aria-current', String(index === sectionIndex));
      const count = orderedThreads(journal.state.threads, capture).filter(t => { const position = displayPosition(t.anchor, capture); return position !== undefined && position >= sections[index].start && position < sections[index].end; }).length;
      node.dataset.marked = String(count > 0); node.title = `${sections[index].title}${count ? ` · ${count} saved` : ''}`;
    }
    for (const thread of orderedThreads(journal.state.threads, capture)) {
      const node = threadNodes.get(thread.id)?.node;
      if (!node) continue;
      const position = displayPosition(thread.anchor, capture);
      const index = position === undefined ? -1 : sectionFor(position);
      const compact = index >= 0 && index !== sectionIndex && !expanded.has(thread.id);
      if (!compact || !node.contains(document.activeElement)) node.classList.toggle('is-compact', compact);
    }
  }
  function sectionFor(start: number) { const index = sections.findIndex(s => start >= s.start && start < s.end); return index < 0 ? 0 : index; }
  sections.forEach((section, index) => {
    for (const container of [map, rail]) {
      const segment = button(section.title, () => { hold(index); showPanel(); sourceAction(anchorAt(capture.text, section.start, section.end)); });
      segment.dataset.section = String(index); segment.className = `m-segment m-colour-${index % 6 + 1}`;
      segment.setAttribute('aria-label', section.title); segment.style.flexGrow = String(Math.max(1, section.end - section.start)); container.append(segment);
    }
  });

  function persistDraft() { if (draft && alive()) void track(persistence.write(draftKey, draft)).catch(fail); }
  function beginDraft(anchor = selected ?? currentAnchor(), thread?: Thread, noteId?: string) {
    if (!alive()) return;
    if (draft) { compose.querySelector('textarea')?.focus(); announce('Finish or discard your current note before starting another.'); return; }
    const note = thread?.notes.find(item => item.id === noteId);
    draft = { anchor: structuredClone(anchor), text: note?.text ?? '', ...(thread ? { threadId: thread.id, noteId: note?.id ?? id(), revision: note?.revision ?? 0 } : {}) };
    hold(sectionFor(displayPosition(anchor, capture) ?? sections[sectionIndex].start)); persistDraft(); renderCompose(true);
  }
  function renderCompose(focus = false) {
    if (!alive()) return;
    compose.replaceChildren();
    if (!draft) { compose.append(writeButton); return; }
    const attachment = el('div', undefined, 'm-attachment');
    attachment.append(el('span', draft.anchor.kind === 'whole-page' ? 'Note on the whole page' : `Note on “${excerpt(displayAnchor(draft.anchor), 66)}”`));
    if (!draft.threadId) attachment.append(button('Change', () => {
      const choose = el('div', undefined, 'm-choose-anchor');
      for (const section of sections) choose.append(button(section.title, () => { draft!.anchor = anchorAt(capture.text, section.start, section.end); persistDraft(); renderCompose(true); }));
      choose.append(button('Whole page', () => { draft!.anchor = wholePageAnchor(); persistDraft(); renderCompose(true); }));
      if (selected) choose.append(button('Selected passage', () => { draft!.anchor = structuredClone(selected!); persistDraft(); renderCompose(true); }));
      attachment.replaceChildren(el('span', 'Choose where this note belongs'), choose);
      choose.querySelector('button')?.focus();
    }));
    const field = el('textarea'); field.id = instance + '-note'; field.value = draft.text; field.placeholder = 'Your note'; field.setAttribute('aria-label', 'Your note'); field.disabled = saving || pendingNoteCommitted || !!draft.mutation || !!pendingNoteMutation && journal.unsaved;
    field.addEventListener('input', () => { draft!.text = field.value; persistDraft(); });
    field.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void saveDraft(); } });
    compose.append(attachment, field, actions(button('Save note', saveDraft), button('Discard draft', () => safely(async () => { await persistence.write(draftKey, undefined); draft = undefined; renderCompose(); writeButton.focus(); }))), el('small', 'Enter saves · Shift+Enter for a new line', 'm-meta'));
    if (draft.mutation) {
      compose.append(el('p', 'Finish saving this note before editing it.', 'm-meta'));
      for (const control of Array.from(compose.querySelectorAll('button'))) if (control.textContent !== 'Save note') control.disabled = true;
    }
    if (saving || pendingNoteCommitted || pendingNoteMutation && journal.unsaved) for (const control of Array.from(compose.querySelectorAll('button'))) control.disabled = true;
    if (focus) field.focus();
  }
  function saveDraft() { return track(saveDraftNow()); }
  async function saveDraftNow() {
    if (!alive()) return;
    if (!draft || saving || !draft.text.trim()) return;
    saving = true;
    renderCompose();
    try {
      const saved = structuredClone(draft);
      pendingNoteMutation ??= saved.mutation ?? (saved.threadId ? { id: id(), kind: 'note', threadId: saved.threadId, noteId: saved.noteId!, text: saved.text, expectedRevision: saved.revision! } : { id: id(), kind: 'keep', threadId: id(), capture, anchor: saved.anchor, note: saved.text });
      // Persist identity before the journal commit, so a reload can replay the same
      // mutation after a successful save followed by failed draft cleanup.
      draft!.mutation = structuredClone(pendingNoteMutation);
      await persistence.write(draftKey, draft);
      if (!pendingNoteCommitted) { await change(pendingNoteMutation); pendingNoteCommitted = true; }
      if (!alive()) return;
      await persistence.write(draftKey, undefined); draft = undefined; pendingNoteMutation = undefined; pendingNoteCommitted = false; renderCompose(); writeButton.focus(); announce('Note saved on this device.');
    } catch (error) { if (!journal.unsaved && !pendingNoteCommitted) { pendingNoteMutation = undefined; if (draft) { delete draft.mutation; persistDraft(); } } fail(error); } finally { saving = false; if (draft) renderCompose(!journal.unsaved); }
  }

  async function keep(anchor: QuoteAnchor, parked = false) {
    await safely(async () => {
      const existing = orderedThreads(journal.state.threads, capture).find(t => t.anchor.start === anchor.start && t.anchor.exact === anchor.exact);
      const threadId = existing?.id ?? id();
      if (!existing) await change({ id: id(), kind: 'keep', threadId, capture, anchor });
      if (parked) { const thread = journal.state.threads.find(t => t.id === threadId)!; await change({ id: id(), kind: 'thread-state', threadId, state: 'parked', expectedRevision: thread.revision }); }
      announce(parked ? 'Passage parked on this device.' : 'Passage kept on this device.');
    });
  }
  function showSelection(anchor: QuoteAnchor) {
    if (!alive()) return;
    if (!anchor.exact.trim()) return;
    selected = structuredClone(anchor); lastOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    hold(sectionFor(anchor.start)); showPanel(); selectionCard.hidden = false;
    const definition = pageDefinition(anchor.exact, capture.text);
    selectionCard.replaceChildren(el('blockquote', displayAnchor(anchor)), el('p', definition ? `${definition} · from this page` : 'No definition found for this selection. Ask about a word or phrase.', 'm-meta'), actions(button('Keep', () => keep(anchor)), button('Ask', () => ask(anchor)), button('Park', () => keep(anchor, true)), button('Write a note', () => beginDraft(anchor)), button('Close selection', closeSelection)), el('p', 'Nothing sent.', 'm-meta'));
    announce('Selection in the margin. Nothing sent.');
  }
  function closeSelection() { if (!alive()) return; selectionCard.hidden = true; selectionCard.replaceChildren(); selected = undefined; if (lastOpener?.isConnected) lastOpener.focus(); }
  selectionCard.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Escape') closeSelection();
    if (selected && event.key.toLowerCase() === 'k') { event.preventDefault(); void keep(selected); }
    if (selected && event.key.toLowerCase() === 'p') { event.preventDefault(); void keep(selected, true); }
    if (selected && event.key === '/') { event.preventDefault(); ask(selected); }
  });
  function ask(anchor: QuoteAnchor, thread?: Thread, answeredNote?: {text: string; revision: number}) {
    hold(sectionFor(displayPosition(anchor, capture) ?? sections[sectionIndex].start)); showPanel(); selectionCard.hidden = false;
    if (!selectionCard.contains(document.activeElement)) lastOpener = document.activeElement as HTMLElement;
    const note = answeredNote ?? thread?.notes.filter(n => !n.deletedAt).at(-1);
    const question = el('textarea'); question.setAttribute('aria-label', 'Your question'); question.placeholder = 'What would help you here?';
    const context = el('textarea'); context.setAttribute('aria-label', 'Context to attach'); context.placeholder = 'Only what you choose to share';
    const extra = el('details'); extra.append(el('summary', 'Attach context'), label('Context to attach', context));
    const suggestions = actions(...['Define this', 'Show me an example', 'Explain step by step'].map(text => button(text, () => { question.value = text; question.focus(); })));
    const more = el('details'); more.append(el('summary', 'All help'), el('p', 'Define · Show me · Derive · Diagram · Check this · Go further. Asking is unavailable until Codex is connected.', 'm-meta'));
    selectionCard.replaceChildren(el('blockquote', displayAnchor(anchor)), ...(note ? [el('p', `Your note (version ${note.revision}): ${note.text}`, 'm-note')] : []), suggestions, question, extra, more,
      el('p', denied ? 'Asking is blocked for this site. You can change this in Settings.' : 'Codex is not connected. You can prepare a question and review exactly what it would send.', 'm-meta'),
      actions(button('Review outgoing text', () => { if (!question.value.trim()) { question.focus(); return; } review(anchor, question.value, note, context.value); }), button('Close question', closeSelection)));
    question.focus();
  }
  function review(anchor: QuoteAnchor, question: string, note: { text: string; revision: number } | undefined, context: string) {
    const packet = outgoingPreview(capture, anchor, question, note, context);
    const payload = el('pre', JSON.stringify(packet, null, 2));
    const details = el('details'); details.open = true; details.append(el('summary', 'Exact outgoing text'), payload);
    const once = button('This time', () => {}); once.disabled = true;
    const always = button(`Always on ${new URL(capture.url).hostname}`, () => {}); always.disabled = true;
    selectionCard.replaceChildren(el('h2', 'Send this passage to Codex'), el('p', 'Recipient: your Codex. Scope: this question only.'), details, el('p', 'Sending is unavailable. Nothing has left this page.', 'm-meta'),
      actions(once, always, button(`Never on ${new URL(capture.url).hostname}`, () => safely(async () => { await persistence.write('denied:' + new URL(capture.url).origin, true); denied = true; renderSettings(); closeSelection(); announce('Asking blocked for this site.'); })), button('Back to question', () => { ask(anchor, undefined, note); const fields = selectionCard.querySelectorAll('textarea'); fields[0].value = question; fields[1].value = context; })));
    const title = selectionCard.querySelector('h2')!; title.tabIndex = -1; title.focus();
  }

  function renderThreads() {
    if (!alive()) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active?.dataset.focusKey;
    const focusedThreadId = active?.closest<HTMLElement>('[data-thread]')?.dataset.thread;
    if (focusKey && focusedThreadId) expanded.add(focusedThreadId);
    const threads = orderedThreads(journal.state.threads, capture);
    for (const [key, entry] of threadNodes) if (!threads.some(t => t.id === key)) { closeReplies(key); replyLoads.set(key, (replyLoads.get(key) ?? 0) + 1); entry.node.remove(); threadNodes.delete(key); }
    const empty = threadList.querySelector('.m-empty'); empty?.remove();
    if (!threads.length) threadList.append(el('p', 'Keep a passage or write a note. Your work stays here, even without the local helper.', 'm-empty'));
    threads.forEach(thread => {
      let entry = threadNodes.get(thread.id);
      if (entry?.revision !== thread.revision) {
        const node = renderThread(thread);
        if (entry) {
          // The reply subtree stays connected while reader notes and thread controls change.
          entry.node.querySelector('.m-thread-content')!.replaceWith(node.querySelector('.m-thread-content')!);
          entry.node.querySelector('.m-excerpt')!.replaceWith(node.querySelector('.m-excerpt')!);
          entry.revision = thread.revision;
        } else {
          entry = { node, revision: thread.revision }; threadNodes.set(thread.id, entry);
          void loadReplies(thread);
        }
      }
      // Move only when order changed; unchanged focused nodes are left in place.
      const index = threads.indexOf(thread); const at = threadList.children[index];
      if (at !== entry.node) threadList.insertBefore(entry.node, at ?? null);
    });
    footerCount.textContent = `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'} on this page`;
    renderPosition(); paintHighlights();
    if (active?.isConnected && focusedThreadId && threadList.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    if (focusKey && active && !active.isConnected) {
      const replacement = Array.from(threadList.querySelectorAll<HTMLElement>('[data-focus-key]')).find(node => node.dataset.focusKey === focusKey);
      (replacement ?? writeButton).focus();
    }
  }
  function renderThread(thread: Thread) {
    const node = el('section', undefined, 'm-thread'); node.id = instance + '-' + thread.id; node.dataset.thread = thread.id;
    const location = sourceLocation(thread, capture);
    const currentSection = () => sectionFor(displayPosition(thread.anchor, capture) ?? sections[sectionIndex].start);
    const preview = button(excerpt(thread.notes.find(n => !n.deletedAt)?.text ?? thread.anchor.exact), () => { expanded.add(thread.id); hold(currentSection()); renderPosition(); requestAnimationFrame(() => { if (alive()) threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); }); }); preview.className = 'm-excerpt'; preview.dataset.focusKey = thread.id + ':excerpt';
    const body = el('div', undefined, 'm-thread-content');
    const sourceText = thread.anchor.kind === 'whole-page' ? 'Whole page' : `“${excerpt(displayAnchor(thread.anchor))}”`;
    const sourceButton = button(sourceText, () => sourceAction(thread.anchor)); sourceButton.className = 'm-source-action'; sourceButton.setAttribute('aria-label', 'Source passage: ' + sourceText); sourceButton.dataset.focusKey = thread.id + ':source';
    sourceButton.addEventListener('mouseenter', () => highlight(thread.anchor)); sourceButton.addEventListener('mouseleave', () => highlight(null));
    sourceButton.addEventListener('focus', () => highlight(thread.anchor)); sourceButton.addEventListener('blur', () => highlight(null));
    body.append(sourceButton);
    if (location.state !== 'exact') body.append(el('p', `Attachment ${location.state}. Saved quote preserved.`, 'm-meta'));
    for (const note of thread.notes.filter(note => !note.deletedAt)) {
      const edit = button('Edit note', () => beginDraft(thread.anchor, thread, note.id)); edit.dataset.focusKey = thread.id + ':note:' + note.id;
      const noteBlock = el('div', undefined, 'm-reader-note'); noteBlock.append(el('p', note.text, 'm-note'), edit); body.append(noteBlock);
    }
    const state = el('select'); state.setAttribute('aria-label', 'Thread state');
    for (const value of ['open', 'parked', 'done', 'archived'] as const) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; state.append(option); } state.value = thread.state;
    state.addEventListener('change', () => void safely(async () => { await change({ id: id(), kind: 'thread-state', threadId: thread.id, expectedRevision: thread.revision, state: state.value as Thread['state'] }); announce('Thread ' + state.value + '.'); threadNodes.get(thread.id)?.node.querySelector('select')?.focus(); }));
    body.append(actions(button('Add note', () => beginDraft(thread.anchor, thread)), button('Ask', () => ask(thread.anchor, thread)), state, button('Remove', () => safely(async () => {
      await change({ id: id(), kind: 'remove', threadId: thread.id, removed: true, expectedRevision: thread.revision });
      toast.hidden = false; const undo = button('Undo', () => safely(async () => { const current = journal.state.threads.find(t => t.id === thread.id)!; await change({ id: id(), kind: 'remove', threadId: thread.id, removed: false, expectedRevision: current.revision }); toast.hidden = true; threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); announce('Thread restored.'); }));
      toast.replaceChildren(el('span', 'Thread removed.'), undo); undo.focus();
    }))));
    const replyArea = el('section', undefined, 'm-saved-replies'); replyArea.setAttribute('aria-label', 'Saved replies');
    const replyStatus = el('p', '', 'm-reply-status m-meta'); replyStatus.setAttribute('role', 'status');
    const replyList = el('div', undefined, 'm-reply-list');
    const replyActions = actions(button('Reload saved views', () => loadReplies(thread, false, true)), button('Export saved replies and views', () => exportReplies(thread)));
    if (options.allowHelper !== false) replyActions.append(button('Load replies from helper', () => loadReplies(thread, true)));
    replyArea.append(replyStatus, replyList, replyActions);
    const bodyGroup = el('div', undefined, 'm-thread-body'); bodyGroup.append(body, replyArea); node.append(preview, bodyGroup);
    for (const control of Array.from(node.querySelectorAll<HTMLElement>('button,select'))) control.dataset.focusKey ??= thread.id + ':' + (control.getAttribute('aria-label') ?? control.textContent);
    node.addEventListener('focusin', () => hold(currentSection()));
    return node;
  }

  function closeReplies(threadId?: string) {
    for (const [key, entry] of replyMounts) if (!threadId || entry.threadId === threadId) { entry.close(); entry.node.remove(); replyMounts.delete(key); }
  }
  async function replyClient(thread: Thread) {
    if (!alive() || options.allowHelper === false || !helper?.token) throw new Error('Open the browser margin and pair with the helper to use this action.');
    const client = helper;
    await options.authorizeHelperSend?.(thread.sourceUrl);
    if (!alive() || helper !== client || !client.token) throw new Error('The helper connection changed.');
    return client;
  }
  function bindingAnchor(binding: SourceBinding, original: string): QuoteAnchor | undefined {
    const selector = binding.selector;
    const match = attachQuote({ exact: selector.exact, prefix: selector.prefix ?? '', suffix: selector.suffix ?? '', start: 0, end: selector.exact.length }, original);
    if (!['exact', 'moved'].includes(match.state) || match.candidates.length !== 1) return;
    const { start, end } = match.candidates[0];
    const anchor = { kind: 'quote' as const, exact: selector.exact, start, end, prefix: original.slice(Math.max(0, start - 32), start), suffix: original.slice(end, end + 32) };
    const attachment = attachQuote(anchor, capture.text);
    if (!['exact', 'moved'].includes(attachment.state)) return;
    return anchor;
  }
  async function loadReplies(thread: Thread, remote = false, reopen = false) {
    if (!alive()) return;
    const generation = (replyLoads.get(thread.id) ?? 0) + 1; replyLoads.set(thread.id, generation);
    const current = () => alive() && replyLoads.get(thread.id) === generation && !!threadNodes.get(thread.id);
    const area = () => threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-saved-replies');
    const message = (text: string) => { if (current()) { const node = area()?.querySelector('.m-reply-status'); if (node) node.textContent = text; } };
    try {
      if (remote) {
        message('Loading saved replies from the local helper…');
        const client = await replyClient(thread);
        await persistence.replies.refresh(client.origin, thread.id, async () => {
          if (!current()) return;
          const currentClient = await replyClient(thread);
          if (currentClient !== client) throw new Error('The helper connection changed.');
          const bundle = await client.replies(thread.id);
          if (!current()) return;
          if (bundle.source.id !== thread.sourceVersionId) throw new Error('The helper returned a different source version.');
          await persistence.replies.cache(client.origin, thread.id, bundle.source, bundle.replies, bundle.views);
        });
      }
      if (!current()) return;
      if (reopen) {
        await Promise.all([...replyMounts.values()].filter(entry => entry.threadId === thread.id).map(entry => entry.flush()));
        if (!current()) return;
        closeReplies(thread.id);
      }
      const records = await persistence.replies.list(thread.id);
      if (!current()) return;
      const visible = records.filter(record => !record.version.deletedAt);
      let unavailable = 0;
      const identity = (record: CachedReply) => JSON.stringify([record.origin, record.version.threadId, record.version.id]);
      for (const [key, entry] of replyMounts) if (entry.threadId === thread.id && !visible.some(record => identity(record) === key)) { entry.close(); entry.node.remove(); replyMounts.delete(key); }
      for (const record of visible) {
        const key = identity(record);
        if (replyMounts.has(key)) continue;
        const session = await persistence.replies.open(record);
        if (!current()) return;
        const saved = session.record;
        if (saved.version.deletedAt) continue;
        if (!validateReply(saved.version.reply, { sourceText: saved.source.text }).ok) { unavailable++; continue; }
        const wrapper = el('section', undefined, 'm-saved-reply'); wrapper.dataset.replyVersion = saved.version.id;
        wrapper.append(el('p', `Saved reply · ${saved.version.createdAt}${saved.version.parentId ? ' · follow-up' : ''}${saved.version.supersedes ? ' · revised version' : ''}`, 'm-meta'));
        if (saved.version.answeredNote) wrapper.append(el('p', `Answers your note, version ${saved.version.answeredNote.revision}: ${saved.version.answeredNote.text}`, 'm-reply-note-reference m-meta'));
        wrapper.append(el('p', saved.dirty ? 'View changes saved on this device.' : 'Saved view. Controls do not change the authored reply.', 'm-meta'));
        const viewStatus = el('p', saved.conflict ? 'This view changed elsewhere. Your local inputs are preserved.' : '', 'm-meta'); viewStatus.setAttribute('role', 'status');
        const canvas = el('div'); wrapper.append(canvas);
        let closed = false;
        let lastPersisted = JSON.stringify(saved.local);
        let reportRequest = 0;
        const persistView = (state: ReturnType<MountedReply['getState']>) => {
          if (closed) return Promise.resolve();
          const snapshotKey = JSON.stringify(state);
          return track(session.save(state)).then(() => { lastPersisted = snapshotKey; }, error => {
            if (error instanceof Error && error.name === 'RecoveredViewConflict') lastPersisted = snapshotKey;
            if (!closed && alive()) viewStatus.textContent = error instanceof Error ? error.message : 'The current view is not saved. Keep this margin open or export it.';
            throw error;
          });
        };
        const mounted: MountedReply = mountReply(canvas, saved.version.reply, {
          sourceText: saved.source.text, initialState: saved.local,
          capabilities: ['samples'],
          hostReport: saved.reports?.[canonicalReplyData(saved.local.parameters)] ?? saved.report ?? saved.version.validation,
          sampleGenerationRecords: saved.sampleGenerationRecords,
          onStateChange: persistView,
          onSourceHighlight: binding => {
            if (closed || !alive()) return;
            highlight(binding ? bindingAnchor(binding, saved.source.text) ?? null : null);
          },
          onSourceNavigate: binding => {
            if (closed || !alive()) return;
            const anchor = bindingAnchor(binding, saved.source.text);
            if (anchor) sourceAction(anchor); else announce('This saved source passage cannot be located unambiguously on the current page. The original reply is preserved.');
          },
          ...(options.allowHelper !== false && helper?.token && helper.origin === saved.origin ? {
            resolveHostReport: async (parameters: Readonly<Record<string, number>>) => {
              if (closed) return undefined;
              const request = ++reportRequest;
              const parameterKey = canonicalReplyData(parameters);
              const isCurrent = () => !closed && alive() && request === reportRequest && canonicalReplyData(mounted.getState().parameters) === parameterKey;
              const client = await replyClient(thread);
              if (client.origin !== saved.origin) return undefined;
              const report = await client.checkReply(thread.id, saved.version.id, parameters);
              if (!isCurrent()) return undefined;
              await persistence.replies.report(saved, parameters, report, isCurrent);
              return isCurrent() ? report : undefined;
            },
          } : {}),
        });
        lastPersisted = JSON.stringify(mounted.getState());
        const flush = async () => {
          if (JSON.stringify(mounted.getState()) === lastPersisted) return;
          try { await persistView(mounted.getState()); }
          catch (error) { if (!(error instanceof Error && error.name === 'RecoveredViewConflict')) throw error; }
        };
        const entry = { threadId: thread.id, node: wrapper, mounted, flush, close() {
          if (closed) return;
          // Drain the renderer's latest buffered snapshot before a replacement opens.
          const finalState = mounted.getState();
          if (JSON.stringify(finalState) !== lastPersisted) void persistView(finalState).catch(fail);
          mounted.destroy(); closed = true;
        } };
        replyMounts.set(key, entry);
        const controls = actions();
        if (options.allowHelper !== false) {
          controls.append(button('Save view to helper', () => safely(async () => {
            if (closed) return;
            await persistView(mounted.getState());
            if (closed || !alive()) return;
            const client = await replyClient(thread);
            if (client.origin !== saved.origin) throw new Error('Pair with the helper that owns this reply.');
            await persistence.replies.sync(saved, async change => {
              if (closed) throw new Error('This reply view has closed. Its inputs remain on this device.');
              const currentClient = await replyClient(thread);
              if (currentClient !== client) throw new Error('The helper connection changed.');
              return client.saveReplyView(thread.id, change);
            });
            const latest = (await persistence.replies.list(thread.id)).find(record => record.origin === saved.origin && record.version.id === saved.version.id);
            if (!closed && alive()) viewStatus.textContent = latest?.dirty ? 'An earlier saved view reached the helper. Newer inputs remain saved on this device; save again to send them.' : 'The saved view was sent to the local helper.';
          })), button('Use helper view', () => safely(async () => {
            if (closed) return;
            const client = await replyClient(thread);
            if (client.origin !== saved.origin) throw new Error('Pair with the helper that owns this reply.');
            if (closed || !alive()) return;
            await persistence.replies.useRemote(saved, mounted.getState(), async () => {
                const currentClient = await replyClient(thread);
                if (currentClient !== client) throw new Error('The helper connection changed.');
                return client.replyView(thread.id, saved.version.id);
            });
            if (closed || !alive()) return;
            entry.close(); replyMounts.delete(key); wrapper.remove();
            await loadReplies(thread);
            announce('Helper view restored. Previous local inputs remain in the recovery export.');
          })));
        }
        wrapper.append(viewStatus, controls, el('p', 'Follow-up sending and saved-solver execution are not connected in this margin yet.', 'm-meta'));
        area()?.querySelector('.m-reply-list')?.append(wrapper);
      }
      message(persistence.replies.unsaved(thread.id).length ? 'Some view inputs are still only in memory after a failed save. Export them before closing this page.' : unavailable ? `${unavailable} saved ${unavailable === 1 ? 'reply could' : 'replies could'} not be safely displayed. Original records remain available in the export.` : visible.some(record => record.conflict) ? 'The helper has a different view. Local controls are preserved; use the helper view explicitly to replace them.' : visible.some(record => record.recovered?.length) ? 'Saved replies are available. Earlier view inputs are preserved in the recovery export.' : visible.length ? `${visible.length} saved ${visible.length === 1 ? 'reply' : 'replies'}. Notes stay above replies.` : 'No saved replies on this device.');
    } catch (error) { message(error instanceof Error ? error.message : 'Saved replies could not be loaded.'); }
  }
  function exportReplies(thread: Thread) {
    return safely(async () => {
      await Promise.allSettled([...replyMounts.values()].filter(entry => entry.threadId === thread.id).map(entry => entry.flush()));
      let records: CachedReply[] = [];
      const memoryOnly = persistence.replies.unsaved(thread.id);
      try { records = await persistence.replies.list(thread.id); } catch (error) { if (!memoryOnly.length) throw error; }
      if (!alive()) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 'marginalia.cached-replies.v1', threadId: thread.id, records, memoryOnly }, null, 2)], { type: 'application/json' }));
      const link = el('a'); link.href = url; link.download = 'marginalia-replies.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function sourceRange(anchor: QuoteAnchor) {
    if (!source) return null;
    const fake = { anchor } as Thread; const attachment = sourceLocation(fake, capture);
    if (!['exact', 'moved'].includes(attachment.state)) return null;
    const match = attachment.candidates[0]; const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    if (!match) return null;
    const range = document.createRange(); let offset = 0, start = false, textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const end = offset + (textNode.textContent?.length ?? 0);
      if (!start && match.start >= offset && match.start < end) { range.setStart(textNode, match.start - offset); start = true; }
      if (start && match.end <= end) { range.setEnd(textNode, match.end - offset); return range; } offset = end;
    }
    return null;
  }
  function highlight(anchor: QuoteAnchor | null) {
    if (!alive()) return;
    options.onHighlight?.(anchor);
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!highlights || !HighlightClass) return;
    const range = anchor && sourceRange(anchor); highlights.set('marginalia-focus', new HighlightClass(...(range ? [range] : [])));
  }
  function paintHighlights() {
    if (!alive()) return;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (highlights && HighlightClass) highlights.set('marginalia-kept', new HighlightClass(...orderedThreads(journal.state.threads, capture).map(t => sourceRange(t.anchor)).filter((r): r is Range => !!r)));
  }
  function sourceAction(anchor: QuoteAnchor) {
    if (!alive()) return;
    options.onSource?.(anchor); const range = sourceRange(anchor);
    const node = range?.startContainer.parentElement;
    node?.scrollIntoView({ block: 'center', behavior: 'instant' }); highlight(anchor);
    if (source && matchMedia('(max-width: 899px)').matches) closePanel();
  }
  function updateReading() {
    if (held || !source) return;
    const blocks = Array.from(source.querySelectorAll<HTMLElement>('[data-reading-section]'));
    const index = blocks.reduce((chosen, node, i) => node.getBoundingClientRect().top <= innerHeight * .4 ? i : chosen, 0);
    sectionIndex = Math.min(index, sections.length - 1); renderPosition();
  }
  function captureSelection() {
    const selection = document.getSelection();
    if (!source || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!source.contains(range.startContainer) || !source.contains(range.endContainer)) return;
    const before = document.createRange(); before.selectNodeContents(source); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length; showSelection(anchorAt(capture.text, start, start + range.toString().length));
  }
  source?.addEventListener('mouseup', captureSelection, { signal });
  source?.addEventListener('keyup', event => { if (event.key === 'Shift') captureSelection(); }, { signal });
  window.addEventListener('scroll', updateReading, { passive: true, signal });
  compose.addEventListener('focusin', () => hold());
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!selectionCard.hidden) closeSelection(); else if (matchMedia('(max-width: 899px)').matches) closePanel(); } }, { signal });

  async function sync() {
    if (!alive()) return;
    if (!helper?.token) { announce('Pair with the local helper first. Your notes remain on this device.'); return; }
    announce('Saving to the local helper…');
    await safely(async () => {
      await locked(async () => {
        await journal.load();
        await journal.sync(async mutation => {
          const sourceUrl = mutation.kind === 'keep' ? mutation.capture.url : journal.state.threads.find(thread => thread.id === mutation.threadId)?.sourceUrl;
          if (!sourceUrl) throw new Error('This change has no source address. It stays on this device.');
          await options.authorizeHelperSend?.(sourceUrl);
          await helper!.change(mutation);
        }, () => helper!.list());
      });
      changed(); renderThreads(); renderSettings(); announce(journal.state.conflicts.length ? 'Updated elsewhere. Your changes are preserved for review in Settings.' : 'Saved to the local helper. Codex is not connected.');
    });
  }
  function renderSettings() {
    if (!alive()) return;
    const focusedAction = setup.contains(document.activeElement) ? document.activeElement?.textContent : null;
    setup.replaceChildren(el('h2', 'Settings'));
    if (journal.unsaved && needsReconciliation) setup.append(el('p', 'Another tab saved a different version. Recovering keeps that version and saves your changes separately for review.', 'm-error'), button('Recover unsaved changes', () => safely(async () => {
      await locked(() => journal.reconcilePersistence());
      needsReconciliation = false; pendingNoteCommitted = false;
      changed(); renderThreads(); renderCompose(); renderSettings();
      announce('Saved work recovered. Your changes and editor draft are preserved. Review them in Settings.');
    })));
    if (journal.unsaved || pendingNoteCommitted) setup.append(el('p', journal.unsaved ? 'Changes are still in memory. Keep this page open.' : 'Your note is saved. Its draft still needs to be cleared.', 'm-error'), button('Retry saving', () => safely(async () => { await locked(() => journal.retryPersistence()); needsReconciliation = false; if (pendingNoteMutation) { pendingNoteCommitted = true; await persistence.write(draftKey, undefined); pendingNoteMutation = undefined; pendingNoteCommitted = false; draft = undefined; renderCompose(); } changed(); renderThreads(); renderSettings(); announce('Changes saved on this device.'); })));
    if (options.allowHelper === false) setup.append(el('p', 'Open the browser margin to connect the local helper.', 'm-meta'));
    else {
    const code = el('input'); code.autocomplete = 'off'; code.setAttribute('aria-label', 'Pairing code'); code.placeholder = 'Code from the local helper';
    setup.append(el('p', 'Reading and notes work on this device without an account. Pairing also saves them in the local helper.', 'm-meta'), label('Pairing code', code), actions(button('Pair', () => safely(async () => {
      if (!helper) throw new Error('Open this page at the local helper address to pair.');
      if (!code.value.trim()) { code.focus(); return; }
      await helper.pair(code.value.trim()); await persistence.write('pairing', { origin: helper.origin, token: helper.token }); code.value = ''; announce('Paired.'); await sync();
    })), button('Save to local helper', sync), button('Disconnect', () => safely(async () => { if (helper?.token) await helper.request('/api/revoke', {}); if (helper) helper.token = ''; await persistence.write('pairing', undefined); announce('Disconnected from the local helper.'); }))));
    }
    const theme = el('select'); theme.setAttribute('aria-label', 'Theme');
    for (const value of ['system', 'light', 'dark']) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; theme.append(option); }
    theme.value = document.documentElement.dataset.theme ?? 'system';
    theme.addEventListener('change', () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; void persistence.write('theme', theme.value).catch(fail); });
    setup.append(label('Theme', theme), el('p', denied ? 'Asking is blocked for this site.' : 'No permission to send has been given.', 'm-meta'), button(denied ? 'Allow review of future questions' : 'Block asking on this site', () => safely(async () => { denied = !denied; await persistence.write('denied:' + new URL(capture.url).origin, denied); renderSettings(); announce(denied ? 'Asking blocked.' : 'Future questions still require review.'); })), button('Close settings', () => { setup.hidden = true; settingsButton.focus(); }));
    for (const conflict of journal.state.conflicts) {
      const detail = el('details'); detail.append(el('summary', 'Updated elsewhere · review your change'), el('p', conflict.message));
      const change = conflict.change;
      detail.append(el('pre', change.kind === 'note' ? change.text : change.kind === 'keep' ? change.note ?? change.anchor.exact : JSON.stringify(change)));
      const resolve = (useHelper: boolean) => safely(async () => {
        const remote = useHelper ? await helper!.list() : undefined;
        await locked(async () => {
          await journal.load();
          if (useHelper) await journal.resolveConflict(change.id, remote!);
          else await journal.acceptCurrentConflict(change.id);
        });
        if (draft?.mutation?.id === change.id) {
          delete draft.mutation; pendingNoteMutation = undefined; pendingNoteCommitted = false;
          const saved = journal.state.threads.find(thread => thread.id === change.threadId && !thread.deletedAt);
          if (saved && draft.threadId) { const note = saved.notes.find(n => n.id === draft!.noteId && !n.deletedAt); draft.revision = note?.revision ?? 0; if (!note) draft.noteId = id(); }
          else { delete draft.threadId; delete draft.noteId; delete draft.revision; }
          await persistence.write(draftKey, draft); renderCompose();
        }
        changed(); renderThreads(); renderSettings(); announce('Chosen version kept. Your change remains in history and your editor draft is preserved.');
      });
      detail.append(button('Keep device version; keep my change in history', () => resolve(false)));
      if (helper?.token) detail.append(button('Use helper version; keep my change in history', () => resolve(true)));
      setup.append(detail);
    }
    if (focusedAction) Array.from(setup.querySelectorAll('button')).find(b => b.textContent === focusedAction)?.focus();
  }
  function exportWork() {
    const threads = journal.state.threads.filter(t => t.sourceUrl === capture.url);
    const threadIds = new Set(threads.map(t => t.id));
    const state = { threads, pending: journal.state.pending.filter(m => threadIds.has(m.threadId)), conflicts: journal.state.conflicts.filter(c => threadIds.has(c.change.threadId)), resolutions: journal.state.resolutions?.filter(c => threadIds.has(c.change.threadId)), draft };
    const blob = new Blob([JSON.stringify({ version: 1, source: capture, ...state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = el('a'); link.href = url; link.download = 'marginalia-notes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function destroy() {
    if (destroyed) return;
    closeReplies(); highlight(null); destroyed = true; abort.abort(); channel?.close();
    workspace.remove(); skip.remove();
    if (mountedMargins.get(root)?.destroy === destroy) root.classList.remove('m-app', 'm-host-only');
  }
  const lifecycle = { destroy, async drain() { await predecessorDrain; while (pendingOperations.size) await Promise.allSettled([...pendingOperations]); } };
  mountedMargins.set(root, lifecycle);
  const api = { select: showSelection, setReadingPosition: (start: number) => { if (alive() && !held) { sectionIndex = sectionFor(start); renderPosition(); } }, destroy };
  try {
    await predecessorDrain;
    if (!alive()) return api;
    await locked(() => journal.load()); storageReady = true;
    const [savedDraft, pairing, block, theme] = await Promise.all([persistence.read<Draft>(draftKey), options.allowHelper === false ? undefined : persistence.read<{ origin: string; token: string }>('pairing'), persistence.read<boolean>('denied:' + new URL(capture.url).origin), persistence.read<string>('theme')]);
    if (!alive()) return api;
    draft = savedDraft; pendingNoteMutation = draft?.mutation; if (draft) { held = true; sectionIndex = sectionFor(displayPosition(draft.anchor, capture) ?? 0); } denied = !!block;
    if (theme && theme !== 'system') document.documentElement.dataset.theme = theme;
    if (options.allowHelper !== false) {
      helper = new HelperClient(options.helperOrigin ?? location.origin);
      if (pairing?.origin === helper.origin) helper.token = pairing.token;
    }
    announce('Notes are saved on this device. Codex is not connected.');
  } catch (error) { fail(error); }
  if (!alive()) return api;
  renderCompose(); renderThreads(); renderSettings();
  if (options.initialOpen === false || (options.initialOpen !== true && matchMedia('(max-width: 899px)').matches)) shell.classList.add('is-collapsed');
  channel?.addEventListener('message', () => void safely(async () => { await locked(() => journal.load()); renderThreads(); announce(journal.unsaved ? 'Another tab saved work. Your unsaved changes are still here; review Settings.' : 'Saved work updated in another tab. Your draft is unchanged.'); }), { signal });
  return api;
}

function demoPage() {
  const article = el('article', undefined, 'm-source'); article.tabIndex = -1;
  const sourceSections = [
    { title: 'A place beside the page', paragraphs: ['Reading is more than taking in a sentence. Sometimes a phrase is worth keeping. Sometimes you need to leave a question and carry on.', 'A margin gives those small acts a place. The text stays where it is; your thoughts sit beside it. You can return to them without starting over.'] },
    { title: 'Keep what catches you', paragraphs: ['Select a passage in this article to open Keep and Ask. Keeping a passage saves it on this device. Asking first lets you prepare a question and inspect what it would share.', 'Nothing is sent just because you select text. You can read, highlight, and write without an account or a connection to Codex.'] },
    { title: 'Write in your own words', paragraphs: ['A note belongs to a place in the text. When you begin writing, that place holds still. Moving down the page does not move the note’s attachment.', 'An unfinished thought can be parked. A question can stay a question. Your own words come first, and they remain yours when you return.'] },
    { title: 'Return to the thread', paragraphs: ['Work saved in the margin stays in page order. The coloured map gives each section a place, and marks the sections where you have left something.', 'Choose a section to hold it in view. Follow reading brings the margin back to the page. Hovering a saved passage only highlights it; opening its source is a deliberate action.'] },
    { title: 'What is available here', paragraphs: ['This local reading page supports keeping passages, writing and editing notes, parking threads, and removing with undo. Your saved work survives a reload in this browser.', 'Codex replies are not connected yet. You can inspect the outgoing text of a question, but this page will not send it. Pairing with the local helper is a separate, explicit step in Settings.'] },
  ];
  article.append(el('p', 'Marginalia · A reading page', 'm-source-meta'), el('h1', 'Leave room for your thoughts'), el('p', 'A short page to try the margin. Select a sentence, or write beside the section you are reading.', 'm-source-intro'));
  const sections: MarginSection[] = [];
  for (const item of sourceSections) {
    const start = article.textContent!.length; const block = el('section'); block.dataset.readingSection = String(sections.length);
    block.append(el('h2', item.title), ...item.paragraphs.map(text => el('p', text))); article.append(block);
    sections.push({ title: item.title, start, end: article.textContent!.length });
  }
  const capture: SourceCapture = { url: 'https://marginalia.local/reading', title: 'Leave room for your thoughts', pageType: 'Reading page', text: article.textContent!, capturedAt: new Date().toISOString(), extractionVersion: 'text-content-v1', sections: structuredClone(sections) };
  return { article, capture, sections };
}

