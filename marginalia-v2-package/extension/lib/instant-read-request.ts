const aliases = new Map([
  ['/api/instant/settings', '/api/read/instant/settings'],
  ['/api/settings/auto-assist', '/api/read/settings/auto-assist'],
  ['/api/vocabulary', '/api/read/vocabulary'],
  ['/api/ambient/policy', '/api/read/ambient/policy'],
]);
/** Only reviewed reads use POST aliases; explicit bodies retain mutation semantics. */
export function instantReadRequest(path: string, body?: unknown): { path: string; body: unknown } {
  if (body !== undefined) return { path, body };
  const query = path.indexOf('?');
  const alias = aliases.get(query < 0 ? path : path.slice(0, query));
  return alias ? { path: alias + (query < 0 ? '' : path.slice(query)), body: {} } : { path, body };
}
