import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DIAGNOSTICS_SCHEMA, displayPath, release, type DiagnosticsSnapshot } from '../../contracts/diagnostics.ts';
import type { ApiRouteContext } from './types.ts';

/** Report observed backup directories, never claim their contents were verified here. */
export async function diagnosticsStorage(database: string): Promise<Pick<DiagnosticsSnapshot, 'dataDirectory' | 'backup'>> {
  const unknown = { dataDirectory: null, backup: { state: 'unknown' as const } };
  if (!database || database === ':memory:') return unknown;
  try {
    const filename = await realpath(resolve(database)), dataDirectory = dirname(filename);
    if (!displayPath(dataDirectory)) return unknown;
    const root = filename + '.backups';
    try {
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { dataDirectory, backup: { state: 'unknown' } };
      const entries = await readdir(root, { withFileTypes: true });
      const candidates = entries.filter(e => e.isDirectory() && /^(routine|recovery)-[0-9]+-[0-9a-f-]{36}$/.test(e.name))
        .sort((a, b) => Number(b.name.split('-')[1]) - Number(a.name.split('-')[1]));
      const path = candidates[0] && join(root, candidates[0].name);
      return { dataDirectory, backup: path && displayPath(path) ? { state: 'present', path }
        : { state: entries.length ? 'unknown' : 'none' } };
    } catch (e) {
      return { dataDirectory, backup: { state: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'unknown' } };
    }
  } catch { return unknown; }
}

export function createDiagnosticsRoute(database: string, diagnostics: (refresh?: boolean) => unknown) {
  const version = readFile(new URL('../../package.json', import.meta.url), 'utf8')
    .then(text => release(JSON.parse(text).version)).catch(() => null);
  return async (c: ApiRouteContext): Promise<boolean> => {
    const alias = c.url.pathname === '/api/read/diagnostics';
    if (!alias && c.url.pathname !== '/api/diagnostics') return false;
    if (c.request.method !== (alias ? 'POST' : 'GET')) {
      c.send(c.response, 405, { error: alias ? 'Use POST for this read operation.' : 'Use GET for diagnostics.' }); return true;
    }
    if (alias) {
      if (!c.requestOrigin) { c.send(c.response, 401, { error: 'Origin required.' }); return true; }
      await c.emptyBody(c.request, true);
    }
    // Reading a streamed body yields; revocation must prevent even a local probe.
    if (!c.requireCurrentPairing()) {
      c.send(c.response, 401, { error: 'Pair with the local helper to read diagnostics.' }); return true;
    }
    let raw: any;
    try { raw = await diagnostics(); } catch { raw = undefined; }
    const storage = await diagnosticsStorage(database);
    const snapshot: DiagnosticsSnapshot = { schema: DIAGNOSTICS_SCHEMA, paired: true, ...storage,
      helperVersion: await version, codex: {
        status: ['installed', 'version-mismatch'].includes(raw?.status) ? raw.status : 'unavailable',
        login: ['signed-in', 'signed-out'].includes(raw?.login) ? raw.login : 'unknown',
        version: release(raw?.version), expectedVersion: release(raw?.expectedVersion),
      } };
    // A disconnect while probes run must fence the private response.
    if (!c.requireCurrentPairing()) c.send(c.response, 401, { error: 'Pair with the local helper to read diagnostics.' });
    else c.send(c.response, 200, snapshot);
    return true;
  };
}
