import { runtimeDisclosureReceipt } from './persistence.ts';
import type { AskingDisclosure } from './asking/types.ts';
import type { ConsentChoice, ConsentGrant, ConsentPreview, SiteExclusion } from '../contracts/consent.ts';
import type { ReplyCapability } from '../contracts/reply.ts';

export type ConsentReviewedPlan = {
  /** Identity of the exact consent preview this host-owned plan accompanies. */
  previewId: string;
  previewRevision: number;
  /** Must remain the same digest as the reviewed, model-visible envelope. */
  preparedPayloadDigest: string;
  capabilities: readonly ReplyCapability[];
};

export type ConsentSheetOptions = {
  preview: ConsentPreview;
  disclosure?: AskingDisclosure;
  /** Display-only projection of the already prepared host plan. It grants no authority. */
  reviewedPlan?: ConsentReviewedPlan;
  canAuthorize: boolean;
  /** Layout context, not a grant of authority. Floating page hosts cannot authorize. */
  surface?: 'native-panel' | 'floating' | 'localhost';
  decide(choice: ConsentChoice, preview: ConsentPreview, signal: AbortSignal): Promise<ConsentGrant>;
  onGranted?(grant: ConsentGrant, decidedPreview: ConsentPreview): void;
  onNotNow?(): void;
  /** Compatibility callback when onNotNow is not supplied. */
  onBack?(): void;
  /** Open the existing host-owned settings surface; this sheet owns no settings UI. */
  onOpenSettings?(): void;
  returnFocus?: HTMLElement;
};

export type ConsentSheet = { updateDisclosure?(disclosure: AskingDisclosure): void; update(preview: ConsentPreview): void; destroy(): void };

/** A modular browser-owned consent surface. Page-embedded margins pass canAuthorize:false. */
export function mountConsentSheet(host: HTMLElement, options: ConsentSheetOptions): ConsentSheet {
  const surface = options.surface ?? 'native-panel';
  if (!['native-panel', 'floating', 'localhost'].includes(surface)) throw new Error('Unknown consent surface.');
  const canAuthorize = options.canAuthorize && surface !== 'floating';
  const returnFocus = options.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const abort = new AbortController();
  let preview = structuredClone(options.preview), busy = false, destroyed = false, generation = 0;
  let pendingDecision: AbortController | undefined;
  const root = document.createElement('section');
  // Escape/Cancel exits; the page remains interactive, so do not claim modality.
  root.className = 'm-consent'; root.dataset.surface = surface; root.tabIndex = -1;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', `m-consent-title-${safeId(preview.id)}`);
  const live = document.createElement('p'); live.className = 'm-consent__status'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  host.replaceChildren(root);

  let disclosure = options.disclosure, shownHere: string | null = null;
  const disclosureLine = element('p', undefined, 'm-consent__disclosure');
  function renderDisclosure() {
    const version = disclosure?.disclosureVersion;
    const show = !!disclosure?.unverified.length && !!version &&
      (shownHere === version || runtimeDisclosureReceipt.read() !== version);
    const ownSetup = 'Marginalia uses your own Codex setup, including its settings and tools.';
    disclosureLine.textContent = show
      ? disclosure?.unverified.includes(ownSetup) ? ownSetup : 'Marginalia cannot yet confirm the limits Codex runs under on this device: where sign-in came from, inherited settings, and access to files, tools and the network.'
      : '';
    disclosureLine.hidden = !show;
    if (show) { shownHere = version; runtimeDisclosureReceipt.shown(version); }
  }
  const render = () => {
    const title = element('h2', 'Send this passage to Codex', 'm-consent__title'); title.id = `m-consent-title-${safeId(preview.id)}`; title.tabIndex = -1;
    const summary = element('dl', undefined, 'm-consent__summary');
    const scopeLabel = preview.scope === 'open-session' ? 'Codex for this site; web checks are not available yet' : preview.scopeLabel;
    summary.append(element('dt', 'Recipient'), element('dd', preview.recipientLabel), element('dt', 'Permission'), element('dd', scopeLabel));
    const reading = element('div', undefined, 'm-consent__reading');
    for (const part of preview.outgoing) {
      if (part.label !== 'Bounded reading packet') continue;
      try {
        const packet: unknown = JSON.parse(part.text);
        if (!packet || typeof packet !== 'object' || !('selection' in packet)) continue;
        const selection = packet.selection;
        if (selection && typeof selection === 'object' && 'exact' in selection && typeof selection.exact === 'string')
          reading.append(element('h3', 'The passage'), element('blockquote', selection.exact));
        if ('answeredNote' in packet && packet.answeredNote && typeof packet.answeredNote === 'object' &&
            'text' in packet.answeredNote && typeof packet.answeredNote.text === 'string')
          reading.append(element('h3', 'Your note'), element('p', packet.answeredNote.text));
        if ('question' in packet && typeof packet.question === 'string') reading.append(element('h3', 'Your question'), element('p', packet.question));
      } catch { /* Exact outgoing bytes remain available even without a readable projection. */ }
    }
    const exact = element('details', undefined, 'm-consent__outgoing');
    exact.append(element('summary', 'What is sent'));
    for (const part of preview.outgoing) {
      const item = element('section', undefined, 'm-consent__part');
      const heading = element('h3', outgoingLabel(part.label)); heading.id = `m-consent-part-${safeId(preview.id)}-${exact.children.length}`;
      const outgoing = element('pre', part.text); outgoing.tabIndex = 0; outgoing.setAttribute('aria-labelledby', heading.id);
      item.append(heading, outgoing); exact.append(item);
    }
    const reviewedPlan = options.reviewedPlan;
    const canRunSavedSolver = reviewedPlan?.previewId === preview.id &&
      reviewedPlan.previewRevision === preview.revision &&
      reviewedPlan.preparedPayloadDigest === preview.bindingDigest &&
      reviewedPlan.capabilities.includes('solver');
    const capability = canRunSavedSolver
      ? element('p', 'If the reply includes a saved solver, Marginalia can run the model locally when you use its controls.', 'm-consent__note')
      : undefined;
    const explanation = preview.scope === 'open-session'
      ? element('p', 'Web checks are not available yet. Nothing will be looked up.', 'm-consent__note')
      : element('p', 'Your question goes to Codex through the app on this device.', 'm-consent__note');
    const unavailable = preview.state !== 'ready' || !canAuthorize
      ? element('p', 'This action is unavailable here. Nothing was sent.', 'm-consent__note')
      : undefined;
    const controls = element('div', undefined, 'm-consent__actions');
    if (preview.state === 'excluded') controls.append(element('p', 'This site is excluded. Nothing can be sent until you change the exclusion in Settings.', 'm-consent__blocked'));
    else if (preview.state === 'denied') {
      controls.append(element('p', 'Sending is denied for this site. Change that decision in Settings before asking again.', 'm-consent__blocked'));
      if (options.onOpenSettings) controls.append(action('Settings', options.onOpenSettings, 'm-consent__settings'));
    }
    else if (!canAuthorize) controls.append(element('p', 'Open the browser-owned margin to approve or send this request.', 'm-consent__blocked'));
    else {
      controls.append(
        action('This time', () => choose('this-time'), 'm-consent__this-time'),
        action(`Always on ${preview.site}`, () => choose('always-site'), 'm-consent__always-site'),
        action(`Never on ${preview.site}`, () => choose('never-site'), 'm-consent__never-site'),
      );
    }
    const dismiss = action('Cancel', notNow); dismiss.dataset.dismiss = 'true'; controls.append(dismiss);
    root.replaceChildren(title, reading, summary, explanation, disclosureLine, ...(capability ? [capability] : []), ...(unavailable ? [unavailable] : []), controls, exact, live);
    renderDisclosure();
    setBusy(busy);
  };

  const choose = async (choice: ConsentChoice) => {
    if (busy || destroyed || !canAuthorize || preview.state !== 'ready') return;
    const decidedPreview = structuredClone(preview), operation = ++generation;
    const decisionAbort = new AbortController(); pendingDecision = decisionAbort;
    const abortDecision = () => decisionAbort.abort(abort.signal.reason);
    abort.signal.addEventListener('abort', abortDecision, { once: true });
    busy = true; live.textContent = ''; setBusy(true);
    try {
      const grant = await options.decide(choice, decidedPreview, decisionAbort.signal);
      if (destroyed || decisionAbort.signal.aborted || operation !== generation ||
          preview.id !== decidedPreview.id || preview.revision !== decidedPreview.revision || preview.requestId !== decidedPreview.requestId) return;
      live.textContent = choice === 'never-site' ? 'Sending is now blocked for this site.' : 'Permission saved.';
      options.onGranted?.(grant, decidedPreview);
    } catch (error) {
      if (!destroyed && !decisionAbort.signal.aborted && operation === generation) live.textContent = error instanceof Error ? error.message : 'Permission could not be saved. Review the request and try again.';
    } finally {
      abort.signal.removeEventListener('abort', abortDecision);
      if (operation === generation) { pendingDecision = undefined; busy = false; if (!destroyed) setBusy(false); }
    }
  };
  const setBusy = (value: boolean) => {
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    root.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = value && button.dataset.dismiss !== 'true'; });
    // Disabling a focused button can blur it immediately in a real browser.
    if (active?.matches(':disabled')) focusEntry();
  };
  const action = (label: string, callback: () => unknown, className = '') => {
    const button = element('button', label, className); button.type = 'button';
    button.addEventListener('click', () => { void callback(); }, { signal: abort.signal }); return button;
  };
  function focusable() {
    return Array.from(root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'))
      .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden], [inert]'));
  }
  function focusEntry() { (root.querySelector<HTMLElement>('button:not([disabled])') ?? focusable()[0] ?? root).focus(); }
  function destroy() {
    if (destroyed) return;
    const ownedFocus = root.contains(document.activeElement);
    destroyed = true; generation++; cancelAnimationFrame(initialFocus);
    pendingDecision?.abort(new DOMException('Consent sheet closed.', 'AbortError')); abort.abort(); root.remove();
    if (ownedFocus && returnFocus?.isConnected) returnFocus.focus();
  }
  function notNow() {
    if (destroyed) return;
    destroy();
    (options.onNotNow ?? options.onBack)?.();
  }
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); notNow(); return; }
  }, { signal: abort.signal });
  render();
  const initialFocus = requestAnimationFrame(() => { if (!destroyed && root.isConnected) focusEntry(); });
  return {
    updateDisclosure(next) { if (destroyed) return; disclosure = next; renderDisclosure(); },
    update(next) {
      if (destroyed) return;
      const ownedFocus = root.contains(document.activeElement);
      generation++; pendingDecision?.abort(new DOMException('Consent preview replaced.', 'AbortError')); pendingDecision = undefined; busy = false;
      preview = structuredClone(next); root.setAttribute('aria-labelledby', `m-consent-title-${safeId(preview.id)}`); render();
      if (ownedFocus) focusEntry();
    },
    destroy,
  };
}

export type ConsentSettingsOptions = {
  grants: ConsentGrant[];
  exclusions: SiteExclusion[];
  revoke(grant: ConsentGrant, signal: AbortSignal): Promise<ConsentGrant>;
  setExcluded(site: string, excluded: boolean, expectedRevision: number | undefined, signal: AbortSignal): Promise<SiteExclusion>;
};

export function mountConsentSettings(host: HTMLElement, options: ConsentSettingsOptions): { update(grants: ConsentGrant[], exclusions: SiteExclusion[]): void; destroy(): void } {
  const abort = new AbortController(); let grants = structuredClone(options.grants), exclusions = structuredClone(options.exclusions), destroyed = false;
  const root = element('section', undefined, 'm-consent-settings'), live = element('p', undefined, 'm-consent__status'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  host.replaceChildren(root);
  const render = () => {
    const grantList = element('ul', undefined, 'm-consent-settings__list');
    for (const grant of grants) {
      const item = element('li');
      const label = grant.decision === 'allow-once' ? 'This time' : grant.decision === 'allow-site' ? 'Always allowed' : 'Never allowed';
      item.append(element('span', `${grant.site} · ${grant.recipient} · ${grant.scope === 'open-session' ? 'Codex and web access' : 'Codex'} · ${label}`));
      if (!grant.revokedAt) item.append(settingsButton('Revoke', async () => {
        const updated = await options.revoke(grant, abort.signal);
        if (destroyed || abort.signal.aborted) return;
        grants = grants.map(value => value.id === updated.id ? updated : value); render();
      }, `Revoke permission for ${grant.site} to ${grant.recipient}`));
      else item.append(element('span', 'Revoked', 'm-consent__meta'));
      grantList.append(item);
    }
    const exclusionsList = element('ul', undefined, 'm-consent-settings__list');
    for (const exclusion of exclusions) {
      const item = element('li'); item.append(element('span', `${new URL(exclusion.site).hostname} · ${exclusion.excluded ? 'Excluded' : 'Allowed'}`));
      item.append(settingsButton(exclusion.excluded ? 'Remove exclusion' : 'Exclude site', async () => {
        const updated = await options.setExcluded(exclusion.site, !exclusion.excluded, exclusion.revision, abort.signal);
        if (destroyed || abort.signal.aborted) return;
        exclusions = exclusions.map(value => value.site === updated.site ? updated : value); render();
      }, `${exclusion.excluded ? 'Remove exclusion for' : 'Exclude'} ${exclusion.site}`)); exclusionsList.append(item);
    }
    const addExclusion = element('form', undefined, 'm-consent-settings__add');
    const siteLabel = element('label', 'Site to exclude');
    const siteInput = element('input'); siteInput.type = 'url'; siteInput.placeholder = 'https://example.com'; siteInput.required = true;
    siteLabel.append(siteInput);
    const addButton = element('button', 'Exclude site'); addButton.type = 'submit';
    addExclusion.append(siteLabel, addButton);
    addExclusion.addEventListener('submit', event => {
      event.preventDefault();
      let site: string;
      try {
        const url = new URL(siteInput.value.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        site = url.origin;
      } catch { live.textContent = 'Enter a complete HTTP or HTTPS site address.'; siteInput.focus(); return; }
      if (exclusions.some(value => value.site === site && value.excluded)) { live.textContent = 'That site is already excluded.'; siteInput.focus(); return; }
      addButton.disabled = true; live.textContent = '';
      void options.setExcluded(site, true, exclusions.find(value => value.site === site)?.revision, abort.signal)
        .then(updated => { if (destroyed || abort.signal.aborted) return; exclusions = [...exclusions.filter(value => value.site !== updated.site), updated].sort((a, b) => a.site.localeCompare(b.site)); render(); })
        .catch(error => { if (!destroyed && !abort.signal.aborted) { live.textContent = error instanceof Error ? error.message : 'The site could not be excluded.'; siteInput.focus(); } })
        .finally(() => { if (!destroyed) addButton.disabled = false; });
    }, { signal: abort.signal });
    root.replaceChildren(element('h2', 'Permissions and exclusions'), element('h3', 'Permissions'), grantList, element('h3', 'Excluded sites'), addExclusion, exclusionsList, live);
  };
  const settingsButton = (label: string, work: () => Promise<void>, accessibleLabel = label) => {
    const button = element('button', label); button.type = 'button';
    button.setAttribute('aria-label', accessibleLabel);
    button.addEventListener('click', () => { button.disabled = true; live.textContent = ''; void work().catch(error => { if (!destroyed && !abort.signal.aborted) live.textContent = error instanceof Error ? error.message : 'The setting could not be changed.'; }).finally(() => { if (!destroyed) button.disabled = false; }); }, { signal: abort.signal });
    return button;
  };
  render();
  return { update(nextGrants, nextExclusions) { if (destroyed) return; grants = structuredClone(nextGrants); exclusions = structuredClone(nextExclusions); render(); }, destroy() { if (destroyed) return; destroyed = true; abort.abort(); root.remove(); } };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
}
function safeId(value: string) { return value.replace(/[^A-Za-z0-9_-]/g, '-'); }


function outgoingLabel(label: string): string {
  const labels: Record<string, string> = { 'Bounded reading packet': 'The passage and context',
    'Adapter prompt': 'Instructions for the reply', 'Workspace instructions': 'Instructions for local work',
    'Reply schema': 'The reply format', 'Reply schema file': 'The reply format', 'Structured output schema': 'The response format' };
  return labels[label] ?? label;
}
