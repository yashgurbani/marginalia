import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedDefinitions, type PreparedDefinitionDependencies, type PreparedPage, type PreparedTerm } from '../daemon/instant/prepared-definitions.ts';
const page: PreparedPage = { pageId: 'page', generation: '1', pageKeyHash: 'a'.repeat(64), model: 'gpt-5.6-luna', effort: 'medium', instructionVersion: '1' };
const terms: PreparedTerm[] = ['viscosity', 'vorticity', 'advection', 'diffusion'].map((term, i) => ({ candidateId: `c${i}`, term, normalizedTerm: term, start: i * 20, end: i * 20 + term.length, contextHash: String(i).repeat(64) }));
const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 };
function harness(overrides: Partial<PreparedDefinitionDependencies> = {}) {
  let admissions = 0, cancelled = 0, settled = 0; const requests: unknown[] = [];
  const deps: PreparedDefinitionDependencies = {
    allowed: () => 'allowed',
    admit: async () => { admissions++; return { state: 'admitted', lease: { settle: () => { settled++; }, cancelBeforeSend: () => { cancelled++; } } }; },
    transport: async request => { requests.push(request); return { items: request.items.map(t => ({ candidateId: t.candidateId, text: 'A short contextual definition.' })), usage }; }, ...overrides,
  };
  return { engine: createPreparedDefinitions(deps), requests, counts: () => ({ admissions, cancelled, settled }) };
}
test('prepared definitions use batches of three, contextual cache costs zero, forget invalidates', async () => {
  const h = harness(); const first = await h.engine.prepare(page, terms);
  assert.equal(first.definitions.length, 4); assert.equal(h.requests.length, 2); assert.equal(h.counts().settled, 2);
  assert.ok(h.requests.every(r => (r as { items: unknown[] }).items.length <= 3)); assert.doesNotMatch(JSON.stringify(h.requests), /pageKeyHash|contextHash|normalizedTerm/);
  await h.engine.prepare(page, terms); assert.equal(h.counts().admissions, 2);
  await h.engine.prepare({ ...page, instructionVersion: '2' }, terms.slice(0, 1)); assert.equal(h.counts().admissions, 3);
  h.engine.forget(page.pageId); await h.engine.prepare(page, terms.slice(0, 1)); assert.equal(h.counts().admissions, 4);
});
test('independent validation keeps valid siblings and rejects markup, long results and unknown IDs', async () => {
  const h = harness({ transport: async () => ({ usage, items: [{ candidateId: 'c0', text: 'Resistance to flow.' }, { candidateId: 'c1', text: '<script>bad</script>' }, { candidateId: 'c2', text: 'word '.repeat(36) }] }) });
  const result = await h.engine.prepare(page, terms.slice(0, 3)); assert.deepEqual(result.definitions.map(d => d.candidateId), ['c0']);
});
test('exclusion race cancels before provider write; budget admission never calls transport', async () => {
  let checks = 0; const h = harness({ allowed: () => ++checks === 1 ? 'allowed' : 'excluded' });
  assert.equal((await h.engine.prepare(page, terms)).state, 'excluded'); assert.equal(h.requests.length, 0); assert.equal(h.counts().cancelled, 1);
  for (const state of ['off', 'excluded', 'paused-at-limit'] as const) {
    const paused = harness({ admit: async () => ({ state }) }); assert.equal((await paused.engine.prepare(page, terms)).state, state); assert.equal(paused.requests.length, 0);
  }
});
test('forget fences late completions but still settles actual usage', async () => {
  let complete!: (v: { items: unknown; usage: typeof usage }) => void;
  const h = harness({ transport: () => new Promise(resolve => { complete = resolve; }) });
  const pending = h.engine.prepare(page, terms.slice(0, 1)); await new Promise(resolve => setTimeout(resolve, 0));
  h.engine.forget(page.pageId); complete({ items: [{ candidateId: 'c0', text: 'Resistance to flow.' }], usage });
  assert.deepEqual(await pending, { state: 'stale', definitions: [] }); assert.equal(h.counts().settled, 1);
});
test('provider failure retains unknown-usage settlement and cannot become a cached success', async () => {
  let unknown: unknown;
  const h = harness({ admit: async () => ({ state: 'admitted', lease: { settle: u => { unknown = u; }, cancelBeforeSend: () => {} } }), transport: async () => { throw new Error('fake disconnect'); } });
  await assert.rejects(h.engine.prepare(page, terms), /fake disconnect/); assert.equal((unknown as { totalTokens: null }).totalTokens, null);
});

test('dismissal invalidates the term cache and cancels a pending generation', async () => {
  const h = harness(); await h.engine.prepare(page, terms.slice(0, 2));
  h.engine.dismiss(page.pageId, terms[0].normalizedTerm);
  await h.engine.prepare(page, terms.slice(0, 2));
  const last = h.requests.at(-1) as { items: { candidateId: string }[] };
  assert.deepEqual(last.items.map(i => i.candidateId), ['c0']);
});
