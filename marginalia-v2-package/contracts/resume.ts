import { attachQuote, type QuoteAnchor, type Thread } from './reader.ts';

export const RESUME_MARKER = 'marginalia-resume=';
export const RESUME_MARKER_VERSION = 'v2';
export const MAX_RESUME_THREAD_ID = 200;
export const MAX_RESUME_MARKER_LENGTH = 4_096;
export const MAX_RESUME_ORIGINAL_HASH = 4_096;
export const MAX_RESUME_URL_LENGTH = 8_192;

export type ResumeCheckpoint = { threadId: string; anchor?: QuoteAnchor };

export type ResumeMarker = Readonly<{
  kind: 'legacy' | 'v2';
  version: 1 | 2;
  threadId: string;
  /** Canonical document identity, with any fragment removed. */
  sourceUrl: string;
  /** The exact URL.hash that was present before the v2 marker was installed. */
  originalHash: string;
  /** Canonical URL containing this marker. Useful as the one-consume fence. */
  markerUrl: string;
}>;

/** The marker is an inert page-fragment identity, never a navigation command. */
export function validResumeThreadId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_RESUME_THREAD_ID && !/[\u0000-\u001f\u007f]/.test(value) && encodeField(value) !== undefined;
}

export function resumePageUrl(sourceUrl: string, threadId: string): string {
  if (!validResumeSourceUrl(sourceUrl)) throw new Error('This saved page address cannot be opened.');
  if (!validResumeThreadId(threadId)) throw new Error('Invalid saved thread identity.');
  const url = new URL(sourceUrl);
  const originalHash = url.hash;
  const marker = markerValue(threadId, originalHash);
  if (!marker) throw new Error('This saved page address is too long to resume.');
  url.hash = marker;
  if (url.href.length > MAX_RESUME_URL_LENGTH) throw new Error('This saved page address is too long to resume.');
  return url.href;
}

/**
 * Read a v2 marker, or a v1 marker emitted before original-fragment support.
 * v1 markers are deliberately consumable but carry no fragment to restore.
 * `expectedSourceUrl` binds the marker to the current document identity.
 */
export function readResumeMarker(value: string, expectedSourceUrl?: string): ResumeMarker | undefined {
  const url = publicUrl(value);
  if (!url || url.hash.slice(1).length > MAX_RESUME_MARKER_LENGTH) return undefined;
  const sourceUrl = sourceIdentity(url.href);
  if (!sourceUrl || (expectedSourceUrl !== undefined && sourceIdentity(expectedSourceUrl) !== sourceUrl)) return undefined;
  const prefix = '#' + RESUME_MARKER;
  if (!url.hash.startsWith(prefix)) return undefined;
  const payload = url.hash.slice(prefix.length);
  const versionPrefix = RESUME_MARKER_VERSION + ':';
  if (payload.startsWith(versionPrefix)) {
    const fields = payload.slice(versionPrefix.length).split(':');
    if (fields.length !== 2) return undefined;
    const threadId = decodeField(fields[0]);
    const originalHash = decodeField(fields[1]);
    if (!threadId || !validResumeThreadId(threadId) || originalHash === undefined || originalHash.length > MAX_RESUME_ORIGINAL_HASH || (originalHash !== '' && (originalHash === '#' || !originalHash.startsWith('#')))) return undefined;
    const restored = new URL(sourceUrl);
    restored.hash = originalHash;
    if (restored.hash !== originalHash) return undefined;
    return { kind: 'v2', version: 2, threadId, sourceUrl, originalHash, markerUrl: url.href };
  }

  // The old format was `#marginalia-resume=<encoded-thread-id>`. It could
  // not retain a prior fragment, so migration only consumes it in place.
  if (payload.includes(':')) return undefined;
  const threadId = decodeField(payload);
  return threadId && validResumeThreadId(threadId)
    ? { kind: 'legacy', version: 1, threadId, sourceUrl, originalHash: '', markerUrl: url.href }
    : undefined;
}

/** Parse only a canonical marker and return its bounded thread identity. */
export function resumeThreadId(value: string, expectedSourceUrl?: string): string | undefined {
  return readResumeMarker(value, expectedSourceUrl)?.threadId;
}

/**
 * Remove a marker without navigating. v2 restores the exact prior URL.hash;
 * a legacy marker is simply removed because its prior fragment is unknown.
 * A source mismatch or malformed marker is left untouched.
 */
export function clearResumeMarker(value: string, expectedSourceUrl?: string): string {
  const url = publicUrl(value);
  if (!url) throw new Error('This saved page address cannot be opened.');
  const marker = readResumeMarker(url.href, expectedSourceUrl);
  if (marker) url.hash = marker.originalHash;
  return url.href;
}

/**
 * Return the cleanup URL only while the same marker URL is still current.
 * Callers should pass this result to history.replaceState(history.state, ...)
 * after the one permitted resume response; an intervening navigation yields
 * undefined and must not be rewritten.
 */
export function resumeCleanupUrl(currentUrl: string, markerUrl: string, expectedSourceUrl?: string): string | undefined {
  const current = publicUrl(currentUrl), marker = publicUrl(markerUrl);
  if (!current || !marker || current.href !== marker.href || !readResumeMarker(current.href, expectedSourceUrl)) return undefined;
  return clearResumeMarker(current.href, expectedSourceUrl);
}

/**
 * Resolve a parked thread to one safe current-page anchor. The caller still
 * owns the local journal lookup and the browser document identity fence.
 */
export function resumeAnchor(
  thread: Pick<Thread, 'id' | 'state' | 'deletedAt' | 'sourceUrl' | 'anchor'>,
  sourceUrl: string,
  sourceText: string,
  checkpoint?: unknown,
): QuoteAnchor | undefined {
  if (!validResumeThreadId(thread.id) || thread.deletedAt || thread.state !== 'parked' || thread.sourceUrl !== sourceUrl) return undefined;
  let anchor: unknown = thread.anchor;
  if (thread.anchor?.kind === 'whole-page') {
    if (!record(checkpoint) || checkpoint.threadId !== thread.id || !resumeQuoteAnchor(checkpoint.anchor)) return undefined;
    anchor = checkpoint.anchor;
  }
  if (!resumeQuoteAnchor(anchor)) return undefined;
  const attachment = attachQuote(anchor, sourceText);
  if (anchor.kind === 'whole-page') return attachment.state === 'exact' ? anchor : undefined;
  return ['exact', 'moved'].includes(attachment.state) && attachment.candidates.length === 1 ? anchor : undefined;
}

export function validResumeSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_RESUME_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.href.length <= MAX_RESUME_URL_LENGTH && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function publicUrl(value: unknown): URL | undefined {
  return validResumeSourceUrl(value) ? new URL(value) : undefined;
}

function sourceIdentity(value: unknown): string | undefined {
  const url = publicUrl(value);
  if (!url) return undefined;
  url.hash = '';
  return url.href;
}

function markerValue(threadId: string, originalHash: string): string | undefined {
  if (originalHash.length > MAX_RESUME_ORIGINAL_HASH) return undefined;
  const encodedThreadId = encodeField(threadId), encodedHash = encodeField(originalHash);
  if (encodedThreadId === undefined || encodedHash === undefined) return undefined;
  const marker = RESUME_MARKER + RESUME_MARKER_VERSION + ':' + encodedThreadId + ':' + encodedHash;
  return marker.length <= MAX_RESUME_MARKER_LENGTH ? marker : undefined;
}

function encodeField(value: string): string | undefined {
  try { return encodeURIComponent(value); } catch { return undefined; }
}

function decodeField(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return encodeField(decoded) === value ? decoded : undefined;
  } catch { return undefined; }
}

function resumeQuoteAnchor(value: unknown): value is QuoteAnchor {
  if (!record(value) || typeof value.exact !== 'string' || value.exact.length > 16_000 || typeof value.prefix !== 'string' || value.prefix.length > 256 ||
    typeof value.suffix !== 'string' || value.suffix.length > 256 || !integer(value.start) || !integer(value.end) || value.end < value.start ||
    (value.kind !== undefined && !['quote', 'section', 'whole-page'].includes(value.kind as string))) return false;
  if (value.kind === 'whole-page') return value.exact === '' && value.prefix === '' && value.suffix === '' && value.start === 0 && value.end === 0;
  return !!value.exact && value.end > value.start && value.end - value.start === value.exact.length;
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
