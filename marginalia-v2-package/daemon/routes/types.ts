import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConsentPrincipal } from '../../contracts/consent.ts';

export type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
export type ReadBody = (request: IncomingMessage) => Promise<any>;
export type ReadEmptyBody = (request: IncomingMessage, requireObject?: boolean) => Promise<void>;

export type ApiRouteContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  requestOrigin: string | undefined;
  authOrigin: string;
  token: string;
  principal: ConsentPrincipal;
  requireCurrentPairing: () => boolean;
  send: SendJson;
  body: ReadBody;
  emptyBody: ReadEmptyBody;
};

