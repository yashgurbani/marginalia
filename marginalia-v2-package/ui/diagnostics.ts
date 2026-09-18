import { isDiagnosticsSnapshot, type DiagnosticsSnapshot } from '../contracts/diagnostics.ts';
export type ReaderDiagnostics = { origin: string; reachability: 'checking' | 'reachable' | 'unreachable' | 'invalid';
  pairing: 'unknown' | 'unpaired' | 'paired'; snapshot?: DiagnosticsSnapshot };
export function diagnosticsOrigin(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* Invalid settings never receive a credential. */ }
}
export async function loadReaderDiagnostics(input: { origin: string; token?: string; extension?: boolean;
  fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number }): Promise<ReaderDiagnostics> {
  const origin = diagnosticsOrigin(input.origin);
  const state: ReaderDiagnostics = { origin: origin ?? 'Invalid local helper address', reachability: origin ? 'unreachable' : 'invalid', pairing: 'unknown' };
  if (!origin) return state;
  const signal = AbortSignal.any([AbortSignal.timeout(input.timeoutMs ?? 12000), ...(input.signal ? [input.signal] : [])]);
  const fetcher = input.fetch ?? globalThis.fetch;
  const get = async (path: string, init: RequestInit = {}) => {
    signal.throwIfAborted();
    const response = await fetcher(origin + path, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', ...init, signal });
    signal.throwIfAborted(); return response;
  };
  try {
    const health = await get('/health');
    if (!health.ok || (await health.json())?.status !== 'ready') return state;
    signal.throwIfAborted(); state.reachability = 'reachable';
    if (!input.token) { state.pairing = 'unpaired'; return state; }
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) return state;
    const response = await get(input.extension ? '/api/read/diagnostics' : '/api/diagnostics', {
      ...(input.extension ? { method: 'POST', body: '{}' } : {}),
      headers: { authorization: `Bearer ${input.token}`, ...(input.extension ? { 'content-type': 'application/json' } : {}) },
    });
    if (response.status === 401) { state.pairing = 'unpaired'; return state; }
    if (!response.ok) return state;
    const payload: unknown = await response.json(); signal.throwIfAborted();
    if (isDiagnosticsSnapshot(payload)) { state.snapshot = payload; state.pairing = 'paired'; }
  } catch { /* Raw transport errors may include request details. */ }
  return state;
}
export function diagnosticLines(v: ReaderDiagnostics): { label: string; value: string }[] {
  const s = v.snapshot;
  const unknown = 'Unknown. Check again when the helper is reachable and pairing is confirmed.';
  return [
    { label: 'Helper address', value: v.origin },
    { label: 'Helper', value: v.reachability === 'checking' ? 'Checking…' : v.reachability === 'reachable' ? 'Reachable.'
      : v.reachability === 'invalid' ? 'Invalid address. Set an HTTP loopback helper address.' : 'The helper is unreachable. Start the local helper.' },
    { label: 'Pairing', value: v.pairing === 'paired' ? 'Confirmed by the helper.' : v.pairing === 'unpaired'
      ? 'Pairing is absent. Enter a fresh helper code in the browser margin Settings.' : 'Pairing is unconfirmed. Check pairing in the browser margin Settings.' },
    { label: 'Data folder', value: s?.dataDirectory ?? unknown },
    { label: 'Codex sign-in', value: s?.codex.login === 'signed-in' ? 'Signed in for the helper’s configured Codex home.'
      : s?.codex.login === 'signed-out' ? 'Signed out. Sign in using the helper’s configured Codex executable and home.'
        : s?.codex.status === 'unavailable' ? 'The configured Codex check was unavailable. Check the helper’s Codex configuration.' : unknown },
    { label: 'Helper version', value: s?.helperVersion ?? unknown },
    { label: 'Codex version', value: s?.codex.status === 'version-mismatch'
      ? `${s.codex.version ?? 'Unrecognized release'}; expected ${s.codex.expectedVersion ?? 'unknown'}. Configure the expected Codex release.`
      : s?.codex.version ?? unknown },
    { label: 'Last migration backup', value: s?.backup.state === 'present' ? `${s.backup.path} (folder observed; contents not checked here).`
      : s?.backup.state === 'none' ? 'No migration backup folder exists.' : unknown },
  ];
}
export function diagnosticsSection(value: ReaderDiagnostics): HTMLElement {
  const section = document.createElement('section'); section.className = 'm-diagnostics';
  section.style.overflowWrap = 'anywhere';
  const heading = document.createElement('h3'); heading.textContent = 'How things are';
  const note = document.createElement('p'); note.className = 'm-meta';
  note.textContent = 'Read-only facts. Codex checks may be up to 30 seconds old. This does not ask a model or establish permission to send.';
  const list = document.createElement('dl');
  for (const line of diagnosticLines(value)) {
    const term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = line.label; detail.textContent = line.value; list.append(term, detail);
  }
  section.append(heading, note, list); return section;
}
