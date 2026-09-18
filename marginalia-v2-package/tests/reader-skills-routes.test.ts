import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from '../daemon/server.ts';

test('skill catalog is a paired POST read with no model dispatch and a revocation fence', async () => {
  const helper = await startServer({ database: ':memory:', port: 0 });
  const origin = 'chrome-extension://' + 'a'.repeat(32), token = helper.pairing.exchange(helper.challenge, origin);
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let reads = 0;
  const catalog = { schema: 'marginalia.reader-skills.v1' as const, status: 'ready' as const, revision: 'a'.repeat(64), skills: [{ name: 'skill', description: 'Metadata' }] };
  helper.jobs.readerSkills = async () => { reads++; return catalog; };
  const post = (body = '{}', extra = {}) => fetch(helper.origin + '/api/read/skills', { method: 'POST', headers: { ...headers, ...extra }, body });
  try {
    const response = await post(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), catalog);
    for (const body of ['null', '[]', '{"path":"secret"}', '', '{']) assert.equal((await post(body)).status, 400);
    assert.equal((await fetch(helper.origin + '/api/read/skills', { headers })).status, 405);
    assert.equal((await post('{}', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('{}', { Authorization: 'Bearer unknown' })).status, 401);
    assert.equal(reads, 1);
    assert.equal(helper.jobs.list().length, 0);
    helper.jobs.readerSkills = async () => { helper.pairing.revoke(token); return catalog; };
    assert.equal((await post()).status, 401);
  } finally { await helper.close(); }
});

test('pairing revoked during a fragmented catalog body prevents discovery from starting', async () => {
  const helper = await startServer({ database: ':memory:', port: 0 });
  const origin = 'chrome-extension://' + 'a'.repeat(32), token = helper.pairing.exchange(helper.challenge, origin);
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': '2' };
  let reads = 0, checked!: () => void;
  const firstCheck = new Promise<void>(resolve => { checked = resolve; });
  const valid = helper.pairing.valid.bind(helper.pairing);
  helper.pairing.valid = (candidate, requestOrigin) => { const result = valid(candidate, requestOrigin); checked(); return result; };
  helper.jobs.readerSkills = async () => { reads++; return { schema: 'marginalia.reader-skills.v1', status: 'unavailable', revision: null, skills: [] }; };
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(helper.origin + '/api/read/skills', { method: 'POST', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.write('{');
      void firstCheck.then(() => { helper.pairing.revoke(token); req.end('}'); });
    });
    assert.equal(status, 401); assert.equal(reads, 0); assert.equal(helper.jobs.list().length, 0);
  } finally { await helper.close(); }
});
