import { siteOriginFromInput, type WhitelistSettings, type WhitelistSite } from '../../contracts/whitelist.ts';
import type { WhitelistTransport } from './transport.ts';

export type WhitelistDeps = { transport: WhitelistTransport };
export type WhitelistMount = { destroy(): void; reload(): Promise<void> };

export const WHITELIST_COPY = Object.freeze({
  title: 'Sites for auto assist',
  description: 'Auto assist may run on the sites in this list.',
  label: 'Site', placeholder: 'example.com', add: 'Add site', remove: 'Remove',
  loading: 'Loading sites.', loaded: 'Sites loaded.', empty: 'No sites are listed.',
  adding: 'Adding the site.', added: 'Site added.', removing: 'Removing the site.', removed: 'Site removed.',
  invalid: 'Enter a valid site address.', duplicate: 'That site is already in the list.',
  failedLoad: 'The site list could not be loaded. Try again.', failedSave: 'The site change could not be saved. Try again.',
  stale: 'The site list changed. It has been reloaded. Your text is still here.',
});

export function mountWhitelist(host: HTMLElement, deps: WhitelistDeps): WhitelistMount {
  const doc = host.ownerDocument, root = doc.createElement('section'); root.className = 'm-whitelist';
  const title = node('h3', WHITELIST_COPY.title), description = node('p', WHITELIST_COPY.description);
  const form = doc.createElement('form'), label = node('label'), labelText = node('span', WHITELIST_COPY.label);
  const input = doc.createElement('input'); input.type = 'text'; input.setAttribute('placeholder', WHITELIST_COPY.placeholder);
  const add = node('button', WHITELIST_COPY.add); add.type = 'submit'; label.append(labelText, input); form.append(label, add);
  const list = doc.createElement('ul'), empty = node('p', WHITELIST_COPY.empty);
  const status = node('p', WHITELIST_COPY.loading); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(title, description, form, list, empty, status); host.replaceChildren(root);
  let settings: WhitelistSettings = { exclusions: [] }, destroyed = false, busy = false, generation = 0;
  let controller: AbortController | undefined;
  form.addEventListener('submit', event => { event.preventDefault(); void addSite(); });

  async function reload(message: string = WHITELIST_COPY.loaded) {
    const own = ++generation; controller?.abort(); controller = new AbortController(); setBusy(true); status.textContent = WHITELIST_COPY.loading;
    try {
      const result = await deps.transport.getSettings(controller.signal);
      if (!current(own)) return;
      settings = result; render(); status.textContent = message;
    } catch (error) { if (current(own) && !aborted(error)) status.textContent = WHITELIST_COPY.failedLoad; }
    finally { if (current(own)) { controller = undefined; setBusy(false); } }
  }

  async function addSite() {
    if (busy || destroyed) return;
    const site = siteOriginFromInput(input.value);
    if (!site) { status.textContent = WHITELIST_COPY.invalid; return; }
    const currentSite = settings.exclusions.find(value => value.site === site);
    if (currentSite && !currentSite.excluded) { status.textContent = WHITELIST_COPY.duplicate; return; }
    await change({ site, excluded: false, currentSite }, WHITELIST_COPY.adding, WHITELIST_COPY.added, true);
  }

  async function removeSite(site: WhitelistSite) {
    if (busy || destroyed) return;
    await change({ site: site.site, excluded: true, currentSite: site }, WHITELIST_COPY.removing, WHITELIST_COPY.removed, false);
  }

  async function change(value: { site: string; excluded: boolean; currentSite?: WhitelistSite }, pending: string, done: string, clear: boolean) {
    const own = generation; setBusy(true); status.textContent = pending;
    try {
      const saved = await deps.transport.saveSite({ action: 'set-exclusion', site: value.site, excluded: value.excluded,
        ...(value.currentSite ? { expectedRevision: value.currentSite.revision } : {}) });
      if (!current(own)) return;
      settings.exclusions = [...settings.exclusions.filter(item => item.site !== saved.site), saved];
      if (clear) input.value = '';
      render(); status.textContent = done;
    } catch (error) {
      if (!current(own)) return;
      if (error instanceof Error && error.name === 'Conflict') { setBusy(false); await reload(WHITELIST_COPY.stale); return; }
      status.textContent = WHITELIST_COPY.failedSave;
    } finally { if (current(own)) setBusy(false); }
  }

  function render() {
    const active = settings.exclusions.filter(value => !value.excluded).sort((a, b) => a.site.localeCompare(b.site));
    list.replaceChildren(...active.map(site => {
      const item = doc.createElement('li'), name = node('span', site.site), remove = node('button', `${WHITELIST_COPY.remove} ${site.site}`);
      remove.type = 'button'; remove.disabled = busy; remove.addEventListener('click', () => { void removeSite(site); }); item.append(name, remove); return item;
    }));
    empty.hidden = active.length > 0;
  }
  function setBusy(value: boolean) { busy = value; input.disabled = value; add.disabled = value; for (const button of list.querySelectorAll('button')) button.disabled = value; }
  function current(own: number) { return !destroyed && own === generation; }
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; return value;
  }
  void reload();
  return { reload, destroy() { if (destroyed) return; ++generation; controller?.abort(); destroyed = true; root.remove(); } };
}

function aborted(error: unknown) { return error instanceof DOMException && error.name === 'AbortError'; }
