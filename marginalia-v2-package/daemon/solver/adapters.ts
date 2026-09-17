import { createHash } from 'node:crypto';
import type { ConsentGrant, SiteExclusion } from '../../contracts/consent.ts';
import type { JobSnapshot } from '../../contracts/jobs.ts';
import type { ReplyVersion } from '../../contracts/reader.ts';
import type { ReplyCapability } from '../../contracts/reply.ts';
import { digestReply } from '../../contracts/host-checks.ts';
import { validateSolverLimits, type SolverArtifactBinding, type SolverLimits } from '../../contracts/solver.ts';
import type { CodexPolicy, PolicyEvidence } from '../codex-policy.ts';
import type {
  SolverAuthority, SolverAuthorizationDecision, SolverAuthorizationInput, SolverContextSource,
  SolverEvidenceSource, SolverExecutionGate, SolverPreparedCommit, SolverRecomputeContext,
} from './service.ts';

/**
 * Concrete host adapters for saved-solver recomputation, built only on services that
 * already exist and expose a public, non-consuming read.
 *
 * Two things shape everything in this file.
 *
 * The first is that a recompute is local work. It makes no model turn, sends nothing
 * to a provider and produces no egress record. So it may read the permission the
 * original job ran under, and it must never take a fresh one, consume a this-time
 * grant, or write an egress row. `ConsentSessionService.finalizeDispatch` does all
 * three — it consumes `allow-once`, inserts into `egress_events`, and is keyed on a
 * `JobSnapshot` a recompute does not have — so it is deliberately not used here.
 * `grants()` and `exclusions()` are, because they only read.
 *
 * The second is that an adapter must not manufacture what the host does not record.
 * Where a required fact has no source today, this module ships an explicit
 * fail-closed adapter that names the missing capability, rather than a default that
 * lets a recompute run on an assumption.
 */

/** The reply reads this module needs. `ReaderStore` satisfies it. */
export type SolverReplyReader = {
  reply(id: string): ReplyVersion | undefined;
};

/** The job reads this module needs. `JobStore` satisfies it. Both are non-consuming. */
export type SolverJobReader = {
  get(id: string): JobSnapshot | undefined;
  capabilities(jobId: string): ReplyCapability[];
};

/**
 * The permission reads this module needs. `ConsentSessionService` satisfies it.
 *
 * Only these two methods. Both are pure reads: neither consumes a grant, records an
 * egress event, nor takes a decision the reader has not already made.
 */
export type SolverPermissionReader = {
  grants(includeRevoked?: boolean): ConsentGrant[];
  exclusions(): SiteExclusion[];
};

/**
 * The committed identity of a saved solver file, pinned when the job succeeded.
 *
 * This is separate from `SolverContextSource` because it is the one part of the
 * context no existing service records. A binding hashed at read time is a point
 * observation of whatever is on disk now, which is exactly the drift the pinned hash
 * exists to catch, so this interface only ever returns what the host wrote down at
 * commit time.
 */
export interface SolverArtifactBindingSource {
  resolve(replyVersionId: string, solverId: string): Promise<SolverArtifactBinding | undefined>;
}

export type StoreSolverContextOptions = {
  replies: SolverReplyReader;
  jobs: SolverJobReader;
  bindings: SolverArtifactBindingSource;
  /**
   * Host-owned execution limits for a recompute. They are configuration, not
   * negotiation: the margin never sends them and cannot change them.
   */
  limits: SolverLimits;
};

/**
 * Resolves a recompute's committed context from the reader and job stores.
 *
 * Everything except the artifact binding comes from data the host already froze: the
 * reply and its hash from the reply version, the thread, source version and source
 * hash from the job's `FrozenJobContext`, and the capabilities from the job's own
 * capability record. Nothing here is recomputed from live page state.
 *
 * It returns `undefined` — never a partial context — whenever any of that does not
 * line up, because a caller cannot check a context it was not given.
 */
export function createStoreSolverContextSource(options: StoreSolverContextOptions): SolverContextSource {
  const limits = validateSolverLimits(options.limits);
  if (!limits.ok) throw new Error(`Saved-solver limits are not usable: ${limits.reason}`);
  return {
    async resolve(replyVersionId: string, solverId: string): Promise<SolverRecomputeContext | undefined> {
      const binding = await options.bindings.resolve(replyVersionId, solverId);
      if (!binding) return undefined;
      const version = options.replies.reply(replyVersionId);
      // A removed reply is not recomputable. The solver file may still be on disk;
      // that the reader deleted the answer is the decision that counts.
      if (!version || version.deletedAt) return undefined;
      const job = options.jobs.get(binding.jobId);
      if (!job) return undefined;
      // The job must be the one that produced this exact reply version. Without this
      // a binding could point a recompute at another job's workspace and grant.
      if (job.replyVersionId !== replyVersionId) return undefined;
      if (job.threadId !== version.threadId || job.context.threadId !== version.threadId) return undefined;
      if (!job.attempts.some(attempt => attempt.id === binding.attemptId)) return undefined;
      const replyHash = digestReply(version.reply);
      // The store records its own hash. If the two disagree the stored reply is not
      // trustworthy, and the service would refuse it a moment later anyway.
      if (version.hash !== replyHash) return undefined;
      return {
        reply: version.reply,
        replyHash,
        threadId: version.threadId,
        sourceVersionId: job.context.sourceVersionId,
        sourceHash: job.context.sourceHash,
        binding,
        capabilities: options.jobs.capabilities(binding.jobId),
        limits: limits.value,
      };
    },
  };
}

export type ConsentSolverAuthorityOptions = {
  permissions: SolverPermissionReader;
  jobs: SolverJobReader;
  /** How long a decision stands before the caller must take it again. */
  ttlMs?: number;
  now?: () => number;
};

const DEFAULT_AUTHORITY_TTL_MS = 60_000;

/**
 * Non-consuming authority for local recomputation, read from current consent state.
 *
 * It answers one question: does the permission the original job ran under still
 * stand? It checks that the site is not excluded, that the grant still exists at the
 * revision the job used, that it was not revoked or replaced, that no later
 * deny-site covers the same site and recipient, and that the caller is the thread and
 * origin the job belonged to.
 *
 * What it deliberately does not do: consume an `allow-once` grant, mint a new grant,
 * record an egress event, or spend any cloud allowance. A recompute sends nothing, so
 * none of those may happen for one.
 *
 * `reservationId` is a digest of the exact permission state this decision was read
 * from, not a row in any table. There is nothing durable to reserve for work that
 * consumes nothing, and a fabricated reservation id would be a durability claim this
 * adapter cannot honour. Its value is real: a later stage that reads changed state
 * produces a different id, which is what the service compares.
 */
export function createConsentSolverAuthority(options: ConsentSolverAuthorityOptions): SolverAuthority {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_AUTHORITY_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000) throw new Error('Invalid recompute authorization lifetime.');
  return {
    async authorize(input: SolverAuthorizationInput): Promise<SolverAuthorizationDecision> {
      // A recompute that claimed any model turn is not this path, whatever else is true.
      if (input.work !== 'local-recompute' || input.modelTurns !== 0) {
        return { decision: 'refused', reason: 'This authority only covers local recomputation with no model turn.' };
      }
      const job = options.jobs.get(input.context.binding.jobId);
      if (!job) return { decision: 'refused', reason: 'The job that produced this solver is no longer recorded.' };
      if (job.threadId !== input.principal.threadId || job.threadId !== input.context.threadId) {
        return { decision: 'refused', reason: 'This recompute does not belong to the caller’s thread.' };
      }
      const grant = options.permissions.grants(true).find(candidate => candidate.id === job.grantId);
      if (!grant) return { decision: 'refused', reason: 'The permission this answer was produced under is no longer recorded.' };
      if (grant.revokedAt) return { decision: 'refused', reason: 'Permission for this site was withdrawn.' };
      if (grant.decision === 'deny-site') return { decision: 'refused', reason: 'Sending is denied for this site.' };
      // The caller's origin must be the site the reader granted. A margin on another
      // site holding a thread id does not inherit this permission.
      if (!sameSite(grant.site, input.principal.siteOrigin)) {
        return { decision: 'refused', reason: 'This recompute was asked for from a different site than the one the permission covers.' };
      }
      const denied = options.permissions.grants(false).some(candidate =>
        candidate.decision === 'deny-site' && !candidate.revokedAt &&
        candidate.site === grant.site && candidate.scope === grant.scope && candidate.recipient === grant.recipient);
      if (denied) return { decision: 'refused', reason: 'A later decision denies this site.' };
      const exclusion = options.permissions.exclusions().find(entry => entry.site === grant.site);
      if (exclusion?.excluded) return { decision: 'refused', reason: 'This site is excluded, so nothing runs for it.' };
      // The exclusion revision is the site's permission epoch: it moves whenever the
      // reader changes what this site may do. The service binds a plan to it, so a
      // change between preparing and clicking refuses rather than runs.
      const sitePermissionEpoch = exclusion?.revision ?? 0;
      if (input.expectedGrantId !== undefined && input.expectedGrantId !== grant.id) {
        return { decision: 'refused', reason: 'Permission for this site was replaced after this recompute was prepared.' };
      }
      const permissionFingerprint = digest('marginalia.solver-permission.v1', {
        grantId: grant.id, grantRevision: grant.revision, sitePermissionEpoch,
        site: grant.site, scope: grant.scope, recipient: grant.recipient, decision: grant.decision,
      });
      return {
        decision: 'allowed',
        authorization: {
          grantId: grant.id,
          grantRevision: grant.revision,
          reservationId: digest('marginalia.solver-reservation.v1', {
            permissionFingerprint, jobId: job.id, threadId: job.threadId,
            replyVersionId: input.subject.replyVersionId, solverId: input.subject.solverId,
          }),
          sitePermissionEpoch,
          permissionFingerprint,
          ...(input.policyFingerprint !== undefined ? { policyFingerprint: input.policyFingerprint } : {}),
          expiresAt: new Date(now() + ttlMs).toISOString(),
        },
      };
    },
  };
}

/**
 * The artifact binding source for a host that does not record one.
 *
 * No module outside `daemon/solver` records a solver's committed SHA-256 or a
 * workspace generation today, so this is what an honest host mounts until one does:
 * every recompute resolves to no context and the product reports it, instead of a
 * recompute running against a file nobody pinned.
 */
export function unavailableSolverArtifactBindings(reason: string): SolverArtifactBindingSource {
  requireReason(reason);
  return { async resolve() { return undefined; } };
}

/**
 * The execution gate for a host with no durable attempt claim or generation lease.
 *
 * It refuses at `prepareCommit`, so nothing is ever dispatched through it. A gate
 * that committed without writing a claim and minted a lease nobody holds would let
 * the same recompute run twice after a restart, and would let a rebuilt workspace be
 * executed under a hash taken before the rebuild. Refusing is the truthful answer
 * until T06 can do both inside one transaction.
 */
export function unavailableSolverExecutionGate(reason: string): SolverExecutionGate {
  requireReason(reason);
  return {
    durableAtMostOnce: false,
    async prepareCommit(): Promise<SolverPreparedCommit> {
      return { commit: () => ({ decision: 'refused', reason }) };
    },
  };
}

/**
 * The evidence source for a host with no observed confinement proof for this policy.
 *
 * `undefined` is read by the service as unavailable, never as good news, so the
 * recompute is refused. Returning a synthesised `PolicyEvidence` here would be the
 * exact false readiness this path must not have: a claim that a process is confined
 * when nothing on this host has observed that it is.
 */
export function unavailableSolverEvidence(reason: string): SolverEvidenceSource {
  requireReason(reason);
  return {
    async collect(_policy: CodexPolicy, _stage: 'dispatch'): Promise<PolicyEvidence | undefined> { return undefined; },
  };
}

function requireReason(reason: string): void {
  if (!reason.trim()) throw new Error('An unavailable adapter must name why it is unavailable.');
}

/** Host and registrable-suffix comparison is the consent module's; this only matches what it stored. */
function sameSite(site: string, origin: string): boolean {
  if (site === origin) return true;
  try {
    return new URL(origin).host === site;
  } catch {
    return false;
  }
}

function digest(version: string, value: Record<string, unknown>): string {
  const ordered = Object.keys(value).sort().map(key => [key, value[key]] as const);
  return createHash('sha256').update(JSON.stringify([version, ordered])).digest('hex');
}
