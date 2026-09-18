import { browser } from 'wxt/browser';
import { DEFAULT_HELPER_ORIGIN, HELPER_ORIGIN_KEY, validHelperOrigin } from '../../lib/helper-origin.ts';
import { diagnosticsSection, loadReaderDiagnostics } from '../../../ui/diagnostics.ts';
import { localPersistence } from '../../../ui/persistence.ts';
const list = document.querySelector('#sites')!;
async function hosts(): Promise<string[]> { const value = (await browser.storage.local.get('excludedHosts')).excludedHosts; return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; }
async function render() {
  list.replaceChildren();
  for (const host of await hosts()) {
    const row = document.createElement('li'), remove = document.createElement('button');
    row.append(document.createTextNode(host + ' ')); remove.textContent = 'Allow reading';
    remove.onclick = async () => { await browser.storage.local.set({ excludedHosts: (await hosts()).filter(h => h !== host) }); await render(); };
    row.append(remove); list.append(row);
  }
}
document.querySelector<HTMLFormElement>('#add')!.onsubmit = async event => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('input')!, status = document.querySelector('#status')!;
  const host = input.value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host) || host.length > 253) { status.textContent = 'Enter a hostname such as example.org.'; return; }
  await browser.storage.local.set({ excludedHosts: [...new Set([...(await hosts()), host])] }); input.value = ''; status.textContent = 'Site excluded.'; await render();
};
void render();
const originInput = document.querySelector<HTMLInputElement>('#helper-origin')!;
const originStatus = document.querySelector<HTMLElement>('#helper-origin-status')!;
const diagnosticsRoot = document.querySelector<HTMLElement>('#diagnostics')!;
let diagnosticsGeneration = 0, diagnosticsAbort: AbortController | undefined;
let stopped = false, addressRevision = 0;
const pairingChanges = new BroadcastChannel('marginalia-extension-reader');
function invalidateDiagnostics() { diagnosticsGeneration++; diagnosticsAbort?.abort(); diagnosticsRoot.replaceChildren(); }
async function renderDiagnostics(origin: string) {
  invalidateDiagnostics();
  if (stopped || window.top !== window) return;
  const generation = diagnosticsGeneration;
  diagnosticsAbort = new AbortController();
  const signal = diagnosticsAbort.signal;
  const valid = validHelperOrigin(origin);
  if (!valid) { diagnosticsRoot.replaceChildren(diagnosticsSection({ origin: 'Invalid local helper address', reachability: 'invalid', pairing: 'unknown' })); return; }
  const saved = await localPersistence('marginalia-extension-reader').read<{ origin: string; token: string }>('pairing').catch(() => undefined);
  if (generation !== diagnosticsGeneration) return;
  const token = saved?.origin === valid ? saved.token : undefined;
  diagnosticsRoot.replaceChildren(diagnosticsSection({ origin: valid, reachability: 'checking', pairing: 'unknown' }));
  const result = await loadReaderDiagnostics({ origin: valid, token, extension: true, signal });
  if (generation !== diagnosticsGeneration || signal.aborted) return;
  diagnosticsRoot.replaceChildren(diagnosticsSection(result));
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
