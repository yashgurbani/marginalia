import { isDeepStrictEqual } from 'node:util';
import type { ProviderHandle, ProviderRequest } from '../../contracts/job-runner.ts';
import type { JobConsentAuthority, JobSnapshot } from '../../contracts/jobs.ts';
import { JobConflictError, type JobStore } from './store.ts';

/** One prepared request and one final transaction. A process crash after commit but before
 * write is still unknown; no database transaction can atomically commit an external stream. */
export function prepareSendCheckpoint(store: JobStore, expectedJob: Readonly<JobSnapshot>, request: ProviderRequest,
  consent: JobConsentAuthority, eligibilityFingerprint: string, admit?: () => boolean) {
  const expected = structuredClone(expectedJob), exactRequest = structuredClone(request), attemptId = request.jobId;
  consent.assertSharedDatabase(store.db);
  let used = false;
  return Object.freeze({ finalize(incoming: ProviderRequest, handle: ProviderHandle): ProviderHandle {
    if (used) throw new JobConflictError('This prepared provider send was already finalized.');
    used = true;
    if (!isDeepStrictEqual(incoming, exactRequest) || handle.jobId !== attemptId || handle.provider !== expected.provider ||
      handle.workspace !== exactRequest.workspace || handle.policyKey !== exactRequest.policyKey ||
      handle.model !== exactRequest.model || handle.mode !== exactRequest.mode || handle.tombstone ||
      handle.state !== 'starting' || handle.turnId || handle.output !== undefined || handle.revision !== undefined ||
      !handle.providerInstanceId || !/^[\w-]{1,100}$/.test(handle.providerInstanceId)) {
      throw new JobConflictError('The prepared provider identity or payload changed.');
    }
    return store.db.transaction(() => {
      if (admit && admit() !== true) throw new JobConflictError('Pairing changed before provider send. Pair again.');
      store.withDispatchHandoff(expected, attemptId, consent,
        current => consent.finalizeDispatch(current, attemptId, eligibilityFingerprint));
      // Nested checkpoint/lease errors roll back grant, egress and handoff as one unit.
      return store.checkpoint(attemptId, structuredClone(handle));
    })();
  } });
}
