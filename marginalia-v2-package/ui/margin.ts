import { followupQuestion } from './asking/surfaces.ts';
import type { QuoteAnchor, ReaderMutation, SourceCapture, Thread } from '../contracts/reader.ts';
import { wholePageAnchor, attachQuote } from '../contracts/reader.ts';
import { el, button } from './dom.ts';
import { localPersistence, documentJournal, documentDraft, documentQuestion, unsavedDrafts, unsavedQuestions, sourceBoundJournal, retryDraftMutation, draftAfterResolution, keepDeviceConflict, resolveHelperConflict, replySaveLifecycle, type MarginDraft, type CachedReply } from './persistence.ts';
import { anchorAt, readingAnchorAt, orderedThreads, outgoingPreview, sourceLocation, pageDefinition, displayPosition, egressRecord } from './margin-model.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import { HelperClient, documentHelper, forgetPairingIfCurrent } from './helper.ts';
import { mountHelperManagement } from './helper-management.ts';
import { mountNoteEditor } from './note-editor.ts';
import { createT08Mount, type AskingMountFactory, type AskingSelection } from './asking-host.ts';
import type { MountedReply } from '../renderer/index.ts';
import { canonicalReplyData, capabilitiesForIntent, validateReply, type SourceBinding } from '../contracts/reply.ts';
import { mountSolverRecompute } from './solver-recompute.ts';

const selectionSuggestions = [
  { intent: 'simulate', label: 'Move it', question: 'Help me explore this passage by moving its inputs.' },
  { intent: 'evidence', label: 'Check this', question: 'Check the evidence for this passage.' },
] as const;

export type MarginSection = { title: string; start: number; end: number };
export type MarginOptions = {
  capture?: SourceCapture;
  sections?: MarginSection[];
  /** Supply a source only when it belongs to this trusted document. Extension hosts use callbacks. */
  sourceRoot?: HTMLElement;
  onSource?: (anchor: QuoteAnchor) => void;
  onHighlight?: (anchor: QuoteAnchor | null) => void;
  /** Read a fresh page snapshot only when the reader asks to look again. */
  captureCurrentPage?: () => Promise<{ capture: SourceCapture; tabCapture: string }>;
  helperOrigin?: string;
  storageName?: string;
  initialOpen?: boolean;
  /** Management is only admitted by the genuine top-level localhost document. */
  helperManagement?: boolean;
  /** Canonical library snapshot, not an inserted journal record. */
  savedThread?: Thread;
  draftScope?: string;
  /** The default composes the separately owned T08 public module when installed. */
  asking?: AskingMountFactory;
  onLibrary?: () => void;
  /** Disable authenticated helper access in page-embedded, clickjackable hosts. */
  allowHelper?: boolean;
  /** Trusted host policy recheck immediately before each local outbox send. */
  authorizeHelperSend?: (sourceUrl: string) => Promise<void>;
  /** Test/host seams; the default uses the authenticated local helper. */
  readPosition?: (sourceUrl: string) => Promise<QuoteAnchor | undefined>;
  writePosition?: (anchor: QuoteAnchor) => Promise<void>;
  positionDebounceMs?: number;
};
type Draft = MarginDraft;
type RetainedRequest = { jobId: string; selection: AskingSelection };

export function sectionIndexAt(sections: MarginSection[], position: number): number {
  const found = sections.findIndex(section => position >= section.start && position < section.end);
  if (found >= 0) return found;
  for (let index = sections.length - 1; index >= 0; index--) if (position >= sections[index].start) return index;
  return 0;
}

export function marginItemSize(section: number, current: number, expanded: boolean, focused: boolean): 'full' | 'line' | 'tick' {
  if (section < 0 || section === current || expanded || focused) return 'full';
  return Math.abs(section - current) === 1 ? 'line' : 'tick';
}
export const composerOffset = (draft: Draft | undefined, readingStart: number) => draft?.position ?? draft?.anchor.start ?? readingStart;
export const threadContentKey = (thread: Thread) => canonicalReplyData(thread);
export function sectionMapState(sections: MarginSection[], threads: Thread[], capture: SourceCapture, current: number) {
  const ordered = orderedThreads(threads, capture);
  return sections.map((section, index) => {
    const here = ordered.filter(thread => { const at = displayPosition(thread.anchor, capture); return at !== undefined && at >= section.start && at < section.end; });
    const marked = here.filter(thread => thread.highlighted);
    return { index, current: index === current, length: Math.max(1, section.end - section.start), threads: here.length,
      notes: here.reduce((sum, thread) => sum + thread.notes.filter(note => !note.deletedAt).length, 0), marks: marked.length,
      markPositions: marked.map(thread => Math.max(0, Math.min(1, ((displayPosition(thread.anchor, capture) ?? section.start) - section.start) / Math.max(1, section.end - section.start)))) };
  });
}
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
  const namespace = options.storageName ?? 'marginalia-reader';
  const persistence = localPersistence(namespace);
  const journal = documentJournal(namespace, persistence.journal);
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
  // Freeze the original capture and use its recorded section boundaries unless
  // the host explicitly supplies a trusted replacement. UI ordering must not
  // be confused with source attachment identity.
  const capture = structuredClone(options.capture);
  const recordedSections = options.sections ?? capture.sections;
  const sections = recordedSections?.length ? structuredClone(recordedSections) : [{ title: 'Whole page', start: 0, end: capture.text.length }];
  const shell = el('aside', undefined, 'mg'); shell.setAttribute('aria-label', 'Marginalia'); shell.id = instance;
  const rail = el('div', undefined, 'm-rail');
  const panel = el('div', undefined, 'm-panel');
  const bar = el('div', undefined, 'm-bar');
  const heading = el('header', undefined, 'm-head');
  heading.append(el('h1', capture.title), el('p', `${capture.pageType} · ${new URL(capture.url).hostname}`, 'm-meta'));
  const compose = el('div', undefined, 'm-compose');
  const map = el('nav', undefined, 'm-map'); map.setAttribute('aria-label', 'Page map: sections, notes and reading position');
  const reading = el('div', undefined, 'm-reading');
  const selectionCard = el('section', undefined, 'm-selection'); selectionCard.hidden = true;
  const questionArea = el('section', undefined, 'm-question'); questionArea.hidden = true;
  const egressSheet = el('section', undefined, 'm-question-slot'); egressSheet.hidden = true;
  egressSheet.setAttribute('role', 'region'); egressSheet.setAttribute('aria-label', 'What was sent');
  let egressGeneration = 0, activityJobId: string | undefined;
  const questionForm = el('div'), askingHost = el('div'); askingHost.hidden = true; questionArea.append(questionForm, askingHost);
  let askingMount: ReturnType<AskingMountFactory> | undefined;
  const threadList = el('div', undefined, 'm-threads');
  const footer = el('footer', undefined, 'm-footer');
  const status = el('p', '', 'm-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const toast = el('div', undefined, 'm-toast'); toast.hidden = true;
  const setup = el('section', undefined, 'm-settings'); setup.hidden = true;
  const settingsBody = el('div'), managementHost = el('div'); setup.append(settingsBody, managementHost);
  const mapSlot = el('div', undefined, 'm-map-slot'); mapSlot.append(map);
  const scroll = el('div', undefined, 'm-scroll'); scroll.append(mapSlot, reading, egressSheet, selectionCard, threadList, footer);
  panel.append(bar, heading, setup, scroll, status, toast); shell.append(rail, panel); workspace.append(shell); root.append(workspace);
  const management = options.helperManagement && options.allowHelper !== false ? mountHelperManagement(managementHost) : undefined;
  let suspended = false, readingPosition = 0, hydrationFinished = false, editorGeneration = 0;
  let alignedReadingPosition = -1;
  let pairingDraft = '', questionDraft: AskingSelection | undefined, retainedRequests: RetainedRequest[] = [];
  const updateManagement = () => { if (!suspended && !setup.hidden && !shell.classList.contains('is-collapsed')) management?.open(); else management?.close(); };
  let sectionIndex = 0, held = false, draft: Draft | undefined, selected: QuoteAnchor | undefined;
  let helper: HelperClient | undefined, storageReady = false, saving = false;
  let positionTimer: ReturnType<typeof setTimeout> | undefined, positionDirty = false, lastPositionWrite = 0, restoredPosition = false;
  let denied = false;
  let pendingNoteMutation: ReaderMutation | undefined;
  let pendingNoteCommitted = false;
  let draftSaveFailed = false;
  let needsReconciliation = false;
  let lastOpener: HTMLElement | null = null;
  let panelOpener: HTMLElement | null = null;
  const narrowViewport = () => matchMedia('(max-width: 899px)').matches;
  const expanded = new Set<string>();
  const attachmentMessages = new Map<string, string>();
  const attachmentPending = new Set<string>();
  const threadNodes = new Map<string, { signature: string; node: HTMLElement }>();
  const replyMounts = new Map<string, { threadId: string; node: HTMLElement; mounted: MountedReply; flush(): Promise<void>; close(): void }>();
  const replyLoads = new Map<string, number>();
  const sessionKey = 'marginalia-draft-tab';
  let tabKey: string;
  try { tabKey = sessionStorage.getItem(sessionKey) ?? id(); sessionStorage.setItem(sessionKey, tabKey); } catch { tabKey = id(); }
  const draftKey = 'draft:' + tabKey + ':' + capture.url + (options.draftScope ? ':' + options.draftScope : '');
  const draftBuffer = documentDraft(namespace, draftKey, capture, { read: () => persistence.read<Draft>(draftKey), write: value => persistence.write(draftKey, value) });
  // Preserve the established source-bound key so existing question drafts
  // remain readable across this reconciliation.
  const questionKey = 'question:' + draftKey;
  const questionBuffer = documentQuestion(namespace, questionKey, capture.url, { read: () => persistence.read<AskingSelection>(questionKey), write: value => persistence.write(questionKey, value) });
  draft = draftBuffer.get(); pendingNoteMutation = draft?.mutation; questionDraft = questionBuffer.get();
  const threadsNow = () => {
    const saved = options.savedThread;
    // A read-only helper preview must not resurrect a device-choice absence or
    // override locally retained work. The journal remains the only reader authority.
    if (!saved || journal.state.threads.some(t => t.id === saved.id)) return journal.state.threads;
    // A deliberately retained device absence must not be undone by a library
    // fallback snapshot while pending/conflict/resolution history names it.
    const known = [...journal.state.pending, ...journal.state.conflicts.map(item => item.change), ...(journal.state.resolutions ?? []).map(item => item.change)].some(change => change.threadId === saved.id);
    if (known) return journal.state.threads;
    return [...journal.state.threads, saved];
  };
  const currentThread = (threadId: string) => threadsNow().find(thread => thread.id === threadId);
  const sectionMarkers = sections.map((section, index) => { const marker = el('h3', section.title, 'm-section-marker'); marker.dataset.sectionMarker = String(index); return marker; });
  function placeItems() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = sectionMarkers.map((node, index) => ({ node: node as HTMLElement, position: sections[index].start, rank: 0 }));
    items.push({ node: compose, position: composerOffset(draft, readingPosition), rank: 1 });
    items.push({ node: selectionCard, position: selected ? displayPosition(selected, capture) ?? readingPosition : readingPosition, rank: 1.2 });
    const questionParent = questionDraft?.threadId ? threadNodes.get(questionDraft.threadId)?.node.querySelector<HTMLElement>('.m-thread-body') : undefined;
    if (questionParent) { if (questionArea.parentElement !== questionParent) questionParent.append(questionArea); }
    else items.push({ node: questionArea, position: questionDraft ? displayPosition(questionDraft.anchor, capture) ?? readingPosition : readingPosition, rank: 1.5 });
    for (const thread of orderedThreads(threadsNow(), capture)) {
      const node = threadNodes.get(thread.id)?.node;
      if (node) items.push({ node, position: displayPosition(thread.anchor, capture) ?? Infinity, rank: 2 });
    }
    items.sort((a, b) => a.position - b.position || a.rank - b.rank);
    items.forEach(({ node }, index) => { if (threadList.children[index] !== node) threadList.insertBefore(node, threadList.children[index] ?? null); });
    if (focused?.isConnected && threadList.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  const displayAnchor = (anchor: QuoteAnchor) => {
    if (anchor.kind === 'whole-page') return 'Whole page';
    const section = sections.find(s => s.start === anchor.start && anchor.exact.startsWith(s.title));
    return section ? section.title + ' · ' + anchor.exact.slice(section.title.length).trimStart() : anchor.exact;
  };
  const announce = (message: string) => { if (alive()) status.textContent = message; };
  const changed = () => { if (alive()) channel?.postMessage('changed'); };
  const fail = (error: unknown) => {
    if (!alive()) return;
    if (draft) draftSaveFailed = true;
    if (error instanceof Error && error.message.startsWith('Local storage changed elsewhere.')) needsReconciliation = true;
    announce(needsReconciliation ? 'Another tab saved work. Use Recover unsaved changes in Settings; your draft is still here.' : journal.unsaved ? 'Not saved yet. Keep this page open and use Retry saving in Settings.' : pendingNoteCommitted ? 'Your note is saved. Use Retry saving in Settings to clear its draft.' : error instanceof Error ? error.message : 'Your work could not be saved. Keep this page open and try again.'); renderSettings();
  };
  async function locked<T>(operation: () => Promise<T>) {
    if (!navigator.locks) throw new Error('Safe local saving needs a browser with Web Locks support.');
    return await navigator.locks.request(namespace, operation);
  }
  async function change(mutation: ReaderMutation) {
    if (!alive()) throw new Error('This margin has closed.');
    if (!storageReady) throw new Error('Local saving is unavailable. Keep your draft open.');
    if (journal.unsaved) throw new Error('Retry saving in Settings before making another change.');
    if (mutation.kind !== 'keep' && !journal.state.threads.some(t => t.id === mutation.threadId)) throw new Error('This is a helper snapshot. Explicitly save/synchronize before editing; it has not replaced local work.');
    try { await locked(async () => { await journal.load(); await journal.change(mutation); }); }
    catch (error) { if (!journal.unsaved) renderThreads(); throw error; }
    changed(); renderThreads();
  }
  function safely(operation: () => Promise<void>) { if (!alive()) return Promise.resolve(); return track((async () => { try { await operation(); } catch (error) { fail(error); } })()); }
  async function flushReadingPosition() {
    if (positionTimer) { clearTimeout(positionTimer); positionTimer = undefined; }
    if (!positionDirty) return;
    const anchor = readingAnchorAt(capture.text, readingPosition);
    const write = options.writePosition ?? (helper?.token ? async (value: QuoteAnchor) => { await helper!.request('/api/position', { capture, anchor: value }); } : undefined);
    if (!anchor || !write) return;
    positionDirty = false;
    try { await write(anchor); lastPositionWrite = Date.now(); } catch { positionDirty = true; }
  }
  function queueReadingPosition() {
    if (positionTimer) clearTimeout(positionTimer);
    const wait = options.positionDebounceMs ?? 3000;
    const delay = Math.max(wait, lastPositionWrite + wait - Date.now());
    positionTimer = setTimeout(() => { positionTimer = undefined; void track(flushReadingPosition()); }, delay);
  }
  function currentAnchor() { const section = sections[sectionIndex]; return anchorAt(capture.text, section.start, section.end); }
  function hold(index = sectionIndex) { if (!alive()) return; held = true; if (sectionIndex !== index) readingPosition = sections[index].start; sectionIndex = index; renderPosition(); }
  function showPanel(focus = false, opener?: HTMLElement) {
    if (!alive()) return;
    if (shell.classList.contains('is-collapsed') && focus && narrowViewport()) panelOpener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    shell.classList.remove('is-collapsed'); openButton.setAttribute('aria-expanded', 'true'); mapSlot.append(map); updateManagement();
    if (focus) (narrowViewport() ? collapse : writeButton).focus();
  }
  function closePanel() {
    if (!alive() || shell.classList.contains('is-collapsed')) return;
    shell.classList.add('is-collapsed'); openButton.setAttribute('aria-expanded', 'false'); rail.append(map); management?.close();
    const target = panelOpener?.isConnected ? panelOpener : openButton; panelOpener = null; target.focus({ preventScroll: true });
  }
  const openButton = button('Open margin', () => showPanel(true, openButton)); openButton.className = 'm-open';
  openButton.setAttribute('aria-controls', shell.id); openButton.setAttribute('aria-expanded', 'true');
  rail.append(openButton);
  const collapse = button('Collapse', closePanel);
  const openSettings = () => { setup.hidden = false; updateManagement(); setup.querySelector<HTMLElement>('input,button')?.focus(); };
  const settingsButton = button('Settings', () => { if (setup.hidden) openSettings(); else setup.hidden = true; });
  const barActions = [collapse];
  if (options.onLibrary) barActions.push(button('Library', options.onLibrary));
  barActions.push(settingsButton);
  bar.append(el('span', 'Marginalia', 'm-wordmark'), actions(...barActions));
  if (options.initialOpen === false || (options.initialOpen !== true && narrowViewport())) {
    shell.classList.add('is-collapsed'); openButton.setAttribute('aria-expanded', 'false'); rail.append(map);
  }
  const writeButton = button('Write here…', () => beginDraft()); writeButton.className = 'm-write'; compose.append(writeButton);
  writeButton.addEventListener('focus', () => { if (hydrationFinished && !draft) beginDraft(); });
  const readingTitle = el('h2'); readingTitle.tabIndex = -1;
  const followingLabel = el('span', 'Reading', 'm-meta');
  const followButton = button('Follow reading', () => { held = false; updateReading(); renderPosition(); readingTitle.focus(); });
  reading.append(readingTitle, followingLabel, followButton);
  const activityButton = button('Work status', () => { void openEgress(); });
  activityButton.className = 'm-activity'; activityButton.hidden = true; map.append(activityButton);
  function updateActivity(value: { phase: string; sending?: boolean; elapsedSeconds?: number }) {
    if (!alive()) return;
    const sending = value.sending ?? value.phase === 'sending';
    const working = ['queued', 'working', 'provisional', 'validating', 'loading-reply', 'cancel_requested'].includes(value.phase);
    const text = sending ? 'Sending' : working ? 'Working' : value.phase === 'committed' ? 'Ready' : value.phase === 'unknown' || value.phase === 'timed_out' ? 'Outcome unconfirmed' : value.phase === 'failed' ? 'Failed' : value.phase === 'cancelled' ? 'Cancelled' : '';
    // Closing the question does not erase the last job's record.
    if (!text && activityJobId) return;
    activityButton.hidden = !text; activityButton.dataset.sending = String(sending);
    activityButton.setAttribute('aria-label', (text || 'Work status') + (value.elapsedSeconds !== undefined && value.elapsedSeconds >= 30 ? `, ${Math.floor(value.elapsedSeconds)} seconds` : '') + '. What was sent.');
    activityButton.title = text; activityButton.textContent = text;
  }
  function closeEgress() { ++egressGeneration; egressSheet.hidden = true; egressSheet.replaceChildren(); activityButton.focus(); }
  async function openEgress() {
    const generation = ++egressGeneration;
    showPanel(); egressSheet.hidden = false;
    const close = button('Close', closeEgress), content = el('div');
    content.setAttribute('role', 'status'); content.textContent = 'Reading the stored record…';
    egressSheet.replaceChildren(el('h2', 'What was sent'), close, content); close.focus();
    try {
      const jobId = activityJobId ?? questionDraft?.resumeJobId;
      if (!jobId) throw new Error('No stored job is linked to this activity. Whether anything was sent is unconfirmed.');
      const client = trustedHelper(), epoch = client.connectionVersion;
      const job = await client.request('/api/jobs/' + encodeURIComponent(jobId), undefined, signal) as JobSnapshot;
      if (!alive() || generation !== egressGeneration || helper !== client || epoch !== client.connectionVersion) return;
      if (job.id !== jobId) throw new Error('The stored record does not match this activity.');
      const record = egressRecord(job);
      content.replaceChildren(el('p', record.summary));
      for (const [label, value] of record.fields) content.append(el('h3', label), el('p', value));
      const packet = el('pre', canonicalReplyData(record.packet));
      packet.style.whiteSpace = 'pre-wrap'; packet.style.overflowWrap = 'anywhere';
      content.append(el('p', record.retention, 'm-meta'), el('h3', 'Retained reading packet'), packet);
    } catch (error) {
      if (alive() && generation === egressGeneration) content.textContent = error instanceof Error ? error.message : 'The stored record is unavailable. The outcome is unconfirmed.';
    }
  }
  const footerCount = el('span', '', 'm-meta');
  footer.append(footerCount, actions(button('Export JSON', exportWork), button('Think with it', () => pageQuestion('unsure', 'Help me reflect on this page and connect it to my own questions.')), button('Go further', () => pageQuestion('explore', 'Suggest useful further reading related to this page.'))), el('span', 'Hear it · not available yet', 'm-meta'));
  const skip = button('Go to margin', () => showPanel(true, skip)); skip.className = 'm-skip'; root.prepend(skip);

  const noteEditor = mountNoteEditor(compose, {
    edit(text) { if (draft && !saving && !draft.mutation) { draft.text = text; persistDraft(); } },
    save: () => { draftSaveFailed = true; void saveDraft(); },
    discard: () => { void safely(async () => { if (saving || draft?.mutation) return; await draftBuffer.save(undefined); draft = undefined; editorGeneration++; renderCompose(); readingTitle.focus({ preventScroll: true }); }); },
    ask: () => { void safely(async () => {
      const committed = await saveDraftNow();
      if (committed && alive()) { const thread = currentThread(committed.threadId); const noteId = committed.kind === 'note' ? committed.noteId : committed.id + '-note';
        const note = thread?.notes.find(item => item.id === noteId && !item.deletedAt);
        if (thread && note) ask(thread.anchor, thread, { noteId: note.id, text: note.text, revision: note.revision }); }
    }); },
    attachments: () => {
      const changeTo = (anchor: QuoteAnchor) => { if (!draft || saving || draft.mutation) return; draft.anchor = structuredClone(anchor); draft.source = structuredClone(capture); draft.position = displayPosition(anchor, capture) ?? readingPosition; persistDraft(); renderCompose(true); };
      return [...sections.map(section => ({ label: section.title, choose: () => changeTo(anchorAt(capture.text, section.start, section.end)) })),
        { label: 'Whole page', choose: () => changeTo(wholePageAnchor()) },
        ...(selected ? [{ label: 'Selected passage', choose: (() => { const frozen = structuredClone(selected); return () => changeTo(frozen); })() }] : [])];
    },
  });
  function renderPosition() {
    if (!alive()) return;
    readingTitle.textContent = sections[sectionIndex].title;
    followButton.hidden = !held; followingLabel.hidden = held;
    const overview = sectionMapState(sections, threadsNow(), capture, sectionIndex);
    for (const node of Array.from(map.querySelectorAll<HTMLElement>('[data-section]'))) {
      const index = Number(node.dataset.section), item = overview[index];
      node.setAttribute('aria-current', String(item.current)); node.dataset.marked = String(item.marks > 0); node.dataset.notes = String(item.notes);
      const text = `${sections[index].title}: ${item.notes} notes, ${item.marks} marks${item.current ? ', current reading position' : ''}`;
      node.title = text; node.setAttribute('aria-label', text);
      const density = node.querySelector<HTMLElement>('.m-density')!; density.textContent = String(item.notes); density.hidden = !item.notes;
      node.style.setProperty('--note-density', String(Math.min(1, item.notes / Math.max(1, item.length / 500))));
      node.querySelector('.m-map-marks')!.replaceChildren(...item.markPositions.map(position => { const tick = el('span', '', 'm-map-mark'); tick.style.setProperty('--mark-position', `${position * 100}%`); return tick; }));
      const cue = node.querySelector<HTMLElement>('.m-map-position')!; cue.hidden = !item.current;
      cue.style.setProperty('--reading-position', `${Math.max(0, Math.min(1, (readingPosition - sections[index].start) / item.length)) * 100}%`);
    }
    for (const thread of orderedThreads(threadsNow(), capture)) {
      const node = threadNodes.get(thread.id)?.node; if (!node) continue;
      const at = displayPosition(thread.anchor, capture);
      const size = marginItemSize(at === undefined ? -1 : sectionFor(at), sectionIndex, expanded.has(thread.id), node.contains(document.activeElement));
      node.dataset.size = size; node.classList.toggle('is-compact', size !== 'full'); node.classList.toggle('is-tick', size === 'tick');
    }
    placeItems();
    // Follow only the margin viewport while idle, never the source document.
    // A draft or focused item retains its position and a library return does not jump.
    if (!suspended && !held && !draft && alignedReadingPosition !== readingPosition && scroll.clientHeight > 0) {
      scroll.scrollTop = Math.max(0, compose.offsetTop - scroll.clientHeight * .25);
      alignedReadingPosition = readingPosition;
    }
  }
  function sectionFor(start: number) { const index = sections.findIndex(s => start >= s.start && start < s.end); return index < 0 ? 0 : index; }
  sections.forEach((section, index) => {
    const segment = button('', () => {
      const openingSheet = narrowViewport() && shell.classList.contains('is-collapsed');
      hold(index); showPanel(openingSheet, segment); sourceAction(anchorAt(capture.text, section.start, section.end), !openingSheet);
    });
    segment.dataset.section = String(index); segment.className = `m-segment m-colour-${index % 6 + 1}`;
    const relativeLength = Math.max(1, section.end - section.start) / Math.max(1, ...sections.map(item => item.end - item.start));
    segment.style.flexGrow = String(Math.max(1, section.end - section.start));
    segment.style.flexBasis = `${Math.max(40, relativeLength * 112)}px`;
    segment.style.setProperty('--section-relative', String(relativeLength));
    const density = el('span', '', 'm-density'), marks = el('span', '', 'm-map-marks'), cue = el('span', '', 'm-map-position');
    for (const child of [density, marks, cue]) child.setAttribute('aria-hidden', 'true');
    segment.append(density, marks, cue); map.append(segment);
  });
  function persistDraft() { if (draft && alive()) { editorGeneration++; void track(draftBuffer.save(draft)).catch(error => { draftSaveFailed = true; fail(error); }); } }
  function beginDraft(explicitAnchor?: QuoteAnchor, thread?: Thread, noteId?: string) {
    if (!alive()) return;
    if (!hydrationFinished) { announce('Restoring saved work. The editor will be available when the read finishes.'); return; }
    if (draft) { noteEditor.focus(); announce('Finish or discard your current note before starting another.'); return; }
    if (thread && !journal.state.threads.some(t => t.id === thread.id)) { announce('This helper snapshot is read-only until you explicitly synchronize it.'); return; }
    const anchor = explicitAnchor ?? selected ?? currentAnchor(), note = thread?.notes.find(item => item.id === noteId);
    const position = explicitAnchor || selected ? displayPosition(anchor, capture) ?? readingPosition : readingPosition;
    draft = { anchor: structuredClone(anchor), source: structuredClone(capture), position, text: note?.text ?? '', ...(thread ? { threadId: thread.id, noteId: note?.id ?? id(), revision: note?.revision ?? 0 } : {}) };
    hold(sectionFor(position)); persistDraft(); renderCompose(true);
  }
  function renderCompose(focus = false) {
    if (!alive()) return;
    writeButton.hidden = !!draft; writeButton.disabled = !hydrationFinished;
    noteEditor.update(draft ? { text: draft.text,
      attachment: draft.anchor.kind === 'whole-page' ? 'Note on the whole page' : `Note on "${excerpt(displayAnchor(draft.anchor), 66)}"`,
      saving, locked: pendingNoteCommitted || !!draft.mutation, canChange: !draft.threadId,
      message: !storageReady ? 'Local storage is unavailable. Export this memory-only draft before closing.' : draft.source && draft.source.text !== capture.text ? 'The original captured passage is retained. Change explicitly adopts the current capture.' : draft.mutation ? 'This exact change is retained. Retry saving or resolve its conflict before editing.' : '' } : undefined);
    placeItems(); if (focus && draft) noteEditor.focus();
  }
  function saveDraft() { return track(saveDraftNow()); }
  async function saveDraftNow(): Promise<Extract<ReaderMutation, { kind: 'keep' | 'note' }> | undefined> {
    if (!alive() || !draft || saving || !draft.text.trim()) return;
    saving = true; renderCompose();
    // A save attempt remains retryable until its mutation and draft cleanup
    // are both durable.
    draftSaveFailed = true;
    try {
      const saved = structuredClone(draft);
      if (!saved.threadId && !saved.mutation && !saved.source) throw new Error('Choose the attachment again. This older draft has no recorded original capture; its text is retained.');
      pendingNoteMutation ??= saved.mutation ?? (saved.threadId ? { id: id(), kind: 'note', threadId: saved.threadId, noteId: saved.noteId!, text: saved.text, expectedRevision: saved.revision! } : { id: id(), kind: 'keep', threadId: id(), capture: saved.source!, anchor: saved.anchor, note: saved.text });
      if (pendingNoteMutation.kind !== 'keep' && pendingNoteMutation.kind !== 'note') throw new Error('The retained note identity is invalid. Export it before recovery.');
      const mutation = pendingNoteMutation;
      draft.mutation = structuredClone(mutation); await draftBuffer.save(draft);
      const result = await locked(() => retryDraftMutation(journal, draft!));
      if (result?.kind === 'resolved') {
        draft = result.draft; pendingNoteMutation = undefined; pendingNoteCommitted = false; await draftBuffer.save(draft);
        announce('Your choice is saved, not uploaded. The note draft is retained and editable; save it as a new deliberate change.'); return;
      }
      pendingNoteCommitted = true;
      const returnToReading = compose.contains(document.activeElement);
      await draftBuffer.save(undefined); draft = undefined; editorGeneration++; pendingNoteMutation = undefined; pendingNoteCommitted = false;
      if (alive()) { changed(); renderThreads(); renderCompose(); if (returnToReading && (compose.contains(document.activeElement) || document.activeElement === document.body)) readingTitle.focus({ preventScroll: true }); announce('Note saved on this device.'); }
      return mutation;
    } catch (error) { draftSaveFailed = true; fail(error); }
    finally { saving = false; if (draft) draftSaveFailed = true; if (alive()) { renderCompose(); renderSettings(); } }
  }

  async function keep(anchor: QuoteAnchor, parked = false) {
    await safely(async () => {
      const existing = orderedThreads(threadsNow(), capture).find(t => t.anchor.start === anchor.start && t.anchor.exact === anchor.exact);
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
    placeItems(); announce('Selection in the margin. Nothing sent.');
  }
  function closeSelection() { if (!alive()) return; selectionCard.hidden = true; selectionCard.replaceChildren(); selected = undefined; if (lastOpener?.isConnected) lastOpener.focus(); }
  selectionCard.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Escape') closeSelection();
    if (selected && event.key.toLowerCase() === 'k') { event.preventDefault(); void keep(selected); }
    if (selected && event.key.toLowerCase() === 'p') { event.preventDefault(); void keep(selected, true); }
    if (selected && event.key === '/') { event.preventDefault(); ask(selected); }
  });
  let questionRequest = 0, questionSaving = false;
  function saveQuestion(value: AskingSelection) {
    questionDraft = structuredClone(value);
    return track(questionBuffer.save(questionDraft));
  }
  function ask(anchor: QuoteAnchor, thread?: Thread, answeredNote?: { noteId: string; text: string; revision: number }, resumeReplyId?: string) {
    if (!alive()) return;
    if (!hydrationFinished) { announce('Restoring saved work. No question was sent.'); return; }
    if (questionSaving) { announce('The question draft is being preserved. Its text remains here.'); return; }
    // Closing hides a draft; it is not permission to overwrite the reader's text.
    if (questionDraft) {
      if (questionArea.hidden) showQuestion(questionDraft);
      else questionArea.querySelector<HTMLElement>('textarea,button')?.focus();
      announce('Your retained question is still attached to its original context. Retain it in history before starting another.'); return;
    }
    const note = answeredNote ?? (() => { const n = thread?.notes.filter(n => !n.deletedAt).at(-1); return n && { noteId: n.id, revision: n.revision, text: n.text }; })();
    const saved: AskingSelection = { capture: structuredClone(capture), anchor: structuredClone(anchor), question: '', context: '',
      ...(thread ? { threadId: thread.id, sourceVersionId: thread.sourceVersionId } : {}), ...(note ? { answeredNote: note } : {}), ...(resumeReplyId ? { resumeReplyId } : {}) };
    void saveQuestion(saved).catch(fail); showQuestion(saved);
  }
  function pageQuestion(intent: 'unsure' | 'explore', question: string) {
    const existing = questionDraft; ask(wholePageAnchor());
    if (!existing && questionDraft) { questionDraft.intent = intent; questionDraft.question = question; void saveQuestion(questionDraft).catch(fail); showQuestion(questionDraft); }
  }
  function showQuestion(value: AskingSelection) {
    questionDraft = structuredClone(value); questionArea.hidden = false; askingHost.hidden = true; questionForm.hidden = false;
    askingMount?.setVisible(false); showPanel(); hold(sectionFor(displayPosition(value.anchor, capture) ?? readingPosition));
    const question = el('textarea'); question.setAttribute('aria-label', 'Your question'); question.maxLength = 20000; question.value = value.question; question.placeholder = 'What would help you here?';
    const context = el('textarea'); context.setAttribute('aria-label', 'Context to attach'); context.maxLength = 20000; context.value = value.context;
    const details = el('details'); details.append(el('summary', 'Attach context'), label('Context to attach', context));
    const message = el('p', 'Draft only. Preparing a review is separate from authorizing a model request.', 'm-meta'); message.setAttribute('role', 'status');
    const persist = () => { if (!questionDraft) return; questionDraft.question = question.value; questionDraft.context = context.value; void saveQuestion(questionDraft).catch(fail); };
    question.addEventListener('input', persist); context.addEventListener('input', persist);
    const suggestions = actions(...([
      { intent: 'define', label: 'Define this', question: 'Define this passage in context.' },
      { intent: 'instantiate', label: 'Show me an example', question: 'Show a worked example of this passage.' },
      { intent: 'derive', label: 'Explain step by step', question: 'Explain this passage step by step.' },
      ...(value.anchor.kind === 'whole-page' ? [] : selectionSuggestions),
    ] as const).map(suggestion => button(suggestion.label, () => { questionDraft!.intent = suggestion.intent; question.value = suggestion.question; persist(); question.focus(); })));
    const contextOnDevice = button('Keep this context on this device', () => { void safely(async () => {
      if (!questionDraft || questionSaving) return; questionSaving = true; contextOnDevice.disabled = true;
      const selection = structuredClone(questionDraft);
      try {
        if (!selection.threadId) {
          selection.keepMutation ??= { id: id(), kind: 'keep', threadId: id(), capture: selection.capture, anchor: selection.anchor };
          await saveQuestion(selection); await change(selection.keepMutation);
          selection.threadId = selection.keepMutation.threadId; selection.sourceVersionId = currentThread(selection.threadId)?.sourceVersionId;
          await saveQuestion(selection);
        }
        message.textContent = 'Context is saved on this device. Explicitly save queued changes to the local helper before preparing a review.';
      } finally { questionSaving = false; contextOnDevice.disabled = false; }
    }); });
    const saveHelper = button('Save all queued device changes to local helper', () => { void safely(async () => {
      await sync();
      if (!questionDraft) return;
      const current = questionDraft.threadId ? currentThread(questionDraft.threadId) : undefined;
      if (current?.sourceVersionId) { questionDraft.sourceVersionId = current.sourceVersionId; await saveQuestion(questionDraft); message.textContent = 'Saved context can now be reviewed. Pairing and local saving do not authorize inference.'; }
    }); });
    const reviewButton = button(value.resumeJobId || value.resumeReplyId ? 'Check saved request or reply' : 'Review with local helper', () => { void openQuestionWithHelper(message, reviewButton); });
    if (options.allowHelper === false) {
      saveHelper.disabled = true; reviewButton.disabled = true;
      message.textContent = 'Open the browser-owned margin or localhost page to review sending. This embedded surface can save local drafts but cannot use pairing credentials.';
    }
    questionForm.replaceChildren(el('blockquote', value.anchor.kind === 'whole-page' ? 'Whole page' : value.anchor.exact),
      ...(value.answeredNote ? [el('p', `Your note, version ${value.answeredNote.revision}: ${value.answeredNote.text}`, 'm-note')] : []),
      suggestions, question, details, message, actions(contextOnDevice, saveHelper, reviewButton, button('Close question', closeQuestion), button('Retain draft in history and start another', () => { void archiveQuestion(); })));
    placeItems(); question.focus({ preventScroll: true });
    return { message, reviewButton };
  }
  function closeQuestion() {
    if (!alive()) return;
    ++questionRequest; questionArea.hidden = true; askingMount?.destroy(); askingMount = undefined;
    if (lastOpener?.isConnected) lastOpener.focus({ preventScroll: true }); else readingTitle.focus({ preventScroll: true });
  }
  function archiveQuestion() {
    return safely(async () => {
      if (!questionDraft || questionSaving) return;
      questionSaving = true;
      try {
        closeQuestion(); // Snapshot the peer before preserving and clearing this draft.
        const retained = structuredClone(questionDraft);
        await persistence.write('question-history:' + draftKey + ':' + id(), retained);
        await questionBuffer.save(undefined); questionDraft = undefined;
        announce('Question draft retained in history and export. Choose a passage or note for another question.');
      } finally { questionSaving = false; }
    });
  }
  footer.append(button('Earlier question drafts', () => safely(async () => {
    const retained = await persistence.values<AskingSelection>('question-history:' + draftKey + ':');
    if (!alive()) return;
    const history = el('details'); history.open = true; history.append(el('summary', 'Earlier question drafts'));
    for (const saved of retained) {
      if (!saved || saved.capture?.url !== capture.url) continue;
      history.append(button(excerpt(saved.question || saved.anchor.exact || 'Whole-page question'), () => {
        if (questionDraft) { announce('Retain the current question in history before reopening another.'); return; }
        void saveQuestion(saved).catch(fail); showQuestion(saved);
      }));
    }
    if (!retained.length) history.append(el('p', 'No earlier question drafts saved on this device.', 'm-meta'));
    footer.querySelector('.m-question-history')?.remove(); history.className = 'm-question-history'; footer.append(history);
  })));
  function renderRetainedRequests() {
    footer.querySelector('.m-saved-requests')?.remove();
    const saved = retainedRequests.filter(item => item?.jobId && item.selection?.resumeJobId === item.jobId && item.selection.capture?.url === capture.url);
    if (!saved.length) return;
    const section = el('section', undefined, 'm-saved-requests');
    section.append(el('p', 'Saved requests with an unconfirmed or unfinished outcome', 'm-meta'));
    for (const item of saved) {
      const open = button('Check saved request', () => { void safely(async () => {
        const selection = structuredClone(item.selection);
        if (questionDraft && canonicalReplyData(questionDraft) !== canonicalReplyData(selection)) throw new Error('Retain the current question in history before checking another saved request.');
        await saveQuestion(selection);
        const controls = showQuestion(selection);
        await openQuestionWithHelper(controls.message, controls.reviewButton);
      }); });
      section.append(el('p', excerpt(item.selection.question || item.selection.anchor.exact || 'Saved request'), 'm-meta'), actions(open));
    }
    footer.append(section);
  }
  async function openQuestionWithHelper(message: HTMLElement, button: HTMLButtonElement) {
    if (!questionDraft || questionSaving || !alive()) return;
    const request = ++questionRequest; questionSaving = true; button.disabled = true;
    try {
      if (denied) throw new Error('Question previews are blocked on this device for this site. Change that preference in Settings.');
      const selected = structuredClone(questionDraft), thread = selected.threadId && currentThread(selected.threadId);
      if (!thread || !thread.sourceVersionId || thread.deletedAt) throw new Error('Keep this context, then explicitly save queued changes to the helper. No inference has been prepared.');
      selected.sourceVersionId = thread.sourceVersionId;
      await saveQuestion(selected);
      if (!alive() || request !== questionRequest) return;
      askingMount ??= (options.asking ?? createT08Mount())(askingHost, {
        helper: trustedHelper, signal,
        surface: options.allowHelper === false ? 'floating' : trustedHelper().origin === location.origin ? 'localhost' : 'native-panel',
        access: () => ({ excluded: denied, supported: ['http:', 'https:'].includes(new URL(capture.url).protocol) }),
        authorize: async url => {
          if (!alive() || options.allowHelper === false || denied) throw new Error('This surface cannot authorize sending.');
          await options.authorizeHelperSend?.(url);
          if (!alive() || denied) throw new Error('The source interaction changed. Nothing is automatically sent.');
        },
        currentThread,
        ensureContextSaved: async selection => {
          await locked(() => journal.load());
          const current = selection.threadId && currentThread(selection.threadId);
          if (!current || current.deletedAt || !current.sourceVersionId || current.sourceVersionId !== selection.sourceVersionId || canonicalReplyData(current.anchor) !== canonicalReplyData(selection.anchor)) throw new Error('The saved source identity changed. Reopen the question without changing its retained draft.');
          if (journal.unsaved || journal.state.pending.some(m => m.threadId === current.id) || journal.state.conflicts.some(c => c.change.threadId === current.id)) throw new Error('This context has unsaved or unsynchronized changes. Save or resolve them explicitly before reviewing a question.');
        },
        persistence, track,
        read: <T>(key: string) => persistence.read<T>('asking:' + draftKey + ':' + key),
        write: async (key, value) => {
          await persistence.write('asking:' + draftKey + ':' + key, value);
          const record = value as { jobId?: string } | undefined;
          if ((key === 'request' || key === 'completion') && typeof record?.jobId === 'string') activityJobId = record.jobId;
        },
        retainedQuestion: value => { if (value.resumeJobId) activityJobId = value.resumeJobId; void saveQuestion(value).catch(fail); },
        onClosed: () => { if (alive()) {
          askingHost.hidden = true; questionForm.hidden = false;
          const fields = questionForm.querySelectorAll<HTMLTextAreaElement>('textarea');
          if (fields[0] && questionDraft) fields[0].value = questionDraft.question;
          if (fields[1] && questionDraft) fields[1].value = questionDraft.context;
        } },
        highlight: (binding, original) => highlight(binding ? bindingAnchor(binding, original) ?? null : null),
        navigate: (binding, original) => { const anchor = bindingAnchor(binding, original); if (anchor) sourceAction(anchor); else announce('This original source passage is uncertain on the current page; no navigation was attempted.'); },
        prepareReplyView: async (threadId, replyId) => {
          for (const [key, entry] of replyMounts) if (entry.threadId === threadId && entry.node.dataset.replyVersion === replyId) { await entry.flush(); entry.close(); entry.node.remove(); replyMounts.delete(key); }
        },
        activity: updateActivity,
        onState: updateActivity,
      onCommitted: threadId => { if (alive()) { changed(); announce('A validated reply is available. Your notes remain above it.'); } },
      openSettings,
      });
      questionForm.hidden = true; askingMount.setVisible(!suspended && !questionArea.hidden);
      const opening = askingMount;
      activityJobId = selected.resumeJobId;
      await opening.open(selected);
      if (!alive() || request !== questionRequest) opening.setVisible(false);
    } catch (error) {
      if (alive() && request === questionRequest) { askingMount?.setVisible(false); questionForm.hidden = false; message.textContent = error instanceof Error ? error.message : 'The review could not be opened. The draft is retained; request outcome is unconfirmed.'; }
    } finally { questionSaving = false; button.disabled = false; }
  }

  function renderThreads() {
    if (!alive()) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active?.dataset.focusKey;
    const focusedThreadId = active?.closest<HTMLElement>('[data-thread]')?.dataset.thread;
    if (focusKey && focusedThreadId) expanded.add(focusedThreadId);
    const threads = orderedThreads(threadsNow(), capture);
    for (const [key, entry] of threadNodes) if (!threads.some(t => t.id === key)) { closeReplies(key); replyLoads.set(key, (replyLoads.get(key) ?? 0) + 1); entry.node.remove(); threadNodes.delete(key); }
    const empty = threadList.querySelector('.m-empty'); empty?.remove();
    if (!threads.length) threadList.append(el('p', 'Keep a passage or write a note. Your work stays here, even without the local helper.', 'm-empty'));
    threads.forEach(thread => {
      let entry = threadNodes.get(thread.id);
      if (entry?.signature !== threadContentKey(thread)) {
        const node = renderThread(thread);
        if (entry) {
          // The reply subtree stays connected while reader notes and thread controls change.
          entry.node.querySelector('.m-thread-content')!.replaceWith(node.querySelector('.m-thread-content')!);
          entry.node.querySelector('.m-excerpt')!.replaceWith(node.querySelector('.m-excerpt')!);
          entry.signature = threadContentKey(thread);
        } else {
          entry = { node, signature: threadContentKey(thread) }; threadNodes.set(thread.id, entry);
          void loadReplies(thread.id);
        }
      }
      // placeItems maintains source order without rebuilding reply/editor subtrees.
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
    const currentSection = () => { const current = currentThread(thread.id); return current ? sectionFor(displayPosition(current.anchor, capture) ?? readingPosition) : sectionIndex; };
    const preview = button(excerpt(thread.notes.find(n => !n.deletedAt)?.text ?? thread.anchor.exact), () => { expanded.add(thread.id); hold(currentSection()); renderPosition(); requestAnimationFrame(() => { if (alive()) threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); }); }); preview.setAttribute('aria-label', 'Open thread: ' + (thread.notes.find(note => !note.deletedAt)?.text ?? thread.anchor.exact)); preview.className = 'm-excerpt'; preview.dataset.focusKey = thread.id + ':excerpt';
    const body = el('div', undefined, 'm-thread-content');
    const sourceText = thread.anchor.kind === 'whole-page' ? 'Whole page' : `“${excerpt(displayAnchor(thread.anchor))}”`;
    const sourceButton = button(sourceText, () => sourceAction(thread.anchor)); sourceButton.className = 'm-source-action'; sourceButton.setAttribute('aria-label', 'Source passage: ' + sourceText); sourceButton.dataset.focusKey = thread.id + ':source';
    sourceButton.addEventListener('mouseenter', () => highlight(thread.anchor)); sourceButton.addEventListener('mouseleave', () => highlight(null));
    sourceButton.addEventListener('focus', () => highlight(thread.anchor)); sourceButton.addEventListener('blur', () => highlight(null));
    body.append(sourceButton);
    if (location.state === 'lost' || location.state === 'unsure') {
      const marker = el('div', undefined, 'm-reader-note');
      marker.append(el('p', 'You were here', 'm-meta'));
      const message = el('p', attachmentMessages.get(thread.id) ?? 'We can’t find this passage on the current page. Your note is still here.', 'm-meta m-attachment-status');
      message.setAttribute('role', 'status');
      const look = button('Look again', () => {
        if (attachmentPending.has(thread.id)) return;
        attachmentPending.add(thread.id); look.disabled = true;
        const show = (text: string) => {
          attachmentMessages.set(thread.id, text);
          const current = threadNodes.get(thread.id)?.node.querySelector('.m-attachment-status');
          if (alive() && current) current.textContent = text;
        };
        show('Looking for this passage…');
        void track((async () => {
          try {
            if (!options.captureCurrentPage) throw new Error('Reopen this page in the browser margin to look again.');
            const client = await replyClient(thread.id), epoch = client.connectionVersion;
            const page = await options.captureCurrentPage();
            if (page.capture.url !== capture.url || !page.tabCapture) throw new Error('The page changed. Reopen its margin to look again.');
            if (await replyClient(thread.id) !== client || client.connectionVersion !== epoch) throw new Error('The helper connection changed.');
            const result = await client.request('/api/reattach', { threadId: thread.id, text: page.capture.text, tabCapture: page.tabCapture, capture: page.capture }, signal);
            if (result.state === 'exact' || result.state === 'moved') show('Found again. Your note is still here.');
            else if (result.state === 'lost' || result.state === 'unsure') show('Still not here. Your note is still here.');
            else throw new Error('The result could not be confirmed. Try looking again.');
          } catch (error) { show(error instanceof Error ? error.message : 'Could not look again. Your note is still here.'); }
          finally {
            attachmentPending.delete(thread.id);
            const current = threadNodes.get(thread.id)?.node.querySelector<HTMLButtonElement>('.m-reattach-action');
            if (alive() && current) current.disabled = false;
          }
        })());
      });
      look.className = 'm-reattach-action'; look.disabled = attachmentPending.has(thread.id);
      marker.append(message, look); body.append(marker);
    }
    for (const note of thread.notes.filter(note => !note.deletedAt)) {
      const edit = button('Edit note', () => beginDraft(thread.anchor, thread, note.id)); edit.dataset.focusKey = thread.id + ':note:' + note.id;
      const remove = button('Remove this note', () => safely(async () => {
        await change({ id: id(), kind: 'note-remove', threadId: thread.id, noteId: note.id, removed: true, expectedRevision: note.revision });
        toast.hidden = false; const undo = button('Undo', () => safely(async () => {
          const current = currentThread(thread.id)!, removed = current.notes.find(item => item.id === note.id)!;
          await change({ id: id(), kind: 'note-remove', threadId: thread.id, noteId: note.id, removed: false, expectedRevision: removed.revision });
          toast.hidden = true; threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); announce('Note restored.');
        }));
        toast.replaceChildren(el('span', 'Note removed.'), undo); undo.focus();
      }));
      const noteBlock = el('div', undefined, 'm-reader-note'); noteBlock.append(el('p', note.text, 'm-note'), edit, button('Ask about this note', () => ask(thread.anchor, currentThread(thread.id), { noteId: note.id, revision: note.revision, text: note.text })), remove); body.append(noteBlock);
    }
    const state = el('select'); state.setAttribute('aria-label', 'Thread state');
    for (const value of ['open', 'parked', 'done', 'archived'] as const) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; state.append(option); } state.value = thread.state;
    state.addEventListener('change', () => void safely(async () => { await change({ id: id(), kind: 'thread-state', threadId: thread.id, expectedRevision: thread.revision, state: state.value as Thread['state'] }); announce('Thread ' + state.value + '.'); threadNodes.get(thread.id)?.node.querySelector('select')?.focus(); }));
    body.append(actions(button('Add note', () => beginDraft(thread.anchor, thread)), button('Ask', () => ask(thread.anchor, thread)), state, button('Remove', () => safely(async () => {
      await change({ id: id(), kind: 'remove', threadId: thread.id, removed: true, expectedRevision: thread.revision });
      toast.hidden = false; const undo = button('Undo', () => safely(async () => { const current = journal.state.threads.find(t => t.id === thread.id)!; await change({ id: id(), kind: 'remove', threadId: thread.id, removed: false, expectedRevision: current.revision }); toast.hidden = true; threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); announce('Thread restored.'); }));
      toast.replaceChildren(el('span', 'Thread removed.'), undo); undo.focus();
    }))));
    if (!journal.state.threads.some(item => item.id === thread.id)) {
      for (const control of Array.from(body.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button:not(.m-source-action):not(.m-reattach-action),select'))) control.disabled = true;
      body.append(el('p', 'Saved helper snapshot. Local work is not replaced; explicitly synchronize before editing or asking.', 'm-meta'));
    }
    const replyArea = el('section', undefined, 'm-saved-replies'); replyArea.setAttribute('aria-label', 'Saved replies');
    const replyStatus = el('p', '', 'm-reply-status m-meta'); replyStatus.setAttribute('role', 'status');
    const replyList = el('div', undefined, 'm-reply-list');
    const replyActions = actions(button('Reload saved views', () => loadReplies(thread.id, false, true)), button('Export saved replies and views', () => exportReplies(thread.id)));
    if (options.allowHelper !== false) replyActions.append(button('Load replies from helper', () => loadReplies(thread.id, true)));
    replyArea.append(replyStatus, replyList, replyActions);
    const bodyGroup = el('div', undefined, 'm-thread-body'); bodyGroup.append(body, replyArea); node.append(preview, bodyGroup);
    for (const control of Array.from(node.querySelectorAll<HTMLElement>('button,select'))) control.dataset.focusKey ??= thread.id + ':' + (control.getAttribute('aria-label') ?? control.textContent);
    node.addEventListener('focusin', () => hold(currentSection()));
    return node;
  }

  function closeReplies(threadId?: string) {
    for (const [key, entry] of replyMounts) if (!threadId || entry.threadId === threadId) { entry.close(); entry.node.remove(); replyMounts.delete(key); }
  }
  async function replyClient(threadId: string) {
    if (!alive() || options.allowHelper === false || !helper?.token) throw new Error('Open the browser margin and pair with the helper to use this action.');
    const thread = currentThread(threadId);
    if (!thread || thread.deletedAt) throw new Error('This thread is unavailable.');
    const client = helper, epoch = client.connectionVersion;
    await options.authorizeHelperSend?.(thread.sourceUrl);
    if (!alive() || helper !== client || client.connectionVersion !== epoch || !client.token) throw new Error('The helper connection changed.');
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
  function loadReplies(threadId: string, remote = false, reopen = false) { return track(readReplies(threadId, remote, reopen)); }
  async function readReplies(threadId: string, remote = false, reopen = false) {
    if (!alive()) return;
    const thread = currentThread(threadId); if (!thread || thread.deletedAt) return;
    const generation = (replyLoads.get(thread.id) ?? 0) + 1; replyLoads.set(thread.id, generation);
    const current = () => alive() && replyLoads.get(thread.id) === generation && !!threadNodes.get(thread.id);
    const area = () => threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-saved-replies');
    const message = (text: string) => { if (current()) { const node = area()?.querySelector('.m-reply-status'); if (node) node.textContent = text; } };
    try {
      if (remote) {
        message('Loading saved replies from the local helper…');
        const client = await replyClient(thread.id);
        await persistence.replies.refresh(client.origin, thread.id, async () => {
          if (!current()) return;
          const currentClient = await replyClient(thread.id);
          if (currentClient !== client) throw new Error('The helper connection changed.');
          const bundle = await client.replies(thread.id);
          if (!current()) return;
          if (bundle.source.id !== currentThread(thread.id)?.sourceVersionId) throw new Error('The helper returned a different source version.');
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
        let reportRequest = 0, viewSaves: ReturnType<typeof replySaveLifecycle> | undefined;
        const persistView = (state: ReturnType<MountedReply['getState']>) => {
          if (closed || !viewSaves) return Promise.resolve();
          return track(viewSaves.save(state)).catch(error => { if (!closed && alive()) viewStatus.textContent = error instanceof Error ? error.message : 'View inputs remain unsaved. Export before closing.'; throw error; });
        };
        const { mountReply } = await import('../renderer/index.ts'); if (!current()) return;
        const solverRecompute = options.allowHelper !== false && helper?.token && helper.origin === saved.origin ? mountSolverRecompute(wrapper, helper, saved.version.id) : undefined;
        const mounted: MountedReply = mountReply(canvas, saved.version.reply, {
          sourceText: saved.source.text, initialState: saved.local,
          capabilities: [...capabilitiesForIntent(saved.version.reply.intent ?? 'define'), ...(solverRecompute ? ['solver' as const] : [])],
          hostReport: saved.reports?.[canonicalReplyData(saved.local.parameters)] ?? saved.report ?? saved.version.validation,
          sampleGenerationRecords: saved.sampleGenerationRecords,
          onStateChange: persistView,
          onFollowup: async context => {
            if (closed || !current()) return;
            const question = followupQuestion(context);
            const existing = questionDraft;
            ask(thread.anchor, currentThread(thread.id) ?? thread, undefined, saved.version.id);
            if (existing || !questionDraft) return;
            await saveQuestion({ ...questionDraft, intent: saved.version.reply.intent, question,
              capture: { ...questionDraft.capture, text: saved.source.text },
              answeredNote: saved.version.answeredNote ?? undefined });
            if (current()) showQuestion(questionDraft!);
          },
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
            onRecompute: solverRecompute?.onRecompute,
            resolveHostReport: async (parameters: Readonly<Record<string, number>>) => {
              if (closed) return undefined;
              const request = ++reportRequest;
              const parameterKey = canonicalReplyData(parameters);
              const isCurrent = () => !closed && alive() && request === reportRequest && canonicalReplyData(mounted.getState().parameters) === parameterKey;
              const client = await replyClient(thread.id);
              if (client.origin !== saved.origin) return undefined;
              const report = await client.checkReply(thread.id, saved.version.id, parameters);
              if (!isCurrent()) return undefined;
              await persistence.replies.report(saved, parameters, report, isCurrent);
              return isCurrent() ? report : undefined;
            },
          } : {}),
        });
        // Renderer normalization is an untouched baseline, never an implicit save.
        viewSaves = replySaveLifecycle(mounted.getState(), state => session.save(state));
        const flush = () => track(viewSaves!.flush(mounted.getState()));
        const entry = { threadId: thread.id, node: wrapper, mounted, flush, close() {
          if (closed) return;
          const final = viewSaves!.close(mounted.getState()); closed = true;
          solverRecompute?.forget();
          mounted.destroy(); void track(final).catch(fail);
        } };
        replyMounts.set(key, entry);
        const controls = actions();
        if (options.allowHelper !== false) {
          controls.append(button('Save view to helper', () => safely(async () => {
            if (closed) return;
            await persistView(mounted.getState());
            if (closed || !alive()) return;
            const client = await replyClient(thread.id);
            if (client.origin !== saved.origin) throw new Error('Pair with the helper that owns this reply.');
            await persistence.replies.sync(saved, async change => {
              if (closed) throw new Error('This reply view has closed. Its inputs remain on this device.');
              const currentClient = await replyClient(thread.id);
              if (currentClient !== client) throw new Error('The helper connection changed.');
              return client.saveReplyView(thread.id, change);
            });
            const latest = (await persistence.replies.list(thread.id)).find(record => record.origin === saved.origin && record.version.id === saved.version.id);
            if (!closed && alive()) viewStatus.textContent = latest?.dirty ? 'An earlier saved view reached the helper. Newer inputs remain saved on this device; save again to send them.' : 'The saved view was sent to the local helper.';
          })), button('Use helper view', () => safely(async () => {
            if (closed) return;
            const client = await replyClient(thread.id);
            if (client.origin !== saved.origin) throw new Error('Pair with the helper that owns this reply.');
            if (closed || !alive()) return;
            await persistence.replies.useRemote(saved, mounted.getState(), async () => {
                const currentClient = await replyClient(thread.id);
                if (currentClient !== client) throw new Error('The helper connection changed.');
                return client.replyView(thread.id, saved.version.id);
            });
            if (closed || !alive()) return;
            entry.close(); replyMounts.delete(key); wrapper.remove();
            await loadReplies(thread.id);
            announce('Helper view restored. Previous local inputs remain in the recovery export.');
          })));
        }
        if (options.allowHelper !== false) controls.append(button('Open saved reply and follow-up', () => { const current = currentThread(thread.id); if (!current) return; const note = saved.version.answeredNote; ask(current.anchor, current, note ? { noteId: note.noteId, revision: note.revision, text: note.text } : undefined, saved.version.id); }));
        wrapper.append(viewStatus, controls, el('p', 'Saved-solver execution is not connected here. Follow-ups require a separate host-prepared review.', 'm-meta'));
        area()?.querySelector('.m-reply-list')?.append(wrapper);
      }
      message(persistence.replies.unsaved(thread.id).length ? 'Some view inputs are still only in memory after a failed save. Export them before closing this page.' : unavailable ? `${unavailable} saved ${unavailable === 1 ? 'reply could' : 'replies could'} not be safely displayed. Original records remain available in the export.` : visible.some(record => record.conflict) ? 'The helper has a different view. Local controls are preserved; use the helper view explicitly to replace them.' : visible.some(record => record.recovered?.length) ? 'Saved replies are available. Earlier view inputs are preserved in the recovery export.' : visible.length ? `${visible.length} saved ${visible.length === 1 ? 'reply' : 'replies'}. Notes stay above replies.` : 'No saved replies on this device.');
    } catch (error) { message(error instanceof Error ? error.message : 'Saved replies could not be loaded.'); }
  }
  function exportReplies(threadId: string) {
    return safely(async () => {
      const thread = currentThread(threadId); if (!thread) return;
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
    if (suspended) return;
    options.onHighlight?.(anchor);
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!highlights || !HighlightClass) return;
    const range = anchor && sourceRange(anchor); highlights.set('marginalia-focus', new HighlightClass(...(range ? [range] : [])));
  }
  function paintHighlights() {
    if (!alive() || suspended) return;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (highlights && HighlightClass) highlights.set('marginalia-kept', new HighlightClass(...orderedThreads(threadsNow(), capture).map(t => sourceRange(t.anchor)).filter((r): r is Range => !!r)));
  }
  function sourceAction(anchor: QuoteAnchor, closeNarrow = true) {
    if (!alive()) return;
    const attachment = sourceLocation({ anchor } as Thread, capture);
    if (anchor.kind !== 'whole-page' && !['exact', 'moved'].includes(attachment.state)) { announce('Attachment is uncertain. The original quote is retained; no source navigation was attempted.'); return; }
    options.onSource?.(anchor); const range = sourceRange(anchor);
    const node = range?.startContainer.parentElement;
    node?.scrollIntoView({ block: 'center', behavior: 'instant' }); highlight(anchor);
    if (source && closeNarrow && narrowViewport()) closePanel();
  }
  function updateReading() {
    if (held || suspended || !source) return;
    const blocks = Array.from(source.querySelectorAll<HTMLElement>('[data-reading-section]'));
    const index = blocks.reduce((chosen, node, i) => node.getBoundingClientRect().top <= innerHeight * .4 ? i : chosen, 0);
    sectionIndex = Math.min(index, sections.length - 1); readingPosition = sections[sectionIndex].start; renderPosition();
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
  root.addEventListener('keydown', event => { if (event.defaultPrevented) return; if (event.key === 'Escape') { if (!egressSheet.hidden) { closeEgress(); event.preventDefault(); return; } if (!questionArea.hidden) { closeQuestion(); return; } if (!selectionCard.hidden) closeSelection(); else if (matchMedia('(max-width: 899px)').matches) closePanel(); } }, { signal });

  async function sync() {
    if (!alive()) return;
    const client = trustedHelper(), epoch = client.connectionVersion;
    const assertCurrent = () => { if (!alive() || client !== helper || epoch !== client.connectionVersion || !client.token) throw new Error('The helper connection changed. Earlier request outcomes are unconfirmed; queued identities remain retained.'); };
    announce('Saving queued changes to the local helper...');
    await locked(async () => {
      assertCurrent(); await journal.load();
      await journal.sync(async mutation => {
        const sourceUrl = mutation.kind === 'keep' ? mutation.capture.url : journal.state.threads.find(thread => thread.id === mutation.threadId)?.sourceUrl;
        if (!sourceUrl) throw new Error('This change has no recorded source address. It remains on this device.');
        await options.authorizeHelperSend?.(sourceUrl); assertCurrent(); await client.change(mutation);
      }, async () => { assertCurrent(); return client.list(); });
    });
    changed(); renderThreads(); renderSettings();
    announce(journal.state.conflicts.length ? 'Changes need review. Local choices and note drafts are retained.' : 'Queued work saved to the local helper. Inference has not been authorized by saving.');
  }
  function renderSettings() {
    if (!alive()) return;
    const focused = settingsBody.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const pairingFocused = focused?.getAttribute('aria-label') === 'Pairing code';
    const caret = pairingFocused && focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : undefined;
    settingsBody.replaceChildren(el('h2', 'Settings'));
    if (journal.unsaved && needsReconciliation) settingsBody.append(el('p', 'Another tab saved a different version. Recovering preserves it and retains your changes for review.', 'm-error'), button('Recover unsaved changes', () => safely(async () => {
      await locked(() => journal.reconcilePersistence()); needsReconciliation = false; pendingNoteCommitted = false;
      changed(); renderThreads(); renderCompose(); renderSettings(); announce('Recovered changes need deliberate review. Your note and question drafts are retained.');
    })));
    if (hydrationFinished && (journal.unsaved || draftBuffer.unsaved() || questionBuffer.unsaved() || pendingNoteMutation || pendingNoteCommitted || draftSaveFailed || !!draft)) settingsBody.append(el('p', 'Some work needs saving or conflict review. Memory-only recovery lasts only while this document stays open; export before closing.', 'm-error'), button('Retry saving', () => safely(async () => {
      if (draft || pendingNoteMutation) await saveDraftNow();
      else { await locked(() => journal.retryPersistence()); await draftBuffer.flush(); }
      if (questionBuffer.unsaved()) await questionBuffer.save(questionBuffer.get());
      draftSaveFailed = false;
      changed(); renderThreads(); renderCompose(); renderSettings();
    })));
    if (options.allowHelper === false) settingsBody.append(el('p', 'Open the browser-owned margin or localhost page to connect the local helper.', 'm-meta'));
    else {
      const code = el('input'); code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 16; code.setAttribute('aria-label', 'Pairing code'); code.placeholder = 'Six-digit helper code'; code.value = pairingDraft;
      code.addEventListener('input', () => { pairingDraft = code.value; });
      settingsBody.append(el('p', 'Reading and notes work without an account. Pairing does not establish model login, readiness or permission to send.', 'm-meta'), label('Pairing code', code), actions(
        button('Pair', () => safely(async () => {
          const client = helper; if (!client) throw new Error('The trusted helper connection is unavailable.');
          const previousToken = client.token;
          await client.pair(code.value, signal); const epoch = client.connectionVersion;
          try { await locked(async () => { if (!alive() || client !== helper || client.connectionVersion !== epoch || !client.token) throw new Error('Pairing changed before local saving.'); await persistence.write('pairing', { origin: client.origin, token: client.token }); }); }
          catch {
            // A failed atomic local write must not leave an unsaved new token
            // masking the stored old one when the reader next disconnects.
            if (client.connectionVersion === epoch) client.token = previousToken;
            throw new Error('The new pairing was not saved on this device. The earlier local pairing is retained. The helper may still list the new pairing; inspect its paired browsers before retrying.');
          }
          if (!alive() || client !== helper || client.connectionVersion !== epoch) return;
          pairingDraft = ''; code.value = ''; channel?.postMessage('pairing-changed'); renderSettings(); announce('Paired with the local helper. No queued work or model request was sent.');
        })),
        button('Save all queued device changes to local helper', () => safely(sync)),
        button('Disconnect', () => safely(async () => {
          const client = helper; if (!client) throw new Error('The local connection is unavailable.');
          const token = client.token; let removed = false;
          const result = await client.disconnect(async () => { await locked(async () => { removed = await forgetPairingIfCurrent(persistence, client.origin, token); }); if (removed) channel?.postMessage('pairing-changed'); });
          announce(result === 'replaced' || !removed ? 'A newer pairing is retained. The earlier revocation may be unconfirmed.' : result === 'unconfirmed' ? 'Local pairing removed. Remote revocation is unconfirmed; the helper may still list this browser.' : 'Local pairing removed. ' + (result === 'revoked' ? 'The helper confirmed revocation.' : 'There was no active token to revoke.'));
        }))));
    }
    const theme = el('select'); theme.setAttribute('aria-label', 'Theme');
    for (const value of ['system', 'light', 'dark']) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; theme.append(option); }
    theme.value = document.documentElement.dataset.theme ?? 'system';
    theme.addEventListener('change', () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; void track(persistence.write('theme', theme.value)).catch(fail); });
    settingsBody.append(label('Theme', theme), el('p', 'Model choices, actual grants, exclusions and vocabulary are managed in the local library and settings.', 'm-meta'),
      button(denied ? 'Allow question previews here' : 'Block question previews here', () => safely(async () => { const next = !denied; await persistence.write('denied:' + new URL(capture.url).origin, next); denied = next; renderSettings(); announce('Local preview preference saved. Helper permission records are unchanged.'); })),
      button('Close settings', () => { setup.hidden = true; updateManagement(); settingsButton.focus({ preventScroll: true }); }));
    for (const conflict of sourceBoundJournal(journal.state, capture.url).conflicts) {
      const item = el('details'), mutation = conflict.change;
      item.append(el('summary', 'Review a retained change'), el('p', conflict.message), el('pre', mutation.kind === 'note' ? mutation.text : mutation.kind === 'keep' ? mutation.note ?? mutation.anchor.exact : JSON.stringify(mutation)));
      const resolve = (useHelper: boolean) => safely(async () => {
        if (useHelper) await resolveHelperConflict(journal, locked, mutation.id, async latest => {
          const client = trustedHelper(), epoch = client.connectionVersion;
          const sourceUrl = latest.kind === 'keep' ? latest.capture.url : currentThread(latest.threadId)?.sourceUrl;
          if (!sourceUrl) throw new Error('This conflict has no recorded source address. Export before resolving.');
          await options.authorizeHelperSend?.(sourceUrl);
          if (!alive() || client !== helper || client.connectionVersion !== epoch) throw new Error('The helper connection changed.');
          const remote = await client.list(); if (!alive() || client.connectionVersion !== epoch) throw new Error('The helper connection changed.'); return remote;
        });
        else await keepDeviceConflict(journal, locked, mutation.id);
        const released = draftAfterResolution(journal, draft);
        if (released) { draft = released; pendingNoteMutation = undefined; pendingNoteCommitted = false; await draftBuffer.save(draft); }
        changed(); renderThreads(); renderCompose(); renderSettings();
        announce(useHelper ? 'Helper version selected. Original changes remain in history; your note draft is retained.' : 'Device version kept locally, including deliberate absence. Nothing was uploaded or accepted remotely; your note draft is retained.');
      });
      item.append(button('Keep device version; keep my change in history', () => resolve(false)));
      if (options.allowHelper !== false && helper?.token) item.append(button('Use helper version; keep my change in history', () => resolve(true)));
      settingsBody.append(item);
    }
    if (pairingFocused) { const next = settingsBody.querySelector<HTMLInputElement>('[aria-label="Pairing code"]'); next?.focus({ preventScroll: true }); if (next && caret) next.setSelectionRange(caret[0], caret[1]); }
    else if (focused && !focused.isConnected) Array.from(settingsBody.querySelectorAll<HTMLElement>('button,select')).find(node => node.textContent === focused.textContent)?.focus({ preventScroll: true });
  }
  function exportWork() {
    return safely(async () => {
      const state = sourceBoundJournal(journal.state, capture.url);
      let requests: unknown[] = [], earlierQuestions: AskingSelection[] = [], requestHistoryAvailable = true;
      try { [requests, earlierQuestions] = await Promise.all([persistence.values('asking:' + draftKey + ':request:'), persistence.values<AskingSelection>('question-history:' + draftKey + ':')]); earlierQuestions = earlierQuestions.filter(q => q.capture?.url === capture.url); }
      catch { requestHistoryAvailable = false; }
      const blob = new Blob([JSON.stringify({ version: 1, source: capture, ...state, draft, question: questionDraft,
        journalDurable: !journal.unsaved, requests, earlierQuestions, requestHistoryAvailable,
        memoryOnlyDrafts: unsavedDrafts(namespace, capture.url), memoryOnlyQuestions: unsavedQuestions(namespace, capture.url) }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = 'marginalia-notes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function destroy() {
    if (destroyed) return;
    void track(flushReadingPosition());
    askingMount?.destroy(); management?.destroy(); closeReplies(); highlight(null); destroyed = true; abort.abort(); channel?.close();
    workspace.remove(); skip.remove();
    if (mountedMargins.get(root)?.destroy === destroy) root.classList.remove('m-app', 'm-host-only');
  }
  const lifecycle = { destroy, async drain() { await predecessorDrain; while (pendingOperations.size) await Promise.allSettled([...pendingOperations]); } };
  mountedMargins.set(root, lifecycle);
  function trustedHelper() {
    if (!alive() || options.allowHelper === false || !helper?.token) throw new Error('Pair in the browser-owned margin or localhost Settings to use this action.');
    return helper;
  }
  const api = {
    sourceUrl: capture.url, connection: trustedHelper, exportWork, drain: lifecycle.drain,
    get restoredPosition() { return restoredPosition; }, flushReadingPosition,
    getThread: currentThread,
    focusThread(threadId: string) { expanded.add(threadId); renderThreads(); const thread = currentThread(threadId); if (thread) hold(sectionFor(displayPosition(thread.anchor, capture) ?? 0)); showPanel(); },
    select: showSelection,
    setReadingPosition(start: number) { if (alive() && !suspended && !held) { const next = Math.max(0, Math.min(capture.text.length, start)); if (restoredPosition && sectionFor(next) === sectionIndex) return; restoredPosition = false; if (next === readingPosition) return; readingPosition = next; sectionIndex = sectionFor(readingPosition); renderPosition(); if (hydrationFinished) { positionDirty = true; queueReadingPosition(); } } },
    suspend() { highlight(null); suspended = true; management?.close(); askingMount?.setVisible(false); },
    resume() { if (!alive()) return; suspended = false; updateManagement(); askingMount?.setVisible(!questionArea.hidden && questionForm.hidden); renderPosition(); renderSettings(); paintHighlights(); },
    async openThread(threadId: string) { await locked(() => journal.load()); const thread = currentThread(threadId); if (!thread || thread.deletedAt || thread.sourceUrl !== capture.url) throw new Error('The current thread is unavailable; local work is unchanged.'); expanded.add(threadId); renderThreads(); hold(sectionFor(displayPosition(thread.anchor, capture) ?? 0)); showPanel(); threadNodes.get(threadId)?.node.querySelector<HTMLElement>('.m-source-action')?.focus({ preventScroll: true }); },
    destroy,
  };
  const startupGeneration = editorGeneration;
  announce('Restoring saved work. Nothing is being sent.'); renderCompose(); renderPosition();
  try {
    await predecessorDrain; if (!alive()) return api;
    if (options.allowHelper !== false) helper = documentHelper(namespace, options.helperOrigin ?? location.origin);
    const connectionEpoch = helper?.connectionVersion;
    await locked(() => journal.load()); storageReady = true;
    const [savedDraft, pairing, block, theme, savedQuestion, savedRequests] = await Promise.all([draftBuffer.load(), options.allowHelper === false ? undefined : persistence.read<{ origin: string; token: string }>('pairing'), persistence.read<boolean>('denied:' + new URL(capture.url).origin), persistence.read<string>('theme'), questionBuffer.load(), persistence.values<RetainedRequest>('asking:' + draftKey + ':request:').catch(() => [])]);
    if (!alive()) return api;
    if (startupGeneration === editorGeneration) { draft = savedDraft; pendingNoteMutation = draft?.mutation; }
    questionDraft = savedQuestion;
    retainedRequests = savedRequests;
    if (draft) { held = true; readingPosition = composerOffset(draft, 0); sectionIndex = sectionFor(readingPosition); }
    denied = !!block; if (theme && theme !== 'system') document.documentElement.dataset.theme = theme;
    if (helper && connectionEpoch === 0 && helper.connectionVersion === connectionEpoch && pairing?.origin === helper.origin) helper.token = pairing.token;
    if (!draft) {
      try {
        const read = options.readPosition ?? (helper?.token ? async (sourceUrl: string) => (await helper!.request('/api/position', { url: sourceUrl })).anchor as QuoteAnchor | null : undefined);
        const saved = await read?.(capture.url), at = saved ? displayPosition(saved, capture) : undefined;
        if (saved && at !== undefined) { readingPosition = at; sectionIndex = sectionFor(at); restoredPosition = true; options.onSource?.(saved); }
      } catch { /* Position restoration is deliberately quiet. */ }
    }
    announce(journal.unsaved || draftBuffer.unsaved() || questionBuffer.unsaved() ? 'Unsaved work recovered in this document. Retry saving or export before closing.' : 'Local storage is available. Model readiness has not been checked; asking requires a separate review.');
  } catch { announce('Local storage could not be restored. Current drafts remain in this document only; export before closing.'); }
  if (!alive()) return api;
  hydrationFinished = true; renderCompose(); renderThreads(); renderSettings(); renderRetainedRequests();
  if (questionDraft) footer.append(button('Return to retained question', () => { if (questionDraft) showQuestion(questionDraft); }));
  channel?.addEventListener('message', event => {
    if (event.data === 'pairing-changed') {
      if (options.allowHelper === false || !helper) return;
      const client = helper, epoch = client.connectionVersion;
      void safely(async () => { await locked(async () => {
        const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
        if (!alive() || client !== helper || epoch !== client.connectionVersion) return;
        const token = pairing?.origin === client.origin ? pairing.token : ''; if (client.token !== token) client.token = token;
      }); announce('Pairing changed in another margin. Earlier outcomes may be unconfirmed; nothing was automatically retried.'); });
      return;
    }
    void safely(async () => { await locked(() => journal.load()); renderThreads(); renderSettings(); announce(journal.unsaved ? 'Another margin saved work; your unsaved changes remain here.' : 'Saved work updated. Your note and question drafts are unchanged.'); });
  }, { signal });
  return api;
}

function demoPage() {
  const article = el('article', undefined, 'm-source'); article.tabIndex = -1;
  const sourceSections = [
    { title: 'A place beside the page', paragraphs: ['Reading is more than taking in a sentence. Sometimes a phrase is worth keeping. Sometimes you need to leave a question and carry on.', 'A margin gives those small acts a place. The text stays where it is; your thoughts sit beside it. You can return to them without starting over.'] },
    { title: 'Keep what catches you', paragraphs: ['Select a passage in this article to open Keep and Ask. Keeping a passage saves it on this device. Asking first lets you prepare a question and inspect what it would share.', 'Nothing is sent just because you select text. You can read, highlight, and write without an account or a connection to Codex.'] },
    { title: 'Write in your own words', paragraphs: ['A note belongs to a place in the text. When you begin writing, that place holds still. Moving down the page does not move the note’s attachment.', 'An unfinished thought can be parked. A question can stay a question. Your own words come first, and they remain yours when you return.'] },
    { title: 'Return to the thread', paragraphs: ['Work saved in the margin stays in page order. The coloured map gives each section a place, and marks the sections where you have left something.', 'Choose a section to hold it in view. Follow reading brings the margin back to the page. Hovering a saved passage only highlights it; opening its source is a deliberate action.'] },
    { title: 'What is available here', paragraphs: ['This local reading page supports keeping passages, writing and editing notes, parking threads, and removing with undo. Your saved work survives a reload in this browser.', 'Reading and local saving do not send questions. An installed asking module and a working local helper are needed for an explicit sending review; pairing alone does not establish model readiness.'] },
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

