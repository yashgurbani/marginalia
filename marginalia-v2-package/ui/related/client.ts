import { RELATED_KINDS, type RelatedPassageResult, type RelatedRequest, type RelatedResponse } from '../../contracts/related.ts';
import type { RelatedTransport } from './transport.ts';

export interface RelatedHttpGateway {
  request(path: string, body: object, signal?: AbortSignal): Promise<unknown>;
}

/** Auth and origin policy belong to the injected helper gateway. */
export class RelatedClient implements RelatedTransport {
  private readonly gateway: RelatedHttpGateway;
  constructor(gateway: RelatedHttpGateway) { this.gateway = gateway; }

  async findRelated(request: RelatedRequest, signal?: AbortSignal): Promise<RelatedResponse> {
    return responseFrom(await this.gateway.request('/api/library-related', request, signal));
  }
}

function responseFrom(value: unknown): RelatedResponse {
  if (!record(value) || !Array.isArray(value.results) || value.results.length > 8) {
    throw new Error('The helper returned invalid related library items.');
  }
  return { results: value.results.map(itemFrom) };
}

function itemFrom(value: unknown): RelatedPassageResult {
  if (!record(value) || !RELATED_KINDS.includes(value.kind as RelatedPassageResult['kind'])
    || !id(value.threadId) || !id(value.anchorId) || !id(value.sourceVersionId)
    || !text(value.sourceTitle, 1_000) || !url(value.sourceUrl) || !anchor(value.anchor)
    || !text(value.sourceExcerpt, 2_000) || !note(value.note)
    || !Array.isArray(value.matchedTerms) || value.matchedTerms.some(term => !text(term, 200))
    || typeof value.score !== 'number' || !Number.isFinite(value.score) || !text(value.reason, 2_000)) {
    throw new Error('The helper returned an invalid related library item.');
  }
  return value as RelatedPassageResult;
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, limit: number): value is string { return typeof value === 'string' && !!value.trim() && value.length <= limit; }
function id(value: unknown): value is string { return typeof value === 'string' && /^[\w-]{1,100}$/.test(value); }
function url(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_000) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
function anchor(value: unknown): boolean {
  if (!record(value)) return false;
  const kind = value.kind;
  return (kind === undefined || kind === 'quote' || kind === 'section' || kind === 'whole-page')
    && typeof value.exact === 'string' && value.exact.length <= 16_000
    && typeof value.prefix === 'string' && value.prefix.length <= 256
    && typeof value.suffix === 'string' && value.suffix.length <= 256
    && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
    && (value.start as number) >= 0 && (value.end as number) >= (value.start as number);
}
function note(value: unknown): boolean {
  return value === null || record(value) && id(value.id) && Number.isSafeInteger(value.revision)
    && (value.revision as number) >= 0 && text(value.excerpt, 2_000);
}
