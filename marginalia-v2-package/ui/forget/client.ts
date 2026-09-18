import type { ForgetPageResult, ForgetTransport } from './transport.ts';

export interface ForgetHttpGateway {
  request(path: string, body: object, signal?: AbortSignal): Promise<unknown>;
}

/** Auth and origin policy belong to the injected helper gateway. */
export class ForgetClient implements ForgetTransport {
  private readonly gateway: ForgetHttpGateway;
  constructor(gateway: ForgetHttpGateway) { this.gateway = gateway; }

  async forgetPage(pageId: string, signal?: AbortSignal): Promise<ForgetPageResult> {
    const value = await this.gateway.request('/api/instant/forget', { pageId }, signal);
    if (!record(value) || value.forgotten !== true || typeof value.alreadyForgotten !== 'boolean'
      || !['deleted', 'not-created', 'retained', 'unknown'].includes(String(value.providerHistory))) {
      throw new Error('Forgetting this page remains unconfirmed.');
    }
    return value as ForgetPageResult;
  }
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
