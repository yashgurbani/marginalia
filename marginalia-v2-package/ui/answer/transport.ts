import type { LibraryAnswer } from '../../contracts/library-answer.ts';

export type LibraryAnswerRequest = { query: string; threadIds: string[] };
export interface LibraryAnswerTransport {
  answer(query: string, threadIds?: readonly string[], signal?: AbortSignal): Promise<LibraryAnswer>;
}

type FakeAnswer = LibraryAnswer | ((request: LibraryAnswerRequest) => LibraryAnswer | Promise<LibraryAnswer>);

/** A deterministic saved-passage answer boundary for UI tests and offline demos. */
export class FakeLibraryAnswerTransport implements LibraryAnswerTransport {
  response: FakeAnswer;
  readonly requests: LibraryAnswerRequest[] = [];
  constructor(response: FakeAnswer) { this.response = response; }
  async answer(query: string, threadIds: readonly string[] = []): Promise<LibraryAnswer> {
    const request = { query, threadIds: [...threadIds] }; this.requests.push(structuredClone(request));
    const value = typeof this.response === 'function' ? await this.response(request) : this.response;
    return structuredClone(value);
  }
}
