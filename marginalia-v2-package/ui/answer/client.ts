import { libraryAnswerFrom, type LibraryAnswer } from '../../contracts/library-answer.ts';
import type { LibraryAnswerTransport } from './transport.ts';

export interface LibraryAnswerHttpGateway {
  request(path: string, signal?: AbortSignal): Promise<unknown>;
}

/** Authentication and origin policy belong to the injected gateway. */
export class LibraryAnswerClient implements LibraryAnswerTransport {
  private readonly gateway: LibraryAnswerHttpGateway;
  constructor(gateway: LibraryAnswerHttpGateway) { this.gateway = gateway; }
  async answer(query: string, threadIds: readonly string[] = [], signal?: AbortSignal): Promise<LibraryAnswer> {
    const params = new URLSearchParams({ q: query });
    for (const threadId of threadIds) params.append('thread', threadId);
    return libraryAnswerFrom(await this.gateway.request(`/api/library-answer?${params}`, signal));
  }
}
