import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateReply } from '../contracts/reply.ts';
import type { ConsentGrant, ConsentPreview } from '../contracts/consent.ts';
import type { PreparedJobPlan } from '../contracts/jobs.ts';
import type { ReplyVersion, SourceVersion } from '../contracts/reader.ts';
import { ReaderStore } from '../daemon/store.ts';
import { citationQuotesFromHost } from '../renderer/host-authority.ts';
import { withFixtureOrigins } from './origins-fixture.ts';
import { journey, keepMutation, pollJob } from './journey-harness.ts';
import { dom, until } from './t05-dom.ts';

registerHooks({
  resolve(specifier, context, next) { return specifier.endsWith('.css') ? { url: 'p12:css', shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === 'p12:css' ? { format: 'module', source: '', shortCircuit: true } : next(url, context); },
});
const { mountReply } = await import('../renderer/index.ts');
const sourceText = 'Start with this passage.';
function evidenceReply(): CandidateReply {
  const reply = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'evidence', status: 'complete',
    requiredCapabilities: ['network.citations'], title: 'Evidence fixture', summary: 'Local quotation and an authored fetch claim.',
    sourceBindings: [{ name: 'passage', meaning: 'Current passage', relation: 'quoted', selector: { exact: sourceText } }],
    parameters: [], assumptions: [], limitations: [], checks: [], staticFallback: 'Claim support remains unverified.',
    blocks: [{ type: 'citations', id: 'local', entries: [{ id: 'entry', claim: 'A local quotation.', support: sourceText, source: 'Current page', date: '2026-09-17', fetched: false }] },
      { type: 'citations', id: 'external', entries: [{ id: 'entry', claim: 'An external claim.', support: sourceText, source: 'External publication', date: '2026-09-17', fetched: true, url: 'https://external.example/paper' }] }],
  });
  reply.origins!.parts['/blocks/0/entries/0/support'] = { kind: 'source-page', binding: 'passage' };
  return reply;
}

test('evidence completion persists a host receipt across restart and renders source quotes without another dispatch', async t => {
  const trip = await journey('p12-evidence', ['network.citations']); t.after(() => trip.dispose());
  let daemon = await trip.start('initial');
  const keep = keepMutation('p12-thread', 'p12-keep', sourceText);
  keep.anchor = { exact: sourceText, prefix: '', suffix: '', start: 0, end: sourceText.length };
  assert.equal((await daemon.request('POST', '/api/change', keep)).status, 200);
  await trip.script({ 'p12-job': { behaviour: 'reply', reply: evidenceReply() } });
  const prepared = await daemon.request('POST', '/api/jobs/prepare', { id: 'p12-job', idempotencyKey: 'p12-key', threadId: 'p12-thread', intent: 'evidence', question: 'What supports this?' });
  assert.equal(prepared.status, 200);
  const submission = prepared.body as unknown as { preview: ConsentPreview; job: PreparedJobPlan };
  assert.deepEqual(await trip.calls(), []);
  const decision = await daemon.request('POST', '/api/consent/decision', { previewId: submission.preview.id, expectedRevision: submission.preview.revision, choice: 'this-time' });
  assert.equal(decision.status, 200);
  assert.deepEqual(await trip.calls(), []);
  const grant = decision.body.grant as ConsentGrant;
  assert.equal((await daemon.request('POST', '/api/jobs', { ...submission.job, grantId: grant.id })).status, 202);
  const job = await pollJob(daemon, 'p12-job', value => value.state === 'succeeded' || value.state === 'failed');
  assert.equal(job.state, 'succeeded', job.reason);
  const response = await daemon.request('GET', '/api/replies?threadId=p12-thread');
  assert.equal(response.status, 200);
  const saved = response.body as unknown as { replies: ReplyVersion[]; source: SourceVersion };
  const report = saved.replies[0].validation;
  assert.deepEqual(report.evidence?.entries.map(value => [value.blockId, value.sourceQuote, value.attribution]), [
    ['local', { start: 0, end: sourceText.length }, 'author-supplied'], ['external', null, 'unsupported-fetch-claim'],
  ]);
  assert.equal(report.evidence?.retrievalComplete, false);
  assert.equal(report.evidence?.observedFetchCount, 0);
  assert.equal(report.evidence?.headline, null);
  const first = dom(t);
  const mounted = mountReply(first.root as unknown as HTMLElement, saved.replies[0].reply, { sourceText, hostReport: report });
  await until(() => first.root.textContent.includes('Quoted from this page.'));
  assert.equal(first.root.querySelectorAll('.mr-citation-status').filter(value => value.textContent.startsWith('Quoted')).length, 1);
  assert.match(first.root.textContent, /Unverified. Claim support awaits assessment./);
  mounted.destroy();
  await daemon.stop(); daemon = await trip.start('reopened');
  const reopenedResponse = await daemon.request('GET', '/api/replies?threadId=p12-thread');
  const reopened = reopenedResponse.body as unknown as { replies: ReplyVersion[]; source: SourceVersion };
  assert.deepEqual(reopened.replies[0].validation, report);
  assert.equal(reopened.source.text, sourceText);
  assert.equal((await trip.calls()).filter(call => call.kind === 'start').length, 1);
  assert.deepEqual(await citationQuotesFromHost(reopened.replies[0].reply, sourceText, report), new Set(['["local","entry"]']));
});

function storedEvidence() {
  const store = new ReaderStore(':memory:');
  store.apply(keepMutation('thread', 'keep', sourceText));
  const saved = store.commitReply({ id: 'reply', threadId: 'thread', reply: evidenceReply() }, ['network.citations']);
  return { store, saved };
}

test('missing, malformed, changed-source, changed-reply, duplicate and unsupported receipts remain unverified', async () => {
  const { store, saved } = storedEvidence();
  try {
    assert.equal((await citationQuotesFromHost(saved.reply, sourceText)).size, 0);
    assert.equal((await citationQuotesFromHost(saved.reply, 'Changed source', saved.validation)).size, 0);
    assert.equal((await citationQuotesFromHost({ ...saved.reply, summary: 'Changed reply' }, sourceText, saved.validation)).size, 0);
    for (const change of [
      (report: typeof saved.validation) => { report.evidence!.sourceStale = true; },
      (report: typeof saved.validation) => { report.evidence!.entries = [...report.evidence!.entries, report.evidence!.entries[0]]; },
      (report: typeof saved.validation) => { report.evidence!.entries[0].attribution = 'unsupported-fetch-claim'; },
      (report: typeof saved.validation) => { report.evidence!.entries[0].sourceQuote = { start: 1, end: sourceText.length }; },
      (report: typeof saved.validation) => { report.evidence!.entries[0].support = 'Different'; },
      (report: typeof saved.validation) => { report.evidence!.verdict = 'refused'; },
      (report: typeof saved.validation) => { Object.assign(report.evidence!, { verdict: 'unsupported' }); },
    ]) {
      const report = structuredClone(saved.validation); change(report);
      assert.equal((await citationQuotesFromHost(saved.reply, sourceText, report)).size, 0);
    }
  } finally { store.close(); }
});

test('frozen-source mismatch rolls back and an existing immutable receipt is preserved on replay', () => {
  const { store, saved } = storedEvidence();
  try {
    const invalid = { sessionScope: 'open-session' as const, retrievalComplete: true, observed: [], boundSourceVersion: { id: 'wrong', hash: 'a'.repeat(64), capturedAt: null } };
    assert.throws(() => store.commitReply({ id: 'new-reply', threadId: 'thread', reply: evidenceReply() }, ['network.citations'], invalid), /frozen request/);
    assert.equal(store.reply('new-reply'), undefined);
    assert.deepEqual(store.commitReply({ id: 'reply', threadId: 'thread', reply: evidenceReply() }, ['network.citations'], invalid).validation, saved.validation);
    assert.equal(store.replies('thread').length, 1);
  } finally { store.close(); }
});

test('disposed citation frame stays unverified when asynchronous hashing completes', async t => {
  const { store, saved } = storedEvidence(); t.after(() => store.close());
  const { root } = dom(t);
  const mounted = mountReply(root as unknown as HTMLElement, saved.reply, { sourceText, hostReport: saved.validation });
  const statuses = root.querySelectorAll('.mr-citation-status');
  assert.equal(statuses.length, 2);
  mounted.destroy();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(statuses.every(value => value.textContent.startsWith('Unverified.')));
});
