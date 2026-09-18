import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAndValidateReply, type CandidateReply, type CitationsBlock } from '../contracts/reply.ts';
import { reconcileEvidence } from '../daemon/transforms/evidence/reconcile.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

const io = readFileSync(new URL('../skills/evidence/IO.md', import.meta.url), 'utf8');
const fragment = JSON.parse(io.match(/```json\s*([\s\S]*?)```/)![1]!);
function fixture(entries: CitationsBlock['entries']): CandidateReply {
  const reply: CandidateReply = { schema: 'marginalia.reply.v1', intent: 'evidence', status: 'complete',
    title: 'Synthetic authoring fixture', summary: 'Unverified wording.', staticFallback: 'Unverified wording.',
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], checks: [], ...structuredClone(fragment) };
  (reply.blocks[1] as CitationsBlock).entries = entries;
  return withFixtureOrigins(reply);
}
for (const entries of [[], [{ id: 'local', claim: 'Fixture claim.', support: 'Local wording only.',
  source: 'Synthetic source', date: '2026-01-01', fetched: false }]] satisfies CitationsBlock['entries'][]) {
  test(`documented citations capability is required with ${entries.length} unfetched entries`, () => {
    const reply = fixture(entries);
    const context = { sourceText: '', requireOrigins: true, capabilities: ['network.citations'] as const };
    assert.equal(parseAndValidateReply(JSON.stringify(reply), context).ok, true);
    const undeclared = { ...reply, requiredCapabilities: [] };
    const rejected = parseAndValidateReply(JSON.stringify(undeclared), context);
    assert.equal(rejected.ok, false);
    assert.deepEqual(rejected.errors, ['$.blocks[1]: block requires declared capability network.citations.']);
    assert.equal(parseAndValidateReply(JSON.stringify(reply), { ...context, capabilities: [] }).ok, false);
    const assessment = reconcileEvidence(reply, { sessionScope: 'open-session', retrievalComplete: false,
      observed: [], boundSourceVersion: { id: 'fixture', hash: 'a'.repeat(64), capturedAt: null } });
    assert.equal(assessment.observedFetchCount, 0);
    assert.equal(assessment.verdict, 'insufficient');
    assert.equal(assessment.headline, null);
  });
}
test('unavailable citations capability uses a text-only reply without self-grant', () => {
  const reply = fixture([]);
  reply.blocks.pop(); reply.requiredCapabilities = [];
  withFixtureOrigins(reply);
  assert.equal(parseAndValidateReply(JSON.stringify(reply), { sourceText: '', requireOrigins: true, capabilities: [] }).ok, true);
  assert.match(io, /If it\s+is absent, omit the citations block/);
});
