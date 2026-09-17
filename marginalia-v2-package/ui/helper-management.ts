import { el, button } from './dom.ts';

type BrowserEntry = { id: string; origin: string; createdAt: string; revoked: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** UI admission only; the server independently enforces actual same-origin metadata. */
export function isHelperPage(location: Pick<Location, 'protocol' | 'hostname' | 'pathname'>) {
  return location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    && ['/', '/index.html'].includes(location.pathname);
}

export function mountHelperManagement(host: HTMLElement) {
  const root = el('section', undefined, 'm-helper-management');
  const heading = el('h3', 'This computer');
  const code = el('output'); code.setAttribute('aria-label', 'Pairing code'); code.hidden = true;
  const codeStatus = el('p', 'Show a code when you are ready to pair a browser.', 'm-meta'); codeStatus.setAttribute('role', 'status');
  const listStatus = el('p', '', 'm-meta'); listStatus.setAttribute('role', 'status');
  const list = el('ul');
  let destroyed = false, active = false, issuing = false, loading = false;
  let epoch = 0, listRequest = 0, deadline = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let browsers: BrowserEntry[] | undefined;
  const pending = new Set<string>();
  const controllers = new Set<AbortController>();
  async function request(action: 'pairing-code' | 'browsers' | 'revoke', body: object) {
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/helper-management/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'omit', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('unconfirmed');
      return await response.json();
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function clearCode() { clearTimeout(expiry); expiry = undefined; deadline = 0; code.textContent = ''; code.hidden = true; }
  const show = button('Show pairing code', async () => {
    if (!active || destroyed || issuing) return;
    const generation = epoch, started = Date.now(); issuing = true; show.disabled = true;
    clearCode(); show.textContent = 'Renew pairing code';
    codeStatus.textContent = 'Requesting a replacement. Any earlier code may stop working.';
    try {
      const result = await request('pairing-code', {});
      if (destroyed || !active || generation !== epoch) return;
      if (!result || !/^\d{6}$/.test(result.code) || result.expiresInSeconds !== 300 || result.singleUse !== true) throw new Error('invalid');
      deadline = started + 300_000;
      if (Date.now() >= deadline) throw new Error('expired');
      code.textContent = result.code; code.hidden = false;
      codeStatus.textContent = 'Use once within five minutes of requesting it. It may already be used or replaced elsewhere. A new code replaces the previous one.';
      expiry = setTimeout(() => { clearCode(); codeStatus.textContent = 'This code has expired. Renew it to pair a browser.'; }, deadline - Date.now());
    } catch {
      if (destroyed || !active || generation !== epoch) return;
      clearCode(); codeStatus.textContent = 'A new code could not be confirmed. Check that the helper is running, then renew. Any previous code may have been replaced.';
    } finally { if (generation === epoch) { issuing = false; show.disabled = false; } }
  });
  function renderList() {
    list.replaceChildren();
    for (const entry of browsers ?? []) {
      const row = el('li');
      row.append(el('p', entry.origin), el('p', `First paired ${new Date(entry.createdAt).toLocaleString()}`, 'm-meta'));
      if (entry.revoked) row.append(el('p', 'Forgotten', 'm-meta'));
      else {
        const forget = button('Forget', () => {
          if (!active || pending.has(entry.id)) return;
          const confirm = button('Forget this browser', async () => {
            if (!active || pending.has(entry.id)) return;
            pending.add(entry.id); confirm.disabled = true; cancel.disabled = true;
            ++listRequest; const generation = epoch;
            listStatus.textContent = 'Forgetting this browser…';
            try {
              const result = await request('revoke', { id: entry.id });
              if (destroyed || !active || generation !== epoch) return;
              if (!['revoked', 'already-revoked'].includes(result?.result)) throw new Error('invalid');
              browsers = browsers?.map(item => item.id === entry.id ? { ...item, revoked: true } : item);
              listStatus.textContent = 'Browser forgotten. It must pair again to use this helper. Site permissions are unchanged.';
              renderList(); refresh.focus();
            } catch {
              if (destroyed || !active || generation !== epoch) return;
              listStatus.textContent = 'Forgetting could not be confirmed. The last loaded list is still shown. Refresh to check before trying again.';
            } finally { pending.delete(entry.id); if (generation === epoch) { confirm.disabled = false; cancel.disabled = false; } }
          });
          const cancel = button('Cancel', () => { choice.replaceChildren(forget); forget.focus(); });
          choice.replaceChildren(el('p', 'Forget this pairing? Saved notes and site permissions are not deleted.', 'm-meta'), confirm, cancel); confirm.focus();
        });
        const choice = el('div', undefined, 'm-actions'); choice.append(forget); row.append(choice);
      }
      list.append(row);
    }
  }
  async function load() {
    if (!active || destroyed || pending.size) return;
    const current = ++listRequest, generation = epoch; loading = true; refresh.disabled = true;
    listStatus.textContent = browsers ? 'Refreshing the browser list…' : 'Loading paired browsers…';
    try {
      const result = await request('browsers', {});
      if (destroyed || !active || generation !== epoch || current !== listRequest) return;
      if (!Array.isArray(result?.browsers) || !result.browsers.every((item: BrowserEntry) => item && uuid.test(item.id)
        && typeof item.origin === 'string' && item.origin.length <= 512 && typeof item.createdAt === 'string'
        && Number.isFinite(Date.parse(item.createdAt)) && typeof item.revoked === 'boolean')) throw new Error('invalid');
      browsers = result.browsers.map((item: BrowserEntry) => ({ id: item.id, origin: item.origin, createdAt: item.createdAt, revoked: item.revoked }));
      renderList(); listStatus.textContent = browsers!.length ? 'Paired browsers on this helper.' : 'No browsers have paired with this helper.';
    } catch {
      if (destroyed || !active || generation !== epoch || current !== listRequest) return;
      listStatus.textContent = browsers ? 'The list could not be refreshed. The last loaded entries are still shown.' : 'The browser list is unavailable. Check that the helper is running, then refresh.';
    } finally { if (generation === epoch) { loading = false; refresh.disabled = false; } }
  }
  const refresh = button('Refresh browser list', () => { if (!loading) void load(); });
  root.append(heading, el('p', 'Pairing connects a browser to this local helper. It does not permit asking or change site permissions.', 'm-meta'), show, code, codeStatus, el('h3', 'Paired browsers'), refresh, listStatus, list);
  host.append(root);
  function deactivate() {
    active = false; ++epoch; ++listRequest;
    for (const controller of controllers) controller.abort();
    clearCode(); issuing = false; loading = false; show.disabled = false; refresh.disabled = false;
    codeStatus.textContent = 'Show or renew a code when you are ready. Renewing replaces any earlier code.';
  }
  return {
    open() { if (destroyed || active) return; active = true; void load(); },
    close: deactivate,
    destroy() { if (destroyed) return; deactivate(); destroyed = true; root.remove(); },
  };
}
