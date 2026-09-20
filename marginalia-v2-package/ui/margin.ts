import { marginSurfaces as surfaces } from './margin-surfaces/registry.ts';
import { mountAskingDraft } from './asking/mount.ts';
import { blockerActions, blockerMessages } from './asking/flow.ts';
import type { AskingBlocker } from './asking/types.ts';
import { createAskingHost } from './asking/helper-adapter.ts';
import { rankEligibleSuggestions, suggestionBlock, suggestionPage, suggestionOffer, SUGGESTION_ORDER } from './suggestion-policy.ts';
import type { Intent } from '../contracts/reply.ts';
import { followupQuestion } from './asking/surfaces.ts';
import type { HighlightColour, QuoteAnchor, ReaderMutation, SourceCapture, Thread } from '../contracts/reader.ts';
import { HIGHLIGHT_COLOURS, wholePageAnchor, attachQuote, highlightColour, validateReaderMutation } from '../contracts/reader.ts';
import { el, button } from './dom.ts';
import { localPersistence, documentJournal, documentDraft, documentQuestion, unsavedDrafts, unsavedQuestions, sourceBoundJournal, retryDraftMutation, draftAfterResolution, keepDeviceConflict, resolveHelperConflict, replySaveLifecycle, replyIsRemoved, SUGGESTION_POLICY_VERSION, type SuggestionExposureResolution, type MarginDraft, type CachedReply } from './persistence.ts';
import { anchorAt, readingAnchorAt, orderedThreads, outgoingPreview, sourceLocation, pageDefinition, displayPosition, egressRecord } from './margin-model.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import { HelperClient, HelperTransportError, HelperHttpError, attachmentTextHash, documentHelper, forgetPairingIfCurrent } from './helper.ts';
import { mountHelperManagement } from './helper-management.ts';
import { createT08Mount, type AskingMountFactory, type AskingSelection } from './asking-host.ts';
import type { MountedReply } from '../renderer/index.ts';
import { canonicalReplyData, capabilitiesForIntent, validateReply, type SourceBinding } from '../contracts/reply.ts';
import { mountSolverRecompute } from './solver-recompute.ts';
import { mountHearIt } from './hear-it.ts';
import { loadReaderDiagnostics, type ReaderDiagnostics } from './diagnostics.ts';
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
  /** Host-owned navigation to the current source site's existing exclusion entry. */
  onReviewSiteSetting?: () => void | Promise<void>;
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
/** Bounded accessible name cut at a word boundary. Visible text is clamped in CSS instead. */
const shortName = (text: string, length = 82) => {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  const space = cut.lastIndexOf(' ');
  return (space > length / 2 ? cut.slice(0, space) : cut).trimEnd() + '…';
};
// Grouping is scoped to one source version: the same words in another capture stay apart.
const anchorKey = (thread: Thread) => JSON.stringify([thread.sourceVersionId, thread.anchor.kind, thread.anchor.start, thread.anchor.end, thread.anchor.exact, thread.anchor.prefix, thread.anchor.suffix]);
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
  const homeSurface = surfaces.home(capture, instance);
  const { heading, headline, compose, reading } = homeSurface;
  function beginReading() {}
  const marksSurface = surfaces.marks({ sections }, (threadId, opener) => { void safely(() => openSavedThread(threadId, opener)); });
  const { map } = marksSurface;
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
  // The footer is assembled as one row further down, once its controls exist.
  const librarySurface = surfaces.library(footerSlots, {
    openLibrary: () => options.onLibrary?.(), hasExternalLibrary: () => !!options.onLibrary,
    useExternalLibrary: () => earlierDrafts.hidden && !footerSlots.requests.children.length && !footerSlots.retained.children.length,
  });
  const { element: localLibrary, control: libraryButton, focusAction: focusLocalLibraryAction } = librarySurface;
  const status = el('p', '', 'm-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const notice = el('div', undefined, 'm-notice'); notice.hidden = true; notice.tabIndex = 0;
  footer.prepend(notice);
  const toast = el('div', undefined, 'm-toast'); toast.hidden = true;
  const settingsSurface = surfaces.settings(options.settingsContent);
  const { setup, settingsBody, managementHost, forgetHost } = settingsSurface;
  rail.append(map);
  const scroll = el('div', undefined, 'm-scroll'); scroll.append(egressSheet, selectionCard, threadList, footer);
  const replySurface = surfaces.reply(shell, scroll, questionArea, {
    back: () => { void track(backHome()); },
    liveReply: () => {
      if (!askingMount) return;
      askingHost.hidden = false; questionForm.hidden = true; questionArea.hidden = false;
      showFullReply(questionArea, liveReply); askingMount.setVisible(true);
    },
  });
  const { replyFrame, replyBody, liveReply, showFullReply, restoreSavedReply } = replySurface;
  async function backHome() {
    if (!replySurface.beginReturn()) return;
    try {
      if (askingMount && !askingHost.hidden) {
        if (!askingMount.saveForNavigation) throw new Error('This reply needs a saving connection before returning.');
        await askingMount.saveForNavigation();
      }
      let before: string;
      do {
        before = canonicalReplyData([...replyMounts.values()].map(entry => entry.mounted.getState()));
        await Promise.all([...replyMounts.values()].map(entry => entry.flush()));
        await questionBuffer.flush(); await draftBuffer.flush(); await flushReadingPosition();
      } while (alive() && before !== canonicalReplyData([...replyMounts.values()].map(entry => entry.mounted.getState())));
      if (!alive()) return;
      askingMount?.setVisible(false); restoreSavedReply();
      replySurface.returnHome(() => renderQuestionContinuation(), noteEditor.element);
      announce('Saved');
    } catch (error) {
      if (alive()) replySurface.failedReturn(error);
    } finally { replySurface.endReturn(); }
  }
  panel.append(...(options.instantHelp ? [instantOnboardingHost] : []), heading, autoAssistAssumesHost, setup, localLibrary, scroll, status, toast); shell.append(rail, panel); workspace.append(shell); root.append(workspace);
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
  let pairingDraft = '', pairingFailure: 'expired' | 'mismatch' | undefined, questionDraft: QuestionDraft | undefined, retainedRequests: RetainedRequest[] = [];
  const updateManagement = () => { if (!suspended && !setup.hidden && !shell.classList.contains('is-collapsed')) management?.open(); else management?.close(); };
  let sectionIndex = 0, held = false, draft: Draft | undefined, selected: QuoteAnchor | undefined;
  let replacementSelection: { anchor: QuoteAnchor; target: 'note' | 'question' } | undefined;
  let draftAttachmentSaveFailed = false, questionAttachmentSaveFailed = false;
  let helper: HelperClient | undefined, storageReady = false, saving = false;
  let noteSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let noteSaveWork: Promise<Extract<ReaderMutation, { kind: 'keep' | 'note' }> | undefined> | undefined;
  let continuousSave = false, noteOfferGeneration = 0;
  let noteOffers: ReturnType<typeof suggestionOffer>[] = [];
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
  /** Thread ID to the ID of the card it displays inside. Display only; records are untouched. */
  const groupLead = homeSurface.groupLead;
  const threadRelated = new Map<string, RelatedMount>();
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
    const items: { node: HTMLElement; position: number; rank: number }[] = [];
    sectionMarkers.forEach(node => node.remove());
    if (reading.parentElement !== scroll) scroll.prepend(reading);
    if (compose.parentElement !== scroll) scroll.insertBefore(compose, threadList);
    const autoAssistPosition = autoAssist?.position();
    if (autoAssistPosition !== undefined && !autoAssistReadyHost.hidden) items.push({ node: autoAssistReadyHost, position: autoAssistPosition, rank: .75 });
    const selectionPosition = replacementSelection?.target === 'note' && draft ? composerOffset(draft, readingPosition)
      : replacementSelection?.target === 'question' && questionDraft ? displayPosition(questionDraft.anchor, capture) ?? readingPosition
      : selected ? displayPosition(selected, capture) ?? readingPosition : readingPosition;
    items.push({ node: selectionCard, position: selectionPosition, rank: 1.2 });
    if (questionArea.parentElement !== scroll && questionArea.parentElement !== replyBody) scroll.insertBefore(questionArea, threadList);
    for (const thread of orderedThreads(threadsNow(), capture)) {
      const node = threadNodes.get(thread.id)?.node;
      // Repeats of one passage stay inside their lead card, so they are not placed here.
      if (node && !groupLead.has(thread.id)) items.push({ node, position: displayPosition(thread.anchor, capture) ?? Infinity, rank: 2 });
    }
    if (!liveReply.hidden) items.push({ node: liveReply, position: questionDraft ? displayPosition(questionDraft.anchor, capture) ?? Infinity : Infinity, rank: 3 });
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
  const repairButtons = new WeakMap<HTMLElement, HTMLButtonElement>();
  function clearRepair(message: HTMLElement) { repairButtons.get(message)?.remove(); repairButtons.delete(message); }
  function showRepair(message: HTMLElement, blocker: AskingBlocker) {
    clearRepair(message); message.textContent = blockerMessages[blocker];
    const action = button(blockerActions[blocker], () => {
      if (questionBuffer.unsaved()) {
        showRepair(message, 'unsaved-context'); focusSavingRepair(); return;
      }
      try { void Promise.resolve(repairRequest(blocker)).catch(() => { if (alive()) message.textContent = 'The repair view could not be opened; your request is retained.'; }); }
      catch { message.textContent = 'The repair view could not be opened; your request is retained.'; }
    });
    action.className = 'm-asking-repair'; message.parentElement?.append(action); repairButtons.set(message, action);
  }
  function focusSetting(key: string) {
    setup.hidden = false; renderSettings(); updateManagement();
    const target = settingsBody.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    target?.focus(); target?.scrollIntoView({ block: 'nearest' });
  }
  function focusSavingRepair() {
    setup.hidden = false; renderSettings(); updateManagement();
    // Local durability/conflict recovery comes before helper synchronization.
    // Inspect the rendered controls: a durable outbox has no Retry saving button.
    const target = ['settings:recover-unsaved-changes', 'settings:retry-saving', 'settings:save-queued-changes']
      .map(key => settingsBody.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)).find(Boolean);
    target?.focus(); target?.scrollIntoView({ block: 'nearest' });
  }
  function repairInstructions(title: string, text: string) {
    setup.hidden = false; updateManagement();
    let target = setup.querySelector<HTMLElement>('.m-repair-instructions');
    if (!target) { target = el('section', undefined, 'm-repair-instructions'); setup.prepend(target); }
    target.replaceChildren(el('h3', title), el('p', text)); target.tabIndex = -1;
    target.focus(); target.scrollIntoView({ block: 'nearest' });
  }
  function repairRequest(blocker: AskingBlocker) {
    if (!alive()) return;
    if (questionBuffer.unsaved() || blocker === 'unsaved-context') {
      focusSavingRepair(); return;
    }
    // A page-controlled presentation has exactly one privileged transition.
    // Invoking its existing host button preserves the initiating user gesture.
    if (options.allowHelper === false) {
      const transition = options.settingsContent?.querySelector<HTMLButtonElement>('#trusted-open');
      if (transition && !transition.disabled) transition.click();
      else repairInstructions('Open browser margin', 'Open Marginalia from the browser toolbar on this page to continue your retained request.');
      return;
    }
    if (blocker === 'unpaired') { focusSetting('settings:pairing-code'); return; }
    if (blocker === 'excluded') {
      if (denied) { focusSetting('settings:question-preview'); return; }
      return options.onReviewSiteSetting?.();
    }
    if (blocker === 'disconnected') { focusSetting('settings:check-how-things-are'); return; }
    if (blocker === 'signed-out') {
      repairInstructions('Codex sign-in', 'Open Codex on this computer and complete sign-in, then return to the retained request and choose Continue. For a separate configured Codex home, sign in using that home and executable.'); return;
    }
    if (blocker === 'runtime-unavailable' || blocker === 'helper-off') {
      repairInstructions('Local setup', blocker === 'helper-off'
        ? 'In the Marginalia source package folder, run npm start to start the installed local helper, then return to your retained request.'
        : 'Open Codex on this computer and check that it starts and is signed in. Use Node 24 and the installed Codex executable; for a separate configured home, check both configured paths. Return to your retained request after setup.'); return;
    }
    if (blocker === 'unsupported') {
      repairInstructions('Retained request', 'Your question and captured passage are retained. Open a supported HTTP or HTTPS page, select the intended passage, and review the attachment before continuing.'); return;
    }
    if (blocker === 'expired-preview' && questionDraft) { showQuestion(questionDraft); return; }
    repairInstructions('Response status', 'The response could not be confirmed. Keep this retained request and use its recorded status control when available before reviewing another request.');
  }
  const settingsButton = settingsSurface.control(() => { if (setup.hidden) openSettings(); else setup.hidden = true; });
  const barActions: HTMLElement[] = [];
  barActions.push(libraryButton, settingsButton);
  collapse.className = 'm-head-toggle'; headline.append(collapse);
  rail.prepend(el('span', 'Marginalia', 'm-wordmark'));
  bar.remove();
  if (options.initialOpen === false || (options.initialOpen !== true && narrowViewport())) {
    shell.classList.add('is-collapsed'); openButton.setAttribute('aria-expanded', 'false'); rail.append(map);
  }
  const { writeButton, readingTitle } = homeSurface.mountReading({
    beginDraft: () => beginDraft(), canBeginDraft: () => hydrationFinished && !draft,
    follow: () => { held = false; updateReading(); renderPosition(); },
  });
  function dismissResumeLine() { resumeLine?.remove(); resumeLine = undefined; resumePosition = undefined; resumeAnchor = undefined; }
  function showResumeLine(anchor: QuoteAnchor, position: number) {
    dismissResumeLine(); resumePosition = position; resumeAnchor = anchor;
    resumeLine = button('You were here', () => { dismissResumeLine(); sourceAction(anchor); });
    resumeLine.className = 'm-resume m-meta';
    heading.append(resumeLine);
  }
  shell.addEventListener('click', dismissResumeLine, { signal });
  shell.addEventListener('input', dismissResumeLine, { signal });
  marksSurface.mountThreadRail();
  const activityButton = replySurface.mountActivity(map, () => { void openEgress(); });
  function showActivity(text: string, sending: boolean, elapsedSeconds?: number) {
    if (!alive()) return;
    // Closing the question does not erase the last job's record.
    if (!text && activityJobId) return;
    replySurface.updateActivity(text, sending, elapsedSeconds);
  }
  const flowActivity = replySurface.activityFor;
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
    const content = replySurface.openEgress(egressSheet, closeEgress);
    try {
      const jobId = activityJobId ?? questionDraft?.resumeJobId;
      if (!jobId) throw new Error('The stored record for this activity is unavailable. The outcome is unconfirmed.');
      const client = trustedHelper(), epoch = client.connectionVersion;
      const job = await client.request('/api/jobs/' + encodeURIComponent(jobId), undefined, signal) as JobSnapshot;
      if (!alive() || generation !== egressGeneration || helper !== client || epoch !== client.connectionVersion) return;
      if (job.id !== jobId) throw new Error('The stored record does not match this activity.');
      const record = egressRecord(job);
      const measured = egressMeasurements(job);
      replySurface.renderEgress(content, record, measured);
    } catch (error) {
      if (alive() && generation === egressGeneration) replySurface.failedEgress(content, error);
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
                focusLocalLibraryAction();
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
  const saveJourneySurface = surfaces.saveJourney(reading, savePage);
  const { savePageButton, parkPageButton } = saveJourneySurface;
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
  pageActions.append(actions(relatedToggle, button('Export', exportWork)), related);
  footerSlots.related.append(pageActions);
  const endOffers = el('div', undefined, 'm-end-offers');
  const think = button('Think with it', () => pageQuestion('unsure', 'Help me reflect on this page and connect it to my own questions.'));
  const further = button('Go further', () => pageQuestion('explore', 'Suggest useful further reading related to this page.'));
  const voiceUnavailable = el('p', 'Hear it needs a local voice.', 'm-meta'); setup.append(voiceUnavailable);
  const hearIt = mountHearIt(footerSlots.voice, () => {
    const at = selected && displayPosition(selected, capture);
    return selected && at !== undefined ? capture.text.slice(at, at + selected.exact.length) : capture.text.slice(readingPosition);
  }, available => { voiceUnavailable.hidden = available; });
  // One footer row. Everything quieter sits behind More, with its handler unchanged.
  const footerMore = el('details', undefined, 'm-footer-more');
  footerMore.append(el('summary', 'More'), actions(...barActions.filter(control => control !== libraryButton)), footerSlots.actions, footerSlots.related, footerSlots.voice);
  relatedToggle.textContent = 'Connections';
  const skillsButton = button('Skills', () => {
    if (!questionDraft) ask(draft?.anchor ?? currentAnchor());
    if (questionDraft) showQuestion(questionDraft, true);
  });
  const footerRow = actions(relatedToggle, skillsButton, libraryButton, settingsButton);
  // Keep existing maintenance and saved-page semantics reachable while their
  // separately owned Settings/Library successors are being implemented.
  footerMore.append(parkPageButton); setup.append(footerMore);
  footer.append(related);
  footerRow.classList.add('m-footer-row');
  footer.append(footerRow);
  const skip = button('Go to margin', () => showPanel(true, skip)); skip.className = 'm-skip'; root.prepend(skip);

  const noteEditor = homeSurface.mountEditor({
    edit(text) {
      if (!draft && hydrationFinished) beginDraft();
      if (draft && (!saving || continuousSave) && (!draft.mutation || continuousSave)) {
        draft.text = text; persistDraft(); queueNoteSave(); updateNoteOffers();
      }
    },
    save: () => { draftSaveFailed = true; void saveDraft(); },
    discard: () => { void safely(async () => { if (saving || draft?.mutation) return; await draftBuffer.save(undefined); draft = undefined; editorGeneration++; renderCompose(); readingTitle.focus({ preventScroll: true }); }); },
    ask: () => { void safely(() => chooseNoteOffer()); },
    chooseOffer: intent => { void safely(() => chooseNoteOffer(noteOffers.find(offer => offer.intent === intent))); },
    attachments: () => {
      const changeTo = (anchor: QuoteAnchor) => { if (!draft || saving || draft.mutation) return; draft.anchor = structuredClone(anchor); draft.source = structuredClone(capture); draft.position = displayPosition(anchor, capture) ?? readingPosition; persistDraft(); renderCompose(true); };
      return [...sections.map(section => ({ label: section.title, choose: () => changeTo(anchorAt(capture.text, section.start, section.end)) })),
        { label: 'Whole page', choose: () => changeTo(wholePageAnchor()) },
        ...(selected ? [{ label: 'Selected passage', choose: (() => { const frozen = structuredClone(selected); return () => changeTo(frozen); })() }] : [])];
    },
  });
  function queueNoteSave() {
    clearTimeout(noteSaveTimer);
    if (!draft?.text.trim()) return;
    noteSaveTimer = setTimeout(() => { noteSaveTimer = undefined; void track(saveNoteContinuously()); }, 350);
  }
  async function saveNoteContinuously() {
    if (noteSaveWork) await noteSaveWork;
    if (!alive() || !draft?.text.trim() || saving) return;
    const existing = draft.threadId && currentThread(draft.threadId)?.notes.find(note => note.id === draft?.noteId);
    if (!draft.mutation && existing && existing.text === draft.text && existing.revision === draft.revision) return;
    continuousSave = true;
    noteSaveWork = saveDraftNow(true);
    try { return await noteSaveWork; }
    finally { noteSaveWork = undefined; continuousSave = false; if (alive()) renderCompose(); }
  }
  function updateNoteOffers() {
    const generation = ++noteOfferGeneration;
    noteOffers = []; noteEditor.offers([]);
    if (!draft?.text.trim()) return;
    const frozen = structuredClone(draft);
    void track(rankedOffers({ capture: frozen.source ?? capture, anchor: frozen.anchor, question: frozen.text, context: '' }).then(offers => {
      if (!alive() || generation !== noteOfferGeneration || draft?.text !== frozen.text) return;
      noteOffers = offers.slice(0, 3); noteEditor.offers(noteOffers.map(offer => ({ id: offer.intent, label: offer.label })));
    })).catch(fail);
  }
  async function chooseNoteOffer(offer?: ReturnType<typeof suggestionOffer>) {
    clearTimeout(noteSaveTimer); noteSaveTimer = undefined;
    await saveNoteContinuously();
    if (!alive() || !draft?.threadId || draft.mutation || journal.unsaved || draftBuffer.unsaved()) return;
    const thread = currentThread(draft.threadId), note = thread?.notes.find(item => item.id === draft?.noteId && !item.deletedAt);
    if (!thread || !note || note.text !== draft.text || note.revision !== draft.revision) return;
    const frozen = structuredClone(note);
    if (questionDraft) {
      if (askingMount?.saveForNavigation) await askingMount.saveForNavigation();
      await archiveQuestion();
      if (questionDraft) return;
    }
    ask(thread.anchor, thread, { noteId: frozen.id, text: frozen.text, revision: frozen.revision });
    const started = questionDraft as QuestionDraft | undefined;
    if (!started) return;
    await saveQuestion({ ...started, intent: offer?.intent ?? 'unsure', question: offer?.question ?? frozen.text });
    if (offer) { beginSuggestionExposure(questionDraft!, noteOffers, noteOffers); resolveSuggestionExposure('chosen', offer.intent); }
    const controls = showQuestion(questionDraft!);
    await openQuestionWithHelper(controls.message, controls.reviewButton);
  }
  function renderPosition() {
    if (!alive()) return;
    homeSurface.updateReadingTitle(sections[sectionIndex].title);
    const lastParagraph = capture.text.trimEnd().lastIndexOf('\n') + 1;
    const sourceEndVisible = source && readingPosition > 0 && source.getBoundingClientRect().bottom <= innerHeight;
    const atEnd = capture.text.length > 0 && (sourceEndVisible || readingPosition >= (lastParagraph || capture.text.length - 1));
    if (atEnd) { if (!endOffers.children.length) endOffers.append(think, further); if (endOffers.parentElement !== scroll) scroll.insertBefore(endOffers, footer); }
    else endOffers.remove();
    sectionMarkers.forEach((marker, index) => { marker.hidden = index === sectionIndex; });
    homeSurface.updateSection(sectionIndex, sections.length);
    marksSurface.updateSections(sectionMapState(sections, threadsNow(), capture, sectionIndex), readingPosition);
    for (const thread of orderedThreads(threadsNow(), capture)) {
      const node = threadNodes.get(thread.id)?.node; if (!node) continue;
      const at = displayPosition(thread.anchor, capture);
      const size = marginItemSize(at === undefined ? -1 : sectionFor(at), sectionIndex, expanded.has(thread.id), node.contains(document.activeElement));
      node.style.setProperty('--section-colour', `var(--m-sec-${(at === undefined ? sectionIndex : sectionFor(at)) % 6 + 1})`);
      node.dataset.size = 'full'; node.classList.remove('is-compact', 'is-tick');
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
  marksSurface.mountSections((index, segment) => {
    const openingSheet = narrowViewport() && shell.classList.contains('is-collapsed');
    hold(index); showPanel(openingSheet, segment); sourceAction(anchorAt(capture.text, sections[index].start, sections[index].end), !openingSheet);
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
    if (draft) {
      if ((thread && (draft.threadId !== thread.id || draft.noteId !== noteId)) || (explicitAnchor && !sameAnchor(explicitAnchor, draft.anchor))) {
        void safely(async () => {
          await saveNoteContinuously();
          if (!alive() || !draft || draft.mutation || draftBuffer.unsaved() || journal.unsaved) return;
          const savedNote = draft.threadId && currentThread(draft.threadId)?.notes.find(note => note.id === draft?.noteId);
          if (draft.text.trim() && (!savedNote || savedNote.text !== draft.text)) return;
          if (thread && !journal.state.threads.some(t => t.id === thread.id)) { announce('This helper snapshot is read-only until you explicitly synchronize it.'); return; }
          // The old note is durable. Replace the editor and queue its next draft
          // synchronously: an awaited clear would let newer typing be overwritten.
          draft = undefined; beginDraft(explicitAnchor, thread, noteId);
        });
      } else noteEditor.focus();
      return;
    }
    if (thread && !journal.state.threads.some(t => t.id === thread.id)) { announce('This helper snapshot is read-only until you explicitly synchronize it.'); return; }
    const anchor = explicitAnchor ?? selected ?? currentAnchor(), note = thread?.notes.find(item => item.id === noteId);
    const position = explicitAnchor || selected ? displayPosition(anchor, capture) ?? readingPosition : readingPosition;
    draft = { anchor: structuredClone(anchor), source: structuredClone(capture), position, text: note?.text ?? '', ...(thread ? { threadId: thread.id, noteId: note?.id ?? id(), revision: note?.revision ?? 0 } : {}) };
    hold(sectionFor(position)); persistDraft(); renderCompose(true);
  }
  function renderCompose(focus = false) {
    if (!alive()) return;
    saveJourneySurface.update(hydrationFinished, pageSaving);
    homeSurface.updateHydration(hydrationFinished);
    homeSurface.updateEditor({
      draft: draft ? { text: draft.text, wholePage: draft.anchor.kind === 'whole-page', passage: displayAnchor(draft.anchor) } : undefined,
      saving, locked: !continuousSave && (pendingNoteCommitted || !!draft?.mutation), canChange: !draft?.threadId,
      hydrated: hydrationFinished, storageReady, attachmentSaveFailed: draftAttachmentSaveFailed,
      originalCapture: !!draft?.source && draft.source.text !== capture.text, retainedMutation: !!draft?.mutation && !continuousSave,
    });
    placeItems(); if (focus && draft) noteEditor.focus();
  }
  function saveDraft() { return track(saveDraftNow()); }
  async function saveDraftNow(retainEditor = false): Promise<Extract<ReaderMutation, { kind: 'keep' | 'note' }> | undefined> {
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
      const noteId = mutation.kind === 'note' ? mutation.noteId : mutation.id + '-note';
      const committedNote = currentThread(mutation.threadId)?.notes.find(note => note.id === noteId);
      const latestText = draft.text;
      const next = retainEditor && committedNote ? { ...saved, text: latestText, threadId: mutation.threadId, noteId, revision: committedNote.revision, mutation: undefined } : undefined;
      draft = next; await draftBuffer.save(next); editorGeneration++; pendingNoteMutation = undefined; pendingNoteCommitted = false;
      if (alive()) { changed(); renderThreads(); renderCompose(); if (!retainEditor && returnToReading && (compose.contains(document.activeElement) || document.activeElement === document.body)) readingTitle.focus({ preventScroll: true }); if (!retainEditor) announce('Note saved on this device.'); }
      if (retainEditor && next && next.text !== committedNote?.text) queueNoteSave();
      return mutation;
    } catch (error) { draftSaveFailed = true; fail(error); }
    finally { saving = false; if (draft?.mutation) draftSaveFailed = true; if (alive()) { renderCompose(); renderSettings(); } }
  }

  // Capture time alone is not a source version. Empty sourceVersionIds do not
  // establish equality: require the original capture retained by the journal.
  function captureIdentity(value: SourceCapture) {
    return JSON.stringify([value.url, value.text, value.extractionVersion, value.title, value.pageType,
      value.author ?? null, value.publicationDate ?? null, value.venue ?? null,
      (value.sections ?? []).map(({ title, start, end }) => [title, start, end])]);
  }
  function sameAnchor(left: QuoteAnchor, right: QuoteAnchor) {
    return (left.kind ?? 'quote') === (right.kind ?? 'quote') && left.start === right.start && left.end === right.end &&
      left.exact === right.exact && left.prefix === right.prefix && left.suffix === right.suffix;
  }
  function keptPassage(anchor: QuoteAnchor) {
    const identity = captureIdentity(capture);
    const retained: ReaderMutation[] = [...journal.state.pending];
    // Acknowledgement fingerprints retain the complete original mutation.
    // Legacy/unknown receipts cannot prove source identity and stay separate.
    for (const receipt of journal.state.acknowledged ?? []) {
      try { const mutation: unknown = JSON.parse(receipt.fingerprint); validateReaderMutation(mutation); retained.push(mutation); }
      catch { /* No verified capture available in this receipt. */ }
    }
    return journal.state.threads.find(thread => !thread.deletedAt && thread.sourceUrl === capture.url && sameAnchor(thread.anchor, anchor) &&
      retained.some(mutation => mutation.kind === 'keep' && mutation.threadId === thread.id &&
        sameAnchor(mutation.anchor, anchor) && captureIdentity(mutation.capture) === identity));
  }
  async function keep(anchor: QuoteAnchor, parked = false) {
    let saved = false;
    await safely(async () => {
      try {
        await locked(async () => {
          if (!alive()) throw new Error('This margin has closed.');
          if (!storageReady) throw new Error('Local saving is unavailable. Keep your draft open.');
          if (journal.unsaved) throw new Error('Retry saving in Settings before making another change.');
          await journal.load();
          const existing = keptPassage(anchor);
          const threadId = existing?.id ?? id();
          if (!existing) await journal.change({ id: id(), kind: 'keep', threadId, capture, anchor });
          const thread = journal.state.threads.find(t => t.id === threadId)!;
          if (parked && thread.state !== 'parked') await journal.change({ id: id(), kind: 'thread-state', threadId, state: 'parked', expectedRevision: thread.revision });
        });
      } catch (error) { if (!journal.unsaved) renderThreads(); throw error; }
      changed(); renderThreads();
      announce(parked ? 'Passage saved for later on this device.' : 'Passage kept on this device.'); saved = true;
    });
    return saved;
  }
  /** Why Ask cannot run right now, in the owner's words. Empty string means Ask is available. */
  function askBlockedReason() {
    const blocker = initialAskBlocker(); return blocker ? blockerMessages[blocker] : '';
  }
  function initialAskBlocker(): AskingBlocker | undefined {
    if (options.allowHelper === false) return 'browser-owned-required';
    if (denied) return 'excluded';
    if (!['http:', 'https:'].includes(new URL(capture.url).protocol)) return 'unsupported';
    if (!helper?.token) return 'unpaired';
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
    const blocked = askBlockedReason();
    const askButton = button('Ask', () => { if (blocked) announce(blocked); ask(anchor); });
    // D49: the fourth resting control starts the same simulate request that choosing
    // Simulate it after Ask starts today. It adds no authority of its own.
    const simulateButton = button('Simulate it', () => { if (blocked) announce(blocked); askSimulate(anchor, !blocked); });
    let keepPending = false;
    const keepButton = button('Keep', async () => {
      if (keepPending) return;
      keepPending = true; keepButton.disabled = true;
      try { if (await keep(anchor)) closeSelection(); }
      finally { keepPending = false; keepButton.disabled = false; }
    });
    const row = actions(keepButton, button('Note', () => beginDraft(anchor)), askButton, simulateButton);
    row.classList.add('m-selection-actions');
    row.querySelectorAll<HTMLButtonElement>('button').forEach((control, index) => { control.id = 'm-selection-' + ['keep', 'note', 'ask', 'simulate'][index]; });
    // The reason sits at the control, not at the bottom of the panel. No pairing
    // or send check is bypassed here; Ask still runs the same gates when allowed.
    const blockedBlock = el('div', undefined, 'm-blocked');
    if (blocked) {
      const sentence = el('p', blocked); sentence.id = instance + '-ask-blocked';
      blockedBlock.append(sentence);
      // Pairing in this surface cannot grant send authority, so it offers no route there.
      showRepair(sentence, initialAskBlocker()!);
      // No aria-disabled: Ask still opens the local question draft, and marking a
      // working control disabled would mislead a screen reader.
      askButton.setAttribute('aria-describedby', sentence.id);
      simulateButton.setAttribute('aria-describedby', sentence.id);
    }
    // D54: Read later is a page action. It lives once, in the footer, so the
    // selection row carries only Keep, Note, Ask and Simulate it. With nothing
    // left behind More but the term control, the disclosure goes and that control
    // sits in the card, where a page definition already placed it.
    selectionCard.replaceChildren(...(definition ? [el('p', `${definition} · from this page`, 'm-meta')] : []),
      ...(instantDefinition ? [instantDefinitionHost] : []), el('blockquote', displayAnchor(anchor)), row,
      ...(blocked ? [blockedBlock] : []), remember,
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
      if (alive()) renderQuestionContinuation();
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
  /** D49: start the existing simulate request for this passage without a separate Ask step.
   * Same draft, same saved question and the same review step the suggestion takes today;
   * every pairing, allowHelper, denied-site and send-review gate still runs unchanged. */
  function askSimulate(anchor: QuoteAnchor, review: boolean) {
    // A retained question is the reader's own text. It is never overwritten, and
    // the reason nothing changed is said once, plainly.
    const retained = questionDraft !== undefined;
    if (retained) { announce('A question is already retained on this page. Retain it in history before starting a simulation.'); return false; }
    ask(anchor);
    if (!questionDraft) return false;
    // The draft is durable before any review step, so a blocked start still keeps
    // what was asked for. After pairing the reader resumes a simulation, not a
    // blank question, and nothing is sent until the reader presses review.
    const started: QuestionDraft = { ...questionDraft, intent: 'simulate', question: suggestionOffer('simulate').question };
    void safely(async () => {
      await saveQuestion(started);
      const controls = showQuestion(started);
      if (review) await openQuestionWithHelper(controls.message, controls.reviewButton);
    });
    return true;
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
  function showQuestion(value: AskingSelection, showSkills = false) {
    questionDraft = structuredClone(value); questionArea.hidden = false; askingHost.hidden = true; questionForm.hidden = false;
    const selectionBlocker = selectionCard.querySelector<HTMLElement>('.m-blocked'); if (selectionBlocker) selectionBlocker.hidden = true;
    askingMount?.setVisible(false); showPanel(); hold(sectionFor(displayPosition(value.anchor, capture) ?? readingPosition));
    showFullReply(questionArea);
    draftMount?.destroy();
    const message = el('p', undefined, 'm-meta'), reviewButton = button('Ask', () => {});
    questionForm.replaceChildren(message);
    const current = questionDraft, generation = ++draftGeneration;
    const retainedIntent = current.intent, retainedQuestion = current.question;
    message.textContent = 'Preparing ideas.';
    void track((activeSuggestionExposure ? Promise.resolve(activeSuggestionExposure.offers) : rankedOffers(current)).then(offers => {
      if (!alive() || generation !== draftGeneration || questionDraft?.anchor.exact !== current.anchor.exact || questionArea.hidden) return;
      beginSuggestionExposure(current, offers.slice(0, 3), offers);
      draftMount = mountAskingDraft(questionForm, { id: 'm-ask-' + draftKey.replace(/[^a-z0-9]/gi, '-'),
        question: current.question, context: current.context, suggestions: offers,
        // A restored request keeps the action it was saved with when the reader
        // submits it unchanged. Edited words, or a deliberate offer, decide for themselves.
        ...(current.intent ? { retained: { intent: current.intent, question: current.question } } : {}),
        onEdit: (question, context) => { if (questionDraft) { questionDraft.question = question; questionDraft.context = context; questionDraft.intent = question === retainedQuestion ? retainedIntent : 'unsure'; void saveQuestion(questionDraft).catch(fail); } },
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
      if (showSkills) draftMount.openSkills();
      const initialBlocker = initialAskBlocker();
      if (initialBlocker) showRepair(draftMount.message, initialBlocker);
      if (current.question.trim() && !askBlockedReason()) draftMount.submit.textContent = current.intent === 'simulate' ? 'Continue simulation' : 'Continue Ask';
      const quote = el('blockquote', current.anchor.kind === 'whole-page' ? 'Whole page' : current.anchor.exact);
      quote.hidden = !!selected && canonicalReplyData(selected) === canonicalReplyData(current.anchor);
      questionForm.prepend(quote);
      if (current.answeredNote) questionForm.prepend(el('p', current.answeredNote.text, 'm-note'));
      if (questionAttachmentSaveFailed) {
        showRepair(draftMount.message, 'unsaved-context');
        draftMount.message.textContent = 'This question attachment is not saved yet.';
      }
      placeItems();
    })).catch(fail);
    placeItems();
    return { message, reviewButton };
  }
  function closeQuestion(resolution: SuggestionExposureResolution = 'dismissed') {
    if (!alive()) return;
    resolveSuggestionExposure(resolution); activeSuggestionExposure = undefined;
    ++questionRequest; ++draftGeneration; questionArea.hidden = true; draftMount?.destroy(); draftMount = undefined; askingMount?.destroy(); askingMount = undefined;
    liveReply.hidden = true;
    replyFrame.hidden = true; shell.classList.remove('m-reply-open'); restoreSavedReply();
    const selectionBlocker = selectionCard.querySelector<HTMLElement>('.m-blocked'); if (selectionBlocker) selectionBlocker.hidden = false;
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
        await questionBuffer.save(undefined); questionDraft = undefined; renderQuestionContinuation();
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
  const returnQuestion = button('Return to retained question', () => { if (questionDraft && !questionSaving) showQuestion(questionDraft); });
  const continueQuestion = button('Continue Ask', () => { void safely(async () => {
    if (!questionDraft || questionSaving || !questionArea.hidden && questionForm.hidden) return;
    const controls = showQuestion(questionDraft);
    await openQuestionWithHelper(controls.message, continueQuestion);
  }); });
  function renderQuestionContinuation() {
    if (!questionDraft) { footerSlots.retained.replaceChildren(); return; }
    if (returnQuestion.parentElement !== footerSlots.retained) footerSlots.retained.append(returnQuestion);
    continueQuestion.textContent = questionDraft.intent === 'simulate' ? 'Continue simulation' : 'Continue Ask';
    if (!questionDraft.question.trim() || askBlockedReason() || !questionArea.hidden && questionForm.hidden) continueQuestion.remove();
    else if (continueQuestion.parentElement !== footerSlots.retained) footerSlots.retained.append(continueQuestion);
  }
  async function openQuestionWithHelper(message: HTMLElement, button: HTMLButtonElement) {
    if (!questionDraft || questionSaving || !alive()) return;
    const request = ++questionRequest; questionSaving = true; button.disabled = true;
    let blocker: AskingBlocker | undefined = initialAskBlocker();
    clearRepair(message);
    message.textContent = 'Preparing request.';
    try {
      if (blocker) throw new Error(blockerMessages[blocker]);
      // A blocked request is a question draft, not an empty saved thread.
      // Check the live connection here too: selection-card state can be stale.
      const client = trustedHelper(), connection = client.connectionVersion;
      const selected = structuredClone(questionDraft), generation = draftGeneration;
      const assertCurrent = () => {
        if (!alive() || request !== questionRequest || generation !== draftGeneration || denied || trustedHelper() !== client || client.connectionVersion !== connection
          || questionDraft?.question !== selected.question || questionDraft.context !== selected.context || questionDraft.intent !== selected.intent) {
          blocker = undefined;
          throw new Error('The request context changed. Your question is retained for review.');
        }
      };
      if (!selected.threadId) {
        blocker = 'unsaved-context';
        await saveQuestion(selected); assertCurrent();
        blocker = 'disconnected';
        await options.authorizeHelperSend?.(selected.capture.url); assertCurrent();
        // Reuse the authenticated read and its response validation. A token alone
        // does not establish helper or runtime availability. The review checks again.
        blocker = 'invalid-response';
        const availability = await createAskingHost({
          request: (path, body) => client.request(path, body, signal),
          get: path => client.request(path, undefined, signal),
          replies: id => client.replies(id),
        }).availability(signal);
        assertCurrent();
        if (!availability.configured || !availability.available) {
          blocker = diagnosticsEpoch === client.connectionVersion && diagnostics.snapshot?.codex.login === 'signed-out' ? 'signed-out' : 'runtime-unavailable';
          throw new Error(blockerMessages[blocker]);
        }
        blocker = 'unsaved-context';
        selected.keepMutation ??= { id: id(), kind: 'keep', threadId: id(), capture: selected.capture, anchor: selected.anchor };
        await saveQuestion(selected); assertCurrent(); await change(selected.keepMutation); assertCurrent();
        selected.threadId = selected.keepMutation.threadId; await saveQuestion(selected);
      }
      assertCurrent();
      if (journal.unsaved || journal.state.pending.some(m => m.threadId === selected.threadId)) await sync();
      assertCurrent();
      const thread = currentThread(selected.threadId);
      if (!thread || !thread.sourceVersionId || thread.deletedAt) throw new Error('This passage could not be saved for review. Your question is retained.');
      selected.sourceVersionId = thread.sourceVersionId;
      await saveQuestion(selected);
      assertCurrent();
      askingMount ??= (options.asking ?? createT08Mount())(askingHost, {
        repair: repairRequest,
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
        retainedQuestion: value => {
          if (value.resumeJobId) activityJobId = value.resumeJobId;
          return saveQuestion(value).catch(error => { fail(error); throw error; });
        },
        onClosed: () => { if (alive()) { askingHost.hidden = true; questionForm.hidden = false; draftMount?.setVisible(true); draftMount?.focus(); renderQuestionContinuation(); } },
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
      renderQuestionContinuation();
      const opening = askingMount;
      blocker = undefined;
      activityJobId = selected.resumeJobId;
      await opening.open(selected);
      if (alive() && request === questionRequest) { liveReply.textContent = suggestionOffer(selected.intent ?? 'unsure').label; liveReply.hidden = false; placeItems(); }
      if (!alive() || request !== questionRequest) opening.setVisible(false);
    } catch (error) {
      if (alive() && request === questionRequest) {
        askingMount?.setVisible(false); questionForm.hidden = false; draftMount?.setVisible(true);
        const target = draftMount?.message ?? message;
        if (error instanceof HelperTransportError) blocker = error.kind === 'response-unknown' ? 'invalid-response' : 'disconnected';
        if (error instanceof HelperHttpError && error.status === 401) blocker = 'unpaired';
        if (error instanceof Error && error.name === 'ExcludedSite') blocker = 'excluded';
        if (blocker) showRepair(target, blocker);
        else target.textContent = error instanceof Error ? error.message : 'The review could not be opened. The draft is retained; request outcome is unconfirmed.';
      }
    } finally { questionSaving = false; button.disabled = false; if (alive()) renderQuestionContinuation(); }
  }

  function renderThreads() {
    if (!alive()) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active?.dataset.focusKey;
    const focusedThreadId = active?.closest<HTMLElement>('[data-thread]')?.dataset.thread;
    if (focusKey && focusedThreadId) expanded.add(focusedThreadId);
    const threads = orderedThreads(threadsNow(), capture);
    for (const [key, entry] of threadNodes) if (!threads.some(t => t.id === key)) { closeReplies(key); threadRelated.get(key)?.destroy(); threadRelated.delete(key); replyLoads.set(key, (replyLoads.get(key) ?? 0) + 1); entry.node.remove(); threadNodes.delete(key); }
    homeSurface.updateEmpty(threadList, threads.length);
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
    groupThreads(threads);
    marksSurface.updateThreads(threads);
    pageActions.hidden = !threads.length;
    footerCount.textContent = 'Connections';
    renderPosition(); paintHighlights();
    if (active?.isConnected && focusedThreadId && threadList.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
    if (focusKey && active && !active.isConnected) {
      const replacement = Array.from(threadList.querySelectorAll<HTMLElement>('[data-focus-key]')).find(node => node.dataset.focusKey === focusKey);
      (replacement ?? writeButton).focus();
    }
  }
  /**
   * One card per passage, for display only. The first thread at an anchor leads;
   * later threads at the same anchor move inside its expander. Nothing is merged,
   * rewritten or removed: every thread keeps its ID, notes, replies and controls,
   * and stays stored, exportable and reachable.
   */
  function groupThreads(threads: Thread[]) { homeSurface.groupThreads(threads, threadNodes); }
  /**
   * A grouped thread sits inside its lead's expander. Every explicit open, focus,
   * rail or resume path calls this first, so the target card is shown and focusable.
   */
  function revealGroup(threadId: string) {
    let enclosing = threadNodes.get(threadId)?.node.parentElement?.closest<HTMLDetailsElement>('.m-thread-repeats');
    while (enclosing) { enclosing.hidden = false; enclosing.open = true; enclosing = enclosing.parentElement?.closest<HTMLDetailsElement>('.m-thread-repeats') ?? null; }
  }
  async function openSavedThread(threadId: string, opener?: HTMLElement) {
    await locked(() => journal.load());
    const thread = currentThread(threadId);
    if (!thread || thread.deletedAt || thread.sourceUrl !== capture.url) throw new Error('The current thread is unavailable; local work is unchanged.');
    expandAdditionally(threadId); renderThreads(); hold(sectionFor(displayPosition(thread.anchor, capture) ?? 0));
    showPanel(true, opener);
    revealGroup(threadId);
    const saved = [...replyMounts.values()].find(entry => entry.threadId === threadId);
    if (saved) { showFullReply(saved.node, opener); return; }
    threadNodes.get(threadId)?.node.querySelector<HTMLElement>('.m-note, .m-source-action')?.focus({ preventScroll: true });
  }
  function renderThread(thread: Thread) {
    const node = el('section', undefined, 'm-thread'); node.id = instance + '-' + thread.id; node.dataset.thread = thread.id;
    const location = sourceLocation(thread, capture);
    const currentSection = () => { const current = currentThread(thread.id); return current ? sectionFor(displayPosition(current.anchor, capture) ?? readingPosition) : sectionIndex; };
    const preview = button(thread.notes.find(n => !n.deletedAt)?.text ?? thread.anchor.exact, () => { expandOnly(thread.id); showThreadRelated(thread); hold(currentSection()); renderPosition(); requestAnimationFrame(() => { if (alive()) threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); }); }); preview.setAttribute('aria-label', 'Open thread: ' + (thread.notes.find(note => !note.deletedAt)?.text ?? thread.anchor.exact)); preview.className = 'm-excerpt'; preview.dataset.focusKey = thread.id + ':excerpt';
    const body = el('div', undefined, 'm-thread-content');
    // Full passage text, clamped in CSS. Slicing strings cut words in half.
    const sourceText = sections[currentSection()].title;
    const sourceButton = button(sourceText, () => sourceAction(thread.anchor)); sourceButton.className = 'm-source-action'; sourceButton.setAttribute('aria-label', 'Source passage: ' + shortName(sourceText)); sourceButton.dataset.focusKey = thread.id + ':source';
    sourceButton.addEventListener('mouseenter', () => highlight(thread.anchor)); sourceButton.addEventListener('mouseleave', () => highlight(null));
    sourceButton.addEventListener('focus', () => highlight(thread.anchor)); sourceButton.addEventListener('blur', () => highlight(null));
    const sourceBlock = el('div', undefined, 'm-thread-source'); sourceBlock.append(sourceButton);
    if (location.state === 'moved' || location.state === 'lost' || location.state === 'unsure') {
      sourceBlock.append(surfaces.recovery({ threadId: thread.id, state: location.state,
        observed: hasAttachmentObservation(thread.id), pending: attachmentPending.has(thread.id), message: attachmentMessages.get(thread.id),
      }, look => {
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
      }));
    }
    const noteBlocks = homeSurface.noteBlocks(thread, {
      edit: note => beginDraft(thread.anchor, thread, note.id),
      read: note => beginDraft(thread.anchor, currentThread(thread.id), note.id),
      ask: note => ask(thread.anchor, currentThread(thread.id), { noteId: note.id, revision: note.revision, text: note.text }),
      remove: note => safely(async () => {
        await change({ id: id(), kind: 'note-remove', threadId: thread.id, noteId: note.id, removed: true, expectedRevision: note.revision });
        toast.hidden = false; const undo = actionButton(thread.id + ':' + 'undo', 'Undo', () => safely(async () => {
          const current = currentThread(thread.id)!, removed = current.notes.find(item => item.id === note.id)!;
          await change({ id: id(), kind: 'note-remove', threadId: thread.id, noteId: note.id, removed: false, expectedRevision: removed.revision });
          toast.hidden = true; threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); announce('Note restored.');
        }));
        toast.replaceChildren(el('span', 'Note removed.'), undo); undo.focus();
      }),
    });
    // The note outranks the quote. With no note, the quote reads in its place.
    sourceButton.classList.add(noteBlocks.length ? 'm-source-meta' : 'm-source-lead', 'm-clamp-2');
    if (noteBlocks.length) { body.append(...noteBlocks); if (sourceBlock.children.length > 1) { sourceButton.hidden = true; body.append(sourceBlock); } }
    else body.append(sourceBlock);
    const state = el('select'); state.dataset.focusKey = thread.id + ':state'; state.setAttribute('aria-label', 'Thread state');
    for (const value of ['open', 'parked', 'done', 'archived'] as const) { const option = el('option', value === 'parked' ? 'Read later' : value[0].toUpperCase() + value.slice(1)); option.value = value; state.append(option); } state.value = thread.state;
    state.addEventListener('change', () => void safely(async () => { await change({ id: id(), kind: 'thread-state', threadId: thread.id, expectedRevision: thread.revision, state: state.value as Thread['state'] }); announce('Thread ' + (state.value === 'parked' ? 'saved for later' : state.value) + '.'); threadNodes.get(thread.id)?.node.querySelector('select')?.focus(); }));
    const { highlightToggle, colourPicker } = marksSurface.highlightControls(thread, {
      toggle: () => safely(async () => {
      const current = currentThread(thread.id);
      if (!current) throw new Error('The saved passage is unavailable.');
      await change({ id: id(), kind: 'highlight', threadId: current.id, highlighted: !current.highlighted, expectedRevision: current.revision });
      announce(current.highlighted ? 'Highlight removed. The kept passage and thread remain.' : 'Passage highlighted on this device.');
    }),
      colour: colour => safely(async () => {
        const current = currentThread(thread.id);
        if (!current) throw new Error('The saved passage is unavailable.');
        await change({ id: id(), kind: 'highlight', threadId: current.id, highlighted: true, highlightColour: colour, expectedRevision: current.revision });
        announce(`${colour[0].toUpperCase() + colour.slice(1)} highlight selected.`);
      }),
    });
    const removeThread = actionButton(thread.id + ':' + 'remove', 'Remove', () => safely(async () => {
      await change({ id: id(), kind: 'remove', threadId: thread.id, removed: true, expectedRevision: thread.revision });
      toast.hidden = false; const undo = actionButton(thread.id + ':' + 'undo', 'Undo', () => safely(async () => { const current = journal.state.threads.find(t => t.id === thread.id)!; await change({ id: id(), kind: 'remove', threadId: thread.id, removed: false, expectedRevision: current.revision }); toast.hidden = true; threadNodes.get(thread.id)?.node.querySelector<HTMLElement>('.m-source-action')?.focus(); announce('Thread restored.'); }));
      toast.replaceChildren(el('span', 'Thread removed.'), undo); undo.focus();
    }));
    const park = actionButton(thread.id + ':park', thread.state === 'parked' ? 'Read now' : 'Read later', () => safely(async () => {
      const current = currentThread(thread.id);
      if (!current) throw new Error('The saved passage is unavailable.');
      const next = current.state === 'parked' ? 'open' : 'parked';
      await change({ id: id(), kind: 'thread-state', threadId: current.id, state: next, expectedRevision: current.revision });
      announce(next === 'parked' ? 'Thread saved for later.' : 'Thread open again.');
    }));
    const more = el('details', undefined, 'm-thread-more');
    more.append(el('summary', 'More'), actions(
      actionButton(thread.id + ':open', 'Open', () => { void safely(() => openSavedThread(thread.id)); }),
      actionButton(thread.id + ':' + 'add-note', 'Add note', () => beginDraft(thread.anchor, thread)),
      highlightToggle, ...(thread.highlighted ? [colourPicker] : []), state, removeThread));
    const tools = actions(actionButton(thread.id + ':' + 'ask', 'Ask', () => ask(thread.anchor, thread)), park, more);
    tools.classList.add('m-thread-tools');
    body.append(tools);
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
    const bodyGroup = el('div', undefined, 'm-thread-body'); bodyGroup.append(body, replyArea);
    // Display-only grouping. Every repeat of this passage keeps its own record,
    // its own node and its own controls; it only moves inside this card.
    const repeats = el('details', undefined, 'm-thread-repeats'); repeats.hidden = true; repeats.append(el('summary', ''));
    node.append(preview, bodyGroup, repeats);
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
        const replyLink = button(saved.version.reply.title ?? 'Reply', () => showFullReply(wrapper, replyLink));
        replyLink.className = 'm-reply-title'; replyLink.dataset.openReply = saved.version.id;
        if (saved.version.answeredNote) replyLink.dataset.noteId = saved.version.answeredNote.noteId;
        const title = el('h2');
        const sourceLink = button(saved.version.reply.title ?? 'Reply', () => sourceAction(thread.anchor, false)); sourceLink.className = 'm-reply-source'; title.append(sourceLink); wrapper.append(title);
        const correctionWarning = el('p', warningText, 'm-reply-correction m-meta');
        correctionWarning.setAttribute('role', 'status'); correctionWarning.hidden = !warningText;
        wrapper.append(correctionWarning);
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
          solverRecompute?.forget(); replyLink.remove();
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
        area()?.querySelector('.m-reply-list')?.append(replyLink, wrapper);
      }
      area()?.querySelector('.m-removed-replies')?.remove();
      if (removed.length) {
        const history = el('details', undefined, 'm-removed-replies');
        history.append(el('summary', 'Removed replies'));
        for (const record of removed) {
          const item = el('div', undefined, 'm-removed-reply');
          item.append(el('p', `${record.version.reply.title ?? 'Saved reply'} · ${readerDate(record.version.createdAt)}`, 'm-meta'));
          if (record.removal?.status === 'conflict') item.append(el('p', 'This reply changed elsewhere. Your choice is kept here.', 'm-meta'));
          item.append(button('Undo', () => safely(async () => { await setReplyRemoval(record, false); toast.hidden = true; })));
          history.append(item);
        }
        area()?.append(history);
      }
      message(persistence.replies.unsaved(thread.id).length ? 'Some view inputs are still only in memory after a failed save. Export them before closing this page.' : unavailable ? 'A saved reply could not be safely displayed. Original records remain available in the export.' : removed.some(record => record.removal?.status === 'conflict') ? 'This reply changed elsewhere. Your choice is kept here.' : visible.some(record => record.conflict) ? 'The helper has a different view. Local controls are preserved; use the helper view explicitly to replace them.' : visible.some(record => record.recovered?.length) ? 'Earlier view inputs are preserved in the recovery export.' : '');
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
    settingsSurface.update({
      needsReconciliation: journal.unsaved && needsReconciliation,
      needsSaving: !!(hydrationFinished && (journal.unsaved || draftBuffer.unsaved() || questionBuffer.unsaved() || persistence.suggestions.unsaved(suggestionScope).length || pendingNoteMutation || pendingNoteCommitted || draftSaveFailed || !!draft)),
      allowHelper: options.allowHelper !== false, pairingDraft, pairingFailure,
      helperOrigin: helper?.origin, helperPaired: !!helper?.token, denied, forget: !!forget,
      conflicts: sourceBoundJournal(journal.state, capture.url).conflicts,
    }, {
      recover: () => safely(async () => {
      await locked(() => journal.reconcilePersistence()); needsReconciliation = false; pendingNoteCommitted = false;
      changed(); renderThreads(); renderCompose(); renderSettings(); announce('Recovered changes need deliberate review. Your note and question drafts are retained.');
      }),
      retry: () => safely(async () => {
      if (draftAttachmentSaveFailed) { await draftBuffer.flush(); draftAttachmentSaveFailed = false; draftSaveFailed = false; announce('Draft attachment saved on this device. The note remains a draft.'); }
      else if (draft || pendingNoteMutation) await saveDraftNow();
      else { await locked(() => journal.retryPersistence()); await draftBuffer.flush(); }
      const questionWasAttachmentFailed = questionAttachmentSaveFailed;
      if (questionBuffer.unsaved()) { const retained = questionBuffer.get(); if (retained) await saveQuestion(retained); }
      if (questionWasAttachmentFailed && questionDraft && !questionArea.hidden) { showQuestion(questionDraft); announce('Question draft attachment saved on this device. The question remains a draft.'); }
      await persistence.suggestions.retry(suggestionScope);
      draftSaveFailed = false;
      if (!questionWasAttachmentFailed && questionDraft && !questionArea.hidden && !questionForm.hidden) showQuestion(questionDraft);
      changed(); renderThreads(); renderCompose(); renderSettings();
      }),
      pairingInput: value => { pairingDraft = value; },
      pair: code => safely(async () => {
          const client = helper; if (!client) throw new Error('The trusted helper connection is unavailable.');
          const previousToken = client.token;
          try { await client.pair(code.value, signal); }
          catch (error) {
            // These two exact existing protocol errors are the only evidence for
            // expiry/exhaustion versus mismatch. Transport failures stay unknown.
            if (error instanceof HelperHttpError && error.status === 403 &&
                ['Pairing expired. Request a new code from the local helper.', 'Pairing code did not match.'].includes(error.message)) {
              pairingFailure = error.message.startsWith('Pairing expired.') ? 'expired' : 'mismatch';
              focusSetting(pairingFailure === 'expired' ? 'settings:helper-page' : 'settings:pairing-code'); return;
            }
            throw error;
          }
          const epoch = client.connectionVersion;
          try { await locked(async () => { if (!alive() || client !== helper || client.connectionVersion !== epoch || !client.token) throw new Error('Pairing changed before local saving.'); await persistence.write('pairing', { origin: client.origin, token: client.token }); }); }
          catch {
            // A failed atomic local write must not leave an unsaved new token
            // masking the stored old one when the reader next disconnects.
            if (client.connectionVersion === epoch) client.token = previousToken;
            throw new Error('The new pairing was not saved on this device. The earlier local pairing is retained. The helper may still list the new pairing; inspect its paired browsers before retrying.');
          }
          if (!alive() || client !== helper || client.connectionVersion !== epoch) return;
          pairingDraft = ''; pairingFailure = undefined; code.value = ''; channel?.postMessage('pairing-changed'); renderSettings();
          // Pairing only restores the draft. Its explicit Continue action opens review.
          if (questionDraft && !questionSaving) { setup.hidden = true; showQuestion(questionDraft); }
          renderQuestionContinuation(); announce('Paired with the local helper. No queued work or model request was sent.');
      }),
      sync: () => safely(sync),
      disconnect: () => safely(async () => {
          const client = helper; if (!client) throw new Error('The local connection is unavailable.');
          const token = client.token; let removed = false;
          const result = await client.disconnect(async () => { await locked(async () => { removed = await forgetPairingIfCurrent(persistence, client.origin, token); }); if (removed) channel?.postMessage('pairing-changed'); });
          renderSettings();
          announce(result === 'replaced' || !removed ? 'A newer pairing is retained. The earlier revocation may be unconfirmed.' : result === 'unconfirmed' ? 'Local pairing removed. Remote revocation is unconfirmed; the helper may still list this browser.' : 'Local pairing removed. ' + (result === 'revoked' ? 'The helper confirmed revocation.' : 'There was no active token to revoke.'));
      }),
      theme: value => { void track(persistence.write('theme', value)).catch(fail); },
      preview: () => safely(async () => { const next = !denied; await persistence.write('denied:' + new URL(capture.url).origin, next); denied = next; renderSettings(); announce('Local preview preference saved. Helper permission records are unchanged.'); }),
      close: () => { setup.hidden = true; updateManagement(); settingsButton.focus({ preventScroll: true }); },
      diagnostics: () => {
        if (diagnosticsEpoch !== helper?.connectionVersion) diagnostics = { origin: helper?.origin ?? diagnostics.origin,
          reachability: 'checking', pairing: 'unknown' };
        return diagnostics;
      },
      refreshDiagnostics,
      resolve: (mutation, useHelper) => safely(async () => {
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
      }),
    });
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
    clearTimeout(noteSaveTimer); noteSaveTimer = undefined; ++noteOfferGeneration;
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
  const lifecycle = { destroy, async drain() {
    await predecessorDrain;
    if (noteSaveTimer && alive()) { clearTimeout(noteSaveTimer); noteSaveTimer = undefined; await track(saveNoteContinuously()); }
    while (pendingOperations.size) await Promise.allSettled([...pendingOperations]);
  } };
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
    focusThread(threadId: string) { expandAdditionally(threadId); renderThreads(); revealGroup(threadId); const thread = currentThread(threadId); if (thread) hold(sectionFor(displayPosition(thread.anchor, capture) ?? 0)); showPanel(); },
    select: showSelection,
    ...(autoAssist ? {
      showAutoAssist(next: AutoAssistReadyHelpState) { if (!alive()) return; readingPosture = next.posture; autoAssist.update(next); placeItems(); },
      clearAutoAssist() { if (!alive()) return; autoAssist.clear(); placeItems(); },
    } : {}),
    setReadingPosition(start: number) { if (alive() && !suspended && !held && Number.isFinite(start)) { const next = Math.max(0, Math.min(capture.text.length, start)); if (resumePosition !== undefined && next > resumePosition) dismissResumeLine(); if (restoredPosition && sectionFor(next) === sectionIndex) return; restoredPosition = false; if (next === readingPosition) return; beginReading(); readingPosition = next; sectionIndex = sectionFor(readingPosition); renderPosition(); if (hydrationFinished) { positionDirty = true; queueReadingPosition(); } } },
    suspend() { hearIt.stop(); highlight(null); suspended = true; diagnosticsAbort?.abort(); management?.close(); askingMount?.setVisible(false); },
    resume() { if (!alive()) return; suspended = false; updateManagement(); askingMount?.setVisible(!questionArea.hidden && questionForm.hidden); renderPosition(); for (const threadId of expanded) revealGroup(threadId); renderSettings(); paintHighlights(); },
    async openThread(threadId: string) { await openSavedThread(threadId); },
    /** D54: run one selection-card action for a passage without a pointer selection.
     * It places the passage through the same select path, then presses the same
     * control a reader presses, so every gate and review stage runs unchanged.
     * Nothing is sent here and no authority is added. */
    async selectionAction(action: 'note' | 'ask' | 'simulate', anchor: QuoteAnchor) {
      if (!alive() || !anchor.exact.trim() || displayPosition(anchor, capture) === undefined) return false;
      showSelection(anchor);
      showPanel();
      const control = selectionCard.hidden ? null : selectionCard.querySelector<HTMLButtonElement>('#m-selection-' + action);
      if (!control) return false;
      control.click();
      await lifecycle.drain();
      if (!alive()) return false;
      // True only when this passage actually reached the stage the control opens.
      // A retained draft holds the surface, so the answer is false and that draft
      // is left exactly as the reader left it.
      const here = (value: { anchor: QuoteAnchor } | undefined) => !!value && canonicalReplyData(value.anchor) === canonicalReplyData(anchor);
      if (action === 'note') return here(draft) && !compose.hidden;
      if (askBlockedReason() || questionArea.hidden || !here(questionDraft)) return false;
      return action === 'ask' || questionDraft!.intent === 'simulate';
    },
    /** D54: run the footer Read later control. Same hash and retry identity. */
    async readLater() {
      if (!alive()) return false;
      await savePage(true);
      if (!alive()) return false;
      const saved = await persistence.read<{ hash: string; threadId: string }>(savedPageKey);
      return !!saved && threadsNow().some(thread => thread.id === saved.threadId && thread.state === 'parked' && !thread.deletedAt);
    },
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
  if (options.helperManagement && document.location.hash === '#pair-helper' && managementHost.querySelector('button')) {
    setup.hidden = false; updateManagement(); managementHost.querySelector<HTMLButtonElement>('button')?.focus();
  }
  renderQuestionContinuation();
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
      }); renderSettings(); renderQuestionContinuation(); announce('Pairing changed in another margin. Earlier outcomes may be unconfirmed; nothing was automatically retried.'); });
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
