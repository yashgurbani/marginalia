import type { ConsentChoice, ConsentGrant, ConsentPreview, SiteExclusion } from '../contracts/consent.ts';

export type ConsentSheetOptions = {
  preview: ConsentPreview;
  canAuthorize: boolean;
  /** Layout context, not a grant of authority. Floating page hosts cannot authorize. */
  surface?: 'native-panel' | 'floating' | 'localhost';
  decide(choice: ConsentChoice, preview: ConsentPreview, signal: AbortSignal): Promise<ConsentGrant>;
  onGranted?(grant: ConsentGrant, decidedPreview: ConsentPreview): void;
  onNotNow?(): void;
  /** Compatibility callback when onNotNow is not supplied. */
  onBack?(): void;
  returnFocus?: HTMLElement;
};

export type ConsentSheet = { update(preview: ConsentPreview): void; destroy(): void };

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
  // Contain keyboard traversal in this sheet, not the reader's whole document.
  // Escape/Not now exits; the page remains interactive, so do not claim modality.
  root.className = 'm-consent'; root.dataset.surface = surface; root.tabIndex = -1;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', `m-consent-title-${safeId(preview.id)}`);
  const live = document.createElement('p'); live.className = 'm-consent__status'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  host.replaceChildren(root);

  const render = () => {
    const title = element('h2', 'Review what will be sent', 'm-consent__title'); title.id = `m-consent-title-${safeId(preview.id)}`; title.tabIndex = -1;
    const summary = element('dl', undefined, 'm-consent__summary');
    summary.append(element('dt', 'Recipient'), element('dd', preview.recipientLabel), element('dt', 'Permission'), element('dd', preview.scopeLabel));
    const exact = element('div', undefined, 'm-consent__outgoing');
    for (const part of preview.outgoing) {
      const item = element('section', undefined, 'm-consent__part');
      item.append(element('h3', part.label), element('pre', part.text)); exact.append(item);
    }
    const explanation = preview.scope === 'open-session'
      ? element('p', 'This also permits separate web access for this site. Fetched pages are recorded; the record says incomplete if another route could fetch outside the observed broker.', 'm-consent__note')
      : element('p', 'Codex is a cloud service. Tool network access stays closed for this request; necessary model-service traffic is separate.', 'm-consent__note');
    const controls = element('div', undefined, 'm-consent__actions');
    if (preview.state === 'excluded') controls.append(element('p', 'This site is excluded. Nothing can be sent until you change the exclusion in Settings.', 'm-consent__blocked'));
    else if (preview.state === 'denied') controls.append(element('p', 'Sending is denied for this site. Change that decision in Settings before asking again.', 'm-consent__blocked'));
    else if (!canAuthorize) controls.append(element('p', 'Open the browser-owned margin to approve or send this request.', 'm-consent__blocked'));
    else {
      controls.append(
        action('This time', () => choose('this-time')),
        action(`Always on ${preview.site}`, () => choose('always-site')),
        action(`Never on ${preview.site}`, () => choose('never-site')),
      );
    }
    const dismiss = action('Not now', notNow); dismiss.dataset.dismiss = 'true'; controls.append(dismiss);
    root.replaceChildren(title, summary, exact, explanation, controls, live);
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
  function focusEntry() { (focusable()[0] ?? root).focus({ preventScroll: true }); }
  function destroy() {
    if (destroyed) return;
    const ownedFocus = root.contains(document.activeElement);
    destroyed = true; generation++; cancelAnimationFrame(initialFocus);
    pendingDecision?.abort(new DOMException('Consent sheet closed.', 'AbortError')); abort.abort(); root.remove();
    if (ownedFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function notNow() {
    if (destroyed) return;
    destroy();
    (options.onNotNow ?? options.onBack)?.();
  }
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); notNow(); return; }
    if (event.key !== 'Tab') return;
    const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
    if (!first) { event.preventDefault(); root.focus(); return; }
    const active = document.activeElement;
    if (!nodes.some(node => node === active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last! : first).focus({ preventScroll: true });
    }
  }, { signal: abort.signal });
  render();
  const initialFocus = requestAnimationFrame(() => { if (!destroyed && root.isConnected) focusEntry(); });
  return {
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
