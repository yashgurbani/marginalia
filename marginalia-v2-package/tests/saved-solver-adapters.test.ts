import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLY_SCHEMA, type CandidateReply, type ReplyCapability } from '../contracts/reply.ts';
import { digestReply } from '../contracts/host-checks.ts';
import type { ConsentGrant, SiteExclusion } from '../contracts/consent.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';
import type { ReplyVersion } from '../contracts/reader.ts';
import type { SolverArtifactBinding, SolverLimits, SolverPrincipal } from '../contracts/solver.ts';
import {
  createConsentSolverAuthority,
  createStoreSolverContextSource,
  unavailableSolverArtifactBindings,
  unavailableSolverEvidence,
  unavailableSolverExecutionGate,
  type SolverArtifactBindingSource,
  type SolverJobReader,
  type SolverPermissionReader,
  type SolverReplyReader,
} from '../daemon/solver/adapters.ts';
import type { SolverAuthorizationInput } from '../daemon/solver/service.ts';
import type { ReaderStore } from '../daemon/store.ts';
import type { JobStore } from '../daemon/jobs/store.ts';
import type { ConsentSessionService } from '../daemon/consent/service.ts';

/**
 * Interface compatibility with the services these adapters are meant to run on.
 *
 * These assignments are the test: if `ReaderStore`, `JobStore` or
 * `ConsentSessionService` change the shape of a method this module reads, the
 * typecheck fails here rather than at whatever future moment someone mounts the
 * route. Nothing is constructed — a store would need a database file — so this
 * checks the published surface, not the behaviour of that surface.
 */
const replyReaderIsCompatible: SolverReplyReader = undefined as unknown as ReaderStore;
const jobReaderIsCompatible: SolverJobReader = undefined as unknown as JobStore;
const permissionReaderIsCompatible: SolverPermissionReader = undefined as unknown as ConsentSessionService;
void replyReaderIsCompatible; void jobReaderIsCompatible; void permissionReaderIsCompatible;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LIMITS: SolverLimits = { timeoutMs: 5_000, maxOutputBytes: 65_536 };
const READER: SolverPrincipal = { siteOrigin: 'https://example.test', threadId: 'thread-1', sessionId: 'session-1' };
const SOURCE_HASH = 'b'.repeat(64);

function reply(): CandidateReply {
  return {
    schema: REPLY_SCHEMA,
    intent: 'simulate',
    status: 'complete',
    title: 'Cooling coffee',
    summary: 'How the cup approaches room temperature.',
    sourceBindings: [],
    parameters: [{ name: 'k', label: 'Cooling rate', default: 0.1, min: 0.01, max: 1, unit: '1/min' }],
    assumptions: [],
    limitations: [],
    requiredCapabilities: ['solver'],
    blocks: [
      { id: 'derived-1', type: 'derived', name: 'halfLife', expression: 'ln(2)/k', unit: 'min', label: 'Half life' },
      { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['k'], outputBlocks: ['derived-1'] },
    ],
    checks: [],
    staticFallback: 'The cup cools toward room temperature.',
  };
}

function binding(overrides: Partial<SolverArtifactBinding> = {}): SolverArtifactBinding {
  return {
    jobId: 'job-1', attemptId: 'attempt-1',
    workspace: '/workspaces/job-1',
    workspaceGeneration: 'gen-1',
    solverRelativePath: 'solver/main.js',
    solverSha256: 'a'.repeat(64),
    runtimeExecutable: '/usr/bin/node',
    ...overrides,
  };
}

function replyVersion(overrides: Partial<ReplyVersion> = {}): ReplyVersion {
  const candidate = overrides.reply ?? reply();
  return {
    id: 'reply-1', threadId: 'thread-1', parentId: null, supersedes: null,
    reply: candidate, hash: digestReply(candidate),
    validation: { ok: true, issues: [] } as unknown as ReplyVersion['validation'],
    answeredNote: null, createdAt: '2026-09-17T10:00:00.000Z', deletedAt: null, revision: 1,
    ...overrides,
  };
}

function job(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 'job-1', threadId: 'thread-1', idempotencyKey: 'key-1',
    packetDigest: 'c'.repeat(64), preparedPayloadDigest: 'd'.repeat(64),
    provider: 'app-server', model: 'test-model', mode: 'structured-final',
    policyKey: 'policy-1', grantId: 'grant-1', state: 'succeeded',
    cancelRequested: false, latestAttemptId: 'attempt-1', replyVersionId: 'reply-1',
    createdAt: '2026-09-17T09:00:00.000Z', updatedAt: '2026-09-17T10:00:00.000Z',
    context: {
      threadId: 'thread-1', sourceVersionId: 'source-1', sourceUrl: 'https://example.test/article',
      sourceTitle: 'Article', sourcePageType: null, sourceCapturedAt: null, sourceHash: SOURCE_HASH,
      sourceText: 'the article', passage: { exact: 'a', prefix: '', suffix: '', start: 0, end: 1 },
      question: 'why?', intent: 'simulate', preparedPayloadDigest: 'd'.repeat(64),
      modelSettingsRevision: 1, modelCompatibilityKey: 'compat-1',
      outgoing: {} as JobSnapshot['context']['outgoing'],
    },
    attempts: [{ id: 'attempt-1', jobId: 'job-1', number: 1, state: 'succeeded', revision: 1,
      dispatchClaimed: true, handoffMarked: true, workspacePrepared: true }],
    ...overrides,
  } as JobSnapshot;
}

function grant(overrides: Partial<ConsentGrant> = {}): ConsentGrant {
  return {
    id: 'grant-1', site: 'example.test', scope: 'cloud-inference', recipient: 'codex',
    decision: 'allow-site', revision: 3, createdAt: '2026-09-17T09:00:00.000Z',
    ...overrides,
  };
}

type Host = {
  replies: SolverReplyReader;
  jobs: SolverJobReader;
  permissions: SolverPermissionReader;
};

function host(options: {
  version?: ReplyVersion | undefined;
  snapshot?: JobSnapshot | undefined;
  capabilities?: ReplyCapability[];
  grants?: ConsentGrant[];
  exclusions?: SiteExclusion[];
} = {}): Host {
  const version = 'version' in options ? options.version : replyVersion();
  const snapshot = 'snapshot' in options ? options.snapshot : job();
  return {
    replies: { reply: (id) => (version && version.id === id ? version : undefined) },
    jobs: {
      get: (id) => (snapshot && snapshot.id === id ? snapshot : undefined),
      capabilities: () => options.capabilities ?? ['solver'],
    },
    permissions: {
      grants: (includeRevoked = true) => (options.grants ?? [grant()])
        .filter((candidate) => includeRevoked || !candidate.revokedAt),
      exclusions: () => options.exclusions ?? [],
    },
  };
}

function contextSource(part: Host, bindings: SolverArtifactBindingSource = pinned(binding())) {
  return createStoreSolverContextSource({ replies: part.replies, jobs: part.jobs, limits: LIMITS, bindings });
}

/** A host that did record the committed binding. Nothing in the product does yet. */
function pinned(value: SolverArtifactBinding): SolverArtifactBindingSource {
  return { async resolve() { return value; } };
}

function authorizationInput(overrides: Partial<SolverAuthorizationInput> = {}): SolverAuthorizationInput {
  const candidate = reply();
  return {
    principal: READER,
    subject: { replyVersionId: 'reply-1', blockId: 'derived-1', solverId: 'solver-1',
      inputs: { k: 0.2 }, stateKey: 'e'.repeat(64), limits: LIMITS },
    context: { reply: candidate, replyHash: digestReply(candidate), threadId: 'thread-1',
      sourceVersionId: 'source-1', sourceHash: SOURCE_HASH, binding: binding(),
      capabilities: ['solver'], limits: LIMITS },
    stage: 'plan',
    work: 'local-recompute',
    modelTurns: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The context source
// ---------------------------------------------------------------------------

test('a committed reply and its job resolve into a recompute context', async () => {
  const context = await contextSource(host()).resolve('reply-1', 'solver-1');
  assert.ok(context, 'the context resolves');
  // The source identity comes from the job's frozen context, not from live page state.
  assert.equal(context.sourceVersionId, 'source-1');
  assert.equal(context.sourceHash, SOURCE_HASH);
  assert.equal(context.threadId, 'thread-1');
  assert.equal(context.replyHash, digestReply(reply()));
  assert.deepEqual(context.capabilities, ['solver']);
  assert.deepEqual(context.limits, LIMITS);
  assert.equal(context.binding.solverSha256, 'a'.repeat(64));
});

test('no pinned artifact binding means no context at all', async () => {
  const context = await contextSource(host(), unavailableSolverArtifactBindings('No solver hash is pinned at commit.'))
    .resolve('reply-1', 'solver-1');
  assert.equal(context, undefined, 'a recompute without a pinned solver hash is not offered');
});

test('a binding pointing at another job cannot borrow this reply', async () => {
  // The binding names a job the store does not hold; the adapter must not fall back
  // to the reply's own thread and run against whatever workspace it was given.
  const context = await contextSource(host(), pinned(binding({ jobId: 'job-other' }))).resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('a job that produced a different reply version does not authorize this one', async () => {
  const context = await contextSource(host({ snapshot: job({ replyVersionId: 'reply-9' }) })).resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('a binding naming an attempt this job never had is refused', async () => {
  const context = await contextSource(host(), pinned(binding({ attemptId: 'attempt-9' }))).resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('a historical failed attempt cannot be named as the producer of a committed reply', async () => {
  const failed = { ...job().attempts[0], state: 'failed' as const };
  const succeeded = { ...job().attempts[0], id: 'attempt-2', number: 2 };
  const snapshot = job({ latestAttemptId: 'attempt-2', attempts: [failed, succeeded] });
  const context = await contextSource(host({ snapshot }), pinned(binding({ attemptId: 'attempt-1' })))
    .resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('a non-succeeded latest attempt cannot be named as the producer of a committed reply', async () => {
  const snapshot = job({
    state: 'validating',
    attempts: [{ ...job().attempts[0], state: 'validating' }],
  });
  const context = await contextSource(host({ snapshot })).resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('a removed reply is not recomputable even while its solver file remains', async () => {
  const removed = replyVersion({ deletedAt: '2026-09-17T11:00:00.000Z' });
  const context = await contextSource(host({ version: removed })).resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('a stored reply that disagrees with its recorded hash yields no context', async () => {
  const context = await contextSource(host({ version: replyVersion({ hash: 'f'.repeat(64) }) })).resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('a job on another thread than the reply resolves to nothing', async () => {
  const context = await contextSource(host({ snapshot: job({ threadId: 'thread-2' }) })).resolve('reply-1', 'solver-1');
  assert.equal(context, undefined);
});

test('the capability record is reported as the host holds it, not assumed', async () => {
  const context = await contextSource(host({ capabilities: [] })).resolve('reply-1', 'solver-1');
  assert.ok(context);
  assert.deepEqual(context.capabilities, [], 'the service refuses this a moment later; the adapter does not invent one');
});

test('unusable host limits are refused when the adapter is built, not at the click', () => {
  assert.throws(() => createStoreSolverContextSource({
    replies: host().replies, jobs: host().jobs,
    bindings: unavailableSolverArtifactBindings('no binding recorder'),
    limits: { timeoutMs: -1, maxOutputBytes: 10 },
  }), /limits are not usable/);
});

// ---------------------------------------------------------------------------
// The authority
// ---------------------------------------------------------------------------

test('a standing permission authorizes a local recompute without consuming anything', async () => {
  const part = host();
  let grantReads = 0;
  const watched: SolverPermissionReader = {
    grants: (includeRevoked) => { grantReads += 1; return part.permissions.grants(includeRevoked); },
    exclusions: () => part.permissions.exclusions(),
  };
  const authority = createConsentSolverAuthority({ permissions: watched, jobs: part.jobs, now: () => 1_000 });
  const decision = await authority.authorize(authorizationInput());
  assert.equal(decision.decision, 'allowed');
  if (decision.decision !== 'allowed') return;
  assert.equal(decision.authorization.grantId, 'grant-1');
  assert.equal(decision.authorization.grantRevision, 3);
  assert.equal(decision.authorization.sitePermissionEpoch, 0);
  assert.match(decision.authorization.permissionFingerprint, /^[a-f0-9]{64}$/);
  assert.match(decision.authorization.reservationId, /^[a-f0-9]{64}$/);
  assert.equal(decision.authorization.expiresAt, new Date(61_000).toISOString());
  assert.ok(grantReads > 0, 'the decision is read from current permission state');
  // The adapter is given only reading methods. There is no `finalizeDispatch`,
  // no grant consumption and no egress row to write, which is the point: a
  // recompute sends nothing, so it may take no fresh permission for sending.
  assert.equal('finalizeDispatch' in watched, false);
});

test('the same permission state gives the same reservation, and a changed one does not', async () => {
  const part = host();
  const authority = createConsentSolverAuthority({ permissions: part.permissions, jobs: part.jobs });
  const first = await authority.authorize(authorizationInput());
  const again = await authority.authorize(authorizationInput({ stage: 'dispatch' }));
  assert.equal(first.decision, 'allowed');
  assert.equal(again.decision, 'allowed');
  if (first.decision !== 'allowed' || again.decision !== 'allowed') return;
  assert.equal(first.authorization.reservationId, again.authorization.reservationId);

  const moved = createConsentSolverAuthority({
    permissions: host({ grants: [grant({ revision: 4 })] }).permissions, jobs: part.jobs,
  });
  const after = await moved.authorize(authorizationInput());
  assert.equal(after.decision, 'allowed');
  if (after.decision !== 'allowed') return;
  assert.notEqual(after.authorization.reservationId, first.authorization.reservationId,
    'a moved grant revision is a different eligibility record');
});

test('a withdrawn, replaced or denied permission refuses the recompute', async () => {
  const part = host();
  const cases: Array<[string, SolverPermissionReader, RegExp]> = [
    ['revoked', host({ grants: [grant({ revokedAt: '2026-09-17T11:00:00.000Z' })] }).permissions, /withdrawn/],
    ['deny-site', host({ grants: [grant({ decision: 'deny-site' })] }).permissions, /denied/],
    ['gone', host({ grants: [] }).permissions, /no longer recorded/],
    ['excluded', host({ exclusions: [{ site: 'example.test', revision: 2, excluded: true, updatedAt: 'now' }] }).permissions, /excluded/],
  ];
  for (const [name, permissions, reason] of cases) {
    const decision = await createConsentSolverAuthority({ permissions, jobs: part.jobs }).authorize(authorizationInput());
    assert.equal(decision.decision, 'refused', `${name} must refuse`);
    if (decision.decision === 'refused') assert.match(decision.reason, reason, name);
  }
});

test('a later deny-site overrides the grant the answer was produced under', async () => {
  const permissions = host({ grants: [grant(), grant({ id: 'grant-2', decision: 'deny-site' })] }).permissions;
  const decision = await createConsentSolverAuthority({ permissions, jobs: host().jobs }).authorize(authorizationInput());
  assert.equal(decision.decision, 'refused');
  if (decision.decision === 'refused') assert.match(decision.reason, /later decision denies/);
});

test('the site permission epoch is read from the exclusion revision and binds the plan', async () => {
  const permissions = host({ exclusions: [{ site: 'example.test', revision: 5, excluded: false, updatedAt: 'now' }] }).permissions;
  const decision = await createConsentSolverAuthority({ permissions, jobs: host().jobs }).authorize(authorizationInput());
  assert.equal(decision.decision, 'allowed');
  if (decision.decision === 'allowed') assert.equal(decision.authorization.sitePermissionEpoch, 5);
});

test('a margin on another site cannot inherit this permission with a thread id', async () => {
  const part = host();
  const decision = await createConsentSolverAuthority({ permissions: part.permissions, jobs: part.jobs })
    .authorize(authorizationInput({ principal: { ...READER, siteOrigin: 'https://elsewhere.test' } }));
  assert.equal(decision.decision, 'refused');
  if (decision.decision === 'refused') assert.match(decision.reason, /different site/);
});

test('a caller on another thread is refused before any permission is read', async () => {
  const part = host();
  const decision = await createConsentSolverAuthority({ permissions: part.permissions, jobs: part.jobs })
    .authorize(authorizationInput({ principal: { ...READER, threadId: 'thread-2' } }));
  assert.equal(decision.decision, 'refused');
  if (decision.decision === 'refused') assert.match(decision.reason, /thread/);
});

test('a grant replaced since the plan was prepared refuses at the click', async () => {
  const part = host();
  const decision = await createConsentSolverAuthority({ permissions: part.permissions, jobs: part.jobs })
    .authorize(authorizationInput({ stage: 'dispatch', expectedGrantId: 'grant-old' }));
  assert.equal(decision.decision, 'refused');
  if (decision.decision === 'refused') assert.match(decision.reason, /replaced/);
});

test('anything claiming a model turn is not this authority’s business', async () => {
  const part = host();
  const authority = createConsentSolverAuthority({ permissions: part.permissions, jobs: part.jobs });
  const turns = await authority.authorize({ ...authorizationInput(), modelTurns: 1 } as unknown as SolverAuthorizationInput);
  assert.equal(turns.decision, 'refused');
  const work = await authority.authorize({ ...authorizationInput(), work: 'cloud-inference' } as unknown as SolverAuthorizationInput);
  assert.equal(work.decision, 'refused');
});

test('the policy fingerprint is carried through, never invented', async () => {
  const part = host();
  const authority = createConsentSolverAuthority({ permissions: part.permissions, jobs: part.jobs });
  const bound = await authority.authorize(authorizationInput({ stage: 'dispatch', policyFingerprint: 'a'.repeat(64) }));
  assert.equal(bound.decision, 'allowed');
  if (bound.decision === 'allowed') assert.equal(bound.authorization.policyFingerprint, 'a'.repeat(64));
  const plain = await authority.authorize(authorizationInput());
  assert.equal(plain.decision, 'allowed');
  if (plain.decision === 'allowed') {
    assert.equal(plain.authorization.policyFingerprint, undefined, 'no policy yet means no claim about one');
  }
});

// ---------------------------------------------------------------------------
// The fail-closed adapters
// ---------------------------------------------------------------------------

test('the unavailable gate refuses at the commit and reports no durability', async () => {
  const gate = unavailableSolverExecutionGate('No durable attempt claim is mounted.');
  assert.equal(gate.durableAtMostOnce, false);
  const prepared = await gate.prepareCommit(undefined as never);
  const decision = prepared.commit();
  assert.equal(decision.decision, 'refused');
  if (decision.decision === 'refused') assert.equal(decision.reason, 'No durable attempt claim is mounted.');
  assert.equal(typeof (decision as { handoffToken?: unknown }).handoffToken, 'undefined');
});

test('the unavailable evidence source reports nothing rather than something good', async () => {
  const evidence = unavailableSolverEvidence('No confinement has been observed on this host.');
  assert.equal(await evidence.collect(undefined as never, 'dispatch'), undefined);
});

test('the unavailable binding source offers no recompute at all', async () => {
  assert.equal(await unavailableSolverArtifactBindings('No solver hash is pinned at commit.').resolve('reply-1', 'solver-1'), undefined);
});

test('an unavailable adapter must say why it is unavailable', () => {
  for (const make of [unavailableSolverExecutionGate, unavailableSolverEvidence, unavailableSolverArtifactBindings]) {
    assert.throws(() => make('   '), /name why it is unavailable/);
  }
});
