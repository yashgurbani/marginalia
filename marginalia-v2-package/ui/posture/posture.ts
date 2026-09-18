import type { AutoAssistPosture, AutoAssistSettings } from '../../contracts/auto-assist.ts';
import type { PostureTransport } from './transport.ts';

export type PostureMount = { reload(): Promise<void>; destroy(): void };

const choices: ReadonlyArray<{ value: AutoAssistPosture; label: string; sentence: string }> = [
  { value: 'flow', label: 'Flow', sentence: 'Put short definitions first and keep extra help light.' },
  { value: 'balanced', label: 'Balanced', sentence: 'Keep definitions and questions in balance as you read.' },
  { value: 'learning', label: 'Learning', sentence: 'Put questions and critiques first and offer more help as you read.' },
];

export function mountPosture(host: HTMLElement, transport: PostureTransport): PostureMount {
  const doc = host.ownerDocument, root = doc.createElement('section'); root.className = 'm-posture';
  const status = doc.createElement('p'); status.className = 'm-posture__status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  host.replaceChildren(root);
  let generation = 0, destroyed = false, saving = false, settings: AutoAssistSettings | undefined;

  async function reload() {
    if (destroyed) return;
    const own = ++generation; root.textContent = 'Opening reading posture.';
    try {
      const next = await transport.getSettings();
      if (destroyed || own !== generation) return;
      settings = next; render(next.posture);
    } catch { if (!destroyed && own === generation) root.textContent = 'Reading posture is unavailable.'; }
  }

  function render(selected: AutoAssistPosture) {
    const fieldset = doc.createElement('fieldset'), legend = doc.createElement('legend'); legend.textContent = 'Reading posture';
    for (const choice of choices) {
      const label = doc.createElement('label'), input = doc.createElement('input'), copy = doc.createElement('span');
      input.type = 'radio'; input.name = 'posture'; input.value = choice.value; input.checked = choice.value === selected;
      copy.textContent = `${choice.label}. ${choice.sentence}`; label.append(input, copy);
      input.addEventListener('change', () => {
        if (destroyed || saving || !input.checked || !settings) return;
        const current = settings;
        saving = true; disable(fieldset, true); status.textContent = 'Saving reading posture.';
        void transport.saveSettings({ expectedRevision: current.revision, enabled: current.enabled, method: current.method,
          posture: choice.value, autoDefinitions: structuredClone(current.autoDefinitions) }).then(next => {
          if (!destroyed) { settings = next; selected = next.posture; sync(fieldset, selected); status.textContent = 'Reading posture saved.'; }
        }).catch(() => {
          if (!destroyed) { sync(fieldset, selected); status.textContent = 'Saving reading posture failed.'; }
        }).finally(() => { saving = false; if (!destroyed) disable(fieldset, false); });
      });
      fieldset.append(label);
    }
    root.replaceChildren(fieldset, status); status.textContent = '';
  }

  void reload();
  return { reload, destroy() { if (destroyed) return; destroyed = true; ++generation; root.remove(); } };
}

export function renderAssumes(list: readonly string[]): HTMLElement | null {
  if (list.length === 0) return null;
  const root = document.createElement('section'), heading = document.createElement('h4'), values = document.createElement('ul');
  root.className = 'm-assumes'; heading.textContent = 'Assumes:';
  for (const value of list) { const item = document.createElement('li'); item.textContent = value; values.append(item); }
  root.append(heading, values); return root;
}

function sync(fieldset: HTMLFieldSetElement, selected: AutoAssistPosture) {
  for (const input of fieldset.querySelectorAll('input')) input.checked = input.value === selected;
}
function disable(fieldset: HTMLFieldSetElement, value: boolean) {
  for (const input of fieldset.querySelectorAll('input')) input.disabled = value;
}
