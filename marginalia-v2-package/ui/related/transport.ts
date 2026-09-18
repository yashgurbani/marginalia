import type { RelatedRequest, RelatedResponse } from '../../contracts/related.ts';

export interface RelatedTransport {
  findRelated(request: RelatedRequest, signal?: AbortSignal): Promise<RelatedResponse>;
}

type FakeRelated = RelatedResponse | ((request: RelatedRequest, signal?: AbortSignal) => Promise<RelatedResponse>);

/** A deterministic in-memory boundary for related-library UI tests and offline demos. */
export class FakeRelatedTransport implements RelatedTransport {
  response: FakeRelated = { results: [] };
  readonly requests: RelatedRequest[] = [];

  async findRelated(request: RelatedRequest, signal?: AbortSignal): Promise<RelatedResponse> {
    this.requests.push(structuredClone(request));
    const response = typeof this.response === 'function' ? await this.response(request, signal) : this.response;
    if (signal?.aborted) throw signal.reason ?? new DOMException('Stopped.', 'AbortError');
    return structuredClone(response);
  }
}
