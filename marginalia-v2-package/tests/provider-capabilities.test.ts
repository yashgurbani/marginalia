import test from 'node:test';
import assert from 'node:assert/strict';
import { providerCapabilities, type ProviderCapability } from '../contracts/provider-capabilities.ts';
import type { StartJobInput } from '../contracts/jobs.ts';
import type { ProviderKind } from '../contracts/job-runner.ts';
import { ReaderStore } from '../daemon/store.ts';
import { LibrarySettingsService } from '../daemon/library.ts';
import { JobService } from '../daemon/jobs/service.ts';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { createCodexPolicy, PINNED_CODEX_VERSION, type PolicyInput } from '../daemon/codex-policy.ts';

test('provider capability is independent of model selection and unavailable entries carry no dispatch adapter', () => {
  const reader = new ReaderStore(':memory:');
  try {
    const library = new LibrarySettingsService(reader), before = structuredClone(providerCapabilities);
    library.saveModels({ fast: 'some-local-model', deep: 'another-provider-model', expectedRevision: 0 });
    assert.equal(library.modelFor('fast').model, 'some-local-model');
    assert.deepEqual(providerCapabilities, before);
    const implemented = providerCapabilities.filter(value => value.support === 'implemented');
    assert.equal(implemented.length, 1);
    assert.equal(implemented[0].recipient, 'openai-codex');
    assert.deepEqual(implemented[0].adapters, ['app-server', 'mcp-server']);
    for (const capability of providerCapabilities) {
      assert.equal(capability.credentialBoundary, 'outside-browser');
      assert.equal('model' in capability, false);
      if (capability.support === 'unavailable') {
        assert.equal('adapters' in capability, false);
        assert.equal('recipient' in capability, false);
      }
    }
  } finally { reader.close(); }
});

// These must remain compile errors: display capabilities cannot widen ProviderKind
// or smuggle a runnable adapter into an unavailable entry.
function checkTypes() {
  // @ts-expect-error A model name does not identify an executable provider adapter.
  const adapter: ProviderKind = 'some-local-model';
  // @ts-expect-error An unavailable provider cannot name an executable adapter.
  const unsupported: ProviderCapability = { label: 'Local', support: 'unavailable', detail: '', credentialBoundary: 'outside-browser', adapters: ['app-server'] };
  return { adapter, unsupported };
}
void checkTypes;

const unsupportedProviders = ['local-model', 'third-party', 'own-agent', 'openai-codex', 'some-local-model'];
for (const provider of unsupportedProviders) test(`${provider}: unsupported host defaults and forged job input cannot dispatch`, async () => {
  const reader = new ReaderStore(':memory:');
  let launches = 0;
  const factory = { dispatchReady: true, consent: new ConsentSessionService(reader),
    create: async () => { launches++; throw new Error('Unexpected provider launch'); } };
  const defaults = { provider: provider as ProviderKind, mode: 'structured-final' as const, policyKey: 'a'.repeat(64), capabilities: [] };
  const library = new LibrarySettingsService(reader);
  const unsupported = new JobService({ reader, workspaceRoot: process.cwd(), library, runtimeFactory: factory, defaults });
  const codex = new JobService({ reader, workspaceRoot: process.cwd(), library, runtimeFactory: factory,
    defaults: { ...defaults, provider: 'app-server' } });
  const draft = { id: 'provider-test', idempotencyKey: 'provider-test-key', threadId: 'provider-thread', intent: 'define' as const, question: 'Explain' };
  const input: StartJobInput = { ...draft, provider: provider as ProviderKind, model: 'some-local-model', mode: 'structured-final',
    policyKey: 'a'.repeat(64), grantId: 'grant', preparedPayloadDigest: 'b'.repeat(64) };
  try {
    assert.equal(unsupported.configured, false); assert.equal(unsupported.available, false);
    await assert.rejects(unsupported.prepare(draft), /No host-owned execution policy/);
    await assert.rejects(unsupported.create(input), /No host-owned execution policy/);
    assert.equal(codex.available, true, 'Synthetic ready fixture exercises rejection beyond the readiness check.');
    await assert.rejects(codex.create(input), /Invalid execution mode/);
    assert.equal(launches, 0); assert.deepEqual(codex.list(), []);
    assert.equal((reader.db.prepare('SELECT count(*) n FROM job_preparations').get() as { n: number }).n, 0);
  } finally { await unsupported.close(); await codex.close(); reader.close(); }
});

for (const platform of ['win32', 'linux', 'darwin'] as const) test(`${platform}: unsupported providers cannot obtain a Codex execution policy`, () => {
  for (const adapter of unsupportedProviders) {
    const input = { version: PINNED_CODEX_VERSION, platform, adapter, operation: 'generation', model: 'some-local-model',
      workspace: platform === 'win32' ? 'C:\\jobs\\one' : '/jobs/one',
      codexHome: platform === 'win32' ? 'C:\\codex-home' : '/codex-home', auditId: 'synthetic' } as PolicyInput;
    assert.throws(() => createCodexPolicy(input), /Unknown provider adapter/);
  }
});
