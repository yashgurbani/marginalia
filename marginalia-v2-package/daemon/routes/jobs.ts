import type { FollowupJobInput, PrepareFollowupJobInput, PrepareJobInput, PrepareRetryJobInput, RetryJobInput, StartJobInput } from '../../contracts/jobs.ts';
import { prepareConsentForTrustedHost, type ConsentSessionService } from '../consent/index.ts';
import type { JobService } from '../jobs/service.ts';
import type { ApiRouteContext } from './types.ts';

export function createJobRoutes(jobs: JobService, consent: ConsentSessionService, runtimeInitializationError?: string) {
  return async (context: ApiRouteContext) => {
    const { request, response, url, requireCurrentPairing, send, body } = context;
    if (url.pathname === '/api/jobs' && request.method === 'GET') {
      send(response, 200, { configured: jobs.configured, available: jobs.available,
        ...((runtimeInitializationError ?? jobs.unavailableReason) ? { unavailableReason: runtimeInitializationError ?? jobs.unavailableReason } : {}),
        jobs: jobs.list(url.searchParams.get('thread') ?? undefined) }); return true;
    }
    if (url.pathname === '/api/jobs/prepare' && request.method === 'POST') {
      const value = await body(request) as PrepareJobInput;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to review outgoing content.' }); return true; }
      const prepared = await jobs.prepare(value, requireCurrentPairing);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed before consent preparation. Pair again.' }); return true; }
      const result = prepareConsentForTrustedHost(consent, prepared.consent);
      send(response, result.status, { ...(result.body as Record<string, unknown>), job: prepared.job }); return true;
    }
    if (url.pathname === '/api/jobs' && request.method === 'POST') {
      const value = await body(request) as StartJobInput;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to ask for help.' }); return true; }
      send(response, 202, await jobs.create(value, requireCurrentPairing)); return true;
    }
    const jobRoute = /^\/api\/jobs\/([\w-]{1,100})(?:\/(cancel|retry|followups|prepare-retry|prepare-followup))?$/.exec(url.pathname);
    if (!jobRoute) return false;
    const [, jobId, action] = jobRoute;
    if (!action && request.method === 'GET') {
      const job = jobs.get(jobId); send(response, job ? 200 : 404, job ?? { error: 'This work is unavailable.' }); return true;
    }
    if (request.method === 'POST' && action === 'cancel') {
      await body(request);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to change this work.' }); return true; }
      send(response, 200, await jobs.cancel(jobId)); return true;
    }
    if (request.method === 'POST' && action === 'retry') {
      const value = await body(request) as RetryJobInput;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to try this work again.' }); return true; }
      send(response, 202, await jobs.retry(jobId, value, requireCurrentPairing)); return true;
    }
    if (request.method === 'POST' && action === 'prepare-retry') {
      const value = await body(request) as PrepareRetryJobInput;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to review this retry.' }); return true; }
      const prepared = await jobs.prepareRetry(jobId, value, requireCurrentPairing);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed before consent preparation. Pair again.' }); return true; }
      const result = prepareConsentForTrustedHost(consent, prepared.consent);
      send(response, result.status, { ...(result.body as Record<string, unknown>), job: prepared.job }); return true;
    }
    if (request.method === 'POST' && action === 'followups') {
      const value = await body(request) as FollowupJobInput;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to continue this thread.' }); return true; }
      send(response, 202, await jobs.followup(jobId, value, requireCurrentPairing)); return true;
    }
    if (request.method === 'POST' && action === 'prepare-followup') {
      const value = await body(request) as PrepareFollowupJobInput;
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pair with the local helper to review this follow-up.' }); return true; }
      const prepared = await jobs.prepareFollowup(jobId, value, requireCurrentPairing);
      if (!requireCurrentPairing()) { send(response, 401, { error: 'Pairing changed before consent preparation. Pair again.' }); return true; }
      const result = prepareConsentForTrustedHost(consent, prepared.consent);
      send(response, result.status, { ...(result.body as Record<string, unknown>), job: prepared.job }); return true;
    }
    return false;
  };
}

