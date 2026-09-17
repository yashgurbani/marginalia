import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import http, { type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { retrieveObserved, RetrievalError } from '../daemon/retrieval/broker.ts';

type Address = { address: string; family: 4 | 6 };
type Reply = { status?: number; headers?: Record<string, string>; body?: string; peer?: string };
/** No DNS or network IO: exercise the real broker with observed transport doubles. */
function transport(t: TestContext, answers: Record<string, Address[]>, replies: Reply[]) {
  const lookups: string[] = [], requests: Array<{ url: URL; options: RequestOptions }> = [], responses: IncomingMessage[] = [];
  t.mock.method(dns, 'lookup', async (host: string, options: unknown) => {
    lookups.push(host); assert.deepEqual(options, { all: true, verbatim: true });
    return answers[host] ?? [];
  });
  t.mock.method(os, 'networkInterfaces', () => ({}));
  const request = (url: URL, options: RequestOptions, callback: (value: IncomingMessage) => void) => {
    requests.push({ url, options });
    const reply = replies[requests.length - 1];
    assert.ok(reply, 'unexpected network request');
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => {
      const fixed = answers[url.hostname]?.[0];
      assert.ok(fixed, 'literal or unvalidated destination must not reach this mock');
      // A fixed family prevents a family race and a second DNS resolution.
      assert.equal(options.family, fixed.family);
      options.lookup!(url.hostname, { family: fixed.family, hints: 0 }, (error, address, family) => {
        assert.equal(error, null); assert.equal(address, fixed.address); assert.equal(family, fixed.family);
      });
      const response = Object.assign(Readable.from([Buffer.from(reply.body ?? 'body')]), {
        statusCode: reply.status ?? 200, headers: reply.headers ?? { 'content-type': 'text/plain' },
        socket: { remoteAddress: reply.peer ?? fixed.address }, complete: true,
      }) as unknown as IncomingMessage;
      responses.push(response);
      queueMicrotask(() => callback(response));
    };
    return req;
  };
  t.mock.method(http, 'request', request as unknown as typeof http.request);
  t.mock.method(https, 'request', request as unknown as typeof https.request);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { lookups, requests, responses };
}

for (const address of [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }] as const) {
  test(`pinned IPv${address.family} preserves the URL/TLS defaults and hashes actual response bytes`, async t => {
    const io = transport(t, { 'papers.example.org': [address] }, [{ body: 'source bytes' }]);
    const result = await retrieveObserved('https://papers.example.org/paper?q=1');
    assert.deepEqual(io.lookups, ['papers.example.org']); assert.equal(io.requests.length, 1);
    const { url, options } = io.requests[0];
    assert.equal(url.href, 'https://papers.example.org/paper?q=1');
    assert.equal(url.hostname, 'papers.example.org'); assert.equal(options.agent, false);
    // Do not replace Host/SNI with the IP or bypass the platform TLS verifier.
    for (const key of ['host', 'hostname', 'servername', 'checkServerIdentity', 'rejectUnauthorized']) assert.equal(key in options, false);
    assert.deepEqual(options.headers, { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'Marginalia-retrieval/1' });
    assert.equal(result.body.toString(), 'source bytes');
    assert.equal(result.record.sha256, createHash('sha256').update('source bytes').digest('hex'));
    assert.equal(result.record.complete, false); assert.equal(result.record.outcome, 'fetched');
    assert.equal(io.responses[0].destroyed, true);
  });
}

test('redirects revalidate and pin once per destination, preserving the original Host for each', async t => {
  const io = transport(t, {
    'first.example.org': [{ address: '93.184.216.34', family: 4 }],
    'next.example.org': [{ address: '2606:4700:4700::1111', family: 6 }],
  }, [{ status: 302, headers: { location: 'https://next.example.org/final' } }, { body: 'final' }]);
  const result = await retrieveObserved('http://first.example.org/start');
  assert.deepEqual(io.lookups, ['first.example.org', 'next.example.org']);
  assert.deepEqual(io.requests.map(request => request.url.hostname), ['first.example.org', 'next.example.org']);
  assert.equal(result.record.finalUrl, 'https://next.example.org/final');
  assert.deepEqual(result.record.redirects, [{ url: 'http://first.example.org/start', status: 302, location: 'https://next.example.org/final' }]);
  assert.ok(io.responses.every(response => response.destroyed));
});

test('a public first answer cannot hide a private DNS answer', async t => {
  const io = transport(t, { 'mixed.example.org': [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] }, []);
  await assert.rejects(retrieveObserved('https://mixed.example.org/'), (error: unknown) => error instanceof RetrievalError && error.code === 'private-retrieval-address');
  assert.equal(io.requests.length, 0); assert.equal(io.lookups.length, 1);
});

test('private mapped literals and private redirects never reach the connector', async t => {
  const io = transport(t, { 'public.example.org': [{ address: '93.184.216.34', family: 4 }] }, [{ status: 302, headers: { location: 'http://[::ffff:127.0.0.1]/' } }]);
  await assert.rejects(retrieveObserved('https://public.example.org/'), (error: unknown) => error instanceof RetrievalError && error.code === 'private-retrieval-address');
  assert.equal(io.requests.length, 1); assert.deepEqual(io.lookups, ['public.example.org']); assert.equal(io.responses[0].destroyed, true);
});

test('peer pin mismatch rejects and destroys the response', async t => {
  const io = transport(t, { 'papers.example.org': [{ address: '93.184.216.34', family: 4 }] }, [{ peer: '93.184.216.35' }]);
  await assert.rejects(retrieveObserved('https://papers.example.org/'), (error: unknown) => error instanceof RetrievalError && error.code === 'retrieval-peer-address-mismatch');
  assert.equal(io.responses[0].destroyed, true); assert.equal(io.lookups.length, 1);
});

test('mapped IPv4 connected peers compare equal to the vetted IPv4 address', async t => {
  const io = transport(t, { 'papers.example.org': [{ address: '93.184.216.34', family: 4 }] }, [{ peer: '::ffff:93.184.216.34' }]);
  assert.equal((await retrieveObserved('https://papers.example.org/')).record.outcome, 'fetched');
  assert.equal(io.responses[0].destroyed, true);
});

for (const [name, reply, options, code] of [
  ['declared length', { headers: { 'content-length': '100' } }, { maxBodyBytes: 4 }, 'retrieval-body-too-large'],
  ['streamed length', { body: 'too large' }, { maxBodyBytes: 4 }, 'retrieval-body-too-large'],
  ['encoding', { headers: { 'content-encoding': 'gzip' } }, {}, 'retrieval-encoding-unsupported'],
] as const) {
  test(`${name} rejection still releases the pinned response`, async t => {
    const io = transport(t, { 'papers.example.org': [{ address: '93.184.216.34', family: 4 }] }, [reply]);
    await assert.rejects(retrieveObserved('https://papers.example.org/', options), (error: unknown) => error instanceof RetrievalError && error.code === code);
    assert.equal(io.responses[0].destroyed, true);
  });
}

test('pre-cancelled retrieval performs neither DNS nor transport IO', async t => {
  const io = transport(t, {}, []), abort = new AbortController(); abort.abort();
  await assert.rejects(retrieveObserved('https://papers.example.org/', { signal: abort.signal }), (error: unknown) => error instanceof RetrievalError && error.record.outcome === 'cancelled');
  assert.equal(io.lookups.length, 0); assert.equal(io.requests.length, 0);
});
