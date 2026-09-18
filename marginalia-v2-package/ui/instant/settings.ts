import type { InstantHelpSettings } from '../../contracts/instant.ts';
import type { InstantTransport } from './transport.ts';

export type InstantSettingsMount = { reload(): Promise<void>; destroy(): void };

export function mountInstantSettings(host: HTMLElement, transport: InstantTransport): InstantSettingsMount {
  const doc = host.ownerDocument;
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value;
  }
  const root = node('section', undefined, 'm-instant-settings');
  const title = node('h3', 'Instant help');
  const disclosure = node('p', 'Instant help uses your Codex subscription. It sends each allowed page to Codex so definitions are ready.', 'm-instant-settings__description');
  const exclusions = node('p', 'Excluded sites never send.', 'm-instant-settings__description');
  const content = node('div');
  const status = node('p', '', 'm-instant-settings__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(title, disclosure, exclusions, content, status); host.replaceChildren(root);
  let settings: InstantHelpSettings | undefined, destroyed = false, loading = 0, saving = false;

  async function reload() {
    if (destroyed) return;
    const generation = ++loading; content.replaceChildren(node('p', 'Opening instant help settings.', 'm-instant-settings__muted')); status.textContent = '';
    try {
      const [next, usage] = await Promise.all([transport.getSettings(), transport.getTodayUsage()]);
      if (destroyed || generation !== loading) return;
      settings = next; render(usage.usedTokens, usage.pendingTokens, usage.limitTokens);
    } catch {
      if (destroyed || generation !== loading) return;
      content.replaceChildren(node('p', 'Instant help settings are unavailable.', 'm-instant-settings__muted'));
    }
  }

  function render(usedTokens: number, pendingTokens: number, limitTokens: number) {
    if (!settings || destroyed) return;
    const form = node('form', undefined, 'm-instant-settings__form');
    const enabled = doc.createElement('input'); enabled.type = 'checkbox'; enabled.checked = settings.enabled;
    enabled.setAttribute('role', 'switch'); enabled.setAttribute('aria-label', 'Instant help');
    const switchRow = node('label', undefined, 'm-instant-settings__switch'); switchRow.append(enabled, node('span', 'Instant help'));
    const warm = numberField('Warm pages', settings.warmPages, 1);
    const idle = numberField('Idle minutes', settings.idleMinutes, 1);
    const usage = node('p', usageSentence(usedTokens, pendingTokens, limitTokens), 'm-instant-settings__usage');
    const save = node('button', 'Save instant help'); save.type = 'submit';
    form.append(switchRow, warm.row, idle.row, usage, save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!settings || saving || !valid(warm.input) || !valid(idle.input)) return;
      const current = settings;
      const { version: _version, revision, updatedAt: _updatedAt, ...values } = current;
      const change = { ...values, expectedRevision: revision, enabled: enabled.checked,
        warmPages: Number(warm.input.value), idleMinutes: Number(idle.input.value) };
      saving = true; save.disabled = true; status.textContent = 'Saving instant help settings.';
      void transport.saveSettings(change).then(next => {
        if (destroyed) return;
        settings = next; enabled.checked = next.enabled;
        warm.input.value = String(next.warmPages); idle.input.value = String(next.idleMinutes);
        status.textContent = 'Instant help settings saved.';
      }).catch(() => { if (!destroyed) status.textContent = 'Saving instant help settings failed.'; })
        .finally(() => { saving = false; if (!destroyed) save.disabled = false; });
    });
    content.replaceChildren(form);
  }

  function numberField(label: string, value: number, min: number) {
    const row = node('label', undefined, 'm-instant-settings__field');
    const input = doc.createElement('input'); input.type = 'number'; input.required = true; input.min = String(min); input.step = '1'; input.value = String(value);
    row.append(node('span', label), input); return { row, input };
  }
  void reload();
  return { reload, destroy() { if (destroyed) return; destroyed = true; ++loading; root.remove(); } };
}

function valid(input: HTMLInputElement) { return /^\d+$/.test(input.value) && Number.isSafeInteger(Number(input.value)) && Number(input.value) > 0; }
function usageSentence(used: number, pending: number, _limit: number) {
  const pendingCopy = pending ? ` Another ${pending.toLocaleString()} tokens are pending.` : '';
  return `Instant help has used about ${used.toLocaleString()} tokens of your Codex plan today.${pendingCopy} Marginalia does not enforce a daily cap.`;
}
