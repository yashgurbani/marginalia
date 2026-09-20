import { readReply } from '../../lib/respond.ts';
import { browser } from 'wxt/browser';
import '../../../ui/tokens.css';
import './options.css';
import { DEFAULT_HELPER_ORIGIN, HELPER_ORIGIN_KEY, validHelperOrigin } from '../../lib/helper-origin.ts';
import { diagnosticsSection, loadReaderDiagnostics, type ReaderDiagnostics } from '../../../ui/diagnostics.ts';
import { localPersistence } from '../../../ui/persistence.ts';
import { HelperClient, HelperHttpError, HelperTransportError } from '../../../ui/helper.ts';
const list = document.querySelector('#sites')!;
const statusLine = document.querySelector<HTMLParagraphElement>('#status')!;
async function hosts(): Promise<string[]> { const value = (await browser.storage.local.get('excludedHosts')).excludedHosts; return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; }
async function changeExclusion(host: string, excluded: boolean) { return readReply(await browser.runtime.sendMessage({ type: 'instant-exclusion', version: 1, host, excluded })) as { excluded: boolean }; }
async function render() {
  list.replaceChildren();
  const current = await hosts();
  // The host supplies the source hostname, not an exclusion rule. Resolve the
  // closest existing rule using the same dot boundary as page exclusion.
  // Fragments remain navigation hints and can never mutate a rule.
  const requested = location.hash?.startsWith('#site=') ? location.hash.slice(6) : '';
  const hostname = (value: string) => value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
  const focusHost = window.top === window && hostname(requested)
    ? current.filter(host => hostname(host) && (requested === host || requested.endsWith('.' + host))).sort((a, b) => b.length - a.length)[0]
    : undefined;
  if (!current.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Your exclusion list is empty. With Instant help on, readable page text is sent to Codex ahead of time when you open an allowed page.';
    list.append(empty); return;
  }
  for (const host of current) {
    const row = document.createElement('li'), remove = document.createElement('button');
    row.append(document.createTextNode(host + ' ')); remove.textContent = 'Stop excluding';
    remove.setAttribute('aria-label', 'Stop excluding ' + host);
    remove.onclick = async () => {
      remove.disabled = true;
      let result: { excluded: boolean };
      try { result = await changeExclusion(host, false); }
      catch { remove.disabled = false; statusLine.textContent = 'The site remains excluded. Connect the helper and try again.'; return; }
      await render();
      statusLine.textContent = result.excluded ? 'Another rule still excludes this site. Review helper settings.' : host + ' can be read again.';
      // render() replaces the button that was just used, so place focus deliberately.
      const next = list.querySelector<HTMLButtonElement>('button');
      if (next) { next.focus(); return; }
      statusLine.tabIndex = -1; statusLine.focus();
    };
    row.append(remove); list.append(row);
    if (host === focusHost) remove.focus();
  }
}
document.querySelector<HTMLFormElement>('#add')!.onsubmit = async event => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('input')!;
  const host = input.value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host) || host.length > 253) { statusLine.textContent = 'Enter a hostname such as example.org.'; return; }
  await changeExclusion(host, true); input.value = ''; statusLine.textContent = 'Site excluded.'; await render();
};
void render();
const originInput = document.querySelector<HTMLInputElement>('#helper-origin')!;
const originStatus = document.querySelector<HTMLElement>('#helper-origin-status')!;
const diagnosticsRoot = document.querySelector<HTMLElement>('#diagnostics')!;
const pairingForm = document.querySelector<HTMLFormElement>('#pairing-form');
const pairingCodeInput = pairingForm?.querySelector<HTMLInputElement>('#pairing-code');
const pairingButton = pairingForm?.querySelector<HTMLButtonElement>('button');
const pairingStorage = localPersistence('marginalia-extension-reader');
const pairingStorageName = 'marginalia-extension-reader';
// Optional: some hosts mount only the diagnostics section, without the one-sentence status line.
const diagnosticsStatus = document.querySelector<HTMLElement>('#diagnostics-status');
// One sentence per state. The full list stays off the live region so it is not re-read on every check.
function diagnosticsSentence(value: ReaderDiagnostics): string {
  if (value.reachability === 'invalid') return 'Enter a local helper address such as http://127.0.0.1:43120.';
  if (value.reachability === 'checking') return 'Checking the local helper.';
  if (value.reachability === 'unreachable') return 'The local helper is unreachable. Start it and check the address.';
  return value.pairing === 'paired' ? 'Local helper reachable. Pairing confirmed.' : 'Use a fresh six-digit code provided by the local helper, then choose Pair to connect this browser.';
}
function showDiagnostics(value: ReaderDiagnostics) {
  const canPair = value.reachability === 'reachable' && value.pairing !== 'paired';
  if (pairingForm) pairingForm.hidden = !canPair;
  if (value.pairing === 'paired') diagnosticsRoot.replaceChildren(diagnosticsSection(value)); else diagnosticsRoot.replaceChildren();
  if (diagnosticsStatus) diagnosticsStatus.textContent = diagnosticsSentence(value);
}
let diagnosticsGeneration = 0, diagnosticsAbort: AbortController | undefined;
let stopped = false, addressRevision = 0;
const pairingChanges = new BroadcastChannel('marginalia-extension-reader');
let pairingGeneration = 0, pairingAbort: AbortController | undefined;
function setPairingBusy(value: boolean) { if (pairingCodeInput) pairingCodeInput.disabled = value; if (pairingButton) pairingButton.disabled = value; }
function cancelPairing() { pairingGeneration++; pairingAbort?.abort(); pairingAbort = undefined; setPairingBusy(false); }
function invalidateDiagnostics() { diagnosticsGeneration++; diagnosticsAbort?.abort(); diagnosticsRoot.replaceChildren(); if (pairingForm) pairingForm.hidden = true; if (diagnosticsStatus) diagnosticsStatus.textContent = ''; }
async function renderDiagnostics(origin: string) {
  invalidateDiagnostics();
  if (stopped || window.top !== window) return;
  const generation = diagnosticsGeneration;
  diagnosticsAbort = new AbortController();
  const signal = diagnosticsAbort.signal;
  const valid = validHelperOrigin(origin);
  if (!valid) { showDiagnostics({ origin: 'Invalid local helper address', reachability: 'invalid', pairing: 'unknown' }); return; }
  const saved = await pairingStorage.read<{ origin: string; token: string }>('pairing').catch(() => undefined);
  if (generation !== diagnosticsGeneration) return;
  const token = saved?.origin === valid ? saved.token : undefined;
  showDiagnostics({ origin: valid, reachability: 'checking', pairing: 'unknown' });
  const result = await loadReaderDiagnostics({ origin: valid, token, extension: true, signal });
  if (generation !== diagnosticsGeneration || signal.aborted) return;
  showDiagnostics(result);
}
pairingChanges.addEventListener('message', event => { if (event.data === 'pairing-changed') void renderDiagnostics(originInput.value); });
originInput.addEventListener('input', () => { addressRevision++; cancelPairing(); invalidateDiagnostics(); });
window.addEventListener('pagehide', () => { stopped = true; cancelPairing(); invalidateDiagnostics(); pairingChanges.close(); });

function pairingFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'Enter the six-digit code shown by the local helper.') return error.message;
  if (error instanceof HelperHttpError && error.status === 403) {
    if (error.message === 'Pairing code did not match.') return 'That code did not match. Check it and try again.';
    if (error.message.startsWith('Pairing expired.')) return 'That code expired or has been used too many times. Get a fresh code from the local helper.';
  }
  if (error instanceof HelperTransportError) return 'The pairing result could not be confirmed. Check the local helper and try again.';
  return 'This browser could not be paired. Check the local helper and try again.';
}

async function pairFromOptions() {
  if (!pairingForm || !pairingCodeInput || stopped || window.top !== window || pairingAbort) return;
  const origin = validHelperOrigin(originInput.value);
  if (!origin) { if (diagnosticsStatus) diagnosticsStatus.textContent = 'Enter a local helper address before pairing.'; return; }
  diagnosticsAbort?.abort(); diagnosticsGeneration++;
  const generation = ++pairingGeneration, controller = new AbortController(); pairingAbort = controller; setPairingBusy(true);
  if (diagnosticsStatus) diagnosticsStatus.textContent = 'Connecting this browser to the local helper…';
  try {
    const client = new HelperClient(origin);
    const token = await client.pair(pairingCodeInput.value, controller.signal);
    if (generation !== pairingGeneration || controller.signal.aborted || stopped) return;
    if (!navigator.locks) throw new Error('Pairing storage is unavailable.');
    await navigator.locks.request(pairingStorageName, async () => {
      if (generation !== pairingGeneration || controller.signal.aborted || stopped) throw new Error('Pairing was cancelled.');
      await pairingStorage.write('pairing', { origin, token },
        () => generation === pairingGeneration && !controller.signal.aborted && !stopped,
        controller.signal);
    });
    if (generation !== pairingGeneration || controller.signal.aborted || stopped) return;
    pairingCodeInput.value = '';
    pairingChanges.postMessage('pairing-changed');
    await renderDiagnostics(origin);
  } catch (error) {
    if (generation !== pairingGeneration || controller.signal.aborted || stopped) return;
    if (error instanceof Error && error.message === 'Pairing storage is unavailable.') {
      if (diagnosticsStatus) diagnosticsStatus.textContent = 'This browser could not save the pairing. No local pairing was changed; try again.';
    } else if (error instanceof Error && error.message === 'Pairing was cancelled.') {
      return;
    } else if (diagnosticsStatus) diagnosticsStatus.textContent = pairingFailureMessage(error);
  } finally {
    if (generation === pairingGeneration) { pairingAbort = undefined; setPairingBusy(false); }
  }
}
if (pairingForm) pairingForm.onsubmit = event => { event.preventDefault(); return pairFromOptions(); };
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[HELPER_ORIGIN_KEY]) {
    addressRevision++;
    cancelPairing();
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
