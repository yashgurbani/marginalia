import { localPersistence } from '../../ui/persistence.ts';
import { ReaderJournal } from '../../ui/journal.ts';
import { HelperClient } from '../../ui/helper.ts';
import { HELPER_ORIGIN_KEY, helperOrigin } from './helper-origin.ts';
import { browser } from 'wxt/browser';

const STORAGE = 'marginalia-extension-reader';
export const HELPER_RECONNECT_ALARM = 'marginalia-helper-reconnect';
const BACKOFF_KEY = 'helper-reconnect-backoff';
type Replay = { token: string; after: number };
type Backoff = { retryAt: number; delay: number };

/** Rebuildable worker transport. Only explicit local-sync opt-in enables it.
 * No provider request is created or retried here. Mutation IDs belong to the journal. */
export function helperReconnect() {
  const persistence = localPersistence(STORAGE);
  const channel = new BroadcastChannel(STORAGE);
  let socket: WebSocket | undefined, connecting = false, retryAt = 0, backoff = 1000, backoffLoaded = false;
  let retryUpdate = Promise.resolve();
  let state = 'Local helper updates are off.';
  let generation = 0;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[HELPER_ORIGIN_KEY]) return;
    ++generation; socket?.close(); socket = undefined; retryAt = 0; void clearRetry().catch(() => {});
    state = 'Helper address changed. Pair again in Settings, then reconnect.';
  });
  async function enabled() { return await persistence.read<boolean>('extension-helper-enabled') === true; }
  async function loadBackoff() {
    if (backoffLoaded) return;
    const saved = (await browser.storage.session.get(BACKOFF_KEY))[BACKOFF_KEY] as Backoff | undefined;
    if (saved && Number.isFinite(saved.retryAt) && Number.isFinite(saved.delay)) {
      retryAt = saved.retryAt; backoff = Math.min(30000, Math.max(1000, saved.delay));
    }
    backoffLoaded = true;
  }
  async function clearRetry() {
    retryAt = 0; backoff = 1000;
    await (retryUpdate = retryUpdate.catch(() => {}).then(async () => { await browser.alarms.clear(HELPER_RECONNECT_ALARM); await browser.storage.session.remove(BACKOFF_KEY); }));
  }
  async function scheduleRetry() {
    retryAt = Date.now() + backoff; backoff = Math.min(30000, backoff * 2); backoffLoaded = true;
    await (retryUpdate = retryUpdate.catch(() => {}).then(async () => {
      await browser.storage.session.set({ [BACKOFF_KEY]: { retryAt, delay: backoff } satisfies Backoff });
      browser.alarms.create(HELPER_RECONNECT_ALARM, { periodInMinutes: 1 });
    }));
  }
  async function synchronize(token: string) {
    const origin = await helperOrigin();
    await navigator.locks.request(STORAGE, async () => {
      const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
      if (!await enabled() || pairing?.origin !== origin || pairing.token !== token) throw new Error('Pair with the local helper again.');
      const helper = new HelperClient(origin); helper.token = token;
      const journal = new ReaderJournal(persistence.journal); await journal.load();
      // Background replay never authorizes outbound source/note mutations. The
      // browser-owned margin's explicit Save action owns that separate boundary.
      await journal.sync(async () => { throw new Error('Save pending changes from the browser margin first.'); }, () => helper.list());
    });
    channel.postMessage('changed');
  }
  channel.addEventListener('message', () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    void (async () => {
      const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
      if (pairing?.origin === await helperOrigin() && await enabled()) await synchronize(pairing.token);
    })().catch(() => { state = 'Some local changes still need to be saved. Review Settings.'; });
  });
  async function wake() {
    if (connecting) return;
    connecting = true;
    try {
      if (!await enabled()) { socket?.close(); socket = undefined; await clearRetry(); state = 'Local helper updates are off.'; return; }
      const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
      const origin = await helperOrigin();
      if (pairing?.origin !== origin || !/^[A-Za-z0-9_-]{43}$/.test(pairing.token)) { socket?.close(); socket = undefined; state = 'Pair in Settings before connecting saved work.'; return; }
      await loadBackoff();
      if (socket || Date.now() < retryAt) return;
      const token = pairing.token, thisGeneration = ++generation;
      const saved = await persistence.read<Replay>('extension-helper-replay');
      let after = saved?.token === token && Number.isSafeInteger(saved.after) && saved.after >= 0 ? saved.after : 0;
      const ws = new WebSocket(origin.replace(/^http:/, 'ws:') + '/events'); socket = ws;
      state = 'Connecting to the local helper…';
      let processing = Promise.resolve();
      ws.onopen = () => { if (thisGeneration === generation) { void clearRetry().catch(() => {}); ws.send(JSON.stringify({ token, after })); } };
      ws.onmessage = event => {
        processing = processing.then(async () => {
          if (thisGeneration !== generation || typeof event.data !== 'string' || event.data.length > 2_000_000) throw new Error('Invalid helper update.');
          const message = JSON.parse(event.data);
          if (message?.type !== 'events' || !Array.isArray(message.events) || message.events.length > 1000 || !message.events.every((e: unknown) => !!e && typeof e === 'object' && Number.isSafeInteger((e as { seq: number }).seq) && (e as { seq: number }).seq > 0)) throw new Error('Invalid helper update.');
          await synchronize(token);
          if (thisGeneration !== generation || !await enabled()) return;
          const last = message.events.reduce((max: number, e: { seq: number }) => Math.max(max, e.seq), after);
          // Commit the cursor only after the authoritative journal snapshot is durable.
          await persistence.write('extension-helper-replay', { token, after: last });
          after = last;
          state = 'Saved work connected to the local helper.';
        }).catch(() => { state = 'Local helper updates paused. Your notes remain on this device.'; ws.close(); });
      };
      ws.onerror = () => { state = 'Local helper unavailable. Your notes remain on this device.'; };
      ws.onclose = event => {
        if (thisGeneration !== generation) return;
        socket = undefined;
        if (event.code === 1008) { state = 'The helper declined this connection. Check pairing in Settings, then reconnect.'; void persistence.write('extension-helper-enabled', false); void clearRetry().catch(() => {}); }
        else void scheduleRetry().catch(() => {});
      };
    } catch { state = 'Local helper unavailable. Your notes remain on this device.'; }
    finally { connecting = false; }
  }
  return {
    isEnabled: enabled,
    async setEnabled(value: boolean) {
      ++generation; socket?.close(); socket = undefined; retryAt = 0;
      await persistence.write('extension-helper-enabled', value);
      await clearRetry();
      if (value) await wake(); else state = 'Local helper updates are off.';
      return state;
    },
    async status() { await wake(); return state; },
    async reconnect() { await wake(); },
  };
}
