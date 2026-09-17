import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { bindLaunchAudit, observedLaunch, recordLaunch, fileIdentity, executableDigest, assertLaunchCurrent } from '../daemon/providers/launch-facts.ts';
import { createDedicatedHostEvidenceSource } from '../daemon/consent/evidence-host.ts';
import { modeForIntent } from '../daemon/jobs/mode.ts';
import type { ProviderAudit } from '../contracts/job-runner.ts';
import type { PolicyHostEvidenceSource } from '../daemon/consent/evidence.ts';

test('launch facts are per-transport, copied, disconnected and executable-identity fenced', async t => {
  const root = await mkdtemp(join(tmpdir(), 't06-launch-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'synthetic-file'); await writeFile(path, 'not a provider; only a file-identity fixture');
  const identity = fileIdentity(path), sha = await executableDigest(identity);
  assert.match(sha, /^[a-f0-9]{64}$/);
  let disconnect!: () => void;
  const rpc = { request: async () => ({}), notify() {}, close() { disconnect(); }, onNotification: () => () => {}, onDisconnect: (cb: () => void) => { disconnect = cb; return () => {}; } };
  const audit = { workspace: root, codexHome: join(root, 'home'), completeModelToolCatalog: false } as ProviderAudit;
  assert.equal(observedLaunch(audit), undefined); assert.throws(() => bindLaunchAudit(audit, rpc), /observation/);
  const facts = { provider: 'app-server' as const, executable: identity, executableSha256: sha, version: 'codex-cli 0.153.4', workspace: root, codexHome: audit.codexHome,
    inheritedEnvironmentKeys: ['PATH'], environmentValueDigests: { PATH: createHash('sha256').update('/synthetic').digest('hex') }, windowsKeyCasingReviewed: true, observedAt: new Date().toISOString() };
  recordLaunch(rpc, facts); assert.throws(() => recordLaunch(rpc, facts), /already/); bindLaunchAudit(audit, rpc);
  facts.environmentValueDigests.PATH = 'mutated';
  assert.notEqual(observedLaunch(audit)!.environmentValueDigests.PATH, 'mutated');
  assert.equal(observedLaunch(structuredClone(audit)), undefined, 'JSON cannot manufacture host observations');
  assert.doesNotThrow(() => assertLaunchCurrent(audit));
  await writeFile(path, 'changed executable bytes'); assert.throws(() => assertLaunchCurrent(audit), /changed/);
  rpc.close(); assert.equal(observedLaunch(audit)!.alive, false); assert.throws(() => assertLaunchCurrent(audit));
});

test('passive evidence never turns sign-in, requested settings or launch facts into confinement', async t => {
  const host = createDedicatedHostEvidenceSource();
  const readiness = host.readiness(); assert.equal(readiness.ready, false); assert.ok(readiness.reasons.includes('model-reachable-read-confinement-not-observed'));
  readiness.reasons.length = 0; assert.ok(host.readiness().reasons.length > 0);
  const audit = { workspace: '/synthetic', codexHome: '/dedicated', account: { signedIn: true }, config: { sandbox: 'workspace-write' } } as unknown as ProviderAudit;
  const context = { audit, job: { provider: 'app-server' }, request: { workspace: '/synthetic' }, policy: { evidenceScope: 'scope' } } as Parameters<PolicyHostEvidenceSource['collect']>[0];
  assert.deepEqual(await host.collect(context), {});
  await assert.rejects(host.authorizeRecovery!({} as never), /not been established/);
  const root = await mkdtemp(join(tmpdir(), 't06-evidence-')); t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'fixture'); await writeFile(file, 'host fixture'); const executable = fileIdentity(file);
  let close!: () => void;
  const rpc = { request: async () => ({}), notify() {}, close() { close(); }, onNotification: () => () => {}, onDisconnect: (fn: () => void) => { close = fn; return () => {}; } };
  recordLaunch(rpc, { provider: 'app-server', executable, executableSha256: await executableDigest(executable), version: 'codex-cli 0.153.4', workspace: audit.workspace, codexHome: audit.codexHome,
    inheritedEnvironmentKeys: ['PATH'], environmentValueDigests: { PATH: 'd'.repeat(64) }, windowsKeyCasingReviewed: true, observedAt: new Date().toISOString() });
  bindLaunchAudit(audit, rpc);
  const evidence = await host.collect(context);
  assert.equal(evidence.environment!.complete, false); assert.equal(evidence.environment!.value.environmentReviewed, false);
  assert.equal(evidence.environment!.value.serverCwd, audit.workspace); assert.equal(evidence.environment!.scope, 'scope');
  assert.equal(evidence.runtime, undefined); assert.equal(evidence.capabilities, undefined); assert.equal(host.readiness().ready, false);
  rpc.close(); assert.deepEqual(await host.collect(context), {});
});

test('host mode keeps definitions read-only and deep help progressive without selecting a model or sending', () => {
  assert.equal(modeForIntent('define'), 'structured-final');
  for (const intent of ['simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure'] as const) assert.equal(modeForIntent(intent), 'workspace-files');
});
