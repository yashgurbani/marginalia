import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { FetchedResourceRecord } from '../../contracts/consent.ts';

/** Only the trusted daemon host may call this module and receive response bytes. */
export type RetrievalLimits = Readonly<{
  maxRedirects?: number;
  maxBodyBytes?: number;
  timeoutMs?: number;
  maxHeaderBytes?: number;
}>;
export type RedirectHop = Readonly<{ url: string; status: number; location: string }>;
export type FetchedResource = Readonly<FetchedResourceRecord & {
  /** True only when the host has separately established that no other route could fetch. */
  complete: boolean;
}>;
export type RetrievalResult = Readonly<{ body: Buffer; record: FetchedResource }>;
export type RetrievalOptions = RetrievalLimits & Readonly<{
  signal?: AbortSignal;
  /** Host-owned confinement evidence for this exact session; omission means incomplete. */
  confinement?: Readonly<{ brokerOnly: true; evidenceRef: string }>;
}>;

export class RetrievalError extends Error {
  constructor(readonly code: string, readonly record: FetchedResource) {
    super(code);
    this.name = 'RetrievalError';
  }
}

const DEFAULTS = { maxRedirects: 5, maxBodyBytes: 2_000_000, timeoutMs: 15_000, maxHeaderBytes: 16_384 } as const;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('invalid-retrieval-limit');
  return value;
}

function parseUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 8192 || /[\\\u0000-\u0020\u007f]/.test(input) || input.includes('#'))
    throw new Error('invalid-retrieval-url');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('invalid-retrieval-url'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hash || !url.hostname)
    throw new Error('invalid-retrieval-url');
  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (!['80', '443'].includes(effectivePort)) throw new Error('unsupported-retrieval-port');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'localhost.localdomain' || hostname.endsWith('.localhost.localdomain'))
    throw new Error('private-retrieval-host');
  if (hostname.endsWith('.') || hostname.includes('%') || (hostname.includes(':') && isIP(hostname) !== 6) ||
      (!hostname.includes('.') && isIP(hostname) === 0) ||
      /\.(?:local|internal|test|invalid|example|onion|home\.arpa)$/.test(hostname))
    throw new Error('invalid-retrieval-host');
  return url;
}

function ipv4Bytes(address: string): number[] | null {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return null;
  const parts = address.split('.').map(Number);
  return parts.every(part => part <= 255) ? parts : null;
}

function ipv6Words(address: string): number[] | null {
  const value = address.toLowerCase().split('%')[0];
  if (isIP(value) !== 6) return null;
  const hasV4 = value.includes('.');
  let v = value;
  if (hasV4) {
    const end = v.slice(v.lastIndexOf(':') + 1);
    const bytes = ipv4Bytes(end);
    if (!bytes) return null;
    v = `${v.slice(0, v.lastIndexOf(':') + 1)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = v.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').map(x => parseInt(x, 16)) : [];
  const right = halves[1] ? halves[1].split(':').map(x => parseInt(x, 16)) : [];
  const fill = 8 - left.length - right.length;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const words = [...left, ...Array(fill).fill(0), ...right];
  return words.length === 8 ? words : null;
}

function inCidr(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < Math.floor(bits / 8); i++) if (bytes[i] !== prefix[i]) return false;
  const rem = bits % 8;
  return rem === 0 || (bytes[Math.floor(bits / 8)] >> (8 - rem)) === (prefix[Math.floor(bits / 8)] >> (8 - rem));
}

function publicIpv4(address: string): boolean {
  const b = ipv4Bytes(address);
  if (!b) return false;
  const denied: [number[], number][] = [
    [[0,0,0,0],8], [[10,0,0,0],8], [[100,64,0,0],10], [[127,0,0,0],8],
    [[169,254,0,0],16], [[172,16,0,0],12], [[192,0,0,0],24], [[192,0,2,0],24],
    [[192,88,99,0],24], [[192,168,0,0],16], [[198,18,0,0],15], [[198,51,100,0],24],
    [[203,0,113,0],24], [[224,0,0,0],4], [[240,0,0,0],4],
  ];
  return !denied.some(([prefix, bits]) => inCidr(b, prefix, bits));
}

function publicAddress(address: string): boolean {
  if (address.includes('%')) return false;
  if (isIP(address) === 4) return publicIpv4(address);
  const w = ipv6Words(address);
  if (!w) return false;
  // IPv4-mapped addresses must pass the IPv4 policy, not the IPv6 global test.
  if (w.slice(0, 5).every(x => x === 0) && w[5] === 0xffff)
    return publicIpv4(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
  // Global unicast only; exclude IANA special purpose and documentation ranges.
  if ((w[0] & 0xe000) !== 0x2000) return false;
  if (w[0] === 0x2001 && w[1] < 0x0200) return false; // 2001::/23
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false;
  if (w[0] === 0x2002) return false; // 6to4 embeds an unchecked IPv4 endpoint
  if (w[0] === 0x3fff && (w[1] & 0xfff0) === 0) return false;
  return true;
}

function canonicalAddress(address: string): string | null {
  const v4 = ipv4Bytes(address);
  if (v4) return v4.join('.');
  const v6 = ipv6Words(address);
  if (!v6) return null;
  // Treat mapped IPv4 exactly like its bare form. This makes URL literals, DNS answers,
  // local interfaces and connected peers share one comparison identity.
  if (v6.slice(0, 5).every(word => word === 0) && v6[5] === 0xffff)
    return `${v6[6] >> 8}.${v6[6] & 255}.${v6[7] >> 8}.${v6[7] & 255}`;
  return v6.map(word => word.toString(16).padStart(4, '0')).join(':');
}

function localInterfaceAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) {
    const canonical = canonicalAddress(entry.address.toLowerCase().split('%')[0]);
    if (canonical) addresses.add(canonical);
  }
  return addresses;
}

async function pinnedAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  if (literal) {
    if (!publicAddress(host) || localInterfaceAddresses().has(canonicalAddress(host)!)) throw new Error('private-retrieval-address');
    return { address: host, family: literal as 4 | 6 };
  }
  let answers: Array<{ address: string; family: number }>;
  try { answers = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error('retrieval-dns-failed'); }
  const local = localInterfaceAddresses();
  if (!answers.length || answers.some(answer => !publicAddress(answer.address) || local.has(canonicalAddress(answer.address)!)))
    throw new Error('private-retrieval-address');
  if (answers[0].family !== 4 && answers[0].family !== 6) throw new Error('retrieval-dns-failed');
  return answers[0] as { address: string; family: 4 | 6 };
}

function abortablePinnedAddress(url: URL, signal: AbortSignal): Promise<{ address: string; family: 4 | 6 }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    pinnedAddress(url).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function oneRequest(url: URL, pinned: { address: string; family: 4 | 6 }, maxHeaderBytes: number, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', agent: false, maxHeaderSize: maxHeaderBytes,
      headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'Marginalia-retrieval/1' },
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      signal,
    }, response => {
      const peer = response.socket.remoteAddress && canonicalAddress(response.socket.remoteAddress.toLowerCase().split('%')[0]);
      const expected = canonicalAddress(pinned.address.toLowerCase().split('%')[0]);
      if (!peer || peer !== expected) { response.destroy(); reject(new Error('retrieval-peer-address-mismatch')); return; }
      resolve(response);
    });
    request.on('error', reject);
    request.end();
  });
}

async function readBody(response: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const rawLength = response.headers['content-length'];
  if (Array.isArray(rawLength) || rawLength && (!/^\d+$/.test(rawLength) || Number(rawLength) > maxBytes))
    throw new Error('retrieval-body-too-large');
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw new Error('retrieval-encoding-unsupported');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    if (signal.aborted) throw signal.reason ?? new Error('retrieval-aborted');
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error('retrieval-body-too-large');
    chunks.push(bytes);
  }
  if (!response.complete) throw new Error('retrieval-body-incomplete');
  return Buffer.concat(chunks, size);
}

/** No cookies, Authorization or caller headers enter this API. Browser link opening is a separate host action. */
export async function retrieveObserved(input: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
  const maxRedirects = options.maxRedirects === 0 ? 0 : bounded(options.maxRedirects, DEFAULTS.maxRedirects, 10);
  const maxBodyBytes = bounded(options.maxBodyBytes, DEFAULTS.maxBodyBytes, 10_000_000);
  const timeoutMs = bounded(options.timeoutMs, DEFAULTS.timeoutMs, 60_000);
  const maxHeaderBytes = bounded(options.maxHeaderBytes, DEFAULTS.maxHeaderBytes, 65_536);
  if (options.confinement && (!options.confinement.evidenceRef.trim() || options.confinement.evidenceRef.length > 500)) throw new Error('invalid-retrieval-confinement-evidence');
  const redirects: RedirectHop[] = [];
  let finalUrl = input;
  let status: number | null = null;
  let contentType: string | null = null;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('retrieval-timeout')); }, timeoutMs);
  const record = (outcome: FetchedResource['outcome'], body?: Buffer): FetchedResource => ({
    requestedUrl: input, finalUrl, redirects: [...redirects], status, contentType,
    sha256: body ? createHash('sha256').update(body).digest('hex') : null,
    bytes: body?.length ?? 0, fetchedAt: new Date().toISOString(), outcome,
    complete: options.confinement?.brokerOnly === true,
  });
  try {
    let url = parseUrl(input);
    for (;;) {
      if (controller.signal.aborted) throw controller.signal.reason;
      finalUrl = url.href;
      const pinned = await abortablePinnedAddress(url, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await oneRequest(url, pinned, maxHeaderBytes, controller.signal);
      try {
        status = response.statusCode ?? null;
        contentType = typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : null;
        const location = response.headers.location;
        if (status !== null && REDIRECTS.has(status)) {
          if (typeof location !== 'string' || redirects.length >= maxRedirects) throw new Error('retrieval-redirect-limit');
          if (/[\\\u0000-\u0020\u007f#]/.test(location)) throw new Error('invalid-retrieval-url');
          const next = parseUrl(new URL(location, url).href);
          redirects.push({ url: url.href, status, location: next.href });
          url = next;
          continue;
        }
        const body = await readBody(response, maxBodyBytes, controller.signal);
        return { body, record: record('fetched', body) };
      } finally {
        // Header rejection, streaming failure, redirect and success all release the socket.
        // The successful result owns a copied Buffer, so destroying the consumed response is safe.
        if (!response.destroyed) response.destroy();
      }
    }
  } catch (error) {
    const code = timedOut ? 'retrieval-timeout' : controller.signal.aborted ? 'retrieval-cancelled' : error instanceof Error ? error.message : 'retrieval-failed';
    const outcome = controller.signal.aborted ? 'cancelled' : code.startsWith('invalid-') || code.startsWith('private-') || code.includes('unsupported') || code.includes('too-large') || code.includes('redirect-limit') ? 'rejected' : 'failed';
    throw new RetrievalError(code, record(outcome));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
