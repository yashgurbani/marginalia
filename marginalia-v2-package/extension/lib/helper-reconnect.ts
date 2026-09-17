import { localPersistence } from '../../ui/persistence.ts';
import { ReaderJournal } from '../../ui/journal.ts';
import { HelperClient } from '../../ui/helper.ts';

const STORAGE = 'marginalia-extension-reader';
const ORIGIN = 'http://127.0.0.1:43120';
type Replay = { token: string; after: number };

/** Rebuildable worker transport. Only explicit local-sync opt-in enables it.
 * No provider request is created or retried here. Mutation IDs belong to the journal. */
export function helperReconnect() {
  const persistence = localPersistence(STORAGE);
  const channel = new BroadcastChannel(STORAGE);
  let socket: WebSocket | undefined, connecting = false, retryAt = 0, backoff = 1000;
  let state = 'Local helper updates are off.';
  let generation = 0;
  async function enabled() { return await persistence.read<boolean>('extension-helper-enabled') === true; }
  async function synchronize(token: string) {
    await navigator.locks.request(STORAGE, async () => {
      const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
      if (!await enabled() || pairing?.origin !== ORIGIN || pairing.token !== token) throw new Error('Pair with the local helper again.');
      const helper = new HelperClient(ORIGIN); helper.token = token;
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
      if (pairing?.origin === ORIGIN && await enabled()) await synchronize(pairing.token);
    })().catch(() => { state = 'Some local changes still need to be saved. Review Settings.'; });
  });
  async function wake() {
    if (connecting) return;
    connecting = true;
    try {
      if (!await enabled()) { socket?.close(); socket = undefined; state = 'Local helper updates are off.'; return; }
      const pairing = await persistence.read<{ origin: string; token: string }>('pairing');
      if (pairing?.origin !== ORIGIN || !/^[A-Za-z0-9_-]{43}$/.test(pairing.token)) { socket?.close(); socket = undefined; state = 'Pair in Settings before connecting saved work.'; return; }
      if (socket || Date.now() < retryAt) return;
      const token = pairing.token, thisGeneration = ++generation;
      const saved = await persistence.read<Replay>('extension-helper-replay');
      let after = saved?.token === token && Number.isSafeInteger(saved.after) && saved.after >= 0 ? saved.after : 0;
      const ws = new WebSocket('ws://127.0.0.1:43120/events'); socket = ws;
      state = 'Connecting to the local helper…';
      let processing = Promise.resolve();
      ws.onopen = () => { if (thisGeneration === generation) ws.send(JSON.stringify({ token, after })); };
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
          backoff = 1000; state = 'Saved work connected to the local helper.';
        }).catch(() => { state = 'Local helper updates paused. Your notes remain on this device.'; ws.close(); });
      };
      ws.onerror = () => { state = 'Local helper unavailable. Your notes remain on this device.'; };
      ws.onclose = event => {
        if (thisGeneration !== generation) return;
        socket = undefined; retryAt = Date.now() + backoff; backoff = Math.min(30000, backoff * 2);
        if (event.code === 1008) { state = 'Pair again or reconnect to resume local updates.'; void persistence.write('extension-helper-enabled', false); }
      };
    } catch { state = 'Local helper unavailable. Your notes remain on this device.'; }
    finally { connecting = false; }
  }
  return {
    async setEnabled(value: boolean) {
      ++generation; socket?.close(); socket = undefined; retryAt = 0;
      await persistence.write('extension-helper-enabled', value);
      if (value) await wake(); else state = 'Local helper updates are off.';
      return state;
    },
    async status() { await wake(); return state; },
  };
}
