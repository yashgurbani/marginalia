import { browser } from 'wxt/browser';
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
