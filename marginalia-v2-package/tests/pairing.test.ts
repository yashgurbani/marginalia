import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('paired browser records distinguish same-origin instances and revoke only the selected record', () => {
  const store = new ReaderStore(':memory:');
  try {
    const pairing = new Pairing(store);
    const origin = 'moz-extension://development-id';
    const firstToken = pairing.exchange(pairing.issue(1000), origin, 1001);
    const secondToken = pairing.exchange(pairing.issue(2000), origin, 2001);

    const before = pairing.listPairedBrowsers();
    assert.equal(before.length, 2);
    assert.notEqual(before[0]!.id, before[1]!.id);
    assert.deepEqual(before.map(({ origin, createdAt, revoked }) => ({ origin, createdAt, revoked })), [
      { origin, createdAt: new Date(1001).toISOString(), revoked: false },
      { origin, createdAt: new Date(2001).toISOString(), revoked: false },
    ]);

    assert.equal(pairing.revokePairedBrowser(before[0]!.id, 3000), 'revoked');
    assert.equal(pairing.revokePairedBrowser(before[0]!.id, 4000), 'already-revoked');
    assert.equal(pairing.valid(firstToken, origin), false);
    assert.equal(pairing.valid(secondToken, origin), true);
    assert.equal(pairing.valid(secondToken, origin + '-other'), false);
    assert.deepEqual(pairing.listPairedBrowsers().map(({ id, revoked }) => ({ id, revoked })), [
      { id: before[0]!.id, revoked: true },
      { id: before[1]!.id, revoked: false },
    ]);

    const revokedAt = store.db.prepare('SELECT revokedAt FROM pairing_tokens WHERE id=?').pluck().get(before[0]!.id);
    assert.equal(revokedAt, new Date(3000).toISOString());
  } finally { store.close(); }
});

test('management APIs return no token material and treat unknown or malformed IDs as not found', () => {
  const store = new ReaderStore(':memory:');
  try {
    const pairing = new Pairing(store);
    const token = pairing.exchange(pairing.issue(1000), 'chrome-extension://browser-a', 1001);
    const records = pairing.listPairedBrowsers();
    const output = JSON.stringify({ records, revoked: pairing.revokePairedBrowser('not-an-id') });

    assert.equal(pairing.revokePairedBrowser('00000000-0000-4000-8000-000000000000'), 'not-found');
    assert.equal(pairing.revokePairedBrowser({ id: records[0]!.id }), 'not-found');
    assert.equal(output.includes(token), false);
    assert.equal(output.includes(digest(token)), false);
    assert.deepEqual(Object.keys(records[0]!).sort(), ['createdAt', 'id', 'origin', 'revoked']);
  } finally { store.close(); }
});

test('legacy pairing rows gain persistent stable IDs without invalidating their tokens', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marginalia-pairing-'));
  const filename = join(directory, 'reader.sqlite');
  const firstToken = 'A'.repeat(43);
  const secondToken = 'B'.repeat(43);
  const origin = 'moz-extension://existing-browser';
  let openStore: ReaderStore | undefined;
  let stableIds: string[];
  try {
    openStore = new ReaderStore(filename);
    openStore.db.exec('CREATE TABLE pairing_tokens(hash TEXT PRIMARY KEY, origin TEXT NOT NULL, createdAt TEXT NOT NULL, revokedAt TEXT)');
    const insertLegacy = openStore.db.prepare('INSERT INTO pairing_tokens(hash,origin,createdAt,revokedAt) VALUES(?,?,?,NULL)');
    insertLegacy.run(digest(firstToken), origin, '2026-09-17T10:00:00.000Z');
    insertLegacy.run(digest(secondToken), origin, '2026-09-17T10:01:00.000Z');
    openStore.close();
    openStore = undefined;

    openStore = new ReaderStore(filename);
    const upgraded = new Pairing(openStore);
    assert.equal(upgraded.valid(firstToken, origin), true);
    assert.equal(upgraded.valid(secondToken, origin), true);
    assert.equal(upgraded.valid(firstToken, origin + '-other'), false);
    const upgradedRecords = upgraded.listPairedBrowsers();
    assert.equal(upgradedRecords.length, 2);
    assert.notEqual(upgradedRecords[0]!.id, upgradedRecords[1]!.id);
    stableIds = upgradedRecords.map(record => record.id);
    openStore.close();
    openStore = undefined;

    openStore = new ReaderStore(filename);
    const reopened = new Pairing(openStore);
    assert.equal(reopened.valid(firstToken, origin), true);
    assert.equal(reopened.valid(secondToken, origin), true);
    assert.deepEqual(reopened.listPairedBrowsers().map(record => record.id), stableIds);
  } finally {
    openStore?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
