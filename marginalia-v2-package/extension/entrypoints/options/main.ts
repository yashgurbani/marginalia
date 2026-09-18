import { browser } from 'wxt/browser';
import '../../../ui/tokens.css';
import './options.css';
import { DEFAULT_HELPER_ORIGIN, HELPER_ORIGIN_KEY, validHelperOrigin } from '../../lib/helper-origin.ts';
import { diagnosticsSection, loadReaderDiagnostics, type ReaderDiagnostics } from '../../../ui/diagnostics.ts';
import { localPersistence } from '../../../ui/persistence.ts';
const list = document.querySelector('#sites')!;
const statusLine = document.querySelector<HTMLParagraphElement>('#status')!;
async function hosts(): Promise<string[]> { const value = (await browser.storage.local.get('excludedHosts')).excludedHosts; return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; }
async function render() {
  list.replaceChildren();
  const current = await hosts();
  if (!current.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No sites are excluded. Marginalia only reads a page when you open its margin there.';
    list.append(empty); return;
  }
  for (const host of current) {
    const row = document.createElement('li'), remove = document.createElement('button');
    row.append(document.createTextNode(host + ' ')); remove.textContent = 'Stop excluding';
    remove.setAttribute('aria-label', 'Stop excluding ' + host);
    remove.onclick = async () => {
      await browser.storage.local.set({ excludedHosts: (await hosts()).filter(h => h !== host) });
      await render();
      // render() replaces the button that was just used, so place focus deliberately.
      const next = list.querySelector<HTMLButtonElement>('button');
      if (next) { next.focus(); return; }
      statusLine.tabIndex = -1; statusLine.textContent = host + ' can be read again.'; statusLine.focus();
    };
    row.append(remove); list.append(row);
  }
}
document.querySelector<HTMLFormElement>('#add')!.onsubmit = async event => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('input')!;
  const host = input.value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host) || host.length > 253) { statusLine.textContent = 'Enter a hostname such as example.org.'; return; }
  await browser.storage.local.set({ excludedHosts: [...new Set([...(await hosts()), host])] }); input.value = ''; statusLine.textContent = 'Site excluded.'; await render();
};
void render();
const originInput = document.querySelector<HTMLInputElement>('#helper-origin')!;
const originStatus = document.querySelector<HTMLElement>('#helper-origin-status')!;
const diagnosticsRoot = document.querySelector<HTMLElement>('#diagnostics')!;
// Optional: some hosts mount only the diagnostics section, without the one-sentence status line.
const diagnosticsStatus = document.querySelector<HTMLElement>('#diagnostics-status');
// One sentence per state. The full list stays off the live region so it is not re-read on every check.
function diagnosticsSentence(value: ReaderDiagnostics): string {
  if (value.reachability === 'invalid') return 'That helper address is not a valid loopback address.';
  if (value.reachability === 'checking') return 'Checking the local helper.';
  if (value.reachability === 'unreachable') return 'Local helper not reachable.';
  return value.pairing === 'paired' ? 'Local helper reachable. Pairing confirmed.' : 'Local helper reachable. Not paired yet.';
}
function showDiagnostics(value: ReaderDiagnostics) {
  diagnosticsRoot.replaceChildren(diagnosticsSection(value));
  if (diagnosticsStatus) diagnosticsStatus.textContent = diagnosticsSentence(value);
}
let diagnosticsGeneration = 0, diagnosticsAbort: AbortController | undefined;
let stopped = false, addressRevision = 0;
const pairingChanges = new BroadcastChannel('marginalia-extension-reader');
function invalidateDiagnostics() { diagnosticsGeneration++; diagnosticsAbort?.abort(); diagnosticsRoot.replaceChildren(); if (diagnosticsStatus) diagnosticsStatus.textContent = ''; }
async function renderDiagnostics(origin: string) {
  invalidateDiagnostics();
  if (stopped || window.top !== window) return;
  const generation = diagnosticsGeneration;
  diagnosticsAbort = new AbortController();
  const signal = diagnosticsAbort.signal;
  const valid = validHelperOrigin(origin);
  if (!valid) { showDiagnostics({ origin: 'Invalid local helper address', reachability: 'invalid', pairing: 'unknown' }); return; }
  const saved = await localPersistence('marginalia-extension-reader').read<{ origin: string; token: string }>('pairing').catch(() => undefined);
  if (generation !== diagnosticsGeneration) return;
  const token = saved?.origin === valid ? saved.token : undefined;
  showDiagnostics({ origin: valid, reachability: 'checking', pairing: 'unknown' });
  const result = await loadReaderDiagnostics({ origin: valid, token, extension: true, signal });
  if (generation !== diagnosticsGeneration || signal.aborted) return;
  showDiagnostics(result);
}
pairingChanges.addEventListener('message', event => { if (event.data === 'pairing-changed') void renderDiagnostics(originInput.value); });
originInput.addEventListener('input', () => { addressRevision++; invalidateDiagnostics(); });
window.addEventListener('pagehide', () => { stopped = true; invalidateDiagnostics(); pairingChanges.close(); });
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[HELPER_ORIGIN_KEY]) {
    addressRevision++;
    originInput.value = typeof changes[HELPER_ORIGIN_KEY].newValue === 'string' ? changes[HELPER_ORIGIN_KEY].newValue : DEFAULT_HELPER_ORIGIN;
    void renderDiagnostics(originInput.value);
  }
});
void browser.storage.local.get(HELPER_ORIGIN_KEY).then(values => {
  if (addressRevision || stopped) return;
  originInput.value = typeof values[HELPER_ORIGIN_KEY] === 'string' ? values[HELPER_ORIGIN_KEY] : DEFAULT_HELPER_ORIGIN;
  void renderDiagnostics(originInput.value);
});
document.querySelector<HTMLFormElement>('#helper-origin-form')!.onsubmit = async event => {
  event.preventDefault();
  const origin = validHelperOrigin(originInput.value);
  if (!origin) { originStatus.textContent = 'Enter an HTTP loopback origin with a port, such as http://127.0.0.1:43120.'; return; }
  invalidateDiagnostics();
  const revision = ++addressRevision;
  await browser.storage.local.set({ [HELPER_ORIGIN_KEY]: origin });
  if (stopped || revision !== addressRevision) return;
  originInput.value = origin;
  originStatus.textContent = 'Helper address saved. Pair again at this address before connecting.';
  void renderDiagnostics(origin);
};
