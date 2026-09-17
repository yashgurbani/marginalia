import type { Intent } from '../../contracts/reply.ts';
import type { AskingFlow } from './flow.ts';
import type { AskingExposure, AskingState, AskingSuggestion, CompletionTrace } from './types.ts';
import { connectAskingSurfaces, type AskingSurfaces } from './surfaces.ts';
import { hostCopy } from './binding.ts';

export type AskingCardOptions = Omit<AskingSurfaces, 'consentRoot' | 'replyRoot' | 'provisionalRoot' | 'onCommitted' | 'onError'> & {
  flow: AskingFlow;
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
const intentLabels: Record<Intent, string> = {
  define: 'Explain this passage', simulate: 'Simulate this idea', instantiate: 'Show a concrete example', derive: 'Work through the steps',
  diagram: 'Make a diagram', evidence: 'Check supporting evidence', explore: 'Explore further', unsure: 'Answer this question',
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
  const form = make('form'), suggestions = make('div'), more = make('details'); more.append(make('summary', 'More ideas'));
  const label = make('label', 'Your question'), input = make('textarea'); input.id = root.id + '-question'; input.rows = 2; input.maxLength = 4000; label.htmlFor = input.id; label.append(input);
  const contextDetails = make('details'), contextLabel = make('label', 'Stated context (included in the reviewed question)'), context = make('textarea');
  context.id = root.id + '-context'; context.rows = 2; context.maxLength = 2000; contextLabel.htmlFor = context.id; contextLabel.append(context);
  contextDetails.append(make('summary', 'What should the reply assume you know?'), contextLabel);
  const submit = make('button', 'Ask'); submit.type = 'submit'; form.append(suggestions, more, label, contextDetails, submit); form.hidden = true;
  const status = make('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const plan = make('p'); plan.setAttribute('aria-label', 'Reviewed plan'); plan.hidden = true;
  const localStatus = make('p'); localStatus.setAttribute('role', 'status');
  const elapsed = make('p'); elapsed.setAttribute('aria-label', 'Elapsed time'); elapsed.hidden = true;
  const consentRoot = make('div'), provisionalRoot = make('div'), replyRoot = make('div');
  const trace = make('details'), traceBody = make('dl'); trace.append(make('summary', 'Completion record'), traceBody); trace.hidden = true;
  const workActions = make('div'); workActions.className = 'm-asking__actions';
  root.append(breadcrumb, definition, noDefinition, actions, form, status, plan, elapsed, localStatus, consentRoot, provisionalRoot, replyRoot, trace, workActions);
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
  const keep = action('Keep', options.onKeep), park = action('Park', options.onPark), source = action('Source passage', options.onSource);
  keep.hidden = !options.onKeep; park.hidden = !options.onPark; source.hidden = !options.onSource;
  const change = action('Change', () => { flow.invalidate(); return options.onChange?.(); }); change.hidden = !options.onChange;
  const ask = action('Ask', () => { flow.openAsk(); if (!form.hidden) input.focus({ preventScroll: true }); });
  const handoff = action('Open in browser margin', options.onOpenBrowserMargin); handoff.hidden = !options.onOpenBrowserMargin;
  const close = action('Dismiss', () => destroy());
  actions.append(keep, ask, park, source, change, handoff, close);
  const cancel = action('Cancel', () => flow.cancel()), check = action('Check status', () => flow.refresh()), retry = action('Review retry', () => flow.retry());
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
      const button = action(item.label + (item.time === 'longer' ? ' (takes longer)' : ''), () => {
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
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !consentRoot.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); destroy(); }
  }, { signal: abort.signal });
  const surfaces = connectAskingSurfaces(flow, { ...options, consentRoot, replyRoot, provisionalRoot, returnFocus: input,
    onError: message => { if (!destroyed) localStatus.textContent = message; },
    onCommitted: result => {
      if (destroyed) return;
      trace.hidden = false; traceBody.replaceChildren();
      for (const [key, value] of Object.entries(result.trace)) traceBody.append(make('dt', traceLabels[key as keyof CompletionTrace]),
        make('dd', key === 'provider' ? connectionLabels[value as CompletionTrace['provider']]
          : typeof value === 'object' ? `${value.noteId}, version ${value.revision}` : value));
      options.onCommitted?.(result);
    },
  });
  function update(state: AskingState) {
    if (destroyed) return;
    root.dataset.state = state.phase;
    definition.hidden = !state.definition; noDefinition.hidden = !!state.definition || state.phase !== 'local';
    const definitionText = state.definition?.text ?? ''; if (quote.textContent !== definitionText) quote.textContent = definitionText;
    if (status.textContent !== state.message) status.textContent = state.message;
    const reviewed = state.preparation && state.intent && planPhases.has(state.phase)
      ? `Reviewed plan: ${intentLabels[state.intent]} with ${state.preparation.preview.recipientLabel} using ${state.preparation.job.model}.`
      : '';
    plan.hidden = !reviewed; if (plan.textContent !== reviewed) plan.textContent = reviewed;
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
    check.hidden = !state.canCheck; check.disabled = !state.canCheck || busyButtons.has(check);
    retry.hidden = !state.canRetry; retry.disabled = !state.canRetry || busyButtons.has(retry);
    const stale = state.phase === 'stale' || state.phase === 'closed';
    for (const button of [keep, park, source, change]) button.disabled = stale || busyButtons.has(button);
    close.disabled = busyButtons.has(close);
    handoff.hidden = !options.onOpenBrowserMargin || state.blocker !== 'browser-owned-required'; handoff.disabled = stale || busyButtons.has(handoff);
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
