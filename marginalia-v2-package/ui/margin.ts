import { mountAskingDraft } from './asking/mount.ts';
import { rankEligibleSuggestions, suggestionBlock, suggestionPage, suggestionOffer, SUGGESTION_ORDER } from './suggestion-policy.ts';
import type { Intent } from '../contracts/reply.ts';
import { followupQuestion } from './asking/surfaces.ts';
import type { HighlightColour, QuoteAnchor, ReaderMutation, SourceCapture, Thread } from '../contracts/reader.ts';
import { HIGHLIGHT_COLOURS, wholePageAnchor, attachQuote, highlightColour } from '../contracts/reader.ts';
import { el, button } from './dom.ts';
import { localPersistence, documentJournal, documentDraft, documentQuestion, unsavedDrafts, unsavedQuestions, sourceBoundJournal, retryDraftMutation, draftAfterResolution, keepDeviceConflict, resolveHelperConflict, replySaveLifecycle, replyIsRemoved, SUGGESTION_POLICY_VERSION, type SuggestionExposureResolution, type MarginDraft, type CachedReply } from './persistence.ts';
import { anchorAt, readingAnchorAt, orderedThreads, outgoingPreview, sourceLocation, pageDefinition, displayPosition, egressRecord } from './margin-model.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import { HelperClient, attachmentTextHash, documentHelper, forgetPairingIfCurrent } from './helper.ts';
import { mountHelperManagement } from './helper-management.ts';
import { mountNoteEditor } from './note-editor.ts';
import { retainedCopiesSection } from './retained-copies.ts';
import { createT08Mount, type AskingMountFactory, type AskingSelection } from './asking-host.ts';
import type { MountedReply } from '../renderer/index.ts';
import { canonicalReplyData, capabilitiesForIntent, validateReply, type SourceBinding } from '../contracts/reply.ts';
import { mountSolverRecompute } from './solver-recompute.ts';
import { mountHearIt } from './hear-it.ts';
import { diagnosticsSection, loadReaderDiagnostics, type ReaderDiagnostics } from './diagnostics.ts';
import type { VocabularyObservation, VocabularyObservationResult } from '../contracts/library.ts';
import { mountInstantDefinition } from './instant/definition.ts';
import { mountInstantOnboarding } from './instant/onboarding.ts';
import type { InstantTransport } from './instant/transport.ts';
import { mountAutoAssistReadyHelp, type AutoAssistHelpItem, type AutoAssistReadyHelpState } from './auto-assist/ready-help.ts';
import { mountRelated, type RelatedMount } from './related/related.ts';
import type { RelatedTransport } from './related/transport.ts';
import { mountForget, type ForgetPageIdSource } from './forget/forget.ts';
import type { ForgetTransport } from './forget/transport.ts';
import type { ReaderSkillSelection } from '../contracts/reader-skills.ts';

type QuestionDraft = AskingSelection & { suggestionExposureId?: string };

export type MarginSection = { title: string; start: number; end: number };
export type MarginOptions = {
  /** Host source invalidation cancels hydration and helper work. */
  signal?: AbortSignal;
  capture?: SourceCapture;
  /** Verified runnable intents from the host, absent means unknown. */
  suggestionEligibility?: readonly Intent[];
  sections?: MarginSection[];
  /** Supply a source only when it belongs to this trusted document. Extension hosts use callbacks. */
  sourceRoot?: HTMLElement;
  onSource?: (anchor: QuoteAnchor) => void;
  onHighlight?: (anchor: QuoteAnchor | null) => void;
  onSavedMarks?: (marks: { anchor: QuoteAnchor; highlighted: boolean; highlightColour?: HighlightColour }[]) => void;
  /** Read a fresh page snapshot only when the reader asks to look again. */
  captureCurrentPage?: () => Promise<{ capture: SourceCapture; tabCapture: string }>;
  helperOrigin?: string;
  storageName?: string;
  initialOpen?: boolean;
  /** Management is only admitted by the genuine top-level localhost document. */
  helperManagement?: boolean;
  /** Existing host-owned controls to place inside the reader's Settings surface. */
  settingsContent?: HTMLElement;
  /** Canonical library snapshot, not an inserted journal record. */
  savedThread?: Thread;
  draftScope?: string;
  /** The default composes the separately owned T08 public module when installed. */
  asking?: AskingMountFactory;
  onLibrary?: (thread?: Thread) => void;
  /** Disable authenticated helper access in page-embedded, clickjackable hosts. */
  allowHelper?: boolean;
  /** Trusted host policy recheck immediately before each local outbox send. */
  authorizeHelperSend?: (sourceUrl: string) => Promise<void>;
  /** Test/host seams; the default uses the authenticated app on this device. */
  readPosition?: (sourceUrl: string) => Promise<QuoteAnchor | undefined>;
  writePosition?: (anchor: QuoteAnchor) => Promise<void>;
  positionDebounceMs?: number;
  /** Test/host seam for the explicit local Remember observation only. */
  rememberVocabulary?: (observation: VocabularyObservation) => Promise<VocabularyObservationResult>;
  /** Authenticated instant-help boundary supplied by the trusted host. */
  instantHelp?: InstantTransport;
  /** Host-owned dismissal boundary for automatic reading help. */
  autoAssist?: { dismiss(item: AutoAssistHelpItem, signal: AbortSignal): Promise<void> };
  /** Local saved-work lookup supplied by the trusted host. */
  related?: RelatedTransport;
  /** Host-owned instant page identity and cleanup boundary. */
  forget?: { transport: ForgetTransport; getPageId: ForgetPageIdSource };
};
type Draft = MarginDraft;
type RetainedRequest = { jobId: string; selection: AskingSelection };
type StoredAttachmentObservation = { threadId: string; sourceUrl: string; textHash: string; sourceGeneration: string; state: 'exact' | 'moved' | 'unsure' | 'lost'; candidates: { start: number; end: number }[] };

/** Facts available from the durable job record. A provider handoff is not an
 * observation of physical transmission, and reviewed bytes are not wire bytes. */
export function egressMeasurements(job: JobSnapshot) {
  const attempt = job.latestAttemptId
    ? job.attempts.find(value => value.id === job.latestAttemptId)
    : job.attempts.at(-1);
  const reviewedBytes = attempt?.sentContent
    ? attempt.sentContent.reduce((total, part) => total + new TextEncoder().encode(part.text).byteLength, 0)
    : null;
  return {
    reviewedBytes,
    handoffRecorded: attempt?.handoffMarked === true,
    observedSentBytes: null,
    transmissionObserved: false,
  } as const;
}

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
    // Both weights are reader marks: Keep contributes the underline/map tick,
    // while Highlight adds tint without changing the passage's map identity.
    const marked = here;
    return { index, current: index === current, length: Math.max(1, section.end - section.start), threads: here.length,
      notes: here.reduce((sum, thread) => sum + thread.notes.filter(note => !note.deletedAt).length, 0), marks: marked.length,
      markPositions: marked.map(thread => Math.max(0, Math.min(1, ((displayPosition(thread.anchor, capture) ?? section.start) - section.start) / Math.max(1, section.end - section.start)))) };
  });
}
const id = () => crypto.randomUUID();
const excerpt = (text: string, length = 82) => text.length > length ? text.slice(0, length) + '…' : text;
const readerDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
const label = (text: string, input: HTMLElement) => { const node = el('label', text); node.append(input); return node; };
const actionButton = (key: string, text: string, run: () => unknown) => { const control = button(text, run); control.dataset.focusKey = key; return control; };
const actions = (...children: HTMLElement[]) => { const row = el('div', undefined, 'm-actions'); row.append(...children); return row; };
const mountedMargins = new WeakMap<HTMLElement, { destroy(): void; drain(): Promise<unknown> }>();

/** Mount in a trusted local or extension document. No remote page receives private note markup. */
export async function mountMargin(root: HTMLElement, options: MarginOptions = {}) {
  options.signal?.throwIfAborted();
  const exposureRecoveryTime = new Date().toISOString();
  const previous = mountedMargins.get(root); previous?.destroy();
  const predecessorDrain = previous?.drain() ?? Promise.resolve();
  let destroyed = false;
  const pendingOperations = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> { pendingOperations.add(work); void work.finally(() => pendingOperations.delete(work)).catch(() => {}); return work; }
  const alive = () => !destroyed && !options.signal?.aborted;
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
  const sourceTitle = el('h1', capture.title); sourceTitle.id = instance + '-source-title';
  heading.setAttribute('role', 'region'); heading.setAttribute('aria-labelledby', sourceTitle.id);
  const sourceMetadata = el('p', [capture.pageType, capture.author, capture.publicationDate, capture.venue].filter(Boolean).join(' · '), 'm-meta');
  sourceMetadata.id = instance + '-source-metadata';
  function beginReading() {}
  heading.append(sourceTitle, sourceMetadata);
  const compose = el('div', undefined, 'm-compose');
  const map = el('nav', undefined, 'm-map'); map.setAttribute('aria-label', 'Page map: sections, notes and reading position');
  const reading = el('div', undefined, 'm-reading');
  const selectionCard = el('section', undefined, 'm-selection'); selectionCard.hidden = true;
  const instantDefinitionHost = el('div', undefined, 'm-instant-definition-slot');
  const selectionRelatedHost = el('div', undefined, 'm-related-slot');
  const instantOnboardingHost = el('div', undefined, 'm-instant-onboarding-slot');
  const autoAssistAssumesHost = el('div', undefined, 'm-auto-assist-assumes-slot'); autoAssistAssumesHost.hidden = true;
  const autoAssistReadyHost = el('div', undefined, 'm-auto-assist-ready-slot'); autoAssistReadyHost.hidden = true;
  const questionArea = el('section', undefined, 'm-question'); questionArea.hidden = true;
  const egressSheet = el('section', undefined, 'm-question-slot'); egressSheet.hidden = true;
  egressSheet.setAttribute('role', 'region'); egressSheet.setAttribute('aria-label', 'What was sent');
  let egressGeneration = 0, activityGeneration = 0, activityJobId: string | undefined;
  const questionForm = el('div'), askingHost = el('div'); askingHost.hidden = true; questionArea.append(questionForm, askingHost);
  let askingMount: ReturnType<AskingMountFactory> | undefined;
  const threadList = el('div', undefined, 'm-threads');
  const footer = el('footer', undefined, 'm-footer');
  const footerSlots = { related: el('div', undefined, 'm-footer-related'), actions: el('div', undefined, 'm-footer-actions'), voice: el('div', undefined, 'm-footer-voice'), history: el('div', undefined, 'm-footer-history'), requests: el('div', undefined, 'm-footer-requests'), retained: el('div', undefined, 'm-footer-retained') };
  footer.append(footerSlots.related, footerSlots.actions, footerSlots.voice);
  const localLibrary = el('section', undefined, 'm-local-library'); localLibrary.hidden = true;
  localLibrary.setAttribute('aria-label', 'Library work on this page');
  localLibrary.append(el('h2', 'Work on this page'), footerSlots.history, footerSlots.requests, footerSlots.retained);
  if (options.onLibrary) localLibrary.append(button('Open Library', () => options.onLibrary?.()));
  localLibrary.append(button('Close Library', () => { localLibrary.hidden = true; libraryButton.focus({ preventScroll: true }); }));
  const status = el('p', '', 'm-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const notice = el('div', undefined, 'm-notice'); notice.hidden = true; notice.tabIndex = 0;
  footer.prepend(notice);
  const toast = el('div', undefined, 'm-toast'); toast.hidden = true;
  const setup = el('section', undefined, 'm-settings'); setup.hidden = true;
  const settingsBody = el('div'), managementHost = el('div'), forgetHost = el('div', undefined, 'm-forget-slot');
  setup.append(settingsBody, managementHost, ...(options.settingsContent ? [options.settingsContent] : []));
  rail.append(map);
  const scroll = el('div', undefined, 'm-scroll'); scroll.append(egressSheet, selectionCard, threadList, footer);
  panel.append(bar, ...(options.instantHelp ? [instantOnboardingHost] : []), heading, autoAssistAssumesHost, setup, localLibrary, scroll, status, toast); shell.append(rail, panel); workspace.append(shell); root.append(workspace);
  const management = options.helperManagement && options.allowHelper !== false ? mountHelperManagement(managementHost) : undefined;
  const instantDefinition = options.instantHelp ? mountInstantDefinition(instantDefinitionHost, options.instantHelp, { quietErrors: true }) : undefined;
  const selectionRelated = options.related ? mountRelated(selectionRelatedHost, options.related) : undefined;
  const instantOnboarding = options.instantHelp ? mountInstantOnboarding(instantOnboardingHost, options.instantHelp, persistence) : undefined;
  const forget = options.forget ? mountForget(forgetHost, options.forget.transport, options.forget.getPageId) : undefined;
  const autoAssist = options.autoAssist ? mountAutoAssistReadyHelp(autoAssistAssumesHost, autoAssistReadyHost, {
    sectionAt: sectionFor,
    open: item => sourceAction(item.anchor, false),
    ask: item => ask(item.anchor),
    dismiss: (item, dismissSignal) => options.autoAssist!.dismiss(item, dismissSignal),
    hold: item => hold(sectionFor(item.anchor.start)),
  }) : undefined;
  let suspended = false, readingPosition = 0, hydrationFinished = false, editorGeneration = 0;
  let alignedReadingPosition = -1;
  let pairingDraft = '', questionDraft: QuestionDraft | undefined, retainedRequests: RetainedRequest[] = [];
  const updateManagement = () => { if (!suspended && !setup.hidden && !shell.classList.contains('is-collapsed')) management?.open(); else management?.close(); };
  let sectionIndex = 0, held = false, draft: Draft | undefined, selected: QuoteAnchor | undefined;
  let replacementSelection: { anchor: QuoteAnchor; target: 'note' | 'question' } | undefined;
  let draftAttachmentSaveFailed = false, questionAttachmentSaveFailed = false;
  let helper: HelperClient | undefined, storageReady = false, saving = false;
  let positionTimer: ReturnType<typeof setTimeout> | undefined, positionDirty = false, lastPositionWrite = 0, restoredPosition = false;
  let resumePosition: number | undefined, resumeLine: HTMLButtonElement | undefined;
  let resumeAnchor: QuoteAnchor | undefined;
  let denied = false;
  let pendingNoteMutation: ReaderMutation | undefined;
  let pendingNoteCommitted = false;
  let draftSaveFailed = false;
  let needsReconciliation = false;
  let lastOpener: HTMLElement | null = null;
  let panelOpener: HTMLElement | null = null;
  let rememberObservation: VocabularyObservation | undefined, rememberPending = false;
  let instantSelectionGeneration = 0;
  let readingPosture: AutoAssistReadyHelpState['posture'] = 'balanced';
  const narrowViewport = () => matchMedia('(max-width: 899px)').matches;
  const expanded = new Set<string>();
  const expandedKey = 'expanded:' + capture.url;
  const rememberExpanded = (threadId: string) => { void track(persistence.write(expandedKey, threadId)).catch(() => {}); };
  const expandOnly = (threadId: string) => { expanded.clear(); expanded.add(threadId); rememberExpanded(threadId); };
  const expandAdditionally = (threadId: string) => { expanded.add(threadId); rememberExpanded(threadId); };
  const attachmentMessages = new Map<string, string>();
  const attachmentPending = new Set<string>();
  const attachmentObservations = new Set<string>();
  const attachmentObservedThisMount = new Set<string>();
  let captureTextHash = '';
  let attachmentGeneration = 0;
  const attachmentObservationKey = (threadId: string, textHash: string) => 'attachment-observation:' + JSON.stringify([threadId, capture.url, textHash]);
  const hasAttachmentObservation = (threadId: string) => attachmentObservedThisMount.has(threadId) || attachmentObservations.has(attachmentObservationKey(threadId, captureTextHash));
  const threadNodes = new Map<string, { signature: string; node: HTMLElement }>();
  const threadRelated = new Map<string, RelatedMount>();
  const railThreadNodes = new Map<string, HTMLButtonElement>();
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
  const questionBuffer = documentQuestion(namespace, questionKey, capture.url, { read: () => persistence.read<QuestionDraft>(questionKey), write: value => persistence.write(questionKey, value) });
  const suggestionScope = draftKey;
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
    const occupied = new Set(orderedThreads(threadsNow(), capture).map(thread => sectionFor(displayPosition(thread.anchor, capture) ?? 0)));
    const items: { node: HTMLElement; position: number; rank: number }[] = [];
    sectionMarkers.forEach((node, index) => {
      if (occupied.has(index) && index !== sectionIndex) items.push({ node, position: sections[index].start, rank: 0 });
      else node.remove();
    });
    items.push({ node: reading, position: readingPosition, rank: .5 });
    const autoAssistPosition = autoAssist?.position();
    if (autoAssistPosition !== undefined && !autoAssistReadyHost.hidden) items.push({ node: autoAssistReadyHost, position: autoAssistPosition, rank: .75 });
    items.push({ node: compose, position: composerOffset(draft, readingPosition), rank: 1 });
    const selectionPosition = replacementSelection?.target === 'note' && draft ? composerOffset(draft, readingPosition)
      : replacementSelection?.target === 'question' && questionDraft ? displayPosition(questionDraft.anchor, capture) ?? readingPosition
      : selected ? displayPosition(selected, capture) ?? readingPosition : readingPosition;
    items.push({ node: selectionCard, position: selectionPosition, rank: 1.2 });
    const questionParent = selected && !selectionCard.hidden && questionDraft && canonicalReplyData(selected) === canonicalReplyData(questionDraft.anchor) ? selectionCard : questionDraft?.threadId ? threadNodes.get(questionDraft.threadId)?.node.querySelector<HTMLElement>('.m-thread-body') : undefined;
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
  let noticeTimer: ReturnType<typeof setTimeout> | undefined, noticeHovered = false;
  const errors: string[] = [];
  function scheduleNotice() {
    clearTimeout(noticeTimer);
    if (!errors.length && !noticeHovered && !notice.contains(document.activeElement)) noticeTimer = setTimeout(() => { notice.hidden = true; }, 4000);
  }
  function showError() {
    notice.hidden = false;
    notice.replaceChildren(el('span', errors[0]), button('Dismiss', () => {
      errors.shift();
      if (errors.length) showError(); else { notice.hidden = true; savePageButton.focus({ preventScroll: true }); }
    }));
  }
  const announce = (message: string, error = false, visible = true) => {
    if (!alive()) return;
    status.textContent = message;
    if (error) { if (!errors.includes(message)) errors.push(message); clearTimeout(noticeTimer); showError(); }
    else if (visible && !errors.length) { notice.replaceChildren(el('span', message)); notice.hidden = false; scheduleNotice(); }
  };
  notice.addEventListener('mouseenter', () => { noticeHovered = true; clearTimeout(noticeTimer); });
  notice.addEventListener('mouseleave', () => { noticeHovered = false; scheduleNotice(); });
  notice.addEventListener('focusin', () => clearTimeout(noticeTimer));
  notice.addEventListener('focusout', () => { queueMicrotask(scheduleNotice); });
  const changed = () => { if (alive()) { channel?.postMessage('changed'); draftMount?.changed(); } };
  const fail = (error: unknown) => {
    if (!alive()) return;
    if (draft) draftSaveFailed = true;
    if (error instanceof Error && error.message.startsWith('Local storage changed elsewhere.')) needsReconciliation = true;
    announce(needsReconciliation ? 'Another tab saved work. Use Recover unsaved changes in Settings; your draft is still here.' : journal.unsaved ? 'Not saved yet. Keep this page open and use Retry saving in Settings.' : pendingNoteCommitted ? 'Your note is saved. Use Retry saving in Settings to clear its draft.' : error instanceof Error ? error.message : 'Your work could not be saved. Keep this page open and try again.', true); renderSettings();
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
    // Related is a reader-opened snapshot. Reopening explicitly refreshes it.
  }
  function safely(operation: () => Promise<void>) { if (!alive()) return Promise.resolve(); return track((async () => { try { await operation(); } catch (error) { fail(error); } })()); }
  async function flushReadingPosition() {
    if (positionTimer) { clearTimeout(positionTimer); positionTimer = undefined; }
    if (options.signal?.aborted) return;
    if (!positionDirty) return;
    const anchor = readingAnchorAt(capture.text, readingPosition);
    const write = options.writePosition ?? (helper?.token ? async (value: QuoteAnchor) => { await helper!.request('/api/position', { capture, anchor: value }, options.signal); } : undefined);
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
    shell.classList.remove('is-collapsed'); openButton.setAttribute('aria-expanded', 'true'); updateManagement();
    if (focus) (narrowViewport() ? collapse : writeButton).focus();
  }
  function closePanel() {
    if (!alive() || shell.classList.contains('is-collapsed')) return;
    hearIt.stop();
    shell.classList.add('is-collapsed'); openButton.setAttribute('aria-expanded', 'false'); rail.append(map); management?.close();
    const target = panelOpener?.isConnected ? panelOpener : openButton; panelOpener = null; target.focus({ preventScroll: true });
  }
  const openButton = button('Open margin', () => showPanel(true, openButton)); openButton.className = 'm-open';
  openButton.setAttribute('aria-controls', shell.id); openButton.setAttribute('aria-expanded', 'true');
  rail.append(openButton);
  const collapse = button('Collapse', closePanel);
  const openSettings = () => { setup.hidden = false; updateManagement(); void refreshDiagnostics(); setup.querySelector<HTMLElement>('input,button')?.focus(); };
  const settingsButton = button('Settings', () => { if (setup.hidden) openSettings(); else setup.hidden = true; });
  const barActions: HTMLElement[] = [];
  const libraryButton = button('Library', () => {
    if (options.onLibrary && earlierDrafts.hidden && !footerSlots.requests.children.length && !footerSlots.retained.children.length) options.onLibrary();
    else { localLibrary.hidden = !localLibrary.hidden; if (!localLibrary.hidden) localLibrary.querySelector<HTMLElement>('button')?.focus(); }
  });
  barActions.push(libraryButton);
  barActions.push(settingsButton, collapse);
  bar.append(el('span', 'Marginalia', 'm-wordmark'), actions(...barActions));
  if (options.initialOpen === false || (options.initialOpen !== true && narrowViewport())) {
    shell.classList.add('is-collapsed'); openButton.setAttribute('aria-expanded', 'false'); rail.append(map);
  }
  const writeButton = button('Write here…', () => beginDraft()); writeButton.className = 'm-write'; compose.append(writeButton);
  writeButton.addEventListener('focus', () => { if (hydrationFinished && !draft) beginDraft(); });
  const readingTitle = el('h2'); readingTitle.tabIndex = -1;
  const followingLabel = el('span', '', 'm-meta');
  const followButton = button('Follow reading', () => { held = false; updateReading(); renderPosition(); readingTitle.focus(); });
  reading.append(readingTitle, followingLabel, followButton);
  function dismissResumeLine() { resumeLine?.remove(); resumeLine = undefined; resumePosition = undefined; resumeAnchor = undefined; }
  function showResumeLine(anchor: QuoteAnchor, position: number) {
    dismissResumeLine(); resumePosition = position; resumeAnchor = anchor;
    resumeLine = button('You were here', () => { dismissResumeLine(); sourceAction(anchor); });
    resumeLine.className = 'm-resume m-meta';
    heading.append(resumeLine);
  }
  shell.addEventListener('click', dismissResumeLine, { signal });
  shell.addEventListener('input', dismissResumeLine, { signal });
  const railThreads = el('div', undefined, 'm-rail-threads');
  map.append(railThreads);
  const activityButton = button('Work status', () => { void openEgress(); });
  activityButton.className = 'm-activity'; activityButton.hidden = true; map.append(activityButton);
  function showActivity(text: string, sending: boolean, elapsedSeconds?: number) {
    if (!alive()) return;
    // Closing the question does not erase the last job's record.
    if (!text && activityJobId) return;
    activityButton.hidden = !text; activityButton.dataset.sending = String(sending);
    activityButton.setAttribute('aria-label', 'Open What was sent: ' + (text || 'work status') + (elapsedSeconds !== undefined && elapsedSeconds >= 30 ? `, ${Math.floor(elapsedSeconds)} seconds` : '') + '.');
    activityButton.title = text; activityButton.textContent = text;
  }
  function flowActivity(value: { phase: string; elapsedSeconds?: number }) {
    const working = ['queued', 'sending', 'working', 'provisional', 'validating', 'loading-reply', 'cancel_requested'].includes(value.phase);
    return { text: working ? 'Working' : value.phase === 'committed' ? 'Ready' : value.phase === 'unknown' || value.phase === 'timed_out' ? 'Outcome unconfirmed' : value.phase === 'failed' ? 'Failed' : value.phase === 'cancelled' ? 'Cancelled' : '', elapsedSeconds: value.elapsedSeconds };
  }
  function updateActivity(value: { phase: string; sending?: boolean; elapsedSeconds?: number }) {
    if (!alive()) return;
    const generation = ++activityGeneration;
    const fallback = flowActivity(value);
    // Asking-flow state describes work, not network observation. It may never
    // light the sending indicator on its own.
    showActivity(fallback.text, false, fallback.elapsedSeconds);
    const jobId = activityJobId;
    if (!jobId) return;
    void (async () => {
      try {
        const client = trustedHelper(), epoch = client.connectionVersion;
        const job = await client.request('/api/jobs/' + encodeURIComponent(jobId), undefined, signal) as JobSnapshot;
        if (!alive() || generation !== activityGeneration || helper !== client || epoch !== client.connectionVersion || job.id !== jobId) return;
        const measured = egressMeasurements(job);
        const activeHandoff = measured.handoffRecorded && job.state === 'sending';
        showActivity(activeHandoff ? 'Request passed to Codex' : flowActivity({ ...value, phase: job.state === 'running' ? 'working' : job.state === 'succeeded' ? 'committed' : job.state }).text,
          false, value.elapsedSeconds);
      } catch {
        if (alive() && generation === activityGeneration) showActivity('Sending status is unavailable', false, value.elapsedSeconds);
      }
    })();
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
      if (!jobId) throw new Error('The stored record for this activity is unavailable. The outcome is unconfirmed.');
      const client = trustedHelper(), epoch = client.connectionVersion;
      const job = await client.request('/api/jobs/' + encodeURIComponent(jobId), undefined, signal) as JobSnapshot;
      if (!alive() || generation !== egressGeneration || helper !== client || epoch !== client.connectionVersion) return;
      if (job.id !== jobId) throw new Error('The stored record does not match this activity.');
      const record = egressRecord(job);
      const measured = egressMeasurements(job);
      content.replaceChildren(el('p', record.summary));
      content.append(el('h3', 'Size of reviewed content'), el('p', measured.reviewedBytes === null
        ? 'Unknown for this record. No measurement is backfilled.'
        : `${measured.reviewedBytes} UTF-8 bytes. The reviewed content size is recorded. Transmission size is unmeasured.`));
      content.append(el('h3', 'Provider handoff'), el('p', measured.handoffRecorded
        ? 'Recorded in the durable attempt record.'
        : 'No durable provider handoff is recorded.'));
      content.append(el('h3', 'Observed transmission'), el('p',
        'Not observed. This record can establish provider handoff. Transmission evidence is unavailable.'));
      for (const [label, value] of record.fields) content.append(el('h3', label), el('p', /^\d{4}-\d{2}-\d{2}T/.test(value) ? readerDate(value) : value));
      const packet = el('pre', canonicalReplyData(record.packet));
      packet.style.whiteSpace = 'pre-wrap'; packet.style.overflowWrap = 'anywhere';
      content.append(el('p', record.retention, 'm-meta'), el('h3', 'Retained reading packet'), packet);
    } catch (error) {
      if (alive() && generation === egressGeneration) content.textContent = error instanceof Error ? error.message : 'The stored record is unavailable. The outcome is unconfirmed.';
    }
  }
  const footerCount = el('summary', '', 'm-meta');
  const pageActions = el('details', undefined, 'm-page-actions'); pageActions.hidden = true; pageActions.append(footerCount);
  footerCount.addEventListener('click', () => { threadList.scrollIntoView({ block: 'start' }); });
  const related = el('section', undefined, 'm-related');
  related.setAttribute('aria-label', 'Related saved passages');
  related.id = instance + '-related'; related.hidden = true;
  let relatedGeneration = 0;
  const relatedToggle = button('Related', () => {
    related.hidden = !related.hidden;
    relatedToggle.setAttribute('aria-expanded', String(!related.hidden));
    if (related.hidden) { ++relatedGeneration; related.replaceChildren(); }
    else refreshRelated();
  });
  relatedToggle.setAttribute('aria-expanded', 'false'); relatedToggle.setAttribute('aria-controls', related.id);
  function refreshRelated() {
    if (related.hidden || !hydrationFinished || !alive()) return;
    const client = helper, epoch = client?.connectionVersion;
    const generation = ++relatedGeneration;
    const current = () => alive() && !related.hidden && generation === relatedGeneration && client === helper && epoch === client?.connectionVersion;
    const unavailable = () => related.replaceChildren(el('p', 'Related passages need the app on this device.', 'm-meta'));
    if (!client?.token) { unavailable(); return; }
    related.replaceChildren(el('p', 'Looking for related saved passages…', 'm-meta'));
    void track((async () => {
      try {
        const threads = (await client.list()).filter(thread => !thread.deletedAt && thread.sourceUrl === capture.url);
        const results = new Map<string, Awaited<ReturnType<HelperClient['relatedLibrary']>>[number]>();
        for (const thread of threads) {
          if (!current()) return;
          for (const result of await client.relatedLibrary(thread.id)) {
            if (result.kind === 'source' && result.sourceUrl !== capture.url) results.set(JSON.stringify([result.sourceVersionId, result.start, result.end]), result);
            if (results.size === 3) break;
          }
          if (results.size === 3) break;
        }
        if (!current()) return;
        related.replaceChildren(el('p', results.size ? 'Related saved passages' : 'No related saved passages were found.', 'm-meta'));
        for (const result of results.values()) {
          const item = el('div'), preview = el('div');
          const open = button(result.sourceTitle, () => { void track((async () => {
            try {
              const bundle = await client.exportThread(result.threadId);
              if (!current()) return;
              if (bundle.thread.id !== result.threadId || bundle.thread.deletedAt || bundle.thread.sourceUrl !== result.sourceUrl || bundle.thread.sourceVersionId !== result.sourceVersionId || bundle.source.id !== result.sourceVersionId || bundle.source.text.slice(result.start, result.end) !== result.passage) throw new Error('Saved source changed.');
              const close = button('Close saved source', () => { preview.replaceChildren(); open.focus(); });
              const start = Math.max(0, result.start - 120), end = Math.min(bundle.source.text.length, start + 600);
              const text = el('p', (start ? '…' : '') + bundle.source.text.slice(start, end) + (end < bundle.source.text.length ? '…' : ''));
              text.className = 'm-related-excerpt'; text.style.whiteSpace = 'pre-wrap';
              const library = button('Open in Library', () => {
                if (options.onLibrary) { options.onLibrary(bundle.thread); return; }
                localLibrary.querySelector('.m-library-source')?.remove();
                const savedSource = el('section', undefined, 'm-library-source');
                savedSource.append(el('h3', bundle.source.title ?? result.sourceTitle), el('pre', bundle.source.text));
                localLibrary.prepend(savedSource); localLibrary.hidden = false;
                localLibrary.querySelector<HTMLElement>('button')?.focus();
              });
              preview.replaceChildren(el('h3', bundle.source.title ?? result.sourceTitle), text, actions(library, close)); close.focus();
            } catch { if (current()) preview.replaceChildren(el('p', 'This saved source is unavailable.', 'm-meta')); }
          })()); });
          item.append(open, el('blockquote', result.passage), preview); related.append(item);
        }
      } catch { if (current()) unavailable(); }
    })());
  }
  const parkedPositionKey = 'parked-page-position:' + capture.url;
  const savedPageKey = 'saved-page:' + capture.url;
  let pageSaving = false;
  const savePageButton = button('Save page', () => savePage(false)), parkPageButton = button('Read page later', () => savePage(true));
  savePageButton.disabled = true; parkPageButton.disabled = true;
  function savePage(parked: boolean) {
    if (!hydrationFinished || pageSaving) return;
    pageSaving = true; savePageButton.disabled = true; parkPageButton.disabled = true;
    const position = readingAnchorAt(capture.text, readingPosition);
    return safely(async () => {
      try {
        // Reopening identical content retains the original capture time; changed
        // source content or supplied metadata receives a separate immutable entry.
        const hash = await attachmentTextHash(JSON.stringify([capture.text, capture.title, capture.pageType, capture.extractionVersion, capture.sections, capture.author, capture.publicationDate, capture.venue]));
        const saved = await persistence.read<{ hash: string; threadId: string }>(savedPageKey);
        const existing = saved?.hash === hash ? orderedThreads(threadsNow(), capture).find(thread => thread.id === saved.threadId && thread.anchor.kind === 'whole-page') : undefined;
        const reserved = saved?.hash === hash && !threadsNow().some(thread => thread.id === saved.threadId) ? saved.threadId : undefined;
        const threadId = existing?.id ?? reserved ?? id();
        await persistence.write(savedPageKey, { hash, threadId });
        if (!existing) await change({ id: id(), kind: 'keep', threadId, capture, anchor: wholePageAnchor() });
        if (parked) {
          const thread = journal.state.threads.find(value => value.id === threadId)!;
          if (thread.state !== 'parked') await change({ id: id(), kind: 'thread-state', threadId, state: 'parked', expectedRevision: thread.revision });
          await persistence.write(parkedPositionKey, { threadId, anchor: position });
        }
        announce(parked ? 'Page saved for later on this device.' : 'Page saved on this device.');
      } finally { pageSaving = false; if (alive()) { savePageButton.disabled = false; parkPageButton.disabled = false; } }
    });
  }
  pageActions.append(actions(relatedToggle, parkPageButton, button('Export', exportWork)), related);
  footerSlots.related.append(pageActions);
  footerSlots.actions.append(savePageButton);
  const endOffers = el('div', undefined, 'm-end-offers');
  const think = button('Think with it', () => pageQuestion('unsure', 'Help me reflect on this page and connect it to my own questions.'));
  const further = button('Go further', () => pageQuestion('explore', 'Suggest useful further reading related to this page.'));
  const voiceUnavailable = el('p', 'Hear it needs a local voice.', 'm-meta'); setup.append(voiceUnavailable);
  const hearIt = mountHearIt(footerSlots.voice, () => {
    const at = selected && displayPosition(selected, capture);
    return selected && at !== undefined ? capture.text.slice(at, at + selected.exact.length) : capture.text.slice(readingPosition);
  }, available => { voiceUnavailable.hidden = available; });
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
    const lastParagraph = capture.text.trimEnd().lastIndexOf('\n') + 1;
    const sourceEndVisible = source && readingPosition > 0 && source.getBoundingClientRect().bottom <= innerHeight;
    const atEnd = capture.text.length > 0 && (sourceEndVisible || readingPosition >= (lastParagraph || capture.text.length - 1));
    if (atEnd) { if (!endOffers.children.length) endOffers.append(think, further); if (endOffers.parentElement !== scroll) scroll.insertBefore(endOffers, footer); }
    else endOffers.remove();
    sectionMarkers.forEach((marker, index) => { marker.hidden = index === sectionIndex; });
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
      node.style.setProperty('--section-colour', `var(--m-sec-${(at === undefined ? sectionIndex : sectionFor(at)) % 6 + 1})`);
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
  function persistDraft() {
    if (!draft || !alive()) return;
    editorGeneration++;
    void track(draftBuffer.save(draft)).then(() => {
      if (!draftBuffer.unsaved()) { draftAttachmentSaveFailed = false; draftSaveFailed = false; if (alive()) renderCompose(); }
    }).catch(error => { draftSaveFailed = true; fail(error); });
  }
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
    savePageButton.disabled = !hydrationFinished || pageSaving; parkPageButton.disabled = !hydrationFinished || pageSaving;
    writeButton.hidden = !!draft; writeButton.disabled = !hydrationFinished;
    noteEditor.update(draft ? { text: draft.text,
      attachment: draft.anchor.kind === 'whole-page' ? 'Note on the whole page' : `Note on "${excerpt(displayAnchor(draft.anchor), 66)}"`,
      saving, locked: pendingNoteCommitted || !!draft.mutation, canChange: !draft.threadId,
       message: !storageReady ? 'Local storage is unavailable. Export this memory-only draft before closing.' : draftAttachmentSaveFailed ? 'This attachment change is not saved yet. Retry saving in Settings; your text is retained.' : draft.source && draft.source.text !== capture.text ? 'The original captured passage is retained. Change explicitly adopts the current capture.' : draft.mutation ? 'This exact change is retained. Retry saving or resolve its conflict before editing.' : '' } : undefined);
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
        announce('Your choice is saved on this device. The note draft remains editable; save it as a new deliberate change.'); return;
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
    let saved = false;
    await safely(async () => {
      const existing = orderedThreads(threadsNow(), capture).find(t => t.anchor.start === anchor.start && t.anchor.exact === anchor.exact);
      const threadId = existing?.id ?? id();
      if (!existing) await change({ id: id(), kind: 'keep', threadId, capture, anchor });
      if (parked) { const thread = journal.state.threads.find(t => t.id === threadId)!; await change({ id: id(), kind: 'thread-state', threadId, state: 'parked', expectedRevision: thread.revision }); }
      announce(parked ? 'Passage saved for later on this device.' : 'Passage kept on this device.'); saved = true;
    });
    return saved;
  }
  function renderSelectionActions(anchor: QuoteAnchor) {
    const instantGeneration = ++instantSelectionGeneration;
    instantDefinition?.clear();
    replacementSelection = undefined;
    rememberObservation = { operationId: id(), term: displayAnchor(anchor), origin: 'stated', observedAt: new Date().toISOString(), source: { kind: 'reader' } }; rememberPending = false;
    const definition = pageDefinition(anchor.exact, capture.text);
    const remember = button('Remember this term', () => { void safely(async () => {
      if (rememberPending) return;
      rememberPending = true; remember.disabled = true;
      try {
        const observation = structuredClone(rememberObservation!);
        const result = options.rememberVocabulary ? await options.rememberVocabulary(observation) : await trustedHelper().observeVocabulary(observation);
        if (!alive() || rememberObservation?.operationId !== observation.operationId) return;
        announce(result.deleted ? 'This earlier Remember action was deleted. Choose Remember again to add a new entry.' : `${observation.term} is in Vocabulary. This records your choice about the term. It stays separate from claims about your knowledge.`);
        remember.textContent = result.deleted ? 'Remember again' : 'Remembered';
        if (result.deleted) rememberObservation = { ...observation, operationId: id(), observedAt: new Date().toISOString() };
      } finally { rememberPending = false; if (alive() && !selectionCard.hidden) remember.disabled = false; }
    }); });
    const row = actions(button('Keep', async () => { if (await keep(anchor)) closeSelection(); }), button('Ask', () => ask(anchor)), button('Read later', async () => { if (await keep(anchor, true)) closeSelection(); }));
    row.classList.add('m-selection-actions');
    row.querySelectorAll<HTMLButtonElement>('button').forEach((control, index) => { control.id = 'm-selection-' + ['keep', 'ask', 'park'][index]; });
    const more = el('details'); more.className = 'm-selection-more'; more.append(el('summary', 'More'), remember);
    selectionCard.replaceChildren(...(definition ? [el('p', `${definition} · from this page`, 'm-meta'), remember] : []),
      ...(instantDefinition ? [instantDefinitionHost] : []), el('blockquote', displayAnchor(anchor)), row, ...(definition ? [] : [more]),
      ...(selectionRelated ? [selectionRelatedHost] : []));
    if (selectionRelated) void track(selectionRelated.show({ passage: structuredClone(anchor), limit: 3 }));
    placeItems();
    if (instantDefinition && options.instantHelp) void track((async () => {
      try {
        const settings = await options.instantHelp!.getSettings(signal);
        if (!alive() || signal.aborted || instantGeneration !== instantSelectionGeneration || !settings.enabled) return;
        await instantDefinition.show({ requestId: id(), pageKey: capture.url, sourceUrl: capture.url,
          sourceGeneration: `${capture.capturedAt}:${capture.extractionVersion}`, text: displayAnchor(anchor), action: settings.defaultAction });
      } catch { instantDefinition.clear(); }
    })());
  }
  function showSelection(anchor: QuoteAnchor) {
    if (!alive()) return;
    if (!anchor.exact.trim()) return;
    selected = structuredClone(anchor); lastOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    hold(sectionFor(anchor.start)); showPanel(); selectionCard.hidden = false;
    const different = (current: QuoteAnchor) => canonicalReplyData(current) !== canonicalReplyData(anchor);
    const target = questionDraft && !questionSaving && !questionArea.hidden && different(questionDraft.anchor) ? 'question'
      : draft && !draft.mutation && !saving && different(draft.anchor) ? 'note'
      : questionDraft && !questionSaving && different(questionDraft.anchor) ? 'question' : undefined;
    if (target) {
      ++instantSelectionGeneration; instantDefinition?.clear();
      replacementSelection = { anchor: structuredClone(anchor), target };
      selectionCard.replaceChildren(el('p', 'Attach to the new passage?'), actions(
        button('Keep', () => {
          if (!replacementSelection) return;
          const kept = replacementSelection.target, passage = structuredClone(replacementSelection.anchor);
          renderSelectionActions(passage);
          announce(`${kept === 'note' ? 'Note' : 'Question'} kept on its original passage. Nothing sent.`);
        }),
        button('Switch', () => { void safely(switchDraftAttachment); }),
      ));
      placeItems(); announce('Attach to the new passage? Nothing sent.'); return;
    }
    renderSelectionActions(anchor); announce('Selection in the margin. Nothing sent.');
  }
  async function highlightSelection(anchor: QuoteAnchor) {
    await safely(async () => {
      let thread = orderedThreads(threadsNow(), capture).find(t => t.anchor.start === anchor.start && t.anchor.exact === anchor.exact);
      if (!thread) {
        const threadId = id();
        await change({ id: id(), kind: 'keep', threadId, capture, anchor });
        thread = currentThread(threadId);
      }
      if (!thread) throw new Error('The saved passage is unavailable.');
      await change({ id: id(), kind: 'highlight', threadId: thread.id, highlighted: true, expectedRevision: thread.revision });
      announce('Passage highlighted on this device.');
    });
  }
  async function switchDraftAttachment() {
    if (!replacementSelection || !alive()) return;
    const choice = structuredClone(replacementSelection), position = displayPosition(choice.anchor, capture) ?? readingPosition;
    closeSelection();
    if (choice.target === 'note') {
      if (!draft || draft.mutation || saving) return;
      const switched: Draft = { anchor: structuredClone(choice.anchor), source: structuredClone(capture), position, text: draft.text };
      draft = switched; pendingNoteMutation = undefined; pendingNoteCommitted = false; editorGeneration++;
      renderCompose(true);
      try {
        await draftBuffer.save(switched); draftAttachmentSaveFailed = false; renderCompose(true);
        announce('Note switched to the new passage. Nothing sent.');
      } catch (error) {
        draftAttachmentSaveFailed = true; draftSaveFailed = true; renderCompose(true); fail(error);
      }
      return;
    }
    if (!questionDraft || questionSaving) return;
    const request = ++questionRequest, generation = draftGeneration;
    askingMount?.destroy(); askingMount = undefined;
    const switched = replaceQuestionExposure(structuredClone(questionDraft));
    switched.capture = structuredClone(capture); switched.anchor = structuredClone(choice.anchor);
    delete switched.threadId; delete switched.sourceVersionId; delete switched.answeredNote; delete switched.keepMutation;
    delete switched.resumeJobId; delete switched.resumeReplyId;
    questionSaving = true;
    try {
      await saveQuestion(switched);
      if (!alive() || request !== questionRequest || generation !== draftGeneration || questionArea.hidden) return;
      showQuestion(questionDraft!);
      announce('Question switched to the new passage. Nothing sent.');
    } catch (error) {
      if (!alive() || request !== questionRequest || generation !== draftGeneration || questionArea.hidden) return;
      showQuestion(questionDraft!); fail(error);
    } finally { questionSaving = false; }
  }
  function closeSelection() { if (!alive()) return; ++instantSelectionGeneration; instantDefinition?.clear(); selectionRelated?.clear(); replacementSelection = undefined; selectionCard.hidden = true; selectionCard.replaceChildren(); selected = undefined; placeItems(); if (lastOpener?.isConnected) lastOpener.focus(); }
  selectionCard.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); if (questionArea.contains(event.target as Node)) closeQuestion(); else closeSelection(); }
    if (replacementSelection) return;
    const offerIndex = ['1', '2', '3'].indexOf(event.key);
    if (offerIndex >= 0 && draftMount && !questionArea.hidden) { event.preventDefault(); draftMount.chooseIndex(offerIndex); }
    if (selected && event.key.toLowerCase() === 'k') { event.preventDefault(); void keep(selected); }
    if (selected && event.key.toLowerCase() === 'p') { event.preventDefault(); void keep(selected, true); }
    if (selected && event.key === '/') { event.preventDefault(); if (draftMount) draftMount.focus(); else ask(selected); }
  });
  let questionRequest = 0, questionSaving = false;
  function saveQuestion(value: QuestionDraft) {
    questionDraft = structuredClone(value);
    return track(questionBuffer.save(questionDraft)).then(value => {
      if (!questionBuffer.unsaved()) questionAttachmentSaveFailed = false;
      return value;
    }, error => { questionAttachmentSaveFailed = true; throw error; });
  }
  type Offer = { intent: string; label: string };
  type Observation = { exposureId: string; policyVersion: string; contextHash: string; eligible: string[]; eligibility: 'unknown'; candidates: string[];
    shown: { intent: string; label: string; position: number }[]; shownAt: string; resolvedAt: string | null;
    choice: string | null; resolution: SuggestionExposureResolution | null; latencyMs: number | null; eventualOutcome: string };
  let activeSuggestionExposure: { id: string; shownAt: number; ready: Promise<void>; resolving: boolean; record: Observation; offers: ReturnType<typeof suggestionOffer>[] } | undefined;
  async function suggestionContextHash(value: AskingSelection): Promise<string> {
    const context = JSON.stringify({ source: [value.capture.url, value.capture.capturedAt, value.capture.extractionVersion],
      anchor: [value.anchor.kind ?? 'quote', value.anchor.start, value.anchor.end], threadId: value.threadId ?? null,
      sourceVersionId: value.sourceVersionId ?? null, answeredNote: value.answeredNote ? [value.answeredNote.noteId, value.answeredNote.revision] : null });
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context)));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function beginSuggestionExposure(value: AskingSelection, offers: readonly Offer[], candidates: readonly ReturnType<typeof suggestionOffer>[]) {
    if (activeSuggestionExposure || questionArea.hidden || suspended) return;
    const exposureId = id(), shownAt = Date.now();
    questionDraft = { ...questionDraft!, suggestionExposureId: exposureId };
    // The v1 validator requires shown to be a subset of verified eligibility. Until
    // capability facts arrive, retain an honest observation alongside that store.
    const record: Observation = { exposureId, policyVersion: SUGGESTION_POLICY_VERSION, contextHash: '', eligible: [], eligibility: 'unknown',
      candidates: candidates.map(offer => offer.intent), shown: offers.map((offer, index) => ({ ...offer, position: index + 1 })),
      shownAt: new Date(shownAt).toISOString(), resolvedAt: null, choice: null, resolution: null, latencyMs: null, eventualOutcome: 'unknown' };
    record.shown = record.shown.map(({ intent, label, position }) => ({ intent, label, position }));
    const ready = (async () => {
      record.contextHash = await suggestionContextHash(value);
      if (options.suggestionEligibility) await persistence.suggestions.record(suggestionScope, { exposureId, policyVersion: SUGGESTION_POLICY_VERSION, contextHash: record.contextHash,
        eligible: [...options.suggestionEligibility], shown: record.shown, shownAt: record.shownAt, resolvedAt: null, choice: null, resolution: null, latencyMs: null, eventualOutcome: 'unknown' });
      else await persistence.write('suggestion-observation:' + suggestionScope + ':' + exposureId, record);
      if (questionDraft?.suggestionExposureId === exposureId) await saveQuestion(questionDraft).catch(fail);
    })();
    activeSuggestionExposure = { id: exposureId, shownAt, ready, resolving: false, record, offers: [...candidates] };
    void track(ready).catch(fail);
  }
  function revealSuggestionExposure(offers: readonly Offer[]) {
    const active = activeSuggestionExposure; if (!active || active.resolving) return;
    void track(active.ready.then(async () => {
      active.record.shown = offers.map(({ intent, label }, index) => ({ intent, label, position: index + 1 }));
      if (options.suggestionEligibility) await persistence.suggestions.reveal(suggestionScope, active.id, active.record.shown);
      else await persistence.write('suggestion-observation:' + suggestionScope + ':' + active.id, active.record);
    })).catch(fail);
  }
  function resolveSuggestionExposure(resolution: SuggestionExposureResolution, choice: string | null = null) {
    const active = activeSuggestionExposure; if (!active || active.resolving) return;
    active.resolving = true; const now = Date.now();
    void track(active.ready.then(async () => {
      Object.assign(active.record, { resolution, choice, resolvedAt: new Date(now).toISOString(), latencyMs: Math.max(0, now - active.shownAt) });
      if (options.suggestionEligibility) await persistence.suggestions.resolve(suggestionScope, active.id, resolution, choice, active.record.resolvedAt!, active.record.latencyMs);
      else await persistence.write('suggestion-observation:' + suggestionScope + ':' + active.id, active.record);
    })).catch(fail);
  }
  /** E23 Switch hook: call before saving/rendering the new question attachment.
   * Keep must not call this. A chosen A keeps its terminal choice; an unchosen A
   * resolves as replaced. showQuestion(B) then creates B's independent exposure. */
  function replaceQuestionExposure<T extends AskingSelection>(next: T): T {
    resolveSuggestionExposure('replaced'); activeSuggestionExposure = undefined;
    const replacement = { ...next } as T & { suggestionExposureId?: string };
    delete replacement.suggestionExposureId;
    return replacement;
  }
  function ask(anchor: QuoteAnchor, thread?: Thread, answeredNote?: { noteId: string; text: string; revision: number }, resumeReplyId?: string) {
    if (!alive()) return;
    if (!hydrationFinished) { announce('Restoring saved work. No question was sent.'); return; }
    if (questionSaving) { announce('The question draft is being preserved. Its text remains here.'); return; }
    // Closing hides a draft; it is not permission to overwrite the reader's text.
    if (questionDraft) {
      if (questionArea.hidden) { void track(archiveQuestion().then(() => ask(anchor, thread, answeredNote, resumeReplyId))); return; }
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
    if (!existing && questionDraft) { questionDraft.intent = intent; questionDraft.question = question; void saveQuestion(questionDraft).catch(fail); }
  }
  let draftGeneration = 0;
  let draftMount: ReturnType<typeof mountAskingDraft> | undefined;
  const suggestionSessionKey = 'marginalia-suggestion-session:' + suggestionScope;
  let suggestionSessionStart = Date.now();
  try { const saved = Number(sessionStorage.getItem(suggestionSessionKey)); if (saved > 0) suggestionSessionStart = saved; else sessionStorage.setItem(suggestionSessionKey, String(suggestionSessionStart)); } catch { /* This mount still has a bounded session. */ }
  async function rankedOffers(value: AskingSelection) {
    const records = [];
    let after: string | undefined;
    do { const page = await persistence.suggestions.list(suggestionScope, after); records.push(...page); after = page.length === 64 ? 'suggestion-exposure:' + suggestionScope + ':' + page.at(-1)!.exposureId : undefined; } while (after);
    const observations = await persistence.values<{ resolution: string | null; shown: { intent: Intent }[]; shownAt: string }>('suggestion-observation:' + suggestionScope + ':');
    const dismissed = [...records, ...observations].filter(record => record.resolution === 'dismissed' && Date.parse(record.shownAt) >= suggestionSessionStart)
      .flatMap(record => record.shown.slice(0, 1).map(item => item.intent as Intent));
    const position = displayPosition(value.anchor, capture);
    const nearby = threadsNow().filter(thread => !thread.deletedAt && thread.sourceUrl === value.capture.url &&
      (value.anchor.kind === 'whole-page' || (() => {
        const start = displayPosition(thread.anchor, capture);
        return position !== null && start !== null && position !== undefined && start !== undefined &&
          sectionFor(start) === sectionFor(position);
      })()));
    const replies = (await Promise.all(nearby.map(thread => persistence.replies.list(thread.id)))).flat();
    const usefulNearby = replies.filter(record => !replyIsRemoved(record) && record.source.text === value.capture.text)
      .flatMap(record => record.version.reply.intent ? [record.version.reply.intent] : []);
    return rankEligibleSuggestions({ block: suggestionBlock(value.anchor.exact, value.anchor.kind === 'whole-page'),
      page: suggestionPage(value.capture.pageType), posture: readingPosture, usefulNearby, dismissed,
      note: [value.answeredNote?.text, value.question, value.context].filter(Boolean).join('\n') }, options.suggestionEligibility ?? (denied ? [] : SUGGESTION_ORDER)).map(item => suggestionOffer(item.intent));
  }
  function showQuestion(value: AskingSelection) {
    questionDraft = structuredClone(value); questionArea.hidden = false; askingHost.hidden = true; questionForm.hidden = false;
    askingMount?.setVisible(false); showPanel(); hold(sectionFor(displayPosition(value.anchor, capture) ?? readingPosition));
    draftMount?.destroy();
    const message = el('p', undefined, 'm-meta'), reviewButton = button('Ask', () => {});
    questionForm.replaceChildren(message);
    const current = questionDraft, generation = ++draftGeneration;
    message.textContent = 'Preparing ideas.';
    void track((activeSuggestionExposure ? Promise.resolve(activeSuggestionExposure.offers) : rankedOffers(current)).then(offers => {
      if (!alive() || generation !== draftGeneration || questionDraft?.anchor.exact !== current.anchor.exact || questionArea.hidden) return;
      beginSuggestionExposure(current, offers.slice(0, 3), offers);
      draftMount = mountAskingDraft(questionForm, { id: 'm-ask-' + draftKey.replace(/[^a-z0-9]/gi, '-'),
        question: current.question, context: current.context, suggestions: offers,
        moreAction: selected && canonicalReplyData(selected) === canonicalReplyData(current.anchor) ? selectionCard.querySelector<HTMLButtonElement>('.m-selection-more button') ?? undefined : undefined,
        onEdit: (question, context) => { if (questionDraft) { questionDraft.question = question; questionDraft.context = context; void saveQuestion(questionDraft).catch(fail); } },
        readerSkills: () => trustedHelper().readerSkills(),
        onChoose: (intent, question, context, readerSkill?: ReaderSkillSelection) => track((async () => {
          const chosen = questionDraft, chosenMount = draftMount, request = questionRequest, generation = draftGeneration;
          if (!chosen || !chosenMount) return;
          chosenMount.message.textContent = 'Preparing request.';
          resolveSuggestionExposure('chosen', intent);
          const next = { ...chosen, intent, question, context };
          if (readerSkill) next.readerSkill = readerSkill; else delete next.readerSkill;
          await saveQuestion(next);
          if (!alive() || request !== questionRequest || generation !== draftGeneration || questionArea.hidden || draftMount !== chosenMount) return;
          await openQuestionWithHelper(chosenMount.message, chosenMount.submit);
        })()),
        onMore: () => { revealSuggestionExposure(offers); },
        onIdeas: () => track((async () => {
          const draft = questionDraft, request = questionRequest, generation = draftGeneration;
          if (!draft) return offers;
          draftMount!.message.textContent = 'Preparing ideas.';
          resolveSuggestionExposure('replaced'); activeSuggestionExposure = undefined;
          offers = await rankedOffers(draft);
          if (!alive() || request !== questionRequest || generation !== draftGeneration || questionArea.hidden || questionDraft !== draft) return offers;
          beginSuggestionExposure(draft, offers.slice(0, 3), offers); return offers;
        })()),
        onClose: () => closeQuestion(), onKeep: () => { void keep(current.anchor); }, onPark: () => { void keep(current.anchor, true); },
      });
      draftMount.message.className = 'm-meta';
      const quote = el('blockquote', current.anchor.kind === 'whole-page' ? 'Whole page' : current.anchor.exact);
      quote.hidden = !!selected && canonicalReplyData(selected) === canonicalReplyData(current.anchor);
      questionForm.prepend(quote);
      if (current.answeredNote) questionForm.prepend(el('p', current.answeredNote.text, 'm-note'));
      if (questionAttachmentSaveFailed) draftMount.message.textContent = 'This question attachment is not saved yet. Retry saving in Settings; your text is retained.';
      placeItems();
    })).catch(fail);
    placeItems();
    return { message, reviewButton };
  }
  function closeQuestion(resolution: SuggestionExposureResolution = 'dismissed') {
    if (!alive()) return;
    resolveSuggestionExposure(resolution); activeSuggestionExposure = undefined;
    ++questionRequest; ++draftGeneration; questionArea.hidden = true; draftMount?.destroy(); draftMount = undefined; askingMount?.destroy(); askingMount = undefined;
    if (lastOpener?.isConnected) lastOpener.focus({ preventScroll: true }); else readingTitle.focus({ preventScroll: true });
  }
  function archiveQuestion() {
    return safely(async () => {
      if (!questionDraft || questionSaving) return;
      questionSaving = true;
      try {
        closeQuestion('replaced'); // Snapshot the peer before preserving and clearing this draft.
        const retained = structuredClone(questionDraft);
        await persistence.write('question-history:' + draftKey + ':' + id(), retained); earlierDrafts.hidden = false;
        await questionBuffer.save(undefined); questionDraft = undefined;
        announce('Question draft retained in history and export. Choose a passage or note for another question.');
      } finally { questionSaving = false; }
    });
  }
  const earlierDrafts = button('Earlier question drafts', () => safely(async () => {
    const retained = await persistence.values<AskingSelection>('question-history:' + draftKey + ':');
    if (!alive()) return;
    const history = el('details'); history.open = true; history.append(el('summary', 'Earlier question drafts'));
    for (const saved of retained) {
      if (!saved || saved.capture?.url !== capture.url) continue;
      history.append(button(excerpt(saved.question || saved.anchor.exact || 'Whole-page question'), () => {
        void safely(async () => { if (questionDraft) await archiveQuestion(); await saveQuestion(saved); showQuestion(saved); });
      }));
    }
    if (!retained.length) history.append(el('p', 'No earlier question drafts saved on this device.', 'm-meta'));
    footerSlots.history.querySelector('.m-question-history')?.remove(); history.className = 'm-question-history'; footerSlots.history.append(history);
  }));
  earlierDrafts.hidden = true; footerSlots.history.append(earlierDrafts);
  void persistence.values('question-history:' + draftKey + ':').then(saved => { earlierDrafts.hidden = !saved.length; });
  function renderRetainedRequests() {
    footerSlots.requests.querySelector('.m-saved-requests')?.remove();
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
    footerSlots.requests.append(section);
  }
  async function openQuestionWithHelper(message: HTMLElement, button: HTMLButtonElement) {
    if (!questionDraft || questionSaving || !alive()) return;
    const request = ++questionRequest; questionSaving = true; button.disabled = true;
    message.textContent = 'Preparing request.';
    try {
      if (denied) throw new Error('Question previews are blocked on this device for this site. Change that preference in Settings.');
      const selected = structuredClone(questionDraft);
      if (!selected.threadId) {
        selected.keepMutation ??= { id: id(), kind: 'keep', threadId: id(), capture: selected.capture, anchor: selected.anchor };
        await saveQuestion(selected); await change(selected.keepMutation);
        selected.threadId = selected.keepMutation.threadId; await saveQuestion(selected);
      }
      if (journal.unsaved || journal.state.pending.some(m => m.threadId === selected.threadId)) await sync();
      const thread = currentThread(selected.threadId);
      if (!thread || !thread.sourceVersionId || thread.deletedAt) throw new Error('This passage could not be saved for review. Your question is retained.');
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
        onClosed: () => { if (alive()) { askingHost.hidden = true; questionForm.hidden = false; draftMount?.setVisible(true); draftMount?.focus(); } },
        highlight: (binding, original) => highlight(binding ? bindingAnchor(binding, original) ?? null : null),
        returnToSource: anchor => { if (alive()) sourceAction(anchor); },
        navigate: (binding, original) => { const anchor = bindingAnchor(binding, original); if (anchor) sourceAction(anchor); else announce('This original source passage is uncertain on the current page; no navigation was attempted.'); },
        prepareReplyView: async (threadId, replyId) => {
          for (const [key, entry] of replyMounts) if (entry.threadId === threadId && entry.node.dataset.replyVersion === replyId) { await entry.flush(); entry.close(); entry.node.remove(); replyMounts.delete(key); }
        },
        activity: updateActivity,
        onState: updateActivity,
      onCommitted: threadId => { if (alive()) { changed(); announce('A validated reply is available. Your notes remain above it.'); } },
      openSettings,
      });
      draftMount?.setVisible(false); questionForm.hidden = true; askingMount.setVisible(!suspended && !questionArea.hidden);
      const opening = askingMount;
      activityJobId = selected.resumeJobId;
      await opening.open(selected);
      if (!alive() || request !== questionRequest) opening.setVisible(false);
    } catch (error) {
      if (alive() && request === questionRequest) { askingMount?.setVisible(false); questionForm.hidden = false; draftMount?.setVisible(true); message.textContent = error instanceof Error ? error.message : 'The review could not be opened. The draft is retained; request outcome is unconfirmed.'; }
    } finally { questionSaving = false; button.disabled = false; }
  }

  function renderThreads() {
    if (!alive()) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active?.dataset.focusKey;
    const focusedThreadId = active?.closest<HTMLElement>('[data-thread]')?.dataset.thread;
    if (focusKey && focusedThreadId) expanded.add(focusedThreadId);
    const threads = orderedThreads(threadsNow(), capture);
    for (const [key, entry] of threadNodes) if (!threads.some(t => t.id === key)) { closeReplies(key); threadRelated.get(key)?.destroy(); threadRelated.delete(key); replyLoads.set(key, (replyLoads.get(key) ?? 0) + 1); entry.node.remove(); threadNodes.delete(key); }
    const empty = threadList.querySelector('.m-empty'); empty?.remove();
    if (!threads.length) threadList.append(el('p', 'Keep a passage or write a note.', 'm-empty'));
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
      if (expanded.has(thread.id)) showThreadRelated(thread);
      // placeItems maintains source order without rebuilding reply/editor subtrees.
    });
    for (const [threadId, dot] of railThreadNodes) if (!threads.some(thread => thread.id === threadId)) { dot.remove(); railThreadNodes.delete(threadId); }
    threads.forEach(thread => {
      const label = thread.notes.find(note => !note.deletedAt)?.text ?? thread.anchor.exact;
      let dot = railThreadNodes.get(thread.id);
      if (!dot) {
        dot = button('', () => { void safely(() => openSavedThread(thread.id, dot)); });
        dot.className = 'm-rail-thread'; railThreadNodes.set(thread.id, dot);
      }
      dot.setAttribute('aria-label', 'Open saved thread: ' + excerpt(label, 66));
      dot.title = 'Saved work: ' + excerpt(label, 66);
      railThreads.append(dot);
    });
    pageActions.hidden = !threads.length;
    footerCount.textContent = threads.length ? `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'} on this page` : '';
    renderPosition(); paintHighlights();
    if (active?.isConnected && focusedThreadId && threadList.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    if (focusKey && active && !active.isConnected) {
      const replacement = Array.from(threadList.querySelectorAll<HTMLElement>('[data-focus-key]')).find(node => node.dataset.focusKey === focusKey);
      (replacement ?? writeButton).focus();
    }
  }
  async function openSavedThread(threadId: string, opener?: HTMLElement) {
    await locked(() => journal.load());
    const thread = currentThread(threadId);
    if (!thread || thread.deletedAt || thread.sourceUrl !== capture.url) throw new Error('The current thread is unavailable; local work is unchanged.');
    expandAdditionally(threadId); renderThreads(); hold(sectionFor(displayPosition(thread.anchor, capture) ?? 0));
    showPanel(true, opener);
    threadNodes.get(threadId)?.node.querySelector<HTMLElement>('.m-source-action')?.focus({ preventScroll: true });
  }
  function renderThread(thread: Thread) {
    const node = el('section', undefined, 'm-thread'); node.id = instance + '-' + thread.id; node.dataset.thread = thread.id;
    const location = sourceLocation(thread, capture);
    const currentSection = () => { const current = currentThread(thread.id); return current ? sectionFor(displayPosition(current.anchor, capture) ?? readingPosition) : sectionIndex; };
    const preview = button(excerpt(thread.notes.find(n => !n.deletedAt)?.text ?? thread.anchor.exact), () => { expandOnly(thread.id); showThreadRelated(thread); hold(currentSection()); renderPosition(); requestAnimationFrame(() => { if (alive()) threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); }); }); preview.setAttribute('aria-label', 'Open thread: ' + (thread.notes.find(note => !note.deletedAt)?.text ?? thread.anchor.exact)); preview.className = 'm-excerpt'; preview.dataset.focusKey = thread.id + ':excerpt';
    const body = el('div', undefined, 'm-thread-content');
    const sourceText = thread.anchor.kind === 'whole-page' ? 'Whole page' : `“${excerpt(displayAnchor(thread.anchor))}”`;
    const sourceButton = button(sourceText, () => sourceAction(thread.anchor)); sourceButton.className = 'm-source-action'; sourceButton.setAttribute('aria-label', 'Source passage: ' + sourceText); sourceButton.dataset.focusKey = thread.id + ':source';
    sourceButton.addEventListener('mouseenter', () => highlight(thread.anchor)); sourceButton.addEventListener('mouseleave', () => highlight(null));
    sourceButton.addEventListener('focus', () => highlight(thread.anchor)); sourceButton.addEventListener('blur', () => highlight(null));
    body.append(sourceButton);
    if (location.state === 'moved' || location.state === 'lost' || location.state === 'unsure') {
      const marker = el('div', undefined, 'm-reader-note');
      marker.append(el('p', 'You were here', 'm-meta'));
      const attachmentCopy = location.state === 'moved'
        ? hasAttachmentObservation(thread.id) ? 'This passage moved. This attachment is saved; the original quotation is still here.' : 'This passage moved. The original quotation is still here.'
        : location.state === 'unsure'
          ? 'More than one passage could match. The original quotation is still here.'
          : 'This passage could not be found. The original quotation is still here.';
      const message = el('p', attachmentMessages.get(thread.id) ?? attachmentCopy, 'm-meta m-attachment-status');
      message.setAttribute('role', 'status');
      const observed = hasAttachmentObservation(thread.id);
      const look = actionButton(thread.id + ':reattach', location.state === 'moved' ? 'Remember this attachment' : 'Look again', () => {
        if (!alive() || attachmentPending.has(thread.id) || hasAttachmentObservation(thread.id)) return;
        attachmentPending.add(thread.id); look.disabled = true;
        const show = (text: string) => {
          if (!alive()) return;
          attachmentMessages.set(thread.id, text);
          const current = threadNodes.get(thread.id)?.node.querySelector('.m-attachment-status');
          if (alive() && current) current.textContent = text;
        };
        show('Looking for this passage…');
        void track((async () => {
          try {
            if (!options.captureCurrentPage) throw new Error('Reopen this page in the browser margin to look again.');
            const client = await replyClient(thread.id), epoch = client.connectionVersion;
            const page = structuredClone(await options.captureCurrentPage());
            if (page.capture.url !== capture.url || !page.tabCapture) throw new Error('The page changed. Reopen its margin to look again.');
            if (await replyClient(thread.id) !== client || client.connectionVersion !== epoch) throw new Error('The helper connection changed.');
            const operation = attachmentGeneration;
            const assertCurrent = () => {
              if (!alive() || signal.aborted || operation !== attachmentGeneration || helper !== client || client.connectionVersion !== epoch) throw new Error('The attachment response belongs to an earlier source or helper connection. Try looking again.');
            };
            assertCurrent();
            const result = await client.reattach({ threadId: thread.id, text: page.capture.text, tabCapture: page.tabCapture, capture: page.capture }, signal);
            if (!alive() || operation !== attachmentGeneration || result.threadId !== thread.id || result.sourceGeneration !== page.tabCapture || result.sourceUrl !== page.capture.url) throw new Error('The attachment response belongs to an earlier source. Try looking again.');
            const textHash = await attachmentTextHash(page.capture.text);
            const observation: StoredAttachmentObservation = { threadId: thread.id, sourceUrl: page.capture.url, textHash, sourceGeneration: page.tabCapture, state: result.state, candidates: result.candidates };
            assertCurrent();
            await persistence.write(attachmentObservationKey(thread.id, textHash), observation);
            assertCurrent();
            attachmentObservations.add(attachmentObservationKey(thread.id, textHash));
            attachmentObservedThisMount.add(thread.id);
            if (result.state === 'exact' || result.state === 'moved') show('Found again. Your note is still here.');
            else if (result.state === 'lost' || result.state === 'unsure') show('Still not here. Your note is still here.');
            else throw new Error('The result could not be confirmed. Try looking again.');
            const current = threadNodes.get(thread.id)?.node.querySelector<HTMLButtonElement>('.m-reattach-action');
            if (current === document.activeElement) threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus();
            current?.remove();
          } catch (error) { show(error instanceof Error ? error.message : 'Could not look again. Your note is still here.'); }
          finally {
            attachmentPending.delete(thread.id);
            const current = threadNodes.get(thread.id)?.node.querySelector<HTMLButtonElement>('.m-reattach-action');
            if (alive() && current) current.disabled = false;
          }
        })());
      });
      look.className = 'm-reattach-action'; look.disabled = attachmentPending.has(thread.id);
      marker.append(message); if (!observed) marker.append(look); body.append(marker);
    }
    for (const note of thread.notes.filter(note => !note.deletedAt)) {
      const edit = actionButton(thread.id + ':' + 'edit-note', 'Edit note', () => beginDraft(thread.anchor, thread, note.id)); edit.dataset.focusKey = thread.id + ':note:' + note.id;
      const remove = actionButton(thread.id + ':remove-note:' + note.id, 'Remove this note', () => safely(async () => {
        await change({ id: id(), kind: 'note-remove', threadId: thread.id, noteId: note.id, removed: true, expectedRevision: note.revision });
        toast.hidden = false; const undo = actionButton(thread.id + ':' + 'undo', 'Undo', () => safely(async () => {
          const current = currentThread(thread.id)!, removed = current.notes.find(item => item.id === note.id)!;
          await change({ id: id(), kind: 'note-remove', threadId: thread.id, noteId: note.id, removed: false, expectedRevision: removed.revision });
          toast.hidden = true; threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); announce('Note restored.');
        }));
        toast.replaceChildren(el('span', 'Note removed.'), undo); undo.focus();
      }));
      const noteBlock = el('div', undefined, 'm-reader-note'); noteBlock.append(el('p', note.text, 'm-note'), edit, actionButton(thread.id + ':ask-note:' + note.id, 'Ask about this note', () => ask(thread.anchor, currentThread(thread.id), { noteId: note.id, revision: note.revision, text: note.text })), remove); body.append(noteBlock);
    }
    const state = el('select'); state.dataset.focusKey = thread.id + ':state'; state.setAttribute('aria-label', 'Thread state');
    for (const value of ['open', 'parked', 'done', 'archived'] as const) { const option = el('option', value === 'parked' ? 'Read later' : value[0].toUpperCase() + value.slice(1)); option.value = value; state.append(option); } state.value = thread.state;
    state.addEventListener('change', () => void safely(async () => { await change({ id: id(), kind: 'thread-state', threadId: thread.id, expectedRevision: thread.revision, state: state.value as Thread['state'] }); announce('Thread ' + (state.value === 'parked' ? 'saved for later' : state.value) + '.'); threadNodes.get(thread.id)?.node.querySelector('select')?.focus(); }));
    const highlightToggle = actionButton(thread.id + ':highlight', thread.highlighted ? 'Remove highlight' : 'Highlight', () => safely(async () => {
      const current = currentThread(thread.id);
      if (!current) throw new Error('The saved passage is unavailable.');
      await change({ id: id(), kind: 'highlight', threadId: current.id, highlighted: !current.highlighted, expectedRevision: current.revision });
      announce(current.highlighted ? 'Highlight removed. The kept passage and thread remain.' : 'Passage highlighted on this device.');
    }));
    if (thread.anchor.kind === 'whole-page') highlightToggle.disabled = true;
    const colourPicker = el('div', undefined, 'm-highlight-colours'); colourPicker.setAttribute('role', 'group'); colourPicker.setAttribute('aria-label', 'Highlight colour');
    if (thread.highlighted) for (const colour of HIGHLIGHT_COLOURS) {
      const swatch = actionButton(thread.id + ':highlight-colour:' + colour, '', () => safely(async () => {
        const current = currentThread(thread.id);
        if (!current) throw new Error('The saved passage is unavailable.');
        await change({ id: id(), kind: 'highlight', threadId: current.id, highlighted: true, highlightColour: colour, expectedRevision: current.revision });
        announce(`${colour[0].toUpperCase() + colour.slice(1)} highlight selected.`);
      }));
      swatch.className = 'm-highlight-swatch'; swatch.dataset.highlightColour = colour;
      swatch.setAttribute('aria-label', colour[0].toUpperCase() + colour.slice(1));
      swatch.setAttribute('aria-pressed', String(highlightColour(thread.highlightColour) === colour));
      colourPicker.append(swatch);
    }
    body.append(actions(actionButton(thread.id + ':' + 'add-note', 'Add note', () => beginDraft(thread.anchor, thread)), highlightToggle, ...(thread.highlighted ? [colourPicker] : []), actionButton(thread.id + ':' + 'ask', 'Ask', () => ask(thread.anchor, thread)), state, actionButton(thread.id + ':' + 'remove', 'Remove', () => safely(async () => {
      await change({ id: id(), kind: 'remove', threadId: thread.id, removed: true, expectedRevision: thread.revision });
      toast.hidden = false; const undo = actionButton(thread.id + ':' + 'undo', 'Undo', () => safely(async () => { const current = journal.state.threads.find(t => t.id === thread.id)!; await change({ id: id(), kind: 'remove', threadId: thread.id, removed: false, expectedRevision: current.revision }); toast.hidden = true; threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); announce('Thread restored.'); }));
      toast.replaceChildren(el('span', 'Thread removed.'), undo); undo.focus();
    }))));
    if (!journal.state.threads.some(item => item.id === thread.id)) {
      for (const control of Array.from(body.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button:not(.m-source-action):not(.m-reattach-action),select'))) control.disabled = true;
      body.append(el('p', 'Saved helper snapshot. Local work is not replaced; explicitly synchronize before editing or asking.', 'm-meta'));
    }
    const replyArea = el('section', undefined, 'm-saved-replies'); replyArea.setAttribute('aria-label', 'Saved replies');
    const replyStatus = el('p', '', 'm-reply-status m-meta'); replyStatus.setAttribute('role', 'status');
    const replyList = el('div', undefined, 'm-reply-list');
    const syncButton = actionButton(thread.id + ':sync', 'Sync', () => safely(async () => {
      syncButton.disabled = true;
      try {
        const remote = options.allowHelper !== false && !!helper?.token;
        if (remote) await syncReplyRemovals(thread.id);
        await readReplies(thread.id, remote, true);
      } finally { if (alive()) syncButton.disabled = false; }
    }));
    const replyActions = el('details'); replyActions.append(el('summary', 'More'), actions(syncButton,
      actionButton(thread.id + ':export-saved-replies-and-views', 'Export saved replies and views', () => exportReplies(thread.id))));
    const relatedHost = el('div', undefined, 'm-related-slot');
    if (options.related && !threadRelated.has(thread.id)) threadRelated.set(thread.id, mountRelated(relatedHost, options.related));
    replyArea.append(replyStatus, replyList, replyActions, ...(options.related ? [relatedHost] : []));
    const bodyGroup = el('div', undefined, 'm-thread-body'); bodyGroup.append(body, replyArea); node.append(preview, bodyGroup);
    node.addEventListener('focusin', () => hold(currentSection()));
    return node;
  }

  function showThreadRelated(thread: Thread) {
    const related = threadRelated.get(thread.id);
    if (related) void track(related.show({ passage: structuredClone(thread.anchor), threadId: thread.id, sourceVersionId: thread.sourceVersionId, limit: 3 }));
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
  async function setReplyRemoval(record: CachedReply, removed: boolean) {
    const changed = await persistence.replies.setRemoved(record, removed);
    if (!alive()) return;
    await readReplies(record.version.threadId, false, true);
    announce(removed ? 'Reply removed from the margin. Its saved record is retained.' : 'Reply restored.');
    return changed;
  }
  function showReplyRemovalToast(record: CachedReply) {
    toast.hidden = false;
    const undo = button('Undo', () => safely(async () => {
      const latest = (await persistence.replies.list(record.version.threadId)).find(item => item.origin === record.origin && item.version.id === record.version.id);
      if (!latest) throw new Error('This saved reply is unavailable.');
      await setReplyRemoval(latest, false);
      toast.hidden = true;
      threadNodes.get(record.version.threadId)?.node.querySelector<HTMLElement>('.m-source-action')?.focus();
    }));
    toast.replaceChildren(el('span', 'Reply removed.'), undo); undo.focus();
  }
  async function syncReplyRemovals(threadId: string) {
    const client = await replyClient(threadId);
    const records = await persistence.replies.list(threadId);
    const changes = records.filter(record => record.removal && record.removal.status !== 'acknowledged');
    if (!changes.length) { announce('No reply changes are waiting to be saved to the helper.'); return; }
    let failure: unknown;
    try {
      for (const record of changes) {
        if (record.origin !== client.origin) throw new Error('Pair with the helper that owns this reply.');
        await persistence.replies.syncRemoval(record, async change => {
          const currentClient = await replyClient(threadId);
          if (currentClient !== client) throw new Error('The helper connection changed.');
          return client.setReplyRemoved(change);
        });
      }
    } catch (error) { failure = error; }
    if (alive()) await readReplies(threadId, false, true);
    if (failure) throw failure;
    announce('Reply changes were saved to the app on this device.');
  }
  async function readReplies(threadId: string, remote = false, reopen = false) {
    if (!alive()) return;
    const thread = currentThread(threadId); if (!thread || thread.deletedAt) return;
    const generation = (replyLoads.get(thread.id) ?? 0) + 1; replyLoads.set(thread.id, generation);
    const current = () => alive() && replyLoads.get(thread.id) === generation && !!threadNodes.get(thread.id);
    const area = () => threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-saved-replies');
    const message = (text: string) => { if (current()) { const node = area()?.querySelector('.m-reply-status'); if (node) node.textContent = text; } };
    try {
      if (remote) {
        message('Loading saved replies from the app on this device…');
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
      const visible = records.filter(record => !replyIsRemoved(record));
      const removed = records.filter(replyIsRemoved);
      let unavailable = 0;
      const identity = (record: CachedReply) => JSON.stringify([record.origin, record.version.threadId, record.version.id]);
      for (const [key, entry] of replyMounts) if (entry.threadId === thread.id && !visible.some(record => identity(record) === key)) { entry.close(); entry.node.remove(); replyMounts.delete(key); }
      for (const record of visible) {
        const key = identity(record);
        const warningText = (record.version.corrections ?? []).map(item =>
          `Review this work: reply “${item.ancestorTitle}” was corrected by a later reply. Saved notes and controls are preserved.`).join(' ');
        const existingMount = replyMounts.get(key);
        if (existingMount) {
          const warning = existingMount.node.querySelector<HTMLElement>('.m-reply-correction');
          if (warning) { warning.textContent = warningText; warning.hidden = !warningText; }
          continue;
        }
        const session = await persistence.replies.open(record);
        if (!current()) return;
        const saved = session.record;
        if (replyIsRemoved(saved)) continue;
        if (!validateReply(saved.version.reply, { sourceText: saved.source.text }).ok) { unavailable++; continue; }
        const wrapper = el('section', undefined, 'm-saved-reply'); wrapper.dataset.replyVersion = saved.version.id;
        wrapper.append(el('p', `Saved reply · ${readerDate(saved.version.createdAt)}${saved.version.parentId ? ' · follow-up' : ''}${saved.version.supersedes ? ' · revised version' : ''}`, 'm-meta'));
        const correctionWarning = el('p', warningText, 'm-reply-correction m-meta');
        correctionWarning.setAttribute('role', 'status'); correctionWarning.hidden = !warningText;
        wrapper.append(correctionWarning);
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
          hostReport: { ...(saved.reports?.[canonicalReplyData(saved.local.parameters)] ?? saved.report ?? saved.version.validation),
            evidence: saved.version.validation.evidence, explore: saved.version.validation.explore },
          onShelfOpen: options.allowHelper !== false && helper?.token && helper.origin === saved.origin ? async item => {
            if (closed || !current()) throw new Error('This saved reply has closed.');
            const client = await replyClient(thread.id);
            if (client.origin !== saved.origin) throw new Error('Pair with the helper that owns this reply.');
            const result = await client.openShelfItem(thread.id, saved.version.id, item);
            if (closed || !current() || client !== helper) throw new Error('The saved reply connection changed.');
            return result;
          } : undefined,
          onShelfReturn: origin => {
            if (closed || !current() || origin.threadId !== thread.id || origin.sourceVersionId !== saved.source.id) return;
            sourceAction(thread.anchor);
          },
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
            if (!closed && alive()) viewStatus.textContent = latest?.dirty ? 'An earlier saved view reached the helper. Newer inputs remain saved on this device; save again to send them.' : 'The saved view was sent to the app on this device.';
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
        controls.append(button('Remove reply', () => safely(async () => {
          if (closed) return;
          await flush();
          if (closed || !alive()) return;
          await persistence.replies.setRemoved(saved, true);
          if (!alive()) return;
          showReplyRemovalToast(saved);
          await readReplies(thread.id, false, true);
        })));
        wrapper.append(viewStatus, controls);
        if (!solverRecompute) wrapper.append(el('p', options.allowHelper === false
          ? 'This example cannot run again here yet. Your notes and current inputs are unchanged.'
          : 'Permission is needed before this example can run again. Your notes and current inputs are unchanged.', 'm-meta'));
        area()?.querySelector('.m-reply-list')?.append(wrapper);
      }
      area()?.querySelector('.m-removed-replies')?.remove();
      if (removed.length) {
        const history = el('details', undefined, 'm-removed-replies');
        history.append(el('summary', `Removed replies (${removed.length})`));
        for (const record of removed) {
          const item = el('div', undefined, 'm-removed-reply');
          item.append(el('p', `${record.version.reply.title ?? 'Saved reply'} · ${readerDate(record.version.createdAt)}`, 'm-meta'));
          if (record.removal?.status === 'conflict') item.append(el('p', 'This reply changed elsewhere. Your choice is kept here.', 'm-meta'));
          item.append(button('Undo', () => safely(async () => { await setReplyRemoval(record, false); toast.hidden = true; })));
          history.append(item);
        }
        area()?.append(history);
      }
      message(persistence.replies.unsaved(thread.id).length ? 'Some view inputs are still only in memory after a failed save. Export them before closing this page.' : unavailable ? `${unavailable} saved ${unavailable === 1 ? 'reply could' : 'replies could'} not be safely displayed. Original records remain available in the export.` : removed.some(record => record.removal?.status === 'conflict') ? 'This reply changed elsewhere. Your choice is kept here.' : visible.some(record => record.conflict) ? 'The helper has a different view. Local controls are preserved; use the helper view explicitly to replace them.' : visible.some(record => record.recovered?.length) ? 'Saved replies are available. Earlier view inputs are preserved in the recovery export.' : visible.length ? `${visible.length} saved ${visible.length === 1 ? 'reply' : 'replies'}. Notes stay above replies.${removed.length ? ` ${removed.length} removed ${removed.length === 1 ? 'reply is' : 'replies are'} retained in history.` : ''}` : removed.length ? `${removed.length} removed ${removed.length === 1 ? 'reply is' : 'replies are'} retained in history.` : 'No saved replies on this device.');
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
    options.onSavedMarks?.(orderedThreads(threadsNow(), capture).filter(thread => thread.anchor.kind !== 'whole-page').map(thread => ({ anchor: structuredClone(thread.anchor), highlighted: thread.highlighted, ...(thread.highlightColour !== undefined ? { highlightColour: thread.highlightColour } : {}) })));
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (highlights && HighlightClass) {
      const threads = orderedThreads(threadsNow(), capture);
      highlights.set('marginalia-kept', new HighlightClass(...threads.map(t => sourceRange(t.anchor)).filter((r): r is Range => !!r)));
      highlights.delete('marginalia-highlighted');
      for (const colour of HIGHLIGHT_COLOURS) highlights.set('marginalia-highlighted-' + colour, new HighlightClass(...threads.filter(t => t.highlighted && highlightColour(t.highlightColour) === colour).map(t => sourceRange(t.anchor)).filter((r): r is Range => !!r)));
    }
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
  function updateReading(event?: Event) {
    if (held || suspended || !source) return;
    if (event?.type === 'scroll') beginReading();
    const blocks = Array.from(source.querySelectorAll<HTMLElement>('[data-reading-section]'));
    const index = blocks.reduce((chosen, node, i) => node.getBoundingClientRect().top <= innerHeight * .4 ? i : chosen, 0);
    sectionIndex = Math.min(index, sections.length - 1); readingPosition = sections[sectionIndex].start;
    if (resumePosition !== undefined && readingPosition > resumePosition) dismissResumeLine();
    else if (resumeAnchor) {
      // Section starts cannot tell whether a mid-section anchor has passed.
      // Measure its first character; a long quote may extend below the viewport.
      const range = sourceRange(resumeAnchor);
      if (range) {
        range.setEnd(range.startContainer, range.startOffset + 1);
        const first = range.getClientRects()[0];
        if (first && first.bottom <= 0) dismissResumeLine();
      }
    }
    renderPosition();
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
  root.addEventListener('keydown', event => { if (event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; if (event.key === 'Escape') { if (!egressSheet.hidden) { closeEgress(); event.preventDefault(); return; } if (!questionArea.hidden) { closeQuestion(); return; } if (!selectionCard.hidden) closeSelection(); else if (matchMedia('(max-width: 899px)').matches) closePanel(); } }, { signal });

  async function sync() {
    if (!alive()) return;
    const client = trustedHelper(), epoch = client.connectionVersion;
    const assertCurrent = () => { if (!alive() || client !== helper || epoch !== client.connectionVersion || !client.token) throw new Error('The helper connection changed. Earlier request outcomes are unconfirmed; queued identities remain retained.'); };
    announce('Saving queued changes to the app on this device...');
    await locked(async () => {
      assertCurrent(); await journal.load();
      await journal.sync(async mutation => {
        const sourceUrl = mutation.kind === 'keep' ? mutation.capture.url : journal.state.threads.find(thread => thread.id === mutation.threadId)?.sourceUrl;
        if (!sourceUrl) throw new Error('This change has no recorded source address. It remains on this device.');
        await options.authorizeHelperSend?.(sourceUrl); assertCurrent(); await client.change(mutation);
      }, async () => { assertCurrent(); return client.list(); });
    });
    changed(); renderThreads(); renderSettings();
    announce(journal.state.conflicts.length ? 'Changes need review. Local choices and note drafts are retained.' : 'Queued work saved to the app on this device. Inference has not been authorized by saving.');
  }
  let diagnostics: ReaderDiagnostics = { origin: options.helperOrigin ?? location.origin,
    reachability: 'checking', pairing: 'unknown' };
  let diagnosticsEpoch = -1, diagnosticsGeneration = 0;
  let diagnosticsAbort: AbortController | undefined;
  async function refreshDiagnostics() {
    if (options.allowHelper === false || !helper || !alive() || suspended) return;
    diagnosticsAbort?.abort(); diagnosticsAbort = new AbortController();
    const client = helper, epoch = client.connectionVersion, generation = ++diagnosticsGeneration;
    diagnosticsEpoch = epoch;
    diagnostics = { origin: client.origin, reachability: 'checking', pairing: 'unknown' };
    if (!setup.hidden) renderSettings();
    const result = await loadReaderDiagnostics({ origin: client.origin, token: client.token || undefined,
      extension: location.protocol.endsWith('-extension:'), signal: AbortSignal.any([signal, diagnosticsAbort.signal]) });
    if (!alive() || suspended || generation !== diagnosticsGeneration || client !== helper || epoch !== client.connectionVersion) return;
    diagnostics = result; if (!setup.hidden) renderSettings();
  }
  function renderSettings() {
    if (!alive()) return;
    const focused = settingsBody.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const pairingFocused = focused?.getAttribute('aria-label') === 'Pairing code';
    const caret = pairingFocused && focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : undefined;
    settingsBody.replaceChildren(el('h2', 'Settings'));
    if (journal.unsaved && needsReconciliation) settingsBody.append(el('p', 'Another tab saved a different version. Recovering preserves it and retains your changes for review.', 'm-error'), actionButton('settings:' + 'recover-unsaved-changes', 'Recover unsaved changes', () => safely(async () => {
      await locked(() => journal.reconcilePersistence()); needsReconciliation = false; pendingNoteCommitted = false;
      changed(); renderThreads(); renderCompose(); renderSettings(); announce('Recovered changes need deliberate review. Your note and question drafts are retained.');
    })));
    if (hydrationFinished && (journal.unsaved || draftBuffer.unsaved() || questionBuffer.unsaved() || persistence.suggestions.unsaved(suggestionScope).length || pendingNoteMutation || pendingNoteCommitted || draftSaveFailed || !!draft)) settingsBody.append(el('p', 'Some work needs saving or conflict review. Memory-only recovery lasts only while this document stays open; export before closing.', 'm-error'), actionButton('settings:' + 'retry-saving', 'Retry saving', () => safely(async () => {
      if (draftAttachmentSaveFailed) { await draftBuffer.flush(); draftAttachmentSaveFailed = false; draftSaveFailed = false; announce('Draft attachment saved on this device. The note remains a draft.'); }
      else if (draft || pendingNoteMutation) await saveDraftNow();
      else { await locked(() => journal.retryPersistence()); await draftBuffer.flush(); }
      const questionWasAttachmentFailed = questionAttachmentSaveFailed;
      if (questionBuffer.unsaved()) { const retained = questionBuffer.get(); if (retained) await saveQuestion(retained); }
      if (questionWasAttachmentFailed && questionDraft && !questionArea.hidden) { showQuestion(questionDraft); announce('Question draft attachment saved on this device. The question remains a draft.'); }
      await persistence.suggestions.retry(suggestionScope);
      draftSaveFailed = false;
      changed(); renderThreads(); renderCompose(); renderSettings();
    })));
    if (options.allowHelper === false) settingsBody.append(el('p', 'Open the browser-owned margin or localhost page to connect the local helper.', 'm-meta'));
    else {
      const code = el('input'); code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 16; code.setAttribute('aria-label', 'Pairing code'); code.placeholder = 'Six-digit helper code'; code.value = pairingDraft;
      code.addEventListener('input', () => { pairingDraft = code.value; });
      settingsBody.append(el('p', 'Reading and notes work without an account. Pairing does not establish model login, readiness or permission to send.', 'm-meta'), label('Pairing code', code), actions(
        actionButton('settings:' + 'pair', 'Pair', () => safely(async () => {
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
        actionButton('settings:' + 'save-queued-changes', 'Save queued changes', () => safely(sync)),
        actionButton('settings:' + 'disconnect', 'Disconnect', () => safely(async () => {
          const client = helper; if (!client) throw new Error('The local connection is unavailable.');
          const token = client.token; let removed = false;
          const result = await client.disconnect(async () => { await locked(async () => { removed = await forgetPairingIfCurrent(persistence, client.origin, token); }); if (removed) channel?.postMessage('pairing-changed'); });
          renderSettings();
          announce(result === 'replaced' || !removed ? 'A newer pairing is retained. The earlier revocation may be unconfirmed.' : result === 'unconfirmed' ? 'Local pairing removed. Remote revocation is unconfirmed; the helper may still list this browser.' : 'Local pairing removed. ' + (result === 'revoked' ? 'The helper confirmed revocation.' : 'There was no active token to revoke.'));
        }))));
    }
    const theme = el('select'); theme.dataset.focusKey = 'settings:theme'; theme.setAttribute('aria-label', 'Theme');
    for (const value of ['system', 'light', 'dark']) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; theme.append(option); }
    theme.value = document.documentElement.dataset.theme ?? 'system';
    theme.addEventListener('change', () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; void track(persistence.write('theme', theme.value)).catch(fail); });
    settingsBody.append(label('Theme', theme), el('p', 'Model choices, actual grants, exclusions and vocabulary are managed in the local library and settings.', 'm-meta'), retainedCopiesSection(),
      actionButton('settings:question-preview', denied ? 'Allow question previews here' : 'Block question previews here', () => safely(async () => { const next = !denied; await persistence.write('denied:' + new URL(capture.url).origin, next); denied = next; renderSettings(); announce('Local preview preference saved. Helper permission records are unchanged.'); })),
      actionButton('settings:' + 'close-settings', 'Close settings', () => { setup.hidden = true; updateManagement(); settingsButton.focus({ preventScroll: true }); }));
    if (forget) settingsBody.append(el('h3', 'Prepared page help'), forgetHost);
    if (options.allowHelper !== false) {
      if (diagnosticsEpoch !== helper?.connectionVersion) diagnostics = { origin: helper?.origin ?? diagnostics.origin,
        reachability: 'checking', pairing: 'unknown' };
      settingsBody.append(diagnosticsSection(diagnostics), actionButton('settings:' + 'check-how-things-are', 'Check how things are', () => refreshDiagnostics()));
    }
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
      item.append(actionButton('settings:' + 'keep-device-version-keep-my-change-in-history', 'Keep device version; keep my change in history', () => resolve(false)));
      if (options.allowHelper !== false && helper?.token) item.append(actionButton('settings:' + 'use-helper-version-keep-my-change-in-history', 'Use helper version; keep my change in history', () => resolve(true)));
      settingsBody.append(item);
    }
    if (pairingFocused) { const next = settingsBody.querySelector<HTMLInputElement>('[aria-label="Pairing code"]'); next?.focus({ preventScroll: true }); if (next && caret) next.setSelectionRange(caret[0], caret[1]); }
    else if (focused && !focused.isConnected) Array.from(settingsBody.querySelectorAll<HTMLElement>('button,select')).find(node => !!focused.dataset.focusKey && node.dataset.focusKey === focused.dataset.focusKey)?.focus({ preventScroll: true });
  }
  function exportWork() {
    return safely(async () => {
      const state = sourceBoundJournal(journal.state, capture.url);
      let requests: unknown[] = [], earlierQuestions: AskingSelection[] = [], requestHistoryAvailable = true;
      try { [requests, earlierQuestions] = await Promise.all([persistence.values('asking:' + draftKey + ':request:'), persistence.values<AskingSelection>('question-history:' + draftKey + ':')]); earlierQuestions = earlierQuestions.filter(q => q.capture?.url === capture.url); }
      catch { requestHistoryAvailable = false; }
      const blob = new Blob([JSON.stringify({ version: 1, source: capture, ...state, draft, question: questionDraft,
        journalDurable: !journal.unsaved, requests, earlierQuestions, requestHistoryAvailable,
        memoryOnlyDrafts: unsavedDrafts(namespace, capture.url), memoryOnlyQuestions: unsavedQuestions(namespace, capture.url),
        unsavedSuggestionExposures: persistence.suggestions.unsaved(suggestionScope) }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = 'marginalia-notes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function destroy() {
    if (destroyed) return;
    options.signal?.removeEventListener('abort', destroy);
    ++attachmentGeneration; clearTimeout(noticeTimer);
    options.onSavedMarks?.([]);
    void track(flushReadingPosition());
    resolveSuggestionExposure('page-closed'); activeSuggestionExposure = undefined;
    hearIt.destroy(); draftMount?.destroy(); askingMount?.destroy(); management?.destroy(); instantDefinition?.destroy(); instantOnboarding?.destroy(); autoAssist?.destroy(); selectionRelated?.destroy(); forget?.destroy(); for (const related of threadRelated.values()) related.destroy(); threadRelated.clear(); closeReplies(); highlight(null); destroyed = true; abort.abort(); channel?.close();
    workspace.remove(); skip.remove();
    if (mountedMargins.get(root)?.destroy === destroy) root.classList.remove('m-app', 'm-host-only');
  }
  const lifecycle = { destroy, async drain() { await predecessorDrain; while (pendingOperations.size) await Promise.allSettled([...pendingOperations]); } };
  mountedMargins.set(root, lifecycle);
  options.signal?.addEventListener('abort', destroy, { once: true });
  function trustedHelper() {
    if (!alive() || options.allowHelper === false || !helper?.token) throw new Error('Pair in the browser-owned margin or localhost Settings to use this action.');
    return helper;
  }
  const api = {
    replaceQuestionExposure,
    sourceUrl: capture.url, connection: trustedHelper, exportWork, drain: lifecycle.drain,
    get restoredPosition() { return restoredPosition; }, flushReadingPosition,
    getThread: currentThread,
    focusThread(threadId: string) { expandAdditionally(threadId); renderThreads(); const thread = currentThread(threadId); if (thread) hold(sectionFor(displayPosition(thread.anchor, capture) ?? 0)); showPanel(); },
    select: showSelection,
    ...(autoAssist ? {
      showAutoAssist(next: AutoAssistReadyHelpState) { if (!alive()) return; readingPosture = next.posture; autoAssist.update(next); placeItems(); },
      clearAutoAssist() { if (!alive()) return; autoAssist.clear(); placeItems(); },
    } : {}),
    setReadingPosition(start: number) { if (alive() && !suspended && !held && Number.isFinite(start)) { const next = Math.max(0, Math.min(capture.text.length, start)); if (resumePosition !== undefined && next > resumePosition) dismissResumeLine(); if (restoredPosition && sectionFor(next) === sectionIndex) return; restoredPosition = false; if (next === readingPosition) return; beginReading(); readingPosition = next; sectionIndex = sectionFor(readingPosition); renderPosition(); if (hydrationFinished) { positionDirty = true; queueReadingPosition(); } } },
    suspend() { hearIt.stop(); highlight(null); suspended = true; diagnosticsAbort?.abort(); management?.close(); askingMount?.setVisible(false); },
    resume() { if (!alive()) return; suspended = false; updateManagement(); askingMount?.setVisible(!questionArea.hidden && questionForm.hidden); renderPosition(); renderSettings(); paintHighlights(); },
    async openThread(threadId: string) { await openSavedThread(threadId); },
    destroy,
  };
  const startupGeneration = editorGeneration;
  announce('Restoring saved work. Nothing is being sent.', false, false); renderCompose(); renderPosition();
  try {
    await predecessorDrain; if (!alive()) return api;
    if (options.allowHelper !== false) helper = documentHelper(namespace, options.helperOrigin ?? location.origin);
    const connectionEpoch = helper?.connectionVersion;
    await locked(() => journal.load()); storageReady = true;
    const [savedDraft, pairing, block, theme, savedQuestion, savedRequests, savedExpanded, textHash, savedAttachments] = await Promise.all([draftBuffer.load(), options.allowHelper === false ? undefined : persistence.read<{ origin: string; token: string }>('pairing'), persistence.read<boolean>('denied:' + new URL(capture.url).origin), persistence.read<string>('theme'), questionBuffer.load(), persistence.values<RetainedRequest>('asking:' + draftKey + ':request:').catch(() => []), persistence.read<string>(expandedKey), attachmentTextHash(capture.text), persistence.values<StoredAttachmentObservation>('attachment-observation:').catch(() => [])]);
    if (!alive()) return api;
    if (startupGeneration === editorGeneration) { draft = savedDraft; pendingNoteMutation = draft?.mutation; }
    questionDraft = savedQuestion;
    retainedRequests = savedRequests;
    captureTextHash = textHash;
    for (const observation of savedAttachments) if (observation && observation.sourceUrl === capture.url && observation.textHash === captureTextHash && typeof observation.threadId === 'string') attachmentObservations.add(attachmentObservationKey(observation.threadId, observation.textHash));
    if (typeof savedExpanded === 'string' && threadsNow().some(thread => thread.id === savedExpanded && !thread.deletedAt && thread.sourceUrl === capture.url)) expanded.add(savedExpanded);
    if (draft) { held = true; readingPosition = composerOffset(draft, 0); sectionIndex = sectionFor(readingPosition); }
    denied = !!block; if (theme && theme !== 'system') document.documentElement.dataset.theme = theme;
    if (helper && connectionEpoch === 0 && helper.connectionVersion === connectionEpoch && pairing?.origin === helper.origin) helper.token = pairing.token;
    if (!draft) {
      try {
        const read = options.readPosition ?? (helper?.token ? async (sourceUrl: string) => (await helper!.request('/api/position', { url: sourceUrl }, options.signal)).anchor as QuoteAnchor | null : undefined);
        const checkpoint = await persistence.read<{ threadId: string; anchor?: QuoteAnchor }>(parkedPositionKey);
        const parked = checkpoint && threadsNow().some(thread => thread.id === checkpoint.threadId && thread.anchor.kind === 'whole-page' && thread.state === 'parked' && !thread.deletedAt);
        const local = parked && checkpoint?.anchor && displayPosition(checkpoint.anchor, capture) !== undefined ? checkpoint.anchor : undefined;
        if (!alive()) return api;
        const saved = local ?? await read?.(capture.url), at = saved ? displayPosition(saved, capture) : undefined;
        if (!alive()) return api;
        if (saved && at !== undefined) { readingPosition = at; sectionIndex = sectionFor(at); restoredPosition = true; if (local || at > 0) showResumeLine(saved, at); options.onSource?.(saved); }
      } catch { /* Position restoration is deliberately quiet. */ }
    }
    announce(journal.unsaved || draftBuffer.unsaved() || questionBuffer.unsaved() ? 'Unsaved work recovered in this document. Retry saving or export before closing.' : 'Local storage is available. Model readiness has not been checked; asking requires a separate review.', journal.unsaved || draftBuffer.unsaved() || questionBuffer.unsaved(), false);
  } catch { announce('Local storage could not be restored. Current drafts remain in this document only; export before closing.', true); }
  if (!alive()) return api;
  hydrationFinished = true; renderCompose(); renderThreads(); renderSettings(); renderRetainedRequests();
  if (questionDraft) footerSlots.retained.append(button('Return to retained question', () => { if (questionDraft) showQuestion(questionDraft); }));
  // Exposure history is independent of reader hydration. Read at most 64 entries
  // per page and yield between pages; preserve malformed rows for inspection.
  void track((async () => {
    let after: string | undefined;
    const recoveryTime = exposureRecoveryTime;
    try {
      await persistence.suggestions.retry(suggestionScope);
      do {
        const result = await persistence.suggestions.recover(suggestionScope, recoveryTime, after);
        if (result.invalid || result.failed) announce('Some suggestion history could not be restored. Your notes and questions are available. Retry saving in Settings for unsaved history.', true);
        after = result.next;
        if (after) await new Promise(resolve => setTimeout(resolve, 0));
      } while (after && alive());
    } catch { announce('Suggestion history could not be restored. Your notes and questions are available.', true); }
    if (alive()) renderSettings();
  })());
  channel?.addEventListener('message', event => {
    if (event.data === 'pairing-changed') {
      if (options.allowHelper === false || !helper) return;
      const client = helper, epoch = client.connectionVersion;
      void safely(async () => { await locked(async () => {
        const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
        if (!alive() || client !== helper || epoch !== client.connectionVersion) return;
        const token = pairing?.origin === client.origin ? pairing.token : ''; if (client.token !== token) client.token = token;
      }); renderSettings(); announce('Pairing changed in another margin. Earlier outcomes may be unconfirmed; nothing was automatically retried.'); });
      return;
    }
    void safely(async () => { await locked(() => journal.load()); draftMount?.changed(); renderThreads(); renderSettings(); announce(journal.unsaved ? 'Another margin saved work; your unsaved changes remain here.' : 'Saved work updated. Your note and question drafts are unchanged.'); });
  }, { signal });
  return api;
}

function demoPage() {
  const article = el('article', undefined, 'm-source'); article.tabIndex = -1;
  const sourceSections = [
    { title: 'A place beside the page', paragraphs: ['Reading is more than taking in a sentence. Sometimes a phrase is worth keeping. Sometimes you need to leave a question and carry on.', 'A margin gives those small acts a place. The text stays where it is; your thoughts sit beside it. You can return to them without starting over.'] },
    { title: 'Keep what catches you', paragraphs: ['Select a passage in this article to open Keep and Ask. Keeping a passage saves it on this device. Asking first lets you prepare a question and inspect what it would share.', 'Nothing is sent just because you select text. You can read, highlight, and write without an account or a connection to Codex.'] },
    { title: 'Write in your own words', paragraphs: ['A note belongs to a place in the text. When you begin writing, that place holds still. Moving down the page does not move the note’s attachment.', 'An unfinished thought can be saved for later. A question can stay a question. Your own words come first, and they remain yours when you return.'] },
    { title: 'Return to the thread', paragraphs: ['Work saved in the margin stays in page order. The coloured map gives each section a place, and marks the sections where you have left something.', 'Choose a section to hold it in view. Follow reading brings the margin back to the page. Hovering a saved passage only highlights it; opening its source is a deliberate action.'] },
    { title: 'What is available here', paragraphs: ['This local reading page supports keeping passages, writing and editing notes, saving threads for later, and removing with undo. Your saved work survives a reload in this browser.', 'Reading and local saving do not send questions. An installed asking module and a working app on this device are needed for an explicit sending review; pairing alone does not establish model readiness.'] },
  ];
  article.append(el('p', 'Marginalia · A reading page', 'm-source-meta'), el('h1', 'Reading with Marginalia'), el('p', 'A short page to try the margin. Select a sentence, or write beside the section you are reading.', 'm-source-intro'));
  const sections: MarginSection[] = [];
  for (const item of sourceSections) {
    const start = article.textContent!.length; const block = el('section'); block.dataset.readingSection = String(sections.length);
    block.append(el('h2', item.title), ...item.paragraphs.map(text => el('p', text))); article.append(block);
    sections.push({ title: item.title, start, end: article.textContent!.length });
  }
  const capture: SourceCapture = { url: 'https://marginalia.local/reading', title: 'Reading with Marginalia', pageType: 'Article', text: article.textContent!, capturedAt: new Date().toISOString(), extractionVersion: 'text-content-v1', sections: structuredClone(sections) };
  return { article, capture, sections };
}

