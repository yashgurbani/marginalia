import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalReplyData, type CandidateReply, type ReplyCapability } from '../../contracts/reply.ts';
import { digestReply } from '../../contracts/host-checks.ts';
import {
  SOLVER_EXECUTION_SCHEMA,
  SOLVER_INPUT_SCHEMA,
  SOLVER_PLAN_SCHEMA,
  SOLVER_REQUEST_SCHEMA,
  digestSolverInputs,
  digestSolverOutputs,
  resolveSolverBlock,
  sameSolverPrincipal,
  solverCacheKey,
  solverPolicyFingerprint,
  solverRequestIdentity,
  validateSolverLimits,
  validateSolverOutput,
  validateSolverExecuteRequest,
  validateSolverPlanRequest,
  validateSolverRequest,
  type SolverArtifactBinding,
  type SolverExecutionRecord,
  type SolverLimits,
  type SolverOutcome,
  type SolverPlanOutcome,
  type SolverPrincipal,
  type SolverRecomputeRequest,
  type SolverRejectionCode,
  type SolverUnavailableCode,
} from '../../contracts/solver.ts';
import {
  PINNED_CODEX_VERSION,
  auditCodexPolicy,
  cancellationFor,
  createCodexPolicy,
  type Platform,
} from '../codex-policy.ts';
import type { CodexPolicy, PolicyEvidence } from '../codex-policy.ts';
import {
  discardSolverInput,
  newAttemptToken,
  nominalSolverInputPath,
  prepareSolverInput,
  resolveSolverArtifacts,
  type ResolvedSolverArtifacts,
} from './artifacts.ts';
import { SolverResultCache } from './cache.ts';
import { execRequestFor, outputBytesCapFor, type SolverCommandTransport } from './transport.ts';

/**
 * Path 3. A reader whose inputs left the saved envelope explicitly asks for a
 * recompute; this service runs the solver the model already wrote, inside the
 * isolated job environment, and makes no model turn of any kind.
 *
 * The margin speaks a two-step handshake. `prepare` takes only fields a browser can
 * honestly know and returns an opaque bound plan; `request` executes exactly one
 * plan after an explicit click. Every host-private value — the reply hash, the
 * source identity, the grant, the policy fingerprint — is resolved here on both
 * sides of the handshake, so no client claim ever certifies itself.
 */

export type SolverRecomputeContext = {
  reply: CandidateReply;
  replyHash: string;
  threadId: string;
  sourceVersionId: string;
  sourceHash: string;
  binding: SolverArtifactBinding;
  /** Host-granted capabilities for the originating job. */
  capabilities: readonly ReplyCapability[];
  /** Host-recorded execution limits for this job. The margin does not negotiate them. */
  limits: SolverLimits;
};

/** T06/T07 own this. It must return committed, immutable data only. */
export interface SolverContextSource {
  resolve(replyVersionId: string, solverId: string): Promise<SolverRecomputeContext | undefined>;
}

export type SolverAuthorization = {
  grantId: string;
  grantRevision: number;
  /** The identity of the eligibility record this decision belongs to. */
  reservationId: string;
  sitePermissionEpoch: number;
  permissionFingerprint: string;
  /** Present once a concrete policy exists. It must equal the host-computed fingerprint. */
  policyFingerprint?: string;
  /** ISO time after which this authorization must be taken again. */
  expiresAt: string;
};

/**
 * `plan` is eligibility before anything is prepared, and it also names the grant the
 * plan binds. `dispatch` re-checks that grant at the click. `cache-read` serves stored
 * numbers and starts no process. `accept` re-checks permission before a result reaches
 * the reader. `result-read` re-checks it again for every later poll of a settled
 * outcome. None of the five consumes anything.
 */
export type SolverAuthorizationStage = 'plan' | 'dispatch' | 'cache-read' | 'accept' | 'result-read';

/** Exactly the client-visible content of a recompute, plus the host-decided limits. */
export type SolverAuthorizationSubject = {
  replyVersionId: string;
  blockId: string;
  solverId: string;
  inputs: Readonly<Record<string, number>>;
  stateKey: string;
  limits: SolverLimits;
};

export type SolverAuthorizationInput = {
  /**
   * Host-resolved caller identity, taken from the paired session that carried the
   * HTTP request. It is never read out of a request body.
   */
  principal: SolverPrincipal;
  subject: SolverAuthorizationSubject;
  context: SolverRecomputeContext;
  stage: SolverAuthorizationStage;
  /** Canonical content identity. Absent only at `plan`, before the host issues one. */
  requestIdentity?: string;
  requestId?: string;
  /** The grant the plan bound. Absent at `plan`, where the decision names the current grant. */
  expectedGrantId?: string;
  /**
   * Host-computed, and present once a concrete policy exists. The decision must be
   * bound to it.
   */
  policyFingerprint?: string;
  /** Present once a dispatch attempt has an identity. */
  executionAttemptId?: string;
  /** Path 3 makes no model turn, so no inference grant may be spent for it. */
  work: 'local-recompute';
  modelTurns: 0;
};

export type SolverAuthorizationDecision =
  | { decision: 'allowed'; authorization: SolverAuthorization }
  | { decision: 'refused'; reason: string }
  | { decision: 'expired'; reason: string };

/**
 * T13 owns this. Every call is non-consuming: it must not spend a once-grant, an
 * egress allowance or a cloud unit. Consumption happens only in the gate below.
 * There is deliberately no allow-by-default implementation here.
 */
export interface SolverAuthority {
  authorize(input: SolverAuthorizationInput): Promise<SolverAuthorizationDecision>;
}

/**
 * Everything the host actually prepared, offered to the gate as one value so the
 * commit decision sees the concrete policy rather than a caller's claim about it.
 */
export type SolverFinalizationInput = {
  request: SolverRecomputeRequest;
  context: SolverRecomputeContext;
  principal: SolverPrincipal;
  /** Canonical content identity of this recompute. */
  requestIdentity: string;
  /** Unique per dispatch attempt. */
  executionAttemptId: string;
  /** Host-computed from the prepared policy. Never taken from the request. */
  policyFingerprint: string;
  /** Fresh evidence epoch for this exact policy. */
  evidenceScope: string;
  /** The reviewed profile manifest the policy module pinned for this platform. */
  profileManifestSha256: string;
  workspaceGeneration: string;
  solverSha256: string;
  inputDigest: string;
  /** Authoritative source identity, for the egress and consent decision. */
  source: { threadId: string; sourceVersionId: string; sourceHash: string };
  /** The eligibility record taken at the `plan` stage. */
  reservationId: string;
  work: 'local-recompute';
  modelTurns: 0;
};

/**
 * A committed claim on the exact artifact generation this attempt was hashed under.
 *
 * Hashing a solver file is a point observation. Between that hash and the moment the
 * result is accepted, this service awaits evidence, the gate and the process itself,
 * and a mutable continuation could rewrite the artifact bytes in between. Re-reading
 * the file, refusing symlinks or pinning paths does not close that window; only a
 * lease that the artifact owner commits and holds does. T06 issues this inside the
 * same transaction as the handoff, and must keep the named generation immutable
 * until `expiresAt` or an explicit release.
 */
export type SolverGenerationLease = {
  leaseId: string;
  /** Must equal the generation the host hashed the solver under. */
  workspaceGeneration: string;
  /** Must equal the reviewed profile manifest the policy pinned. */
  profileManifestSha256: string;
  /** The lease must still be held when the result is accepted, or the result is refused. */
  expiresAt: string;
};

/**
 * Whether the durable attempt claim for this request identity was written in the same
 * transaction as the handoff. Only `durable-host-journal` survives a restart, and the
 * execution record carries whichever value the commit actually reported.
 */
export type SolverAttemptClaim = 'durable-host-journal' | 'process-local';

export type SolverFinalizationDecision =
  | {
      decision: 'committed';
      handoffToken: string;
      authorization: SolverAuthorization;
      lease: SolverGenerationLease;
      /** True to `durable-host-journal` only when this transaction wrote the claim. */
      attemptClaim: SolverAttemptClaim;
    }
  /** This request identity was already claimed durably. It is not dispatched again. */
  | { decision: 'already-claimed'; reason: string; state: 'dispatched' | 'settled' }
  | { decision: 'refused'; reason: string }
  | { decision: 'expired'; reason: string }
  /** The commit was not observed. It is never retried and never becomes a success. */
  | { decision: 'unknown'; reason: string };

/**
 * The commit itself, and the reason this is an interface rather than a promise.
 *
 * `commit` returns a plain `SolverFinalizationDecision`, not a `Promise` of one. A
 * host operation that has to be awaited cannot be the same operation as the handoff
 * that follows it: every `await` between the decision and `transport.exec` is a window
 * in which permission can be withdrawn, the workspace can be rebuilt, or the daemon
 * can stop after claiming an attempt that never ran. Typing the commit as synchronous
 * is what makes "one host transaction, then the handoff" checkable rather than a
 * promise written in a comment.
 *
 * The implementation is therefore a synchronous transaction. T06's shared SQLite store
 * (better-sqlite3 style) does exactly this: one `BEGIN IMMEDIATE`, the permission and
 * grant re-check, the durable attempt claim, the generation lease and the handoff row,
 * one `COMMIT`, all inside one function call that returns a value.
 */
export interface SolverPreparedCommit {
  commit(): SolverFinalizationDecision;
}

/**
 * The F20 seam. T06 and T13 agreed that consume, authorization, egress, generation
 * lease, durable attempt claim and handoff become durable together inside the
 * JobStore's shared transaction, after re-checking the current attempt, principal,
 * permission epoch, grant revision and reviewed manifest.
 *
 * `prepareCommit` may await as much as it needs: reading current state decides
 * nothing. Everything that must be atomic happens in `SolverPreparedCommit.commit`,
 * which this service calls with no `await` between it and the transport handoff.
 *
 * This service does not implement the transaction and claims no atomicity of its own.
 * What it does enforce is the boundary: an implementation whose `commit` returns a
 * thenable is refused rather than dispatched, because that implementation cannot be
 * the single host operation it is required to be.
 */
export interface SolverExecutionGate {
  /**
   * True only when `commit` writes the durable attempt claim inside the same
   * transaction as the handoff, so at-most-once survives an eviction or a restart.
   * It is a static capability of the gate, reported by `GET /api/solver/status`, and
   * it mirrors `SolverCommandTransport.enforces`: a truthful statement of what this
   * implementation can promise, not a per-attempt measurement. A gate that cannot
   * make the claim durable reports `false`, and every record it commits then reads
   * `atMostOnce: 'process-local'`.
   */
  readonly durableAtMostOnce: boolean;
  prepareCommit(input: SolverFinalizationInput): Promise<SolverPreparedCommit>;
  /**
   * Release a claim this service committed but never handed off.
   *
   * `commit` writes the durable attempt claim and mints the generation lease. The
   * service then makes its last synchronous checks — that the committed grant
   * revision, permission epoch and lease actually cover what this attempt hashed —
   * and a gate that answered with a lease on a rebuilt workspace fails them. Without
   * a release, that claim stays written for a dispatch that never happened, and every
   * later recompute of the same content is refused as `already-claimed` forever.
   *
   * It is synchronous for the same reason `commit` is: it runs on the no-`await`
   * path between the commit and the handoff, and a release that has to be awaited
   * is not the same host operation as the commit it undoes.
   *
   * Optional, and honestly so. A gate that cannot release reports nothing here. A
   * gate that can must return `{ decision: 'released' }` only after removing the
   * exact request/attempt/handoff/lease claim named by the input. Missing, malformed,
   * or asynchronous confirmation is not success. In every unconfirmed case the
   * service answers `outcome_unknown` rather than a clean rejection.
   */
  releaseClaim?(input: SolverClaimRelease): SolverClaimReleaseResult;
}

/** Identifies exactly the claim to withdraw, and why the handoff never happened. */
export type SolverClaimRelease = {
  requestIdentity: string;
  executionAttemptId: string;
  handoffToken: string;
  leaseId: string;
  reason: string;
};

/** Synchronous confirmation that the exact claim identified above was removed. */
export type SolverClaimReleaseResult = { decision: 'released' };

/** Actual host observations for this exact policy. `undefined` means unavailable, never assumed good. */
export interface SolverEvidenceSource {
  collect(policy: CodexPolicy, stage: 'dispatch'): Promise<PolicyEvidence | undefined>;
  /** Named, reader-facing reasons the evidence is not available. Optional; an adapter that has none returns nothing. */
  issues?(): readonly string[];
}

export type SolverServiceOptions = {
  context: SolverContextSource;
  authority: SolverAuthority;
  gate: SolverExecutionGate;
  evidence: SolverEvidenceSource;
  transport?: SolverCommandTransport;
  /** Dedicated Codex home, absolute and disjoint from every job workspace. */
  codexHome: string;
  /** Host-owned worker/attempt/configuration identity; replace it after restart or any config change. */
  auditId: string;
  platform?: Platform;
  codexVersion?: string;
  cache?: SolverResultCache;
  maxSettledOutcomes?: number;
  /** How long a prepared plan may wait for the reader's click. */
  planTtlMs?: number;
  maxPlans?: number;
  now?: () => number;
  clock?: () => string;
  newExecutionId?: () => string;
  newAttemptId?: () => string;
  newPlanId?: () => string;
  newPlanToken?: () => string;
  unavailableReason?: string;
};

type Attempt = {
  requestId: string;
  requestIdentity: string;
  principal: SolverPrincipal;
  subject: SolverAuthorizationSubject;
  grantId: string;
  controller: AbortController;
  promise: Promise<SolverOutcome>;
  cancelled: boolean;
  inputDirectory?: string;
};

type Settled = {
  outcome: SolverOutcome;
  requestIdentity: string;
  principal: SolverPrincipal;
  subject: SolverAuthorizationSubject;
  grantId: string;
};

/** The host's own record of one prepared plan. None of it is sent to the margin. */
type PreparedPlan = {
  planId: string;
  tokenSha256: string;
  expiresAtMs: number;
  principal: SolverPrincipal;
  subject: SolverAuthorizationSubject;
  requestIdentity: string;
  policyFingerprint: string;
  grantId: string;
  grantRevision: number;
  sitePermissionEpoch: number;
  reservationId: string;
  replyHash: string;
  threadId: string;
  sourceVersionId: string;
  sourceHash: string;
  workspaceGeneration: string;
  solverSha256: string;
  spent: boolean;
};

const SUPPORTED_PLATFORMS = new Set<string>(['win32', 'linux', 'darwin']);
/** The one argv element that differs between two otherwise identical attempts. */
const ATTEMPT_INPUT_PLACEHOLDER = '<attempt-input>';
/** The attempt token a plan uses for its nominal, never-written input path. */
const PLAN_INPUT_TOKEN = 'plan';
const DEFAULT_PLAN_TTL_MS = 5 * 60_000;

const rejected = (code: SolverRejectionCode, reason: string): SolverOutcome => ({ status: 'rejected', code, reason });
const unavailable = (code: SolverUnavailableCode, reason: string, issues?: readonly string[]): SolverOutcome =>
  issues ? { status: 'unavailable', code, reason, issues } : { status: 'unavailable', code, reason };

function hostPlatform(): Platform | undefined {
  return SUPPORTED_PLATFORMS.has(process.platform) ? process.platform as Platform : undefined;
}

/**
 * True when a value is thenable. The commit boundary requires a synchronous decision,
 * so a `commit` that returns a promise is detected here and refused rather than awaited.
 */
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
function sameDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

type Resolved = {
  context: SolverRecomputeContext;
  artifacts: ResolvedSolverArtifacts;
  binding: SolverArtifactBinding;
};

export class SolverExecutionService {
  readonly configured: boolean;
  readonly unavailableReason?: string;
  /**
   * Whether the gate's commit makes the attempt claim durable. While it is false, a
   * dispatch is at most once only within this process's memory.
   */
  readonly durableAtMostOnce: boolean;
  private options: SolverServiceOptions;
  private platform?: Platform;
  private cache: SolverResultCache;
  private attempts = new Map<string, Attempt>();
  private settled = new Map<string, Settled>();
  private plans = new Map<string, PreparedPlan>();
  private maxSettled: number;
  private maxPlans: number;
  private planTtlMs: number;
  private now: () => number;
  private clock: () => string;
  private newExecutionId: () => string;
  private newAttemptId: () => string;
  private newPlanId: () => string;
  private newPlanToken: () => string;
  private closed = false;

  constructor(options: SolverServiceOptions) {
    this.options = options;
    this.platform = options.platform ?? hostPlatform();
    this.cache = options.cache ?? new SolverResultCache();
    this.maxSettled = options.maxSettledOutcomes ?? 256;
    this.maxPlans = options.maxPlans ?? 256;
    this.planTtlMs = options.planTtlMs ?? DEFAULT_PLAN_TTL_MS;
    this.now = options.now ?? Date.now;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.newExecutionId = options.newExecutionId ?? (() => randomUUID());
    this.newAttemptId = options.newAttemptId ?? (() => randomUUID());
    this.newPlanId = options.newPlanId ?? (() => randomUUID());
    this.newPlanToken = options.newPlanToken ?? (() => randomBytes(32).toString('hex'));
    this.configured = !!options.transport && !!this.platform;
    this.durableAtMostOnce = options.gate.durableAtMostOnce;
    this.unavailableReason = options.unavailableReason ??
      (!options.transport ? 'No isolated command-execution adapter is configured.'
        : !this.platform ? `This platform (${process.platform}) has no reviewed saved-solver policy.` : undefined);
    if (!Number.isSafeInteger(this.maxSettled) || this.maxSettled < 1) throw new Error('Invalid settled-outcome limit.');
    if (!Number.isSafeInteger(this.maxPlans) || this.maxPlans < 1) throw new Error('Invalid prepared-plan limit.');
    if (!Number.isSafeInteger(this.planTtlMs) || this.planTtlMs < 1_000) throw new Error('Invalid plan lifetime.');
  }

  /** Whether this principal has a recompute running under that id. Another principal's is not visible. */
  inFlight(requestId: string, principal: SolverPrincipal): boolean {
    const attempt = this.attempts.get(requestId);
    return !!attempt && sameSolverPrincipal(attempt.principal, principal);
  }

  /**
   * The outcome of a finished recompute, re-checked against current authority.
   *
   * Holding the request id is not enough. The caller must be the principal that ran
   * it, the reply and its source must still be what ran, and authority must still
   * allow this principal to read it. `undefined` means this service does not hold an
   * outcome for that principal; it never reveals that another principal's does exist.
   */
  async result(requestId: string, principal: SolverPrincipal): Promise<SolverOutcome | undefined> {
    const entry = this.settled.get(requestId);
    if (!entry || !sameSolverPrincipal(entry.principal, principal)) return undefined;

    const context = await this.options.context.resolve(entry.subject.replyVersionId, entry.subject.solverId);
    if (!context) return rejected('unknown-reply', 'This reply version is no longer available.');
    if (context.threadId !== principal.threadId) {
      return rejected('authorization-refused', 'This result belongs to a different thread.');
    }
    const decision = await this.options.authority.authorize({
      principal,
      subject: entry.subject,
      context,
      stage: 'result-read',
      requestIdentity: entry.requestIdentity,
      requestId,
      expectedGrantId: entry.grantId,
      work: 'local-recompute',
      modelTurns: 0,
    });
    const refusal = this.checkAuthorization(decision, { grantId: entry.grantId });
    if (refusal) return refusal;
    return entry.outcome;
  }

  /**
   * Fences the current attempt for this request identity and asks the adapter to
   * terminate that exact process. It does not prove the isolated process stopped;
   * late output is discarded rather than delivered.
   */
  cancel(requestId: string, principal: SolverPrincipal): { cancelled: boolean; processStopConfirmed: false } {
    const attempt = this.attempts.get(requestId);
    if (!attempt || !sameSolverPrincipal(attempt.principal, principal)) return { cancelled: false, processStopConfirmed: false };
    attempt.cancelled = true;
    attempt.controller.abort();
    return { cancelled: true, processStopConfirmed: false };
  }

  invalidateGrant(grantId: string): number {
    return this.cache.invalidateGrant(grantId);
  }

  invalidateReply(replyVersionId: string): number {
    return this.cache.invalidateReply(replyVersionId);
  }

  close(): void {
    this.closed = true;
    for (const attempt of this.attempts.values()) { attempt.cancelled = true; attempt.controller.abort(); }
    this.plans.clear();
    this.cache.clear();
  }

  /**
   * Step one: the host resolves the whole policy for the recompute the reader is
   * looking at, and hands back an opaque plan.
   *
   * Nothing is dispatched, no input file is written, no grant is consumed and no
   * process is started. The margin sends only fields it can see; the reply hash, the
   * source identity, the grant and the policy fingerprint are all resolved here.
   */
  async prepare(raw: unknown, principal: SolverPrincipal): Promise<SolverPlanOutcome> {
    if (this.closed) return { status: 'unavailable', code: 'not-configured', reason: 'The recompute service is shutting down.' };
    const validated = validateSolverPlanRequest(raw);
    if (!validated.ok) return { status: 'rejected', code: validated.code, reason: validated.reason };
    const planRequest = validated.value;

    const readiness = this.readiness();
    if (readiness) return asPlanOutcome(readiness);

    const resolved = await this.resolve(planRequest.replyVersionId, planRequest.solverId, principal);
    if ('outcome' in resolved) return asPlanOutcome(resolved.outcome);
    const { context, artifacts, binding } = resolved;

    const limits = validateSolverLimits(context.limits);
    if (!limits.ok) {
      return { status: 'unavailable', code: 'not-configured', reason: 'The recorded execution limits for this job are not usable.' };
    }
    const subject: SolverAuthorizationSubject = {
      replyVersionId: planRequest.replyVersionId,
      blockId: planRequest.blockId,
      solverId: planRequest.solverId,
      inputs: planRequest.inputs,
      stateKey: planRequest.stateKey,
      limits: limits.value,
    };

    const capability = this.checkCapability(context, limits.value);
    if (capability) return asPlanOutcome(capability);

    // Eligibility only, and the point at which the host learns which grant this
    // recompute belongs to. Nothing is consumed.
    const eligibility = await this.options.authority.authorize({
      principal, subject, context, stage: 'plan', work: 'local-recompute', modelTurns: 0,
    });
    const refusal = this.checkAuthorization(eligibility, {});
    if (refusal) return asPlanOutcome(refusal);
    const reserved = (eligibility as { authorization: SolverAuthorization }).authorization;

    const planId = this.newPlanId();
    const draft = this.hostRequest({
      requestId: planId,
      subject,
      context,
      grantId: reserved.grantId,
      policyKey: '',
      requestedAt: this.clock(),
    });
    const block = resolveSolverBlock(context.reply, draft);
    if (!block.ok) return { status: 'rejected', code: block.code, reason: block.reason };
    if (block.value.path !== context.binding.solverRelativePath) {
      return { status: 'rejected', code: 'artifact-unknown', reason: 'The solver block does not name the artifact the host recorded for this job.' };
    }

    const inputDigest = digestSolverInputs(subject.inputs);
    // A path that `prepareSolverInput` would create, computed without creating it.
    const nominalInput = nominalSolverInputPath(artifacts.workspace, planId, PLAN_INPUT_TOKEN);
    let policy: CodexPolicy;
    try {
      policy = this.buildPolicy(artifacts, nominalInput, limits.value.timeoutMs);
    } catch (error) {
      return { status: 'rejected', code: 'path-unsafe', reason: error instanceof Error ? error.message : 'The recompute policy could not be constructed.' };
    }
    if (policy.operation !== 'saved-solver' || policy.modelTurn !== false) {
      return { status: 'rejected', code: 'unsupported-capability', reason: 'The constructed policy is not a model-free saved-solver policy.' };
    }

    const policyFingerprint = this.fingerprint(policy, nominalInput, binding, inputDigest, limits.value.maxOutputBytes);
    // Identity is content, not policy: the same question asked twice is one
    // recompute. The policy fingerprint is bound separately, on the plan.
    const requestIdentity = solverRequestIdentity(draft, binding);

    const planToken = this.newPlanToken();
    const expiresAtMs = this.now() + this.planTtlMs;
    this.rememberPlan({
      planId,
      tokenSha256: sha256Hex(planToken),
      expiresAtMs,
      principal,
      subject,
      requestIdentity,
      policyFingerprint,
      grantId: reserved.grantId,
      grantRevision: reserved.grantRevision,
      sitePermissionEpoch: reserved.sitePermissionEpoch,
      reservationId: reserved.reservationId,
      replyHash: context.replyHash,
      threadId: context.threadId,
      sourceVersionId: context.sourceVersionId,
      sourceHash: context.sourceHash,
      workspaceGeneration: binding.workspaceGeneration,
      solverSha256: binding.solverSha256,
      spent: false,
    });

    return { status: 'planned', plan: {
      schema: SOLVER_PLAN_SCHEMA,
      planId,
      planToken,
      limits: limits.value,
      expiresAt: new Date(expiresAtMs).toISOString(),
      modelTurns: 0,
      replyVersionId: subject.replyVersionId,
      blockId: subject.blockId,
      solverId: subject.solverId,
    } };
  }

  /**
   * Step two: the explicit click. It executes exactly one prepared plan.
   *
   * Idempotency is bound to the canonical request identity, not to `requestId`
   * alone. Reusing a request id for different content is refused rather than
   * answered with the earlier result.
   */
  async request(raw: unknown, principal: SolverPrincipal): Promise<SolverOutcome> {
    if (this.closed) return unavailable('not-configured', 'The recompute service is shutting down.');
    const validated = validateSolverExecuteRequest(raw);
    if (!validated.ok) return rejected(validated.code, validated.reason);
    const execute = validated.value;

    // Looked up before the sweep. Sweeping first would delete an expired plan and
    // leave the caller with "unknown", which reads as though they made the id up.
    const plan = this.plans.get(execute.planId);
    this.sweepPlans();
    // One refusal for every way a plan can fail to belong to this caller, so a
    // guessed plan id learns nothing from the difference.
    const unknownPlan = rejected('plan-unknown', 'This recompute plan is not available. Prepare the recompute again.');
    if (!plan) return unknownPlan;
    if (!sameSolverPrincipal(plan.principal, principal)) return unknownPlan;
    if (!sameDigest(plan.tokenSha256, sha256Hex(execute.planToken))) return unknownPlan;
    if (plan.expiresAtMs <= this.now()) {
      this.plans.delete(plan.planId);
      return rejected('plan-expired', 'This recompute plan expired before it was used. Prepare the recompute again.');
    }
    // The echoed content must be the content the plan was issued for. Changing an
    // input after preparing is a new question, not this one.
    if (execute.replyVersionId !== plan.subject.replyVersionId || execute.blockId !== plan.subject.blockId ||
        execute.solverId !== plan.subject.solverId || execute.stateKey !== plan.subject.stateKey ||
        digestSolverInputs(execute.inputs) !== digestSolverInputs(plan.subject.inputs)) {
      return rejected('request-identity-mismatch', 'This plan was prepared for different recompute content.');
    }

    const previous = this.settled.get(execute.requestId);
    if (previous) {
      if (previous.requestIdentity !== plan.requestIdentity) {
        return rejected('request-identity-mismatch', 'That request id already answered a different recompute.');
      }
      if (!sameSolverPrincipal(previous.principal, principal)) return unknownPlan;
      return previous.outcome;
    }
    const running = this.attempts.get(execute.requestId);
    if (running) {
      if (running.requestIdentity !== plan.requestIdentity) {
        return rejected('request-identity-mismatch', 'That request id is already running a different recompute.');
      }
      if (!sameSolverPrincipal(running.principal, principal)) return unknownPlan;
      return running.promise;
    }

    // A plan buys one dispatch. Repeats of that dispatch are answered above.
    if (plan.spent) return unknownPlan;
    plan.spent = true;

    const readiness = this.readiness();
    if (readiness) return readiness;

    const controller = new AbortController();
    const attempt: Attempt = {
      requestId: execute.requestId,
      requestIdentity: plan.requestIdentity,
      principal,
      subject: plan.subject,
      grantId: plan.grantId,
      controller,
      cancelled: false,
      promise: Promise.resolve(rejected('invalid-request', 'unset')),
    };
    const remember = (outcome: SolverOutcome): SolverOutcome => {
      this.attempts.delete(execute.requestId);
      this.remember(execute.requestId, {
        outcome,
        requestIdentity: plan.requestIdentity,
        principal,
        subject: plan.subject,
        grantId: plan.grantId,
      });
      return outcome;
    };
    attempt.promise = this.run(execute, plan, principal, attempt).then(remember, (error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The recompute failed before any result was observed.';
      return remember({ status: 'outcome_unknown', reason: `The saved-solver outcome is unknown: ${reason}` });
    });
    this.attempts.set(execute.requestId, attempt);
    return attempt.promise;
  }

  private readiness(): SolverOutcome | undefined {
    if (!this.platform) {
      return unavailable('platform-unverified', this.unavailableReason ?? `This platform (${process.platform}) has no reviewed saved-solver policy.`);
    }
    if (!this.configured || !this.options.transport) {
      return unavailable('not-configured', this.unavailableReason ?? 'Saved-solver recomputation is not configured.');
    }
    const version = this.options.codexVersion ?? PINNED_CODEX_VERSION;
    if (version !== PINNED_CODEX_VERSION) {
      return unavailable('not-configured', 'The configured Codex version does not match the reviewed saved-solver policy.');
    }
    return undefined;
  }

  /** Resolves the committed context and re-hashes the artifacts. Used by both steps. */
  private async resolve(
    replyVersionId: string,
    solverId: string,
    principal: SolverPrincipal,
  ): Promise<Resolved | { outcome: SolverOutcome }> {
    const context = await this.options.context.resolve(replyVersionId, solverId);
    if (!context) return { outcome: rejected('unknown-reply', 'This reply version is not available for recomputation.') };
    if (digestReply(context.reply) !== context.replyHash) {
      return { outcome: rejected('unknown-reply', 'The stored reply does not match its recorded hash.') };
    }
    if (context.threadId !== principal.threadId) {
      return { outcome: rejected('authorization-refused', 'This reply belongs to a different thread.') };
    }
    if (!context.capabilities.includes('solver')) {
      return { outcome: rejected('unsupported-capability', 'The saved-solver capability is not granted for this reply.') };
    }
    const artifacts = await resolveSolverArtifacts(context.binding);
    if (!artifacts.ok) return { outcome: rejected(artifacts.code, artifacts.reason) };
    const binding: SolverArtifactBinding = {
      ...context.binding,
      workspace: artifacts.value.workspace,
      solverSha256: artifacts.value.solverSha256,
      runtimeExecutable: artifacts.value.runtimeExecutable,
      ...(artifacts.value.runtimeSha256 ? { runtimeSha256: artifacts.value.runtimeSha256 } : {}),
    };
    return { context, artifacts: artifacts.value, binding };
  }

  /**
   * Withdraw a committed claim whose handoff never happened, and report what is true.
   *
   * A gate that offers `releaseClaim` gets to undo the claim, so the refusal stays a
   * clean rejection and the reader can try the same recompute again. A gate that does
   * not — including every gate that only claims process-locally — leaves a claim
   * standing for work that never ran, so the honest answer is `outcome_unknown`
   * naming that fact, not a rejection that implies the host is back where it started.
   *
   * Only an explicit synchronous `released` result proves removal. A throw, missing
   * or malformed result, or thenable leaves the claim's state unknown, which is
   * exactly what `outcome_unknown` says.
   */
  private abandonCommitted(
    outcome: SolverOutcome,
    claim: SolverAttemptClaim,
    release: Omit<SolverClaimRelease, 'reason'>,
  ): SolverOutcome {
    // A process-local claim is this process's own memory. Nothing outside it
    // recorded an attempt, so a refusal here really does leave the host where it
    // started and the plain rejection is the truthful answer.
    if (claim !== 'durable-host-journal') return outcome;
    const reason = outcome.status === 'rejected' || outcome.status === 'unavailable' ? outcome.reason : 'The recompute was refused after its claim was committed.';
    const gate = this.options.gate;
    if (gate.releaseClaim) {
      try {
        const released = gate.releaseClaim({ ...release, reason });
        if (isThenable<SolverClaimReleaseResult>(released)) {
          // The boundary is synchronous. Attach a rejection handler immediately so
          // a violating async adapter cannot also create an unhandled rejection.
          void Promise.resolve(released).catch(() => {});
          return { status: 'outcome_unknown', reason: `${reason} Withdrawing the committed attempt claim did not settle synchronously, so whether this recompute can be asked for again is unknown.` };
        }
        if (!released || released.decision !== 'released') {
          return { status: 'outcome_unknown', reason: `${reason} The host did not confirm removal of the exact committed attempt claim, so whether this recompute can be asked for again is unknown.` };
        }
        return outcome;
      } catch (error) {
        return { status: 'outcome_unknown', reason: `${reason} Withdrawing the committed attempt claim failed, so whether this recompute can be asked for again is unknown: ${error instanceof Error ? error.message : 'the host gave no reason'}.` };
      }
    }
    return { status: 'outcome_unknown', reason: `${reason} Nothing was dispatched, but this host cannot withdraw the attempt claim it already committed, so the same recompute may be refused until the claim is cleared.` };
  }

  private checkCapability(context: SolverRecomputeContext, limits: SolverLimits): SolverOutcome | undefined {
    const transport = this.options.transport;
    if (!transport) return unavailable('not-configured', 'Saved-solver recomputation is not configured.');
    if (!transport.enforces.timeout) {
      return unavailable('limit-enforcement-unavailable', 'The command adapter cannot enforce a time limit.');
    }
    if (!transport.enforces.outputBytes) {
      return unavailable('limit-enforcement-unavailable', 'The command adapter cannot enforce an output limit.');
    }
    if (limits.timeoutMs > transport.enforces.maxTimeoutMs) {
      return unavailable('limit-enforcement-unavailable',
        `This adapter answers within ${transport.enforces.maxTimeoutMs} ms, so it cannot carry a ${limits.timeoutMs} ms solver limit.`);
    }
    if (limits.maxMemoryBytes !== undefined) {
      // Codex 0.153.4 command/exec has no memory parameter. Refusing is the honest
      // answer; accepting and ignoring the limit would not be.
      return unavailable('limit-enforcement-unavailable', 'No adapter can enforce a memory limit, so a request that declares one is refused.');
    }
    if (!context.capabilities.includes('solver')) {
      return rejected('unsupported-capability', 'The saved-solver capability is not granted for this reply.');
    }
    return undefined;
  }

  /** The canonical request the host runs. A margin never constructs one of these. */
  private hostRequest(input: {
    requestId: string;
    subject: SolverAuthorizationSubject;
    context: SolverRecomputeContext;
    grantId: string;
    policyKey: string;
    requestedAt: string;
  }): SolverRecomputeRequest {
    return {
      schema: SOLVER_REQUEST_SCHEMA,
      requestId: input.requestId,
      replyVersionId: input.subject.replyVersionId,
      replyHash: input.context.replyHash,
      threadId: input.context.threadId,
      sourceVersionId: input.context.sourceVersionId,
      sourceHash: input.context.sourceHash,
      blockId: input.subject.blockId,
      solverId: input.subject.solverId,
      inputs: input.subject.inputs,
      stateKey: input.subject.stateKey,
      grantId: input.grantId,
      policyKey: input.policyKey,
      limits: input.subject.limits,
      requestedAt: input.requestedAt,
    };
  }

  private buildPolicy(artifacts: ResolvedSolverArtifacts, inputPath: string, timeoutMs: number): CodexPolicy {
    return createCodexPolicy({
      version: this.options.codexVersion ?? PINNED_CODEX_VERSION,
      platform: this.platform!,
      adapter: 'app-server',
      workspace: artifacts.workspace,
      codexHome: this.options.codexHome,
      auditId: this.options.auditId,
      operation: 'saved-solver',
      executable: artifacts.runtimeExecutable,
      solverPath: artifacts.solverPath,
      inputPath,
      // v1 runs read-only. A solver that must write is an unsupported capability,
      // not a reason to make committed job artifacts writable.
      writesWorkspace: false,
      timeoutMs,
    });
  }

  private fingerprint(
    policy: CodexPolicy,
    inputPath: string,
    binding: SolverArtifactBinding,
    inputDigest: string,
    maxOutputBytes: number,
  ): string {
    if (policy.operation !== 'saved-solver') throw new Error('Only a saved-solver policy has a recompute fingerprint.');
    return solverPolicyFingerprint({
      policyVersion: policy.policyVersion,
      codexVersion: policy.version,
      platform: policy.platform,
      adapter: policy.adapter,
      profileManifestSha256: policy.reviewedProfile.manifestSha256,
      runtimeBackend: policy.reviewedProfile.runtimeBackend,
      sandboxPolicy: policy.sandboxPolicy,
      // The per-attempt input filename is replaced, so the fingerprint names the
      // policy and the attempt id names the attempt. The input tuple is still
      // bound, by digest. This is also what lets a plan and its later execution
      // share one fingerprint although their input files differ.
      command: policy.commandExec.params.command.map((argument) =>
        argument === inputPath ? ATTEMPT_INPUT_PLACEHOLDER : argument),
      cwd: policy.commandExec.params.cwd,
      timeoutMs: policy.commandExec.params.timeoutMs,
      outputBytesCapPerStream: outputBytesCapFor(maxOutputBytes),
      workspaceGeneration: binding.workspaceGeneration,
      solverSha256: binding.solverSha256,
      runtimeSha256: binding.runtimeSha256 ?? null,
      inputDigest,
    });
  }

  private rememberPlan(plan: PreparedPlan): void {
    this.sweepPlans();
    this.plans.set(plan.planId, plan);
    while (this.plans.size > this.maxPlans) {
      const oldest = this.plans.keys().next();
      if (oldest.done) break;
      this.plans.delete(oldest.value);
    }
  }

  private sweepPlans(): void {
    const now = this.now();
    for (const [planId, plan] of this.plans) {
      if (plan.expiresAtMs <= now) this.plans.delete(planId);
    }
  }

  private remember(requestId: string, entry: Settled): void {
    this.settled.delete(requestId);
    this.settled.set(requestId, entry);
    while (this.settled.size > this.maxSettled) {
      const oldest = this.settled.keys().next();
      if (oldest.done) break;
      this.settled.delete(oldest.value);
    }
  }

  private async run(
    execute: { requestId: string; requestedAt: string },
    plan: PreparedPlan,
    principal: SolverPrincipal,
    attempt: Attempt,
  ): Promise<SolverOutcome> {
    const transport = this.options.transport!;

    // Everything the plan recorded is resolved again. A plan is a binding, never a
    // shortcut past the checks.
    const resolved = await this.resolve(plan.subject.replyVersionId, plan.subject.solverId, principal);
    if ('outcome' in resolved) return resolved.outcome;
    const { context, artifacts, binding } = resolved;

    if (context.replyHash !== plan.replyHash || context.threadId !== plan.threadId ||
        context.sourceVersionId !== plan.sourceVersionId || context.sourceHash !== plan.sourceHash) {
      return rejected('reply-changed', 'This reply or its source changed after the recompute was prepared.');
    }
    if (binding.workspaceGeneration !== plan.workspaceGeneration) {
      return rejected('generation-drift', 'The job workspace was rebuilt after the recompute was prepared.');
    }
    if (binding.solverSha256 !== plan.solverSha256) {
      return rejected('artifact-modified', 'The saved solver changed after the recompute was prepared.');
    }

    const capability = this.checkCapability(context, plan.subject.limits);
    if (capability) return capability;

    const request = this.hostRequest({
      requestId: execute.requestId,
      subject: plan.subject,
      context,
      grantId: plan.grantId,
      policyKey: plan.policyFingerprint,
      requestedAt: execute.requestedAt,
    });
    // The host's own request must satisfy the same structural contract T05 and T06
    // read. This catches a host bug, not a caller.
    const selfCheck = validateSolverRequest(request);
    if (!selfCheck.ok) return rejected(selfCheck.code, selfCheck.reason);

    const solver = resolveSolverBlock(context.reply, request);
    if (!solver.ok) return rejected(solver.code, solver.reason);
    if (solver.value.path !== context.binding.solverRelativePath) {
      return rejected('artifact-unknown', 'The solver block does not name the artifact the host recorded for this job.');
    }

    // Current authority at the moment of the click, bound to the grant the plan
    // recorded. A grant revoked or replaced since preparation refuses here.
    const current = await this.options.authority.authorize({
      principal,
      subject: plan.subject,
      context,
      stage: 'dispatch',
      requestIdentity: plan.requestIdentity,
      requestId: request.requestId,
      expectedGrantId: plan.grantId,
      work: 'local-recompute',
      modelTurns: 0,
    });
    const currentRefusal = this.checkAuthorization(current, { grantId: plan.grantId });
    if (currentRefusal) return currentRefusal;
    const reserved = (current as { authorization: SolverAuthorization }).authorization;
    if (reserved.grantRevision !== plan.grantRevision || reserved.sitePermissionEpoch !== plan.sitePermissionEpoch) {
      return rejected('authorization-refused', 'Permission for this site changed after the recompute was prepared.');
    }

    if (attempt.cancelled) return { status: 'cancelled', reason: 'The recompute was cancelled before it started.' };

    const executionAttemptId = this.newAttemptId();
    const inputDigest = digestSolverInputs(request.inputs);
    const payload = canonicalReplyData({
      schema: SOLVER_INPUT_SCHEMA,
      requestId: request.requestId,
      replyVersionId: request.replyVersionId,
      solverId: request.solverId,
      inputs: request.inputs,
    });
    // The input path and the policy both exist before any consuming decision is
    // taken, so the gate commits against what would actually run.
    const prepared = await prepareSolverInput(artifacts.workspace, request.requestId, newAttemptToken(), payload);
    if (!prepared.ok) return rejected(prepared.code, prepared.reason);
    attempt.inputDirectory = prepared.value.directory;

    try {
      let policy: CodexPolicy;
      try {
        policy = this.buildPolicy(artifacts, prepared.value.inputPath, request.limits.timeoutMs);
      } catch (error) {
        return rejected('path-unsafe', error instanceof Error ? error.message : 'The recompute policy could not be constructed.');
      }
      if (policy.operation !== 'saved-solver' || policy.modelTurn !== false) {
        return rejected('unsupported-capability', 'The constructed policy is not a model-free saved-solver policy.');
      }

      const policyFingerprint = this.fingerprint(policy, prepared.value.inputPath, binding, inputDigest, request.limits.maxOutputBytes);
      // Both sides of this comparison are host-computed: the left is what the host
      // bound into the plan, the right is what it just prepared. A margin cannot
      // supply either, and a difference means the host's own inputs moved.
      if (policyFingerprint !== plan.policyFingerprint) {
        return rejected('policy-mismatch', 'This recompute would now run under a different policy than the one that was prepared.');
      }
      const requestIdentity = solverRequestIdentity(request, binding);
      if (requestIdentity !== plan.requestIdentity) {
        return rejected('request-identity-mismatch', 'This recompute no longer matches the plan that was prepared for it.');
      }

      const cacheKey = solverCacheKey(binding, request, policyFingerprint);
      const hit = this.cache.get(cacheKey);
      if (hit) {
        // A stored result is served, not re-run. This stage consumes nothing:
        // reading the cache must never spend a once-grant.
        const read = await this.options.authority.authorize({
          principal, subject: plan.subject, context, stage: 'cache-read',
          requestIdentity, requestId: request.requestId, expectedGrantId: plan.grantId,
          policyFingerprint, work: 'local-recompute', modelTurns: 0,
        });
        const refusal = this.checkAuthorization(read, { grantId: plan.grantId, policyFingerprint });
        if (refusal) return refusal;
        return { status: 'succeeded', origin: 'cache', result: {
          requestId: request.requestId,
          stateKey: request.stateKey,
          replyVersionId: request.replyVersionId,
          outputs: hit.outputs,
          record: hit.record,
        } };
      }

      const evidence = await this.options.evidence.collect(policy, 'dispatch');
      if (!evidence) {
        const issues = this.options.evidence.issues?.();
        return unavailable('isolation-evidence-unavailable',
          'No current isolation evidence is available, so no saved solver was run.', issues?.length ? issues : undefined);
      }
      const decision = auditCodexPolicy(policy, evidence, 'dispatch');
      if (decision.decision !== 'evidence-consistent' || !decision.dispatchPolicySatisfied) {
        const issues = decision.issues.map((issue) => `${issue.code}:${issue.field}`);
        return unavailable('isolation-evidence-unavailable',
          'The isolated environment could not be confirmed, so no saved solver was run.', issues);
      }

      // Everything asynchronous the commit depends on is prepared here, before the
      // commit itself. `prepareCommit` may read any current state — the durable
      // attempt row, the grant, the permission epoch, the reviewed manifest — because
      // reading decides nothing. The gate owns durable at-most-once: it looks up a
      // prior claim now and writes the new one inside `commit`, so there is no
      // separate journal read-then-write for a state change to slip between.
      const preparedCommit = await this.options.gate.prepareCommit({
        request,
        context,
        principal,
        requestIdentity,
        executionAttemptId,
        policyFingerprint,
        evidenceScope: policy.evidenceScope,
        profileManifestSha256: policy.reviewedProfile.manifestSha256,
        workspaceGeneration: binding.workspaceGeneration,
        solverSha256: binding.solverSha256,
        inputDigest,
        source: { threadId: context.threadId, sourceVersionId: context.sourceVersionId, sourceHash: context.sourceHash },
        reservationId: reserved.reservationId,
        work: 'local-recompute',
        modelTurns: 0,
      });

      // The last point a cancellation may stop the attempt cleanly. After the commit
      // writes the durable claim, a cancellation can only race the running process; it
      // can never rewrite a committed, handed-off attempt into one that never ran.
      if (attempt.cancelled) return { status: 'cancelled', reason: 'The recompute was cancelled before dispatch.' };

      // The single synchronous commit. Consume, authorization, egress, generation
      // lease, durable attempt claim and handoff become durable together inside the
      // job store transaction, and `transport.exec` below is reached with no `await`
      // between the committed decision and the handoff.
      //
      // `commit` is typed synchronous for exactly this reason. A `commit` that returns
      // a thenable reopens the window this boundary closes, so it is refused rather
      // than dispatched: a claim that could not be honoured atomically is not one this
      // service will hand a process off against.
      const committed = preparedCommit.commit();
      if (isThenable<SolverFinalizationDecision>(committed)) {
        void Promise.resolve(committed).catch(() => {});
        return { status: 'outcome_unknown', reason: 'The recompute commit did not settle synchronously, so the at-most-once handoff boundary could not be honoured and nothing was dispatched.' };
      }
      const finalized = committed;
      if (finalized.decision === 'expired') return rejected('authorization-expired', finalized.reason);
      if (finalized.decision === 'refused') return rejected('handoff-refused', finalized.reason);
      if (finalized.decision === 'unknown') {
        return { status: 'outcome_unknown', reason: `The recompute handoff did not report a result: ${finalized.reason}` };
      }
      if (finalized.decision === 'already-claimed') {
        // The durable claim for this content identity already exists. This is what
        // stops a second dispatch after an eviction or a restart, and it is decided
        // inside the same transaction that would otherwise write the claim, not by a
        // separate lookup that a concurrent commit could race.
        return { status: 'outcome_unknown', reason: finalized.state === 'dispatched'
          ? 'A previous attempt at this recompute was dispatched and its result was never observed. It is not dispatched again.'
          : 'This recompute already ran and its result is no longer held here. It is not dispatched again.' };
      }
      const authorization = finalized.authorization;
      const lease = finalized.lease;
      // The claim strength this exact attempt committed under, not a static flag. A gate
      // that could not make the claim durable reports `process-local` here even when it
      // advertises durability elsewhere, and the record carries the truthful value.
      const attemptClaim = finalized.attemptClaim;
      // Every refusal below happens *after* the claim is durable. Withdrawing it is
      // not optional tidying: an unreleased claim for an attempt that never ran makes
      // this content permanently unrecomputable, and tells the reader a dispatch
      // happened when none did. `abandonCommitted` withdraws it where the gate can,
      // and reports the outcome honestly where it cannot.
      const abandon = (outcome: SolverOutcome): SolverOutcome =>
        this.abandonCommitted(outcome, attemptClaim, { requestIdentity: plan.requestIdentity, executionAttemptId,
          handoffToken: finalized.handoffToken, leaseId: lease.leaseId });
      const handoffRefusal = this.checkAuthorization({ decision: 'allowed', authorization }, { grantId: plan.grantId, policyFingerprint });
      if (handoffRefusal) return abandon(handoffRefusal);
      if (authorization.grantRevision !== reserved.grantRevision || authorization.sitePermissionEpoch !== reserved.sitePermissionEpoch) {
        return abandon(rejected('authorization-refused', 'Permission for this site changed while the recompute was being prepared.'));
      }
      // The lease is the only thing that makes the hashed generation immutable across
      // the awaits below. A lease for another generation or another reviewed manifest
      // is not a lease on what this attempt hashed. These checks are synchronous, so no
      // `await` runs between the committed decision and the handoff.
      if (lease.workspaceGeneration !== binding.workspaceGeneration) {
        return abandon(rejected('generation-drift', 'The committed generation lease does not cover the workspace this recompute hashed.'));
      }
      if (lease.profileManifestSha256 !== policy.reviewedProfile.manifestSha256) {
        return abandon(rejected('generation-drift', 'The committed generation lease does not cover the reviewed profile this policy pinned.'));
      }

      // The handoff. `cancellationFor` and both clock reads are synchronous, so this
      // dispatch is the first `await` after the commit above.
      const cancellation = cancellationFor(policy);
      const startedAt = this.clock();
      const startedMs = this.now();
      const observation = await transport.exec(execRequestFor(policy), {
        maxOutputBytes: request.limits.maxOutputBytes,
        executionAttemptId,
        signal: attempt.controller.signal,
      });
      const endedAt = this.clock();
      const durationMs = Math.max(0, this.now() - startedMs);

      if (attempt.cancelled) {
        return { status: 'cancelled', reason: `The recompute was cancelled. The isolated process stop was not confirmed (${cancellation.strategy}).` };
      }
      if (observation.status === 'unknown') {
        return { status: 'outcome_unknown', reason: observation.reason };
      }
      // Both streams carry the same per-stream limit, so an overrun on either one is
      // a refusal. Counting stdout alone would let a solver that flooded stderr be
      // reported as a within-limit success.
      for (const stream of ['stdout', 'stderr'] as const) {
        const seen = observation[stream];
        if (seen.capReached || seen.bytes > request.limits.maxOutputBytes) {
          return rejected('output-invalid', `The saved solver produced more than its ${request.limits.maxOutputBytes} byte ${stream} limit.`);
        }
        if (seen.hostBoundReached) {
          return rejected('output-invalid', `The saved solver produced more ${stream} than this host will hold for one recompute.`);
        }
      }
      if (observation.exitCode !== 0) {
        // The response carries no timeout flag, so an overrun is inferred from the
        // host's own clock and reported as an inference, never as a confirmed kill.
        const overran = durationMs >= request.limits.timeoutMs;
        return {
          status: 'failed',
          reason: overran
            ? `The saved solver did not finish inside its ${request.limits.timeoutMs} ms limit. Whether the isolated process stopped was not confirmed.`
            : 'The saved solver ended with an error.',
          exitCode: observation.exitCode,
        };
      }

      let document: unknown;
      try { document = JSON.parse(observation.stdout.text); }
      catch { return rejected('output-invalid', 'The saved solver did not print valid JSON.'); }
      const outputs = validateSolverOutput(context.reply, solver.value, request, document);
      if (!outputs.ok) return rejected(outputs.code, outputs.reason);

      // The lease has to still be held now. If it lapsed while the solver ran, the
      // bytes that produced these numbers are no longer guaranteed to be the bytes
      // the host hashed, and no amount of path checking recovers that.
      const leaseExpiry = Date.parse(lease.expiresAt);
      if (Number.isNaN(leaseExpiry)) return rejected('generation-drift', 'The generation lease has no readable expiry.');
      if (leaseExpiry <= this.now()) {
        return rejected('generation-drift', 'The generation lease lapsed while the saved solver ran, so its result is not accepted.');
      }

      const accept = await this.options.authority.authorize({
        principal, subject: plan.subject, context, stage: 'accept',
        requestIdentity, requestId: request.requestId, expectedGrantId: plan.grantId,
        policyFingerprint, executionAttemptId, work: 'local-recompute', modelTurns: 0,
      });
      const acceptRefusal = this.checkAuthorization(accept, { grantId: plan.grantId, policyFingerprint });
      if (acceptRefusal) return acceptRefusal;
      const accepted = (accept as { authorization: SolverAuthorization }).authorization;
      if (accepted.grantRevision !== authorization.grantRevision || accepted.sitePermissionEpoch !== authorization.sitePermissionEpoch) {
        return rejected('authorization-refused', 'Permission for this site changed while the saved solver was running.');
      }
      if (attempt.cancelled) {
        return { status: 'cancelled', reason: 'The recompute was cancelled; its late result was discarded.' };
      }

      const record: SolverExecutionRecord = {
        schema: SOLVER_EXECUTION_SCHEMA,
        origin: 'host-execution',
        executionId: this.newExecutionId(),
        executionAttemptId,
        requestId: request.requestId,
        requestIdentity,
        replyVersionId: request.replyVersionId,
        replyHash: request.replyHash,
        solverId: request.solverId,
        solverSha256: binding.solverSha256,
        runtimeExecutable: binding.runtimeExecutable,
        ...(binding.runtimeSha256 ? { runtimeSha256: binding.runtimeSha256 } : {}),
        workspace: binding.workspace,
        workspaceGeneration: binding.workspaceGeneration,
        inputDigest,
        outputDigest: digestSolverOutputs(outputs.value),
        grantId: authorization.grantId,
        grantRevision: authorization.grantRevision,
        policyKey: request.policyKey,
        policyFingerprint,
        handoffToken: finalized.handoffToken,
        evidenceScope: policy.evidenceScope,
        permissionFingerprint: authorization.permissionFingerprint,
        startedAt,
        endedAt,
        durationMs,
        exitCode: observation.exitCode,
        outputBytes: observation.stdout.bytes,
        enforced: { timeout: transport.enforces.timeout, outputBytes: transport.enforces.outputBytes, memoryBytes: transport.enforces.memoryBytes },
        generationLeaseId: lease.leaseId,
        atMostOnce: attemptClaim,
        streamed: observation.streamed,
        modelTurns: 0,
      };
      this.cache.store(cacheKey, outputs.value, record);
      return { status: 'succeeded', origin: 'execution', result: {
        requestId: request.requestId,
        stateKey: request.stateKey,
        replyVersionId: request.replyVersionId,
        outputs: outputs.value,
        record,
      } };
    } finally {
      await discardSolverInput(prepared.value.directory);
    }
  }

  /**
   * Returns a calm typed outcome when authority refuses; `undefined` means allowed.
   * When a grant or a policy fingerprint is supplied, the decision must be bound to
   * that exact host-held value.
   */
  private checkAuthorization(
    decision: SolverAuthorizationDecision,
    expect: { grantId?: string; policyFingerprint?: string },
  ): SolverOutcome | undefined {
    if (decision.decision === 'expired') return rejected('authorization-expired', decision.reason);
    if (decision.decision !== 'allowed') return rejected('authorization-refused', decision.reason);
    const authorization = decision.authorization;
    if (expect.grantId !== undefined && authorization.grantId !== expect.grantId) {
      return rejected('authorization-refused', 'The current grant no longer matches this recompute.');
    }
    if (expect.policyFingerprint !== undefined && authorization.policyFingerprint !== expect.policyFingerprint) {
      return rejected('policy-mismatch', 'The authorization is not bound to the policy this recompute prepared.');
    }
    const expiry = Date.parse(authorization.expiresAt);
    if (Number.isNaN(expiry)) return rejected('authorization-refused', 'The authorization has no readable expiry.');
    if (expiry <= this.now()) return rejected('authorization-expired', 'The authorization for this recompute has expired.');
    return undefined;
  }
}

/** A refusal reads the same whichever step of the handshake produced it. */
function asPlanOutcome(outcome: SolverOutcome): SolverPlanOutcome {
  if (outcome.status === 'rejected') return { status: 'rejected', code: outcome.code, reason: outcome.reason };
  if (outcome.status === 'unavailable') {
    return outcome.issues
      ? { status: 'unavailable', code: outcome.code, reason: outcome.reason, issues: outcome.issues }
      : { status: 'unavailable', code: outcome.code, reason: outcome.reason };
  }
  return { status: 'rejected', code: 'invalid-request', reason: 'This recompute could not be prepared.' };
}
