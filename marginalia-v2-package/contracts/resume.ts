import { attachQuote, type QuoteAnchor, type Thread } from './reader.ts';

export const RESUME_MARKER = 'marginalia-resume=';
export const MAX_RESUME_THREAD_ID = 200;

export type ResumeCheckpoint = { threadId: string; anchor?: QuoteAnchor };

/** The marker is an inert page-fragment identity, never a navigation command. */
export function validResumeThreadId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_RESUME_THREAD_ID && !/[\u0000-\u001f\u007f]/.test(value);
}

export function resumePageUrl(sourceUrl: string, threadId: string): string {
  if (!publicSourceUrl(sourceUrl)) throw new Error('This saved page address cannot be opened.');
  if (!validResumeThreadId(threadId)) throw new Error('Invalid saved thread identity.');
  const url = new URL(sourceUrl);
  url.hash = RESUME_MARKER + encodeURIComponent(threadId);
  return url.href;
}

/** Parse only the exact canonical marker form from the current page URL. */
export function resumeThreadId(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  const hash = url.hash;
  if (!hash.startsWith('#' + RESUME_MARKER)) return undefined;
  const encoded = hash.slice(('#' + RESUME_MARKER).length);
  if (!encoded) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(encoded); } catch { return undefined; }
  return validResumeThreadId(decoded) && encodeURIComponent(decoded) === encoded ? decoded : undefined;
}

export function clearResumeMarker(value: string): string {
  const url = new URL(value);
  if (url.hash.startsWith('#' + RESUME_MARKER)) url.hash = '';
  return url.href;
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

function publicSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
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
