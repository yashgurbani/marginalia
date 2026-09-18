import test from 'node:test';
import assert from 'node:assert/strict';
import type { WhitelistSettings, WhitelistSiteChange } from '../contracts/whitelist.ts';
import { WhitelistClient } from '../ui/whitelist/client.ts';
import { FakeWhitelistTransport, type WhitelistTransport } from '../ui/whitelist/transport.ts';
import { mountWhitelist, WHITELIST_COPY } from '../ui/whitelist/whitelist.ts';
import { button, dom, until } from './t05-dom.ts';

const at = '2026-09-18T12:00:00.000Z';
const settings = (): WhitelistSettings => ({ exclusions: [
  { site: 'https://allowed.example', revision: 2, excluded: false, updatedAt: at },
  { site: 'https://blocked.example', revision: 4, excluded: true, updatedAt: at },
] });

test('site list loads active sites, adds a site and removes it with its current revision', async t => {
  const d = dom(t), fake = new FakeWhitelistTransport(settings());
  const mount = mountWhitelist(d.root as unknown as HTMLElement, { transport: fake }); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes(WHITELIST_COPY.loaded));
  assert.match(d.root.textContent, /https:\/\/allowed\.example/); assert.doesNotMatch(d.root.textContent, /blocked\.example/);
  const input = d.root.querySelector('input')!; input.value = 'new.example/path'; d.root.querySelector('form')!.fire('submit');
  await until(() => d.root.textContent.includes(WHITELIST_COPY.added));
  assert.deepEqual(fake.changes[0], { action: 'set-exclusion', site: 'https://new.example', excluded: false });
  assert.equal(input.value, '');
  button(d.root, 'Remove https://new.example').click(); await until(() => d.root.textContent.includes(WHITELIST_COPY.removed));
  assert.deepEqual(fake.changes[1], { action: 'set-exclusion', site: 'https://new.example', excluded: true, expectedRevision: 1 });
  assert.equal(d.root.querySelectorAll('button').every(value => value.tagName === 'BUTTON'), true);
  assert.equal(d.root.querySelector('[aria-live="polite"]')?.tagName, 'P');
});

test('stale site change reloads the list and keeps the typed text', async t => {
  const d = dom(t); let reads = 0;
  const transport: WhitelistTransport = {
    async getSettings() { reads++; return reads === 1 ? settings() : { exclusions: [{ site: 'https://other.example', revision: 3, excluded: false, updatedAt: at }] }; },
    async saveSite(_change: WhitelistSiteChange) { const error = new Error('changed'); error.name = 'Conflict'; throw error; },
  };
  const mount = mountWhitelist(d.root as unknown as HTMLElement, { transport }); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes(WHITELIST_COPY.loaded));
  const input = d.root.querySelector('input')!; input.value = 'keep.example'; d.root.querySelector('form')!.fire('submit');
  await until(() => d.root.textContent.includes(WHITELIST_COPY.stale));
  assert.equal(reads, 2); assert.equal(input.value, 'keep.example'); assert.match(d.root.textContent, /other\.example/);
});

test('site list gives fixed validation and failure states', async t => {
  const d = dom(t), transport: WhitelistTransport = { async getSettings() { return settings(); }, async saveSite() { throw new Error('failed'); } };
  const mount = mountWhitelist(d.root as unknown as HTMLElement, { transport }); t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes(WHITELIST_COPY.loaded));
  const input = d.root.querySelector('input')!; input.value = 'file:///private'; d.root.querySelector('form')!.fire('submit');
  assert.match(d.root.textContent, /valid site address/);
  input.value = 'new.example'; d.root.querySelector('form')!.fire('submit'); await until(() => d.root.textContent.includes(WHITELIST_COPY.failedSave));
});

test('site-list client keeps the frozen settings route shapes and validates replies', async () => {
  const calls: unknown[][] = [], site = settings().exclusions[0];
  const client = new WhitelistClient({ async request(...args) { calls.push(args); return args[0] === 'GET' ? { grants: [], ...settings() } : { exclusion: site }; } });
  await client.getSettings(); await client.saveSite({ action: 'set-exclusion', site: site.site, excluded: true, expectedRevision: 2 });
  assert.deepEqual(calls.map(value => value.slice(0, 3)), [
    ['GET', '/api/consent/settings', undefined],
    ['POST', '/api/consent/settings', { action: 'set-exclusion', site: site.site, excluded: true, expectedRevision: 2 }],
  ]);
  await assert.rejects(new WhitelistClient({ async request() { return { exclusions: [{ site: 'javascript:bad' }] }; } }).getSettings(), /invalid site list/);
});

test('site-list copy has no banned reader-facing words', () => {
  const banned = /\b(artifact|provenance|ledger|transform|tier|job|schema|sandbox|MCP|AI|confidence)\b/i;
  for (const value of Object.values(WHITELIST_COPY)) assert.doesNotMatch(value, banned);
});
