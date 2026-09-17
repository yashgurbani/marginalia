import { el, button } from './dom.ts';

type BrowserEntry = { id: string; origin: string; createdAt: string; revoked: boolean };
export type HelperManagementMount = { open(): void; close(): void; destroy(): void };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** UI admission only. The server independently checks real Origin/Fetch Metadata. */
export function isHelperPage(location: Pick<Location, 'protocol' | 'hostname' | 'pathname'> | undefined) {
  return !!location && location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    && ['/', '/index.html'].includes(location.pathname);
}

/** Only the top-level helper page gets management controls; an extension bearer
 * never authorizes this surface. No request occurs merely from mounting it. */
export function mountHelperManagement(host: HTMLElement): HelperManagementMount {
  const doc = host.ownerDocument;
  const admitted = () => doc === globalThis.document && isHelperPage(doc.location)
    && (!doc.defaultView || doc.defaultView.top === doc.defaultView);
  if (!admitted()) return { open() {}, close() {}, destroy() {} };
  const root = el('section', undefined, 'm-helper-management');
  const code = el('output'); code.setAttribute('aria-label', 'Pairing code'); code.hidden = true;
  const codeStatus = el('p', 'Show a code when you are ready to pair a browser.', 'm-meta'); codeStatus.setAttribute('role', 'status');
  const listStatus = el('p', '', 'm-meta'); listStatus.setAttribute('role', 'status');
  const list = el('ul');
  let destroyed = false, active = false, issuing = false, loading = false;
  let epoch = 0, listRequest = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let browsers: BrowserEntry[] | undefined;
  const pending = new Map<string, symbol>(), uncertain = new Set<string>();
  const controllers = new Set<AbortController>();
  type Row = { node: HTMLElement; entry: BrowserEntry; origin: HTMLElement; date: HTMLElement; choice: HTMLElement; forget: HTMLButtonElement; confirm?: HTMLButtonElement; cancel?: HTMLButtonElement };
  const rows = new Map<string, Row>();
  const current = (generation: number) => !destroyed && active && generation === epoch && admitted();
  async function request(action: 'pairing-code' | 'browsers' | 'revoke', body: object) {
    if (!active || destroyed || !admitted()) throw new Error('Helper page closed.');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      // Relative same-origin POST supplies the genuine browser metadata. No token,
      // Origin or Fetch Metadata header is manufactured by this component.
      const response = await fetch('/api/helper-management/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'omit', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('unconfirmed');
      return await response.json();
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function clearCode() { clearTimeout(expiry); expiry = undefined; code.textContent = ''; code.hidden = true; }
  const show = button('Show pairing code', async () => {
    if (!active || destroyed || issuing || !admitted()) return;
    const generation = epoch, started = Date.now(); issuing = true; show.disabled = true;
    clearCode(); show.textContent = 'Renew pairing code';
    codeStatus.textContent = 'Requesting a replacement. Any earlier code may stop working.';
    try {
      const result = await request('pairing-code', {});
      if (!current(generation)) return;
      if (!result || typeof result.code !== 'string' || !/^\d{6}$/.test(result.code) || result.expiresInSeconds !== 300 || result.singleUse !== true) throw new Error('invalid');
      const deadline = started + 300_000;
      if (Date.now() >= deadline) throw new Error('expired');
      code.textContent = result.code; code.hidden = false;
      codeStatus.textContent = 'Use once within five minutes of requesting it. It may already be used or replaced elsewhere. A new code replaces the previous one.';
      expiry = setTimeout(() => {
        if (!current(generation)) return;
        clearCode(); codeStatus.textContent = 'This code has expired. Renew it to pair a browser.';
      }, deadline - Date.now());
    } catch {
      if (!current(generation)) return;
      clearCode(); codeStatus.textContent = 'A new code could not be confirmed. Check that the helper is running, then renew. Any previous code may have been replaced.';
    } finally { if (generation === epoch) { issuing = false; show.disabled = false; } }
  });
  function updateRow(row: Row) {
    row.origin.textContent = row.entry.origin;
    row.date.textContent = `First paired ${new Date(row.entry.createdAt).toLocaleString()}`;
    if (row.entry.revoked) {
      uncertain.delete(row.entry.id);
      if (row.choice.dataset.revoked !== 'true') { row.choice.dataset.revoked = 'true'; row.choice.replaceChildren(el('p', 'Forgotten', 'm-meta')); }
    } else {
      if (row.choice.dataset.revoked === 'true') { row.choice.dataset.revoked = 'false'; row.choice.replaceChildren(row.forget); row.confirm = undefined; row.cancel = undefined; }
      const busy = pending.size > 0;
      row.forget.disabled = busy;
      if (row.confirm) row.confirm.disabled = busy;
      if (row.cancel) row.cancel.disabled = busy;
    }
  }
  function createRow(entry: BrowserEntry): Row {
    const node = el('li'), origin = el('p'), date = el('p', '', 'm-meta'), choice = el('div', undefined, 'm-actions');
    const row: Row = { node, entry, origin, date, choice, forget: button('Forget', () => {
      if (!current(epoch) || pending.size > 0 || row.entry.revoked) return;
      const confirm = button('Forget this browser', async () => {
        if (!current(epoch) || pending.size > 0 || row.entry.revoked) return;
        const operation = Symbol(entry.id), generation = epoch;
        pending.set(entry.id, operation); uncertain.add(entry.id); ++listRequest; loading = false; refresh.disabled = true;
        for (const item of rows.values()) updateRow(item);
        listStatus.textContent = 'Forgetting this browser...';
        try {
          const result = await request('revoke', { id: entry.id });
          if (!current(generation) || pending.get(entry.id) !== operation) return;
          if (!['revoked', 'already-revoked'].includes(result?.result)) throw new Error('invalid');
          const returnFocus = doc.activeElement === confirm;
          uncertain.delete(entry.id); pending.delete(entry.id); refresh.disabled = false;
          browsers = browsers?.map(item => item.id === entry.id ? { ...item, revoked: true } : item);
          renderList();
          listStatus.textContent = 'Browser forgotten. It must pair again to use this helper. Site permissions are unchanged.';
          if (returnFocus) refresh.focus(); // Never pull focus back from a reader's draft.
        } catch {
          if (!current(generation) || pending.get(entry.id) !== operation) return;
          listStatus.textContent = 'Forgetting could not be confirmed. The last loaded list is still shown. Refresh to check before trying again.';
        } finally {
          if (pending.get(entry.id) === operation) {
            pending.delete(entry.id);
            if (current(generation)) { refresh.disabled = pending.size > 0; for (const item of rows.values()) updateRow(item); }
          }
        }
      });
      const cancel = button('Cancel', () => { if (pending.has(entry.id)) return; choice.replaceChildren(row.forget); row.confirm = undefined; row.cancel = undefined; row.forget.focus(); });
      row.confirm = confirm; row.cancel = cancel;
      choice.replaceChildren(el('p', 'Forget this pairing? Saved notes and site permissions are not deleted.', 'm-meta'), confirm, cancel); confirm.focus();
    }) };
    choice.append(row.forget); node.append(origin, date, choice); return row;
  }
  function renderList() {
    const focused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const ownedFocus = !!focused && list.contains(focused);
    for (const [id, row] of rows) if (!browsers?.some(entry => entry.id === id)) { row.node.remove(); rows.delete(id); }
    (browsers ?? []).forEach((entry, index) => {
      let row = rows.get(entry.id);
      if (!row) { row = createRow(entry); rows.set(entry.id, row); }
      row.entry = entry; updateRow(row);
      // Preserve connected confirmation controls and focus across list refreshes.
      if (list.children[index] !== row.node) list.insertBefore(row.node, list.children[index] ?? null);
    });
    if (ownedFocus && focused?.isConnected && doc.activeElement !== focused) focused.focus({ preventScroll: true });
    else if (ownedFocus && !focused?.isConnected) refresh.focus();
  }
  async function load() {
    if (!active || destroyed || pending.size || !admitted()) return;
    const requestId = ++listRequest, generation = epoch; loading = true; refresh.disabled = true;
    listStatus.textContent = browsers ? 'Refreshing the browser list...' : 'Loading paired browsers...';
    try {
      const result = await request('browsers', {});
      if (!current(generation) || requestId !== listRequest) return;
      if (!Array.isArray(result?.browsers) || !result.browsers.every((item: BrowserEntry) => item && typeof item.id === 'string' && uuid.test(item.id)
        && typeof item.origin === 'string' && item.origin.length <= 512 && typeof item.createdAt === 'string'
        && Number.isFinite(Date.parse(item.createdAt)) && typeof item.revoked === 'boolean')
        || new Set(result.browsers.map((item: BrowserEntry) => item.id)).size !== result.browsers.length) throw new Error('invalid');
      browsers = result.browsers.map((item: BrowserEntry) => ({ id: item.id, origin: item.origin, createdAt: item.createdAt, revoked: item.revoked }));
      renderList();
      listStatus.textContent = uncertain.size ? 'The last loaded entries are shown. An earlier Forget outcome is unconfirmed; refresh or explicitly retry it.'
        : browsers!.length ? 'Paired browsers on this helper.' : 'No browsers have paired with this helper.';
    } catch {
      if (!current(generation) || requestId !== listRequest) return;
      listStatus.textContent = browsers ? 'The list could not be refreshed. The last loaded entries are still shown.' : 'The browser list is unavailable. Check that the helper is running, then refresh.';
    } finally { if (generation === epoch && requestId === listRequest) { loading = false; refresh.disabled = false; } }
  }
  const refresh = button('Refresh browser list', () => { if (!loading) void load(); });
  root.append(el('h3', 'This computer'), el('p', 'Pairing connects a browser to this local helper. It does not permit asking or change site permissions.', 'm-meta'), show, code, codeStatus, el('h3', 'Paired browsers'), refresh, listStatus, list);
  host.append(root);
  function deactivate() {
    active = false; ++epoch; ++listRequest;
    pending.clear(); // Old finally blocks cannot clear a later operation's symbol.
    for (const controller of controllers) controller.abort();
    clearCode(); issuing = false; loading = false; show.disabled = false; refresh.disabled = false;
    for (const row of rows.values()) updateRow(row);
    codeStatus.textContent = 'Show or renew a code when you are ready. Renewing replaces any earlier code.';
  }
  return {
    open() { if (destroyed || active || !admitted()) return; active = true; void load(); },
    close: deactivate,
    destroy() { if (destroyed) return; deactivate(); destroyed = true; root.remove(); },
  };
}
