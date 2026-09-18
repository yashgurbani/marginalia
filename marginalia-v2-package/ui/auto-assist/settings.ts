import type { AutoAssistPosture, AutoAssistSettings } from '../../contracts/auto-assist.ts';
import type { AutoAssistTransport } from './transport.ts';

export type AutoAssistSettingsMount = { reload(): Promise<void>; destroy(): void };

export function mountAutoAssistSettings(host: HTMLElement, transport: AutoAssistTransport): AutoAssistSettingsMount {
  const doc = host.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value;
  };
  const root = node('section', undefined, 'm-auto-assist-settings');
  const title = node('h3', 'Auto assist');
  const description = node('p', 'Auto assist underlines a few unfamiliar terms and sends those terms to Codex to prepare short definitions as you read.', 'm-auto-assist-settings__description');
  const content = node('div');
  const status = node('p', '', 'm-auto-assist-settings__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(title, description, content, status); host.replaceChildren(root);
  let settings: AutoAssistSettings | undefined, destroyed = false, generation = 0, saving = false;

  async function reload() {
    if (destroyed) return;
    const own = ++generation; content.replaceChildren(node('p', 'Opening auto assist settings.', 'm-auto-assist-settings__muted')); status.textContent = '';
    try {
      const next = await transport.getSettings();
      if (destroyed || own !== generation) return;
      settings = next; render();
    } catch {
      if (!destroyed && own === generation) content.replaceChildren(node('p', 'Auto assist settings are unavailable.', 'm-auto-assist-settings__muted'));
    }
  }

  function render() {
    if (!settings || destroyed) return;
    const form = node('form', undefined, 'm-auto-assist-settings__form');
    const enabled = doc.createElement('input'); enabled.type = 'checkbox'; enabled.checked = settings.enabled;
    enabled.setAttribute('role', 'switch'); enabled.setAttribute('aria-label', 'Auto assist');
    const switchRow = node('label', undefined, 'm-auto-assist-settings__switch'); switchRow.append(enabled, node('span', 'Auto assist'));
    const posture = doc.createElement('select'); posture.setAttribute('aria-label', 'Suggestion amount');
    for (const [value, label] of [['flow', 'Flow'], ['balanced', 'Balanced'], ['learning', 'Learning']] as const) {
      const option = doc.createElement('option'); option.value = value; option.textContent = label; posture.append(option);
    }
    posture.value = settings.posture;
    const postureRow = node('label', undefined, 'm-auto-assist-settings__field'); postureRow.append(node('span', 'Suggestion amount'), posture);
    const postureDescription = node('p', 'Changes how many suggestions appear. Every reading action stays available.', 'm-auto-assist-settings__description');
    const save = node('button', 'Save auto assist'); save.type = 'submit';
    form.append(switchRow, postureRow, postureDescription, save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!settings || saving || !postureValue(posture.value)) return;
      const current = settings;
      const change = { expectedRevision: current.revision, enabled: enabled.checked, method: current.method,
        posture: posture.value, autoDefinitions: structuredClone(current.autoDefinitions) };
      saving = true; save.disabled = true; status.textContent = 'Saving auto assist settings.';
      void transport.saveSettings(change).then(next => {
        if (destroyed) return;
        settings = next; enabled.checked = next.enabled; posture.value = next.posture; status.textContent = 'Auto assist settings saved.';
      }).catch(() => { if (!destroyed) status.textContent = 'Saving auto assist settings failed.'; })
        .finally(() => { saving = false; if (!destroyed) save.disabled = false; });
    });
    content.replaceChildren(form);
  }

  void reload();
  return { reload, destroy() { if (destroyed) return; destroyed = true; ++generation; root.remove(); } };
}

function postureValue(value: string): value is AutoAssistPosture { return value === 'flow' || value === 'balanced' || value === 'learning'; }
