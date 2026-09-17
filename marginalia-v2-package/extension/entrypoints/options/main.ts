import { browser } from 'wxt/browser';
import { DEFAULT_HELPER_ORIGIN, HELPER_ORIGIN_KEY, validHelperOrigin } from '../../lib/helper-origin.ts';
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
void browser.storage.local.get(HELPER_ORIGIN_KEY).then(values => { originInput.value = typeof values[HELPER_ORIGIN_KEY] === 'string' ? values[HELPER_ORIGIN_KEY] : DEFAULT_HELPER_ORIGIN; });
document.querySelector<HTMLFormElement>('#helper-origin-form')!.onsubmit = async event => {
  event.preventDefault();
  const origin = validHelperOrigin(originInput.value);
  if (!origin) { originStatus.textContent = 'Enter an HTTP loopback origin with a port, such as http://127.0.0.1:43120.'; return; }
  await browser.storage.local.set({ [HELPER_ORIGIN_KEY]: origin });
  originInput.value = origin;
  originStatus.textContent = 'Helper address saved. Pair again at this address before connecting.';
};
