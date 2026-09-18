export const DIAGNOSTICS_SCHEMA = 'marginalia.diagnostics.v1';
export type DiagnosticsSnapshot = {
  schema: typeof DIAGNOSTICS_SCHEMA;
  paired: true;
  dataDirectory: string | null;
  helperVersion: string | null;
  backup: { state: 'unknown' | 'none' } | { state: 'present'; path: string };
  codex: { status: 'installed' | 'version-mismatch' | 'unavailable';
    login: 'signed-in' | 'signed-out' | 'unknown'; version: string | null; expectedVersion: string | null };
};
export const release = (v: unknown): string | null => typeof v === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(v) ? v : null;
export const displayPath = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v);
export function isDiagnosticsSnapshot(v: unknown): v is DiagnosticsSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as DiagnosticsSnapshot;
  return s.schema === DIAGNOSTICS_SCHEMA && s.paired === true
    && (s.dataDirectory === null || displayPath(s.dataDirectory))
    && (s.helperVersion === null || release(s.helperVersion) !== null)
    && !!s.backup && ['unknown', 'none', 'present'].includes(s.backup.state)
    && (s.backup.state !== 'present' || displayPath(s.backup.path))
    && !!s.codex && ['installed', 'version-mismatch', 'unavailable'].includes(s.codex.status)
    && ['signed-in', 'signed-out', 'unknown'].includes(s.codex.login)
    && (s.codex.version === null || release(s.codex.version) !== null)
    && (s.codex.expectedVersion === null || release(s.codex.expectedVersion) !== null);
}
