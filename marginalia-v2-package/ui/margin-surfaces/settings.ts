import { el, button } from '../dom.ts';
import { retainedCopiesSection } from '../retained-copies.ts';
import { diagnosticsSection, type ReaderDiagnostics } from '../diagnostics.ts';
import type { ReaderMutation } from '../../contracts/reader.ts';
import type { SurfaceAction } from './types.ts';

const label = (text: string, input: HTMLElement) => { const node = el('label', text); node.append(input); return node; };
const actionButton = (key: string, text: string, run: () => unknown) => { const control = button(text, run); control.dataset.focusKey = key; return control; };
const actions = (...children: HTMLElement[]) => { const row = el('div', undefined, 'm-actions'); row.append(...children); return row; };

type SettingsView = {
  needsReconciliation: boolean; needsSaving: boolean; allowHelper: boolean;
  pairingDraft: string; pairingFailure?: 'expired' | 'mismatch'; helperOrigin?: string; helperPaired: boolean;
  denied: boolean; forget: boolean; conflicts: readonly { change: ReaderMutation; message: string }[];
};
type SettingsCommands = {
  recover: SurfaceAction; retry: SurfaceAction; pairingInput(value: string): void;
  pair(code: HTMLInputElement): unknown; sync: SurfaceAction; disconnect: SurfaceAction;
  theme(value: string): void; preview: SurfaceAction; close: SurfaceAction;
  diagnostics(): ReaderDiagnostics; refreshDiagnostics: SurfaceAction;
  resolve(mutation: ReaderMutation, useHelper: boolean): unknown;
};

export function mountSettingsSurface(hostContent?: HTMLElement) {
  const setup = el('section', undefined, 'm-settings'); setup.hidden = true;
  const settingsBody = el('div'), managementHost = el('div'), forgetHost = el('div', undefined, 'm-forget-slot');
  setup.append(settingsBody, managementHost, ...(hostContent ? [hostContent] : []));
  return {
    setup, settingsBody, managementHost, forgetHost,
    control(toggle: SurfaceAction) { return button('Settings', toggle); },
    update(view: SettingsView, commands: SettingsCommands) {
      const focused = settingsBody.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      const pairingFocused = focused?.getAttribute('aria-label') === 'Pairing code';
      const caret = pairingFocused && focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : undefined;
      settingsBody.replaceChildren(el('h2', 'Settings'));
      if (view.needsReconciliation) settingsBody.append(el('p', 'Another tab saved a different version. Recovering preserves it and retains your changes for review.', 'm-error'), actionButton('settings:' + 'recover-unsaved-changes', 'Recover unsaved changes', commands.recover));
      if (view.needsSaving) settingsBody.append(el('p', 'Some work needs saving or conflict review. Memory-only recovery lasts only while this document stays open; export before closing.', 'm-error'), actionButton('settings:' + 'retry-saving', 'Retry saving', commands.retry));
      if (!view.allowHelper) settingsBody.append(el('p', 'Open the browser-owned margin or localhost page to connect the local helper.', 'm-meta'));
      else {
        const code = el('input'); code.dataset.focusKey = 'settings:pairing-code'; code.type = 'text'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.maxLength = 16; code.setAttribute('aria-label', 'Pairing code'); code.placeholder = 'Six-digit helper code'; code.value = view.pairingDraft;
        if (view.pairingFailure) settingsBody.append(el('p', view.pairingFailure === 'expired'
          ? 'Get a fresh code from the helper to continue.' : 'Enter the code shown in the helper settings.', 'm-pairing-repair'));
        if (view.helperOrigin !== undefined) {
          const helperSettings = el('a', 'Open helper settings'); helperSettings.dataset.focusKey = 'settings:helper-page'; helperSettings.href = view.helperOrigin + '/#pair-helper'; helperSettings.target = '_blank'; helperSettings.rel = 'noopener noreferrer';
          settingsBody.append(helperSettings);
        }
        code.addEventListener('input', () => commands.pairingInput(code.value));
        settingsBody.append(el('p', 'Reading and notes work without an account. Pairing does not establish model login, readiness or permission to send.', 'm-meta'), label('Pairing code', code), actions(
          actionButton('settings:' + 'pair', 'Pair', () => commands.pair(code)),
          actionButton('settings:' + 'save-queued-changes', 'Save queued changes', commands.sync),
          actionButton('settings:' + 'disconnect', 'Disconnect', commands.disconnect)));
      }
      const theme = el('select'); theme.dataset.focusKey = 'settings:theme'; theme.setAttribute('aria-label', 'Theme');
      for (const value of ['system', 'light', 'dark']) { const option = el('option', value[0].toUpperCase() + value.slice(1)); option.value = value; theme.append(option); }
      theme.value = document.documentElement.dataset.theme ?? 'system';
      theme.addEventListener('change', () => { if (theme.value === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme.value; commands.theme(theme.value); });
      settingsBody.append(label('Theme', theme), el('p', 'Model choices, actual grants, exclusions and vocabulary are managed in the local library and settings.', 'm-meta'), retainedCopiesSection(),
        actionButton('settings:question-preview', view.denied ? 'Allow question previews here' : 'Block question previews here', commands.preview),
        actionButton('settings:' + 'close-settings', 'Close settings', commands.close));
      if (view.forget) settingsBody.append(el('h3', 'Prepared page help'), forgetHost);
      if (view.allowHelper) settingsBody.append(diagnosticsSection(commands.diagnostics()), actionButton('settings:' + 'check-how-things-are', 'Check how things are', commands.refreshDiagnostics));
      for (const conflict of view.conflicts) {
        const item = el('details'), mutation = conflict.change;
        item.append(el('summary', 'Review a retained change'), el('p', conflict.message), el('pre', mutation.kind === 'note' ? mutation.text : mutation.kind === 'keep' ? mutation.note ?? mutation.anchor.exact : JSON.stringify(mutation)));
        item.append(actionButton('settings:' + 'keep-device-version-keep-my-change-in-history', 'Keep device version; keep my change in history', () => commands.resolve(mutation, false)));
        if (view.allowHelper && view.helperPaired) item.append(actionButton('settings:' + 'use-helper-version-keep-my-change-in-history', 'Use helper version; keep my change in history', () => commands.resolve(mutation, true)));
        settingsBody.append(item);
      }
      if (pairingFocused) { const next = settingsBody.querySelector<HTMLInputElement>('[aria-label="Pairing code"]'); next?.focus({ preventScroll: true }); if (next && caret) next.setSelectionRange(caret[0], caret[1]); }
      else if (focused && !focused.isConnected) Array.from(settingsBody.querySelectorAll<HTMLElement>('button,select')).find(node => !!focused.dataset.focusKey && node.dataset.focusKey === focused.dataset.focusKey)?.focus({ preventScroll: true });
    },
  };
}
