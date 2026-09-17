import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReaderStore, digest } from '../daemon/store.ts';
import { Pairing } from '../daemon/pairing.ts';

test('codes expire at the boundary, renewal invalidates old codes, and tokens are stored only as hashes', () => {
  const store = new ReaderStore(':memory:');
  try {
    const pairing = new Pairing(store);
    const expired = pairing.issue(100);
    assert.throws(() => pairing.exchange(expired, 'origin', 300100), /expired/);
    const code = pairing.issue(400000);
    assert.notEqual(code, expired);
    assert.throws(() => pairing.exchange(expired, 'origin', 400001), /did not match/);
    for (let i = 0; i < 4; i++) assert.throws(() => pairing.exchange('invalid', 'origin', 400001));
    assert.throws(() => pairing.exchange(code, 'origin', 400002), /expired/);
    const renewed = pairing.issue(500000);
    const token = pairing.exchange(renewed, 'origin', 500001);
    assert.throws(() => pairing.exchange(renewed, 'origin', 500002), /expired/);
    assert.equal(pairing.valid(token, 'origin'), true);
    assert.equal(pairing.valid(token, 'other'), false);
    assert.equal(pairing.valid({ toString: () => token }, 'origin'), false);
    const row = store.db.prepare('SELECT hash FROM pairing_tokens').get() as { hash: string };
    assert.equal(row.hash, digest(token));
    pairing.revoke(token);
    assert.equal(pairing.valid(token, 'origin'), false);
  } finally { store.close(); }
});
