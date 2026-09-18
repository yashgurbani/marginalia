import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from '../daemon/server.ts';

const origin = 'chrome-extension://' + 'a'.repeat(32);
const cases = [
  ['/api/instant/settings', '/api/read/instant/settings'],
  ['/api/settings/auto-assist', '/api/read/settings/auto-assist'],
  ['/api/vocabulary', '/api/read/vocabulary'],
  ['/api/ambient/policy?sourceUrl=https%3A%2F%2Ffixture.invalid%2Fpaper&type=paper&trigger=instant', '/api/read/ambient/policy?sourceUrl=https%3A%2F%2Ffixture.invalid%2Fpaper&type=paper&trigger=instant'],
];
for (const [legacy, alias] of cases) {
  test(alias + ' preserves GET projection and strict read authority', async () => {
    const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
    const token = helper.pairing.exchange(helper.challenge, origin);
    const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const post = (body = '{}', extra: Record<string, string> = {}) => fetch(helper.origin + alias, { method: 'POST', headers: { ...headers, ...extra }, body });
    try {
      const original = await fetch(helper.origin + legacy, { headers }); const result = await post();
      assert.equal(original.status, 200); assert.equal(result.status, 200); const expected = await original.json(); assert.deepEqual(await result.json(), expected);
      for (const body of ['null', '[]', '', '{', '{"enabled":false}']) assert.equal((await post(body)).status, 400);
      assert.deepEqual(await (await post()).json(), expected, 'invalid payload must not mutate settings');
      assert.equal((await post('{}', { Origin: 'chrome-extension://' + 'b'.repeat(32) })).status, 401);
      assert.equal((await post('{}', { Origin: 'https://hostile.invalid' })).status, 403);
      assert.equal((await post('{}', { Authorization: 'Bearer invalid' })).status, 401);
      assert.equal((await fetch(helper.origin + alias, { method: 'POST', headers: { Authorization: headers.Authorization, 'Sec-Fetch-Site': 'same-origin' }, body: '{}' })).status, 401);
      assert.equal((await fetch(helper.origin + alias, { headers })).status, 405);
      assert.equal((await fetch(helper.origin + legacy, { headers: { Authorization: headers.Authorization } })).status, 401);
      const localToken = helper.pairing.exchange(helper.pairing.issue(), helper.origin);
      assert.equal((await fetch(helper.origin + legacy, { headers: { Authorization: `Bearer ${localToken}`, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
      helper.pairing.revoke(token); assert.equal((await post()).status, 401);
    } finally { await helper.close(); }
  });
  test(alias + ' rechecks pairing after reading the body', async () => {
    const helper = await startServer({ database: ':memory:', port: 0, diagnostics: () => ({ status: 'unavailable' }) });
    const token = helper.pairing.exchange(helper.challenge, origin);
    try {
      let checked!: () => void; const firstCheck = new Promise<void>(resolve => { checked = resolve; });
      const valid = helper.pairing.valid.bind(helper.pairing);
      helper.pairing.valid = (candidate, candidateOrigin) => { const result = valid(candidate, candidateOrigin); checked(); return result; };
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(helper.origin + alias, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Length': '2' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject); req.write('{'); void firstCheck.then(() => { helper.pairing.revoke(token); req.end('}'); });
      });
      assert.equal(status, 401);
    } finally { await helper.close(); }
  });
}
