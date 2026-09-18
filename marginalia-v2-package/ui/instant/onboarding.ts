import type { InstantHelpSettings } from '../../contracts/instant.ts';
import { instantOnboardingReceipt, type ReaderKeyValueStore } from '../persistence.ts';
import type { InstantTransport } from './transport.ts';

export type InstantOnboardingMount = { destroy(): void };

export function mountInstantOnboarding(host: HTMLElement, transport: InstantTransport, store: ReaderKeyValueStore): InstantOnboardingMount {
  const doc = host.ownerDocument, receipt = instantOnboardingReceipt(store);
  let destroyed = false, working = false, root: HTMLElement | undefined;
  const current = () => !destroyed;
  void Promise.all([receipt.dismissed(), transport.getSettings()]).then(([dismissed, settings]) => {
    if (!current() || dismissed || !settings.enabled) return;
    root = doc.createElement('div'); root.className = 'm-instant-onboarding';
    const line = doc.createElement('p'); line.textContent = 'Instant help is on. It uses your Codex subscription and sends each allowed page to Codex for ready definitions.';
    const turnOff = action('Turn off', async () => {
      if (working) return; working = true; disable(true);
      try {
        const latest = await transport.getSettings();
        if (latest.enabled) await transport.saveSettings(disabledChange(latest));
        await receipt.dismiss(); if (current()) root?.remove();
      } catch { if (current()) { line.textContent = 'Instant help setup is unavailable.'; disable(false); } }
      finally { working = false; }
    });
    const keep = action('Keep on', async () => {
      if (working) return; working = true; disable(true);
      try { await receipt.dismiss(); if (current()) root?.remove(); }
      catch { if (current()) { line.textContent = 'Saving this choice is unavailable.'; disable(false); } }
      finally { working = false; }
    });
    const disable = (value: boolean) => { turnOff.disabled = value; keep.disabled = value; };
    root.append(line, turnOff, keep); host.replaceChildren(root);
  }).catch(() => { /* Reading continues when onboarding state is unavailable. */ });
  function action(label: string, work: () => Promise<void>) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => { void work(); }); return button;
  }
  return { destroy() { destroyed = true; root?.remove(); } };
}

function disabledChange(settings: InstantHelpSettings) {
  const { version: _version, revision, updatedAt: _updatedAt, ...values } = settings;
  return { ...values, enabled: false, expectedRevision: revision };
}
