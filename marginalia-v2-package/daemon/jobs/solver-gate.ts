import { randomBytes, randomUUID } from 'node:crypto';
import { isSolverStateKey, type SolverPrincipal } from '../../contracts/solver.ts';
import type {
  SolverAuthorization,
  SolverExecutionGate,
  SolverFinalizationInput,
} from '../solver/service.ts';
import type { JobStore, SolverGateDecisionRecord } from './store.ts';

export type SolverConfinementObservation =
  | { status: 'observed'; platform: string; evidenceScope: string; reference: string }
  | { status: 'uncollected'; platform: string; reason: string };

export interface SolverConfinementSource {
  /** A requested confinement mode is never evidence that confinement was observed. */
  observe(evidenceScope: string): Promise<SolverConfinementObservation>;
}

/** No platform has an implicit pass. Without a collector, every platform is named and refused. */
export function uncollectedSolverConfinement(reason: string): SolverConfinementSource {
  requireReason(reason);
  return { async observe() { return { status: 'uncollected', platform: process.platform, reason }; } };
}

export interface SolverCommitAuthorityReader {
  reread(input: { reservationId: string; grantId: string; policyFingerprint: string; threadId: string; principal: SolverPrincipal }):
    | { decision: 'allowed'; authorization: SolverAuthorization }
    | { decision: 'refused'; reason: string }
    | { decision: 'expired'; reason: string };
}

/** No permission state is inferred when a synchronous, non-consuming reader is absent. */
export function unavailableSolverCommitAuthority(reason: string): SolverCommitAuthorityReader {
  requireReason(reason);
  return { reread() { return { decision: 'refused', reason }; } };
}

export type SolverGateDenialCode =
  | 'confinement-evidence-uncollected'
  | 'confinement-evidence-stale'
  | 'state-key-invalid'
  | 'principal-thread-mismatch'
  | 'authority-unavailable'
  | 'binding-missing'
  | 'binding-moved'
  | 'job-not-succeeded';

export type JobSolverExecutionGateOptions = {
  store: JobStore;
  confinement: SolverConfinementSource;
  authority: SolverCommitAuthorityReader;
  /** How long the committed generation lease covers the hashed saved solver. Default 60_000. */
  leaseTtlMs?: number;
  now?: () => number;
  clock?: () => string;
  newLeaseId?: () => string;
  newHandoffToken?: () => string;
};

export function createJobSolverExecutionGate(options: JobSolverExecutionGateOptions): SolverExecutionGate {
  const now = options.now ?? Date.now;
  const clock = options.clock ?? (() => new Date().toISOString());
  const leaseTtlMs = options.leaseTtlMs ?? 60_000;
  const newLeaseId = options.newLeaseId ?? randomUUID;
  const newHandoffToken = options.newHandoffToken ?? (() => randomBytes(32).toString('hex'));
  return {
    durableAtMostOnce: true,
    async prepareCommit(input) {
      const confinement = await options.confinement.observe(input.evidenceScope);
      return {
        commit() {
          const denial = (code: SolverGateDenialCode, reason: string, expired = false) => {
            options.store.recordSolverGateDecision(decisionRecord(input, confinement, clock(), 'denied', code, reason));
            return expired ? { decision: 'expired' as const, reason } : { decision: 'refused' as const, reason };
          };
          if (!isSolverStateKey(input.request.stateKey)) {
            return denial('state-key-invalid', 'The saved-solver view state key is invalid. Nothing was run.');
          }
          if (confinement.status === 'uncollected') {
            return denial('confinement-evidence-uncollected',
              `No saved-solver confinement evidence collector is mounted for ${confinement.platform}, so this host has not observed that a saved solver would run confined. Nothing was run. (${confinement.reason})`);
          }
          if (confinement.evidenceScope !== input.evidenceScope) {
            return denial('confinement-evidence-stale', 'The saved-solver confinement evidence belongs to a different policy scope. Nothing was run.');
          }
          if (input.principal.threadId !== input.context.threadId || input.principal.threadId !== input.source.threadId) {
            return denial('principal-thread-mismatch', 'This saved-solver recompute belongs to a different thread. Nothing was run.');
          }
          const decidedAt = clock();
          const leaseId = newLeaseId();
          const handoffToken = newHandoffToken();
          const expiresAt = new Date(now() + leaseTtlMs).toISOString();
          const authority = options.authority.reread({ reservationId: input.reservationId, grantId: input.request.grantId,
            policyFingerprint: input.policyFingerprint, threadId: input.context.threadId, principal: input.principal });
          if (authority.decision === 'refused') return denial('authority-unavailable', authority.reason);
          if (authority.decision === 'expired') return denial('authority-unavailable', authority.reason, true);
          const result = options.store.commitSolverExecutionClaim({
            ...decisionRecord(input, confinement, decidedAt, 'allowed', 'committed', 'Saved-solver execution claim committed.'),
            jobId: input.context.binding.jobId, attemptId: input.context.binding.attemptId,
            workspaceGeneration: input.workspaceGeneration, profileManifestSha256: input.profileManifestSha256,
            solverSha256: input.solverSha256, handoffToken, leaseId, leaseExpiresAt: expiresAt,
          });
          if (result.decision === 'already-claimed') return result;
          if (result.decision === 'refused') return { decision: 'refused', reason: result.reason };
          return { decision: 'committed', handoffToken, authorization: authority.authorization,
            lease: { leaseId, workspaceGeneration: result.workspaceGeneration,
              profileManifestSha256: input.profileManifestSha256, expiresAt },
            attemptClaim: 'durable-host-journal' };
        },
      };
    },
    releaseClaim(input) {
      options.store.releaseSolverExecutionClaim({ ...input, at: clock() });
      return { decision: 'released' };
    },
  };
}

function decisionRecord(input: SolverFinalizationInput, confinement: SolverConfinementObservation, decidedAt: string,
  decision: SolverGateDecisionRecord['decision'], reasonCode: string, reason: string): SolverGateDecisionRecord {
  return {
    decidedAt, requestIdentity: input.requestIdentity, executionAttemptId: input.executionAttemptId,
    replyVersionId: input.request.replyVersionId, solverId: input.request.solverId,
    siteOrigin: input.principal.siteOrigin, threadId: input.principal.threadId, sessionId: input.principal.sessionId,
    stateKey: input.request.stateKey, decision, reasonCode, reason,
    confinement: confinement.status === 'observed' ? 'observed' : 'uncollected',
    confinementReference: confinement.status === 'observed' ? confinement.reference : null,
    confinementReason: confinement.status === 'uncollected' ? confinement.reason : null,
    policyFingerprint: input.policyFingerprint, evidenceScope: input.evidenceScope, modelTurns: 0,
  };
}

function requireReason(reason: string): void {
  if (!reason.trim()) throw new TypeError('An unavailable saved-solver adapter must say why it is unavailable.');
}
