import type { ConsentSheet, ConsentSheetOptions } from '../consent.ts';
import type { MountedReply, ReplyOptions, FollowupContext } from '../../renderer/index.ts';
import type { CandidateReply } from '../../contracts/reply.ts';
import type { AskingFlow } from './flow.ts';
import type { AskingResult, AskingState } from './types.ts';
import { hostCopy } from './binding.ts';

export type AskingSurfaces = {
  consentRoot: HTMLElement;
  replyRoot: HTMLElement;
  provisionalRoot: HTMLElement;
  mountConsent(host: HTMLElement, options: ConsentSheetOptions): ConsentSheet;
  mountReply(host: HTMLElement, reply: CandidateReply, options: ReplyOptions): MountedReply;
  /** The default is a labelled literal provisional text view, never the committed renderer. */
  mountProvisional?(host: HTMLElement, reply: CandidateReply): { destroy(): void };
  replyOptions(result: AskingResult): Omit<ReplyOptions, 'sourceText' | 'hostReport' | 'onFollowup'>;
  returnFocus?: HTMLElement;
  onCommitted?(result: AskingResult): void;
  onError?(message: string): void;
};

/** Explicitly visible inputs become question text, not an unrecorded side channel or a slider-triggered request. */
export function followupQuestion(context: FollowupContext): string {
  if (typeof context?.text !== 'string') throw new Error('Write a follow-up question.');
  const values = Object.entries(context.parameters ?? {});
  if (values.length > 32 || values.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== 'number' || !Number.isFinite(value)))
    throw new Error('These current inputs could not be included.');
  const question = context.text.trim() + (values.length ? '\n\nCurrent reader-selected inputs:\n' + values.map(([name, value]) => `${name} = ${value}`).join('\n') : '');
  if (!context.text.trim() || question.length > 4000) throw new Error('Keep the question and current inputs within 4,000 characters.');
  return question;
}

/** Plain first content from an already structurally validated host partial. No titles/classifications/links execute or gain authority. */
export function mountProvisionalText(host: HTMLElement, candidate: CandidateReply): { destroy(): void } {
  const doc = host.ownerDocument, root = doc.createElement('section'); root.className = 'm-asking__provisional';
  root.setAttribute('aria-label', 'Provisional reply');
  const label = doc.createElement('p'); label.textContent = 'Provisional. This reply has not finished its checks or been saved as complete.';
  const content = doc.createElement('p');
  content.textContent = candidate.staticFallback || 'A provisional reply is available. The finished reply is not ready.';
  root.append(label, content); host.append(root);
  return { destroy() { root.remove(); } };
}

/** Stable existing consent/committed surfaces, confined to T05-owned child slots. */
export function connectAskingSurfaces(flow: AskingFlow, options: AskingSurfaces) {
  let destroyed = false, revision = 0, sheet: ConsentSheet | undefined, sheetKey = '';
  let partial: { destroy(): void } | undefined, partialKey = '';
  const replies = new Map<string, { mount: MountedReply; root: HTMLElement }>();
  const announced = new Set<string>();
  function report(message: string) { if (!destroyed) { try { options.onError?.(message); } catch { /* Display only. */ } } }
  function dispose(item: { destroy(): void } | undefined) { try { item?.destroy(); } catch { report('A view could not be fully removed. Reopen this margin before continuing.'); } }
  function isCurrent(result: AskingResult): boolean {
    const latest = flow.getState();
    return [latest.previousResult, latest.result].some(value => value?.reply.id === result.reply.id && value.reply.hash === result.reply.hash);
  }
  function update(state: AskingState) {
    if (destroyed) return;
    const version = ++revision;
    const preview = ['consent', 'deciding'].includes(state.phase) ? state.preparation?.preview : undefined;
    const nextSheet = preview ? `${preview.id}:${preview.revision}:${preview.payloadDigest}` : '';
    if (nextSheet !== sheetKey) {
      const old = sheet; sheet = undefined; sheetKey = nextSheet; dispose(old);
      if (destroyed || version !== revision) return;
      if (preview) {
        try {
          const a = flow.getAccess();
          const preparation = state.preparation!;
          const mounted = options.mountConsent(options.consentRoot, { preview: hostCopy(preview),
            reviewedPlan: hostCopy({ previewId: preview.id, previewRevision: preview.revision,
              preparedPayloadDigest: preparation.job.preparedPayloadDigest,
              capabilities: preparation.job.capabilities ?? [] }), surface: a.surface,
            canAuthorize: a.paired && a.canAuthorize && !a.excluded, returnFocus: options.returnFocus,
            decide: (choice, exactPreview, signal) => flow.choose(choice, exactPreview, signal), onNotNow: () => flow.dismissPreview(),
            // No onGranted dispatch: the existing sheet also invokes it for Never.
          });
          if (destroyed || version !== revision || sheetKey !== nextSheet) dispose(mounted); else sheet = mounted;
        } catch { flow.dismissPreview(); report('The permission review could not open. Nothing was asked.'); }
      }
    }
    if (destroyed || version !== revision) return;
    // Keep the parent mounted while its follow-up is reviewed or running; never overwrite a kept version.
    const desired = [state.previousResult, state.result].filter((r): r is AskingResult => !!r);
    const keys = new Set(desired.map(r => `${r.reply.id}:${r.reply.hash}`));
    for (const [key, value] of replies) if (!keys.has(key)) { replies.delete(key); dispose(value.mount); value.root.remove(); }
    for (const result of desired) {
      if (destroyed || version !== revision) return;
      const key = `${result.reply.id}:${result.reply.hash}`;
      if (replies.has(key)) continue;
      const root = options.replyRoot.ownerDocument.createElement('section');
      root.className = 'm-asking__saved'; options.replyRoot.append(root);
      // The note quote is reader-authored evidence above this reply, not generated text.
      if (result.reply.answeredNote) {
        const label = root.ownerDocument.createElement('p'); label.textContent = `Reply to note version ${result.reply.answeredNote.revision}`;
        const quote = root.ownerDocument.createElement('blockquote'); quote.textContent = result.reply.answeredNote.text;
        root.append(label, quote);
      }
      try {
        const supplied = options.replyOptions(hostCopy(result));
        if (destroyed || version !== revision || !isCurrent(result)) { root.remove(); return; }
        const mount = options.mountReply(root, hostCopy(result.reply.reply), {
          ...supplied,
          ...(result.view && !supplied.initialState ? { initialState: { parameters: result.view.parameters, view: result.view.view } } : {}),
          sourceText: result.source.text, hostReport: hostCopy(result.reply.validation),
          onFollowup: async context => {
            if (destroyed || flow.getState().result?.reply.id !== result.reply.id) throw new Error('Open the latest chosen reply to continue it.');
            await flow.followup(followupQuestion(context));
          },
        });
        if (destroyed || version !== revision || !isCurrent(result)) { dispose(mount); root.remove(); return; }
        replies.set(key, { mount, root });
        if (state.result?.reply.id === result.reply.id && !announced.has(key)) {
          announced.add(key);
          try { options.onCommitted?.(hostCopy(result)); } catch { report('The reply is saved, but its completion notification could not finish.'); }
        }
      } catch { root.remove(); report('The saved reply could not be displayed. It remains in its thread; reopen it without asking twice.'); }
    }
    if (destroyed || version !== revision) return;
    const candidate = state.result ? undefined : state.provisional;
    const nextPartial = candidate ? JSON.stringify(candidate) : '';
    if (nextPartial !== partialKey) {
      const old = partial; partial = undefined; partialKey = nextPartial; dispose(old);
      if (destroyed || version !== revision) return;
      if (candidate) {
        try {
          const mounted = (options.mountProvisional ?? mountProvisionalText)(options.provisionalRoot, hostCopy(candidate));
          if (destroyed || version !== revision) dispose(mounted); else partial = mounted;
        } catch { report('The provisional view is unavailable. The finished reply is not ready yet.'); }
      }
    }
  }
  const unsubscribe = flow.subscribe(update);
  return { destroy() {
    if (destroyed) return;
    destroyed = true; revision++; unsubscribe(); flow.close();
    dispose(sheet); dispose(partial);
    for (const value of replies.values()) { dispose(value.mount); value.root.remove(); }
    replies.clear(); sheet = undefined; partial = undefined;
  } };
}
