import type { Intent } from '../../contracts/reply.ts';
import { blockerActions, type AskingFlow } from './flow.ts';
import type { AskingBlocker } from './types.ts';
import type { AskingExposure, AskingState, AskingSuggestion, CompletionTrace } from './types.ts';
import { connectAskingSurfaces, type AskingSurfaces } from './surfaces.ts';
import { SUGGESTION_LABELS } from '../suggestion-policy.ts';
import { hostCopy } from './binding.ts';
import type { ReaderSkillsCatalog, ReaderSkillSelection } from '../../contracts/reader-skills.ts';

export type AskingCardOptions = Omit<AskingSurfaces, 'consentRoot' | 'replyRoot' | 'provisionalRoot' | 'onCommitted' | 'onError'> & {
  flow: AskingFlow;
  reviewOnly?: boolean;
  /** T05 chooses the presentation from the actual host, not native-panel width alone. */
  presentation?: 'inline' | 'sheet';
  suggestions?: readonly AskingSuggestion[];
  moreSuggestions?: readonly AskingSuggestion[];
  /** Optional existing local exposure recorder. No persistence authority is introduced. */
  onExposure?(event: AskingExposure): void;
  onKeep?(): void | Promise<void>;
  onPark?(): void | Promise<void>;
  onSource?(): void | Promise<void>;
  /** Prior binding is invalidated before this callback. Remount only with the newly confirmed binding. */
  onChange?(): void | Promise<void>;
  onOpenBrowserMargin?(): void | Promise<void>;
  /** Navigation only; the host retains all repair authority. */
  onRepair?(blocker: AskingBlocker): void | Promise<void>;
  onHoldReading?(): void;
  onCommitted?: AskingSurfaces['onCommitted'];
};
const traceLabels: Record<keyof CompletionTrace, string> = {
  jobId: 'Request reference', attemptId: 'Attempt reference', replyVersionId: 'Reply reference', provider: 'Connection', model: 'Model',
  grantId: 'Permission reference', preparedPayloadDigest: 'Reviewed text fingerprint', sourceVersionId: 'Source version', sourceHash: 'Source fingerprint',
  requestedAt: 'Requested', savedAt: 'Saved', attemptEndedAt: 'Finished', parentReplyId: 'Earlier reply', answeredNote: 'Answered note version',
};
const connectionLabels: Record<CompletionTrace['provider'], string> = {
  'app-server': 'Codex app connection',
  'mcp-server': 'Codex compatibility connection',
};
const planPhases = new Set<AskingState['phase']>(['submitting', 'queued', 'sending', 'working', 'provisional', 'validating', 'cancel_requested']);

/** Append to a T05 child slot at the reading position, below reader notes. Never replace the source or parent editor. */
export function mountAskingCard(host: HTMLElement, options: AskingCardOptions) {
  const doc = host.ownerDocument, flow = options.flow, binding = flow.getBinding();
  const abort = new AbortController(); let destroyed = false, exposureChosen = false;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node;
  };
  const root = make('section'); root.className = 'm-asking'; root.id = 'm-asking-' + crypto.randomUUID();
  root.dataset.presentation = options.presentation ?? 'inline'; root.setAttribute('aria-label', 'Ask about this passage');
  if (options.presentation === 'sheet') { root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'false'); }
  const breadcrumb = make('blockquote', binding.anchor.kind === 'whole-page' ? 'Whole page' : binding.anchor.exact);
  breadcrumb.className = 'm-asking__breadcrumb';
  const definition = make('section'), quote = make('blockquote'); definition.append(make('p', 'from this page'), quote);
  const noDefinition = make('p', 'No explicit definition found in the captured page. Ask to review a contextual question.');
  const actions = make('div'); actions.className = 'm-asking__actions';
  const form = make('form'), suggestions = make('div'), more = make('details'); more.append(make('summary', 'More'));
  const label = make('label', 'Your question'), input = make('textarea'); input.id = root.id + '-question'; input.rows = 2; input.maxLength = 4000; label.htmlFor = input.id; label.append(input);
  const contextDetails = make('details'), contextLabel = make('label', 'Add context'), context = make('textarea');
  context.id = root.id + '-context'; context.rows = 2; context.maxLength = 2000; contextLabel.htmlFor = context.id; contextLabel.append(context);
  contextDetails.append(make('summary', 'Add context'), contextLabel);
  const submit = make('button', 'Ask'); submit.type = 'submit'; form.append(suggestions, more, label, contextDetails, submit); form.hidden = true;
  const status = make('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const plan = make('p'); plan.hidden = true;
  const reviewEdit = make('form'); reviewEdit.hidden = true;
  const reviewLabel = make('label', 'Your question'), reviewInput = make('textarea');
  reviewInput.id = root.id + '-review-question'; reviewInput.rows = 2; reviewInput.maxLength = 4000;
  reviewLabel.htmlFor = reviewInput.id; reviewLabel.append(reviewInput);
  const reviewButton = make('button', 'Review question'); reviewButton.type = 'submit'; reviewButton.hidden = true;
  reviewEdit.append(reviewLabel, reviewButton);
  let editing: ReturnType<AskingFlow['editQuestion']>;
  reviewInput.addEventListener('input', () => {
    if (!editing) editing = flow.editQuestion();
    reviewButton.hidden = !editing;
    if (editing) { reviewEdit.hidden = false; reviewInput.readOnly = false; }
  }, { signal: abort.signal });
  reviewEdit.addEventListener('submit', event => {
    event.preventDefault();
    if (!editing || !reviewInput.value.trim()) return;
    const previous = editing; editing = undefined;
    void flow.ask(reviewInput.value === previous.question ? previous.intent : 'unsure', reviewInput.value, previous.readerSkill);
  }, { signal: abort.signal });
  const trust = make('p', 'Nothing has been asked yet.'); trust.hidden = true;
  const skillReview = make('p'); skillReview.className = 'm-asking__skill-disclosure'; skillReview.hidden = true;
  const skillWait = make('p'); skillWait.className = 'm-asking__skill-wait'; skillWait.hidden = true;
  const localStatus = make('p'); localStatus.setAttribute('role', 'status');
  const elapsed = make('p'); elapsed.hidden = true;
  const consentRoot = make('div'), provisionalRoot = make('div'), replyRoot = make('div');
  const unformattedRoot = make('section'); unformattedRoot.className = 'm-asking__unformatted'; unformattedRoot.hidden = true;
  const trace = make('details'), traceBody = make('dl'); trace.append(make('summary', 'How this was made'), traceBody); trace.hidden = true;
  const workActions = make('div'); workActions.className = 'm-asking__actions';
  root.append(breadcrumb, definition, noDefinition, actions, form, status, plan, reviewEdit, trust, skillReview, skillWait, elapsed, localStatus, consentRoot, provisionalRoot, unformattedRoot, replyRoot, trace, workActions);
  if (options.reviewOnly) { form.remove(); actions.remove(); breadcrumb.remove(); definition.remove(); noDefinition.remove(); }
  host.append(root);
  const busyButtons = new Set<HTMLButtonElement>();
  function action(text: string, callback?: () => void | Promise<void>) {
    const button = make('button', text); button.type = 'button';
    button.addEventListener('click', () => {
      if (destroyed || button.disabled || busyButtons.has(button) || !callback) return;
      busyButtons.add(button); button.disabled = true; localStatus.textContent = '';
      void Promise.resolve().then(() => { if (!destroyed) return callback(); }).catch(() => {
        if (!destroyed) localStatus.textContent = 'That action could not finish. Your passage and note remain unchanged.';
      }).finally(() => { busyButtons.delete(button); if (!destroyed) update(flow.getState()); });
    }, { signal: abort.signal });
    return button;
  }
  const keep = action('Keep', options.onKeep), park = action('Read later', options.onPark), source = action('Source passage', options.onSource);
  keep.hidden = !options.onKeep; park.hidden = !options.onPark; source.hidden = !options.onSource;
  const change = action('Change', () => { flow.invalidate(); return options.onChange?.(); }); change.hidden = !options.onChange;
  const ask = action('Ask', () => { flow.openAsk(); if (!form.hidden) input.focus({ preventScroll: true }); });
  const handoff = action('Open in browser margin', options.onOpenBrowserMargin); handoff.hidden = !options.onOpenBrowserMargin;
  const close = action('Dismiss', () => destroy());
  actions.append(keep, ask, park, source, change, handoff, close);
  const cancel = action('Cancel', () => flow.cancel()), check = action('Check status', () => flow.refresh()), retry = action('Review retry', () => flow.retry());
  const repair = make('button'); repair.type = 'button'; repair.hidden = true;
  repair.className = 'm-asking-repair';
  repair.addEventListener('click', () => {
    const state = flow.getState();
    if (destroyed || repair.disabled || !state.blocker || !['unavailable', 'excluded', 'reply-unavailable'].includes(state.phase)) return;
    if (state.blocker === 'invalid-response' && state.canCheck) { void flow.refresh(); return; }
    // Keep the existing browser transition in the initiating user gesture.
    try { void Promise.resolve(options.onRepair?.(state.blocker)).catch(() => { if (!destroyed) localStatus.textContent = 'The repair view could not be opened; your request is retained.'; }); }
    catch { localStatus.textContent = 'The repair view could not be opened; your request is retained.'; }
  }, { signal: abort.signal });
  root.append(repair);
  workActions.append(cancel, check, retry);
  let intent: Intent = binding.answeredNote ? 'unsure' : 'define';
  const offered = hostCopy(options.suggestions ?? [{ id: 'context', label: binding.answeredNote ? 'Ask about my note' : 'Define in context', intent,
    question: binding.answeredNote ? 'Help me with the question in my note.' : 'What does this mean in this passage?', time: 'quick' }]).slice(0, 3);
  const additional = hostCopy(options.moreSuggestions ?? []).slice(0, 32);
  function exposure(kind: AskingExposure['kind'], choice?: string) {
    try { options.onExposure?.({ kind, captureId: binding.captureId, threadId: binding.threadId, positions: offered.map(s => s.id), ...(choice ? { choice } : {}) }); }
    catch { /* Logging is local optional observation, never authority or a prerequisite for saving. */ }
  }
  const suggestionButtons: HTMLButtonElement[] = [];
  for (const [parent, items] of [[suggestions, offered], [more, additional]] as const) {
    for (const item of items) {
      const button = action(SUGGESTION_LABELS[item.intent], () => {
        intent = item.intent; input.value = item.question; exposureChosen = true; exposure('choice', item.id); input.focus({ preventScroll: true });
      }); suggestionButtons.push(button); parent.append(button);
    }
  }
  more.hidden = additional.length === 0;
  form.addEventListener('submit', event => {
    event.preventDefault(); if (destroyed || submit.disabled) return;
    const question = input.value + (context.value.trim() ? '\n\nReader-stated context:\n' + context.value.trim() : '');
    exposureChosen = true; exposure('choice', 'free-text'); void flow.ask(intent, question);
  }, { signal: abort.signal });
  root.addEventListener('focusin', () => { try { options.onHoldReading?.(); } catch { /* Never navigate source implicitly. */ } }, { signal: abort.signal });
  let confirmEscape = false;
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || consentRoot.contains(event.target as Node)) return;
    event.preventDefault(); event.stopPropagation();
    if (planPhases.has(flow.getState().phase) && !confirmEscape) {
      confirmEscape = true;
      localStatus.textContent = 'Work is in progress. Press Escape again to dismiss this view; the request will continue.';
      return;
    }
    destroy();
  }, { signal: abort.signal });
  const surfaces = connectAskingSurfaces(flow, { ...options, consentRoot, replyRoot, provisionalRoot, returnFocus: input,
    onError: message => { if (!destroyed) localStatus.textContent = message; },
    onCommitted: result => {
      if (destroyed) return;
      trace.hidden = false; traceBody.replaceChildren();
      for (const [key, value] of Object.entries(result.trace).filter(([key]) => ['provider', 'requestedAt', 'savedAt', 'attemptEndedAt'].includes(key))) traceBody.append(make('dt', traceLabels[key as keyof CompletionTrace]),
        make('dd', key === 'provider' ? connectionLabels[value as CompletionTrace['provider']]
          : typeof value === 'object' ? `${value.noteId}, version ${value.revision}` : value));
      options.onCommitted?.(result);
    },
  });
  function update(state: AskingState) {
    if (destroyed) return;
    if (!planPhases.has(state.phase)) confirmEscape = false;
    root.dataset.state = state.phase;
    definition.hidden = !state.definition; noDefinition.hidden = !!state.definition || state.phase !== 'local';
    const definitionText = state.definition?.text ?? ''; if (quote.textContent !== definitionText) quote.textContent = definitionText;
    if (status.textContent !== state.message) status.textContent = state.message;
    const repairing = !!state.blocker && ['unavailable', 'excluded', 'reply-unavailable'].includes(state.phase);
    repair.hidden = !repairing || !options.onRepair;
    if (repairing) repair.textContent = blockerActions[state.blocker!];
    reviewEdit.hidden = !(editing && state.phase === 'suggestions') && !flow.canEditQuestion?.();
    reviewInput.readOnly = !editing && !flow.canEditQuestion?.();
    if (!editing && state.phase === 'consent') reviewInput.value = state.question ?? '';
    reviewButton.hidden = !editing;
    trust.hidden = state.phase !== 'consent';
    const reviewed = state.preparation && state.intent && planPhases.has(state.phase)
      ? `${SUGGESTION_LABELS[state.intent]} with ${state.preparation.preview.recipientLabel}.` : '';
    plan.hidden = !reviewed; if (plan.textContent !== reviewed) plan.textContent = reviewed;
    const reviewingSkill = state.preparation?.job.readerSkill;
    skillReview.hidden = !reviewingSkill || !['consent', 'deciding', 'submitting'].includes(state.phase);
    if (!skillReview.hidden && reviewingSkill) {
      skillReview.replaceChildren(doc.createTextNode('This runs your own skill '), doc.createTextNode(reviewingSkill.name),
        doc.createTextNode(' with this passage. It can take up to 15 minutes.'));
    }
    const waitingForSkill = state.job?.context.readerSkill && ['queued', 'sending', 'working', 'provisional', 'validating', 'cancel_requested'].includes(state.phase);
    skillWait.hidden = !waitingForSkill;
    if (waitingForSkill) skillWait.textContent = 'This can take up to 15 minutes.';
    const unformatted = state.phase === 'failed' ? state.job?.unformatted : undefined;
    unformattedRoot.hidden = !unformatted;
    unformattedRoot.replaceChildren();
    if (unformatted) {
      const heading = make('h3', 'Unformatted skill output');
      const sourceLine = make('p'); sourceLine.replaceChildren(doc.createTextNode('From your skill: '),
        doc.createTextNode(unformatted.readerSkill.name), doc.createTextNode('. Marginalia did not check these sources.'));
      const output = make('pre'); output.textContent = unformatted.text;
      unformattedRoot.append(heading, sourceLine, output);
    }
    elapsed.hidden = state.elapsedSeconds === undefined;
    const duration = state.elapsedSeconds === undefined ? '' : `${state.elapsedSeconds} s elapsed.`;
    if (elapsed.textContent !== duration) elapsed.textContent = duration;
    if (state.phase !== 'local') form.hidden = false;
    const editable = state.canAsk && ['suggestions', 'unavailable', 'cancelled', 'reply-unavailable'].includes(state.phase);
    submit.disabled = !editable; input.readOnly = !editable; context.readOnly = !editable;
    for (const button of suggestionButtons) button.disabled = !editable || busyButtons.has(button);
    ask.disabled = !state.canAsk || busyButtons.has(ask);
    cancel.hidden = !state.canCancel && !['cancel_requested', 'submitting', 'sending', 'working', 'provisional', 'unknown'].includes(state.phase);
    cancel.disabled = !state.canCancel || busyButtons.has(cancel);
    check.hidden = !state.canCheck || repairing; check.disabled = !state.canCheck || busyButtons.has(check);
    retry.hidden = !state.canRetry; retry.disabled = !state.canRetry || busyButtons.has(retry);
    const stale = state.phase === 'stale' || state.phase === 'closed';
    for (const button of [keep, park, source, change]) button.disabled = stale || busyButtons.has(button);
    close.disabled = busyButtons.has(close);
    handoff.hidden = !!options.onRepair || !options.onOpenBrowserMargin || state.blocker !== 'browser-owned-required'; handoff.disabled = stale || busyButtons.has(handoff);
    trace.hidden = !state.result;
  }
  const unsubscribe = flow.subscribe(update);
  // Local elapsed clock and lifetime reconciliation only. Never poll or dispatch from this timer.
  const timer = setInterval(() => { if (!destroyed) { flow.reconcile(); update(flow.getState()); } }, 1000);
  exposure('shown');
  function destroy() {
    if (destroyed) return;
    const ownedFocus = root.contains(doc.activeElement);
    destroyed = true; clearInterval(timer); unsubscribe(); abort.abort(); surfaces.destroy(); root.remove();
    if (!exposureChosen) exposure('no-choice');
    if (ownedFocus && options.returnFocus?.isConnected) options.returnFocus.focus({ preventScroll: true });
  }
  return { destroy };
}

/** The single draft editor. It works before a saved helper binding exists. */
export function mountAskingDraft(host: HTMLElement, options: {
  id: string; question: string; context: string; suggestions: readonly AskingSuggestion[];
  /** A function defers the local catalog read until the reader opens More. */
  readerSkills?: Promise<ReaderSkillsCatalog> | (() => Promise<ReaderSkillsCatalog>);
  moreAction?: HTMLElement;
  /** A restored request and the words it was restored with. Submitting those exact
   * words again resumes that action. Edited words are a plain question again. */
  retained?: { intent: Intent; question: string };
  onEdit(question: string, context: string): void;
  onChoose(intent: Intent, question: string, context: string, readerSkill?: ReaderSkillSelection): Promise<void>;
  onMore(): void; onIdeas(): Promise<readonly AskingSuggestion[]>;
  onClose(): void; onKeep(): void; onPark(): void;
}) {
  const doc = host.ownerDocument, abort = new AbortController();
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node;
  };
  const form = make('form'); form.className = 'm-asking-draft'; form.id = options.id;
  const top = make('div'); top.className = 'm-offers';
  const input = make('textarea'); input.rows = 3; input.id = options.id + '-question'; input.maxLength = 4000;
  input.placeholder = 'Ask something else\u2026'; input.setAttribute('aria-label', 'Your question'); input.value = options.question;
  const more = make('details'); more.append(make('summary', 'More'));
  const extra = make('div'), contextDetails = make('details'), context = make('textarea');
  context.setAttribute('aria-label', 'Context to attach'); context.id = options.id + '-context'; context.value = options.context; context.maxLength = 2000;
  const label = make('label', 'Add context'); label.htmlFor = context.id; label.append(context);
  contextDetails.append(make('summary', 'Add context'), label); more.append(extra, contextDetails);
  const moreActionParent = options.moreAction?.parentElement;
  if (options.moreAction) { more.append(options.moreAction); if (moreActionParent) moreActionParent.hidden = true; }
  const ideas = make('button', 'More ideas'); ideas.type = 'button'; ideas.hidden = true;
  const submit = make('button', 'Ask'); submit.type = 'submit';
  const useSkill = make('button', 'Use a skill'); useSkill.type = 'button'; useSkill.className = 'm-asking-draft__use-skill'; useSkill.hidden = true;
  const skillList = make('div'); skillList.className = 'm-asking-draft__skills'; skillList.hidden = true;
  const message = make('p'); message.setAttribute('role', 'status');
  form.append(top, input, submit, more, ideas, useSkill, skillList, message); host.replaceChildren(form);
  let offers = [...options.suggestions], busy = false, disposed = false;
  function edit() { options.onEdit(input.value, context.value); ideas.hidden = false; }
  input.addEventListener('input', edit, { signal: abort.signal }); context.addEventListener('input', edit, { signal: abort.signal });
  async function choose(intent: Intent, question: string, readerSkill?: ReaderSkillSelection) {
    if (busy || disposed) return; busy = true;
    try { options.onEdit(question, context.value); await options.onChoose(intent, question, context.value, readerSkill); }
    catch (error) { message.textContent = error instanceof Error ? error.message : 'Your question could not be saved. Try again.'; }
    finally { busy = false; }
  }
  function draw() {
    top.replaceChildren(); extra.replaceChildren();
    offers.forEach((item, index) => {
      const row = make('div'); row.className = 'm-suggestion';
      const button = make('button', item.label); button.type = 'button'; button.id = options.id + '-' + item.intent;
      button.dataset.intent = item.intent;
      if (index < 3) row.append(make('span', String(index + 1)));
      row.append(button);
      if (item.time === 'longer') { const time = make('span', 'a few minutes'); time.className = 'm-suggestion-time'; row.append(time); }
      button.addEventListener('click', () => { input.value = item.question; void choose(item.intent, item.question); }, { signal: abort.signal });
      (index < 3 ? top : extra).append(row);
    });
  }
  draw();
  const showSkills = (pending: Promise<ReaderSkillsCatalog>): void => void pending.then(catalog => {
    if (disposed || catalog.status !== 'ready' || !catalog.revision || catalog.skills.length === 0) return;
    const revision = catalog.revision;
    for (const skill of catalog.skills) {
      const row = make('div'); row.className = 'm-asking-draft__skill';
      const select = make('button'); select.type = 'button';
      const name = make('span'); name.textContent = skill.name;
      const description = make('span'); description.className = 'm-asking-draft__skill-description'; description.textContent = skill.description;
      select.append(name, description);
      select.addEventListener('click', () => {
        const question = input.value.trim() || 'Run this skill on this passage.';
        input.value = question; void choose('unsure', question, { name: skill.name, catalogRevision: revision });
      }, { signal: abort.signal });
      row.append(select); skillList.append(row);
    }
    useSkill.hidden = false;
  }).catch(() => { /* Catalog failure is intentionally silent. */ });
  const skillSource = options.readerSkills; let skillsAsked = false;
  if (skillSource && typeof skillSource !== 'function') showSkills(skillSource);
  more.addEventListener('toggle', () => { if (!more.open || skillsAsked || typeof skillSource !== 'function') return; skillsAsked = true; showSkills(Promise.resolve().then(skillSource)); }, { signal: abort.signal });
  useSkill.addEventListener('click', () => { skillList.hidden = !skillList.hidden; }, { signal: abort.signal });
  more.addEventListener('toggle', () => { if (more.open) options.onMore(); }, { signal: abort.signal });
  ideas.addEventListener('click', () => { if (ideas.disabled) return; ideas.disabled = true; void options.onIdeas().then(next => { if (disposed) return; offers = [...next]; draw(); ideas.hidden = true; if (more.open) options.onMore(); }).catch(() => { if (!disposed) message.textContent = 'New ideas could not be loaded. Your current offers remain here.'; }).finally(() => { ideas.disabled = false; }); }, { signal: abort.signal });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input.value.trim()) return;
    const resumed = options.retained && input.value === options.retained.question;
    void choose(resumed ? options.retained!.intent : 'unsure', input.value);
  }, { signal: abort.signal });
  form.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const index = ['1', '2', '3'].indexOf(event.key);
    if (index >= 0) { event.preventDefault(); top.querySelectorAll<HTMLButtonElement>('button')[index]?.click(); }
    else if (event.key === '/') { event.preventDefault(); input.focus({ preventScroll: true }); }
    else if (event.key.toLowerCase() === 'k') { event.preventDefault(); options.onKeep(); }
    else if (event.key.toLowerCase() === 'p') { event.preventDefault(); options.onPark(); }
    else if (event.key === 'Escape') { event.preventDefault(); options.onClose(); }
  }, { signal: abort.signal });
  return { message, submit,
    openSkills() {
      more.open = true; skillList.hidden = false;
      if (!skillsAsked && typeof skillSource === 'function') { skillsAsked = true; showSkills(Promise.resolve().then(skillSource)); }
    },
    chooseIndex: (index: number) => top.querySelectorAll<HTMLButtonElement>('button')[index]?.click(), setVisible: (visible: boolean) => { if (visible) host.append(form); else form.remove(); }, focus: () => input.focus(), changed: () => { ideas.hidden = false; }, destroy: () => { disposed = true; abort.abort(); if (options.moreAction && moreActionParent?.isConnected) { moreActionParent.append(options.moreAction); moreActionParent.hidden = false; } form.remove(); } };
}
