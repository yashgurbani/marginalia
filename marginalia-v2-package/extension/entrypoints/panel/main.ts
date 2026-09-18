import { ForgetClient } from '../../../ui/forget/client.ts';
import type { InstantPage } from '../../lib/instant-lifecycle.ts';
import { panelInstantTransport } from '../../lib/panel-instant.ts';
import { connectionControls } from '../../lib/panel-controls.ts';
import type { ReadyPage } from '../../lib/auto-assist-bridge.ts';
import { libraryThreadUrl } from '../../lib/library-link.ts';
import { browser } from 'wxt/browser';
import { mountMargin } from '../../../ui/margin.ts';
import '../../../ui/tokens.css';
import '../../../ui/margin.css';
import './panel.css';
import { validSnapshot, validSavedMarks, type SavedMark, type Snapshot } from '../../lib/protocol.ts';
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
let sourceEpoch = 0, autoPending: number | undefined, autoIdentity = '';
let mountAbort: AbortController | undefined;
const closingMounts = new Set<AbortController>();
root.hidden = true;
async function refreshAutoAssist() {
  if (stopped || !current || !mounted || autoPending === sourceEpoch) return;
  const epoch = sourceEpoch, surface = mounted, snapshot = current;
  autoPending = epoch;
  try {
    const state = await send('auto-assist-status') as ReadyPage | null;
    if (epoch !== sourceEpoch || surface !== mounted || snapshot !== current) return;
    if (!state || state.document !== current.document || state.url !== current.capture.url) { mounted?.clearAutoAssist?.(); autoIdentity = ''; return; }
    const items = state.items.map(({ candidateId, term, anchor, state, definition }) => ({ candidateId, term, anchor, state, definition }));
    const readingPosition = state.items.find(item => item.candidateId === state.focused)?.anchor.start ?? current.position;
    const identity = JSON.stringify([state.document, state.sourceHash, state.posture, readingPosition, items]);
    if (identity === autoIdentity) return; autoIdentity = identity;
    mounted?.showAutoAssist?.({ posture: state.posture, readingPosition, assumes: items, items });
  } catch { if (epoch === sourceEpoch) { surface.clearAutoAssist?.(); autoIdentity = ''; } }
  finally { if (autoPending === epoch) autoPending = undefined; }
}
root.addEventListener('click', event => {
  const button = (event.target as Element | null)?.closest<HTMLElement>('[data-auto-assist-action="open"]');
  const candidateId = button?.dataset.autoAssistCandidate;
  if (candidateId) void send('auto-assist-open', { candidateId }).then(() => refreshAutoAssist()).catch(() => {});
});
let mounted: Awaited<ReturnType<typeof mountMargin>> | undefined, current: Snapshot | undefined, pending: number | undefined, stopped = false;
const send = async (action: string, extra: Record<string, unknown> = {}) => readReply(await browser.runtime.sendMessage({ type: 'surface', version: 1, action, capability, workspace, ...extra }));
let savedMarks: SavedMark[] = [], markSends: Promise<unknown> = Promise.resolve();
function paintSavedMarks(snapshot: Snapshot, marks: SavedMark[]) {
  const packet = { document: snapshot.document, url: snapshot.capture.url, revision: snapshot.revision, marks: structuredClone(marks) };
  const valid = validSavedMarks(packet);
  if (!valid) status.textContent = 'Saved marks exceed the page display limit. Your saved work is retained.';
  const epoch = sourceEpoch;
  markSends = markSends.catch(() => {}).then(() => {
    if (epoch !== sourceEpoch || stopped) return;
    return send('saved-marks', valid ? packet : { document: snapshot.document, url: snapshot.capture.url, revision: snapshot.revision, marks: [] });
  }).catch(() => {});
}
function neutralize(preservePosition = false) {
  ++sourceEpoch;
  if (!preservePosition) { for (const closing of closingMounts) closing.abort(); closingMounts.clear(); }
  const previous = mounted, previousAbort = mountAbort;
  mountAbort = undefined; mounted = undefined; current = undefined;
  if (preservePosition && previous) {
    // Ordinary hide/close retains the last reading position. Policy/source
    // invalidation uses abort-first teardown and cannot start this helper write.
    if (previousAbort) closingMounts.add(previousAbort);
    void previous.flushReadingPosition().finally(() => {
      if (previousAbort) closingMounts.delete(previousAbort);
      previousAbort?.abort(); previous.destroy();
    }).catch(() => {});
  } else { previousAbort?.abort(); previous?.destroy(); }
  root.replaceChildren(); root.hidden = true; controls.hidden = true;
  savedMarks = []; autoIdentity = ''; helperStatus.textContent = '';
  status.textContent = 'Checking this page.';
}
async function refresh() {
  if (pending === sourceEpoch || stopped || document.visibilityState === 'hidden') return;
  const epoch = sourceEpoch; pending = epoch;
  const valid = () => epoch === sourceEpoch && !stopped && document.visibilityState !== 'hidden';
  const boundSend: typeof send = async (action, extra = {}) => {
    if (!valid()) throw new Error('The page changed.');
    const value = await send(action, extra);
    if (!valid()) throw new Error('The page changed.');
    return value;
  };
  let restoredOnMount = false;
  try {
    const next: unknown = await boundSend('read');
    if (!validSnapshot(next)) throw new Error('Select a passage on this page to open your margin.');
    if (current && (current.document !== next.document || current.capture.url !== next.capture.url || current.capture.text !== next.capture.text)) { neutralize(); void refresh(); return; }
    if (!current) {
      const origin = embedded ? undefined : await helperOrigin().catch(() => undefined);
      if (!valid()) return;
      mountAbort = new AbortController();
      const candidate = await mountMargin(root, {
        signal: mountAbort.signal,
        instantHelp: panelInstantTransport(boundSend),
        settingsContent: controls,
        forget: {
          transport: new ForgetClient({ request: async (_path, body, signal) => { signal?.throwIfAborted(); return boundSend('instant-forget', { pageId: (body as { pageId: string }).pageId }); } }),
          getPageId: async signal => { signal?.throwIfAborted(); return ((await boundSend('instant-status')) as InstantPage | null)?.pageId; },
        },
        autoAssist: { dismiss: async (item, signal) => { signal.throwIfAborted(); const result = await boundSend('auto-assist-dismiss', { candidateId: item.candidateId }) as { dismissed?: boolean }; if (result?.dismissed !== true) throw new Error('This term could not be marked familiar.'); autoIdentity = ''; } },
        capture: next.capture, sections: next.sections, helperOrigin: origin ?? DEFAULT_HELPER_ORIGIN, storageName: 'marginalia-extension-reader', initialOpen: true, allowHelper: !embedded && !!origin,
        onLibrary: origin ? thread => { void browser.tabs.create({ url: libraryThreadUrl(origin, thread?.id) }).catch(() => { status.textContent = 'The Library could not be opened. Your reading remains here.'; }); } : undefined,
        captureCurrentPage: async () => {
          const snapshot: unknown = await boundSend('read');
          if (!validSnapshot(snapshot) || snapshot.document !== next.document || snapshot.capture.url !== next.capture.url) throw new Error('The page changed. Reopen its margin to look again.');
          return { capture: snapshot.capture, tabCapture: snapshot.document };
        },
        authorizeHelperSend: async sourceUrl => {
          const result = await boundSend('authorize-helper-send', { sourceUrl });
          if ((result as { allowed?: boolean })?.allowed !== true) throw new Error('This site is excluded. Allow it in extension options before saving to the local helper.');
        },
        onSource: anchor => { void boundSend('scroll', { document: next.document, anchor }).catch(error => { status.textContent = String(error); }); },
        onHighlight: anchor => { void boundSend('highlight', { document: next.document, anchor }).catch(() => {}); },
        onSavedMarks: marks => { if (!valid()) return; savedMarks = marks; paintSavedMarks(current?.document === next.document ? current : next, marks); },
      });
      if (!valid()) { candidate.destroy(); return; }
      // Recheck source and exclusion after asynchronous hydration before revealing data.
      const checked = await boundSend('read');
      if (!validSnapshot(checked) || checked.document !== next.document || checked.capture.url !== next.capture.url || checked.capture.text !== next.capture.text) { candidate.destroy(); neutralize(); void refresh(); return; }
      mounted = candidate; current = next;
      root.hidden = false; controls.hidden = false;
      restoredOnMount = mounted.restoredPosition;
      if (next.anchor) mounted.select(next.anchor);
    } else if (next.revision !== current.revision && next.anchor) mounted?.select(next.anchor);
    current = next; if (!restoredOnMount) mounted?.setReadingPosition(next.position); status.textContent = ''; controls.hidden = false;
    paintSavedMarks(next, savedMarks); void refreshAutoAssist();
    const helper = await boundSend('helper-status');
    connectionControls(controls, embedded, (helper as { enabled?: boolean })?.enabled === true);
    if (typeof (helper as { status?: unknown })?.status === 'string' && (helper as { status: string }).status.length < 300) helperStatus.textContent = (helper as { status: string }).status;
  } catch (error) {
    if (!valid()) return;
    // Invalidate callbacks as well as removing the old private surface.
    neutralize();
    status.textContent = error instanceof Error ? error.message : 'The page is unavailable. Reopen the margin.';
  } finally { if (pending === epoch) pending = undefined; }
}
exclude.addEventListener('click', () => { void send('exclude').then(() => { neutralize(); status.textContent = 'This site is excluded. Manage exclusions in the extension options.'; }).catch(error => { status.textContent = String(error); }); });
for (const [id, action] of [['connect', 'helper-connect'], ['disconnect', 'helper-disconnect']]) document.getElementById(id)!.addEventListener('click', () => { void send(action).then(result => { connectionControls(controls, embedded, (result as { enabled?: boolean })?.enabled === true); if (typeof (result as { status?: unknown })?.status === 'string') helperStatus.textContent = (result as { status: string }).status; }).catch(() => { helperStatus.textContent = 'Local helper unavailable. Your notes remain on this device.'; }); });
connectionControls(controls, embedded, false);
document.getElementById('trusted-open')!.addEventListener('click', () => { void send('trusted-open').catch(() => { status.textContent = 'Reopen the margin from your source page.'; }); });
// Each request wakes a disposable worker and reconstructs its source binding.
// It never starts inference or automatically replays unknown provider outcomes.
const timer = setInterval(() => { void refresh(); }, 1500);
document.addEventListener('visibilitychange', () => { neutralize(document.visibilityState === 'hidden'); if (document.visibilityState !== 'hidden') void refresh(); });
browser.runtime.onMessage.addListener((message, sender) => {
  if (!embedded && !workspace && sender.id === browser.runtime.id && !sender.tab && message?.type === 'panel-source-pending' && message.version === 1) {
    neutralize(); void refresh();
  }
});
window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); neutralize(true); });
void refresh();

