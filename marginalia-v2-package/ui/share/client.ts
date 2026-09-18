import { shareFileFrom, type ShareFile, type ShareFormat } from '../../contracts/share.ts';
import type { ShareTransport } from './transport.ts';

export interface ShareDownloadGateway {
  download(path: string, signal?: AbortSignal): Promise<unknown>;
}

/** Authentication, response headers, and response text belong to the injected gateway. */
export class ShareClient implements ShareTransport {
  private readonly gateway: ShareDownloadGateway;
  constructor(gateway: ShareDownloadGateway) { this.gateway = gateway; }
  async prepare(threadId: string, format: ShareFormat, signal?: AbortSignal): Promise<ShareFile> {
    const params = new URLSearchParams({ thread: threadId, format });
    return shareFileFrom(await this.gateway.download(`/api/share/thread?${params}`, signal), format);
  }
}
