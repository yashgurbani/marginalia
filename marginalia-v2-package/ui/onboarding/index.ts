import type { InstantHelpSettings } from '../../contracts/instant.ts';
import type { AutoAssistSettings } from '../../contracts/auto-assist.ts';
import type { InstantTransport } from '../instant/transport.ts';
import type { AutoAssistTransport } from '../auto-assist/transport.ts';
import { instantOnboardingReceipt, localPersistence, type ReaderKeyValueStore } from '../persistence.ts';

export const ONBOARDING_RECEIPT_KEY = 'reading-preferences-onboarding:v1';
export type OnboardingDeps = {
  instantHelp: InstantTransport;
  autoAssist: AutoAssistTransport;
  store?: ReaderKeyValueStore;
};
export type OnboardingMount = { destroy(): void };
const mounts = new WeakMap<HTMLElement, OnboardingMount>();

/** Local display receipt only. Settings authority remains with the existing transports. */
export function mountOnboarding(host: HTMLElement, deps: OnboardingDeps): OnboardingMount {
  mounts.get(host)?.destroy();
  const doc = host.ownerDocument, store = deps.store ?? localPersistence(), abort = new AbortController();
  let destroyed = false, busy = false;
  let instant: InstantHelpSettings | undefined, assist: AutoAssistSettings | undefined;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; return element;
  };
  const root = node('section'); root.className = 'ml__section m-onboarding'; root.setAttribute('aria-label', 'Choose your reading help');
  const title = node('h2', 'Choose your reading help');
  const disclosure = node('p', 'Marginalia uses your own Codex setup, including its settings and tools.');
  const instantInput = node('input'); instantInput.type = 'checkbox'; instantInput.setAttribute('aria-label', 'Instant help');
  const assistInput = node('input'); assistInput.type = 'checkbox'; assistInput.setAttribute('aria-label', 'Auto assist');
  const instantLabel = node('label'); instantLabel.append(instantInput, node('span', 'Instant help'));
  const assistLabel = node('label'); assistLabel.append(assistInput, node('span', 'Auto assist'));
  const save = node('button', 'Save choices'); save.type = 'button';
  const dismiss = node('button', 'Keep current settings'); dismiss.type = 'button';
  const retry = node('button', 'Reload settings'); retry.type = 'button'; retry.hidden = true;
  const status = node('p', 'Opening your reading preferences.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(title, disclosure, instantLabel,
    node('p', 'Instant help starts on. It sends allowed pages to Codex ahead of time and gives short explanations when you select text. Excluded sites never send.'),
    assistLabel, node('p', 'Auto assist starts off. Turn it on to underline unfamiliar terms and prepare short definitions as you read.'),
    node('p', "You can change these choices in Settings, where today's approximate Codex usage is shown."), save, dismiss, retry, status);
  const active = () => !destroyed && root.parentElement === host;
  const disable = (value: boolean) => { instantInput.disabled = assistInput.disabled = save.disabled = dismiss.disabled = retry.disabled = value; };
  disable(true);
  host.replaceChildren(root);

  async function load() {
    if (!active() || busy) return;
    busy = true; disable(true); retry.hidden = true;
    try {
      const receipt = await store.read<{ version?: unknown; dismissedAt?: unknown }>(ONBOARDING_RECEIPT_KEY);
      if (!active()) return;
      if (receipt?.version === 1 && typeof receipt.dismissedAt === 'string' && Number.isFinite(Date.parse(receipt.dismissedAt))) { root.remove(); return; }
      const values = await Promise.all([deps.instantHelp.getSettings(abort.signal), deps.autoAssist.getSettings(abort.signal)]);
      if (!active()) return;
      [instant, assist] = values;
      instantInput.checked = instant.enabled; assistInput.checked = assist.enabled;
      status.textContent = ''; disable(false);
    } catch {
      if (active()) { status.textContent = 'Reading preferences are unavailable. You can keep reading and try again.'; retry.hidden = false; retry.disabled = false; dismiss.disabled = false; }
    } finally { busy = false; }
  }

  async function finish(saveChoices: boolean) {
    if (!active() || busy || (saveChoices && (!instant || !assist))) return;
    busy = true; disable(true); status.textContent = 'Saving your choices.';
    try {
      // Each request uses the exact revision shown to the reader. A conflict is
      // surfaced for explicit reload; it never overwrites another settings editor.
      if (saveChoices && instant && instantInput.checked !== instant.enabled) {
        const { version: _version, revision, updatedAt: _updatedAt, ...values } = instant;
        instant = await deps.instantHelp.saveSettings({ ...values, enabled: instantInput.checked, expectedRevision: revision }, abort.signal);
        if (!active()) return;
      }
      if (saveChoices && assist && assistInput.checked !== assist.enabled) {
        const { version: _version, revision, updatedAt: _updatedAt, ...values } = assist;
        assist = await deps.autoAssist.saveSettings({ ...values, enabled: assistInput.checked, expectedRevision: revision }, abort.signal);
        if (!active()) return;
      }
      await instantOnboardingReceipt(store).dismiss();
      if (!active()) return;
      await store.write(ONBOARDING_RECEIPT_KEY, { version: 1, dismissedAt: new Date().toISOString() });
      if (active()) root.remove();
    } catch {
      if (active()) {
        status.textContent = 'Some choices may have saved. Reload settings to check your current choices.';
        retry.hidden = false; retry.disabled = false; dismiss.disabled = false;
      }
    } finally { busy = false; }
  }
  save.addEventListener('click', () => { void finish(true); });
  dismiss.addEventListener('click', () => { void finish(false); });
  retry.addEventListener('click', () => { void load(); });
  const mount = { destroy() { if (destroyed) return; destroyed = true; abort.abort(); root.remove(); } };
  mounts.set(host, mount);
  void load();
  return mount;
}
