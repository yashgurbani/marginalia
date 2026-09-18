import { browser } from 'wxt/browser';
import { mountMargin } from '../../../ui/margin.ts';
import '../../../ui/tokens.css';
import '../../../ui/margin.css';
import './panel.css';
import { validSnapshot, type Snapshot } from '../../lib/protocol.ts';
import { readReply } from '../../lib/respond.ts';
import { DEFAULT_HELPER_ORIGIN, helperOrigin } from '../../lib/helper-origin.ts';

const capability = new URLSearchParams(location.hash.slice(1)).get('capability');
const workspace = new URLSearchParams(location.hash.slice(1)).get('workspace');
const embedded = window.top !== window;
const status = document.querySelector<HTMLElement>('#connection')!;
const exclude = document.querySelector<HTMLButtonElement>('#exclude')!;
const controls = document.querySelector<HTMLElement>('#controls')!;
const helperStatus = document.querySelector<HTMLElement>('#helper-status')!;
const root = document.querySelector<HTMLElement>('#margin')!;
let mounted: Awaited<ReturnType<typeof mountMargin>> | undefined, current: Snapshot | undefined, pending = false, stopped = false;
const send = async (action: string, extra: Record<string, unknown> = {}) => readReply(await browser.runtime.sendMessage({ type: 'surface', version: 1, action, capability, workspace, ...extra }));
async function refresh() {
  if (pending || stopped) return; pending = true;
  let restoredOnMount = false;
  try {
    const next: unknown = await send('read');
    if (!validSnapshot(next)) throw new Error('Select a passage on this page to open your margin.');
    if (!current || current.document !== next.document || current.capture.text !== next.capture.text) {
      const origin = embedded ? undefined : await helperOrigin().catch(() => undefined);
      mounted?.destroy();
      current = next;
      mounted = await mountMargin(root, {
        capture: next.capture, sections: next.sections, helperOrigin: origin ?? DEFAULT_HELPER_ORIGIN, storageName: 'marginalia-extension-reader', initialOpen: true, allowHelper: !embedded && !!origin,
        onLibrary: origin ? () => { void browser.tabs.create({ url: new URL('/', origin).href }).catch(() => { status.textContent = 'The Library could not be opened. Your reading remains here.'; }); } : undefined,
        captureCurrentPage: async () => {
          const snapshot: unknown = await send('read');
          if (!validSnapshot(snapshot) || snapshot.document !== next.document || snapshot.capture.url !== next.capture.url) throw new Error('The page changed. Reopen its margin to look again.');
          return { capture: snapshot.capture, tabCapture: snapshot.document };
        },
        authorizeHelperSend: async sourceUrl => {
          const result = await send('authorize-helper-send', { sourceUrl });
          if ((result as { allowed?: boolean })?.allowed !== true) throw new Error('This site is excluded. Allow it in extension options before saving to the local helper.');
        },
        onSource: anchor => { void send('scroll', { document: next.document, anchor }).catch(error => { status.textContent = String(error); }); },
        onHighlight: anchor => { void send('highlight', { document: next.document, anchor }).catch(() => {}); },
      });
      restoredOnMount = mounted.restoredPosition;
      if (next.anchor) mounted.select(next.anchor);
    } else if (next.revision !== current.revision && next.anchor) mounted?.select(next.anchor);
    current = next; if (!restoredOnMount) mounted?.setReadingPosition(next.position); status.textContent = ''; controls.hidden = false;
    const helper = await send('helper-status');
    if (typeof (helper as { status?: unknown })?.status === 'string' && (helper as { status: string }).status.length < 300) helperStatus.textContent = (helper as { status: string }).status;
  } catch (error) {
    // Invalidated sources cannot retain a previous page's private margin on screen.
    mounted?.destroy(); mounted = undefined; current = undefined; controls.hidden = true;
    status.textContent = error instanceof Error ? error.message : 'The page is unavailable. Reopen the margin.';
  } finally { pending = false; }
}
exclude.addEventListener('click', () => { void send('exclude').then(() => { mounted?.destroy(); mounted = undefined; current = undefined; controls.hidden = true; status.textContent = 'This site is excluded. Manage exclusions in the extension options.'; }).catch(error => { status.textContent = String(error); }); });
for (const [id, action] of [['connect', 'helper-connect'], ['disconnect', 'helper-disconnect']]) document.getElementById(id)!.addEventListener('click', () => { void send(action).then(result => { if (typeof (result as { status?: unknown })?.status === 'string') helperStatus.textContent = (result as { status: string }).status; }).catch(() => { helperStatus.textContent = 'Local helper unavailable. Your notes remain on this device.'; }); });
document.getElementById('connect')!.hidden = embedded;
document.getElementById('disconnect')!.hidden = embedded;
document.getElementById('trusted-open')!.hidden = !embedded;
document.getElementById('trusted-open')!.addEventListener('click', () => { void send('trusted-open').catch(() => { status.textContent = 'Reopen the margin from your source page.'; }); });
// Each request wakes a disposable worker and reconstructs its source binding.
// It never starts inference or automatically replays unknown provider outcomes.
const timer = setInterval(() => { void refresh(); }, 1500);
window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); void mounted?.flushReadingPosition(); mounted?.destroy(); });
void refresh();

