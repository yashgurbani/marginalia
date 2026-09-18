export type ForgetProviderHistory = 'deleted' | 'not-created' | 'retained' | 'unknown';

export type ForgetPageResult = {
  forgotten: true;
  alreadyForgotten: boolean;
  providerHistory: ForgetProviderHistory;
};

export interface ForgetTransport {
  forgetPage(pageId: string, signal?: AbortSignal): Promise<ForgetPageResult>;
}

/** A deterministic in-memory boundary for forget-page UI tests and offline demos. */
export class FakeForgetTransport implements ForgetTransport {
  readonly forgotten: string[] = [];
  error: unknown;
  result: ForgetPageResult = { forgotten: true, alreadyForgotten: false, providerHistory: 'not-created' };

  async forgetPage(pageId: string, signal?: AbortSignal): Promise<ForgetPageResult> {
    if (this.error !== undefined) throw this.error;
    if (signal?.aborted) throw signal.reason ?? new DOMException('Stopped.', 'AbortError');
    this.forgotten.push(pageId);
    return structuredClone(this.result);
  }
}
