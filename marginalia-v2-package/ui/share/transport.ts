import type { ShareFile, ShareFormat } from '../../contracts/share.ts';

export interface ShareTransport {
  prepare(threadId: string, format: ShareFormat, signal?: AbortSignal): Promise<ShareFile>;
}

export class FakeShareTransport implements ShareTransport {
  response: ShareFile | ((format: ShareFormat) => ShareFile | Promise<ShareFile>);
  readonly requests: { threadId: string; format: ShareFormat }[] = [];
  constructor(response: ShareFile | ((format: ShareFormat) => ShareFile | Promise<ShareFile>)) { this.response = response; }
  async prepare(threadId: string, format: ShareFormat): Promise<ShareFile> {
    this.requests.push({ threadId, format });
    const value = typeof this.response === 'function' ? await this.response(format) : this.response;
    return structuredClone(value);
  }
}
