import type { SolverOutcome, SolverPlanOutcome, SolverPrincipal } from '../../contracts/solver.ts';
import type { SolverExecutionService } from './service.ts';

/**
 * The composition boundary for T06 and the explicit controls in T05. It is a
 * plain function so it can be mounted by `daemon/server.ts` and tested without
 * a socket. Mounting it is a one-line change in that frozen file; the exact
 * patch is in `docs/evidence/T20/integration.patch`.
 *
 * A margin talks to two endpoints. `POST prepare` asks the host to plan a
 * recompute and returns an opaque plan; `POST recompute` runs one prepared plan
 * after the reader clicks. Preparation starts no process and consumes nothing.
 */
export const SOLVER_ROUTE_PREFIX = '/api/solver/';

export type SolverRouteRequest = {
  method: string;
  pathname: string;
  search?: URLSearchParams;
  body?: unknown;
  /**
   * Caller identity resolved by the host from the paired session that carried
   * this HTTP request. It is never parsed out of the body, and the route refuses
   * every action except `status` without it.
   */
  principal?: SolverPrincipal;
};

export type SolverRouteResponse = {
  status: number;
  body: unknown;
};

export type SolverServiceStatus = {
  available: boolean;
  reason?: string;
  /** Recompute never makes a model turn. This is a structural claim about the path, not a runtime measurement. */
  modelTurns: 0;
  /**
   * True only when a durable host attempt journal is mounted. While it is false,
   * a dispatch is at most once within this process's memory and no further.
   */
  durableAtMostOnce: boolean;
};

/**
 * Every outcome the service produced is returned with status 200, because each
 * one is a real product outcome the margin shows the reader. Non-200 statuses
 * mean the request never reached the service.
 */
function outcomeResponse(outcome: SolverOutcome | SolverPlanOutcome): SolverRouteResponse {
  return { status: 200, body: { outcome } };
}

const NEEDS_PRINCIPAL = { status: 401, body: { error: 'This recompute route needs a paired reader session.' } };

export function createSolverRoutes(service: SolverExecutionService) {
  return async function handleSolverRoute(request: SolverRouteRequest): Promise<SolverRouteResponse | undefined> {
    if (!request.pathname.startsWith(SOLVER_ROUTE_PREFIX)) return undefined;
    const action = request.pathname.slice(SOLVER_ROUTE_PREFIX.length);

    if (action === 'status') {
      if (request.method !== 'GET') return { status: 405, body: { error: 'Use GET for the recompute status.' } };
      const status: SolverServiceStatus = service.configured
        ? { available: true, modelTurns: 0, durableAtMostOnce: service.durableAtMostOnce }
        : {
            available: false,
            reason: service.unavailableReason ?? 'Saved-solver recomputation is not configured.',
            modelTurns: 0,
            durableAtMostOnce: service.durableAtMostOnce,
          };
      return { status: 200, body: status };
    }

    const principal = request.principal;
    if (!principal) return NEEDS_PRINCIPAL;

    if (action === 'prepare') {
      if (request.method !== 'POST') return { status: 405, body: { error: 'Use POST to prepare a recompute.' } };
      return outcomeResponse(await service.prepare(request.body, principal));
    }

    if (action === 'recompute') {
      if (request.method !== 'POST') return { status: 405, body: { error: 'Use POST to request a recompute.' } };
      return outcomeResponse(await service.request(request.body, principal));
    }

    if (action === 'cancel') {
      if (request.method !== 'POST') return { status: 405, body: { error: 'Use POST to cancel a recompute.' } };
      const body = request.body;
      const requestId = typeof body === 'object' && body !== null ? (body as { requestId?: unknown }).requestId : undefined;
      if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)) {
        return { status: 400, body: { error: 'A valid recompute request identity is required.' } };
      }
      return { status: 200, body: service.cancel(requestId, principal) };
    }

    if (action === 'result') {
      if (request.method !== 'GET') return { status: 405, body: { error: 'Use GET to read a recompute outcome.' } };
      const requestId = request.search?.get('requestId') ?? '';
      if (!/^[\w-]{1,100}$/.test(requestId)) {
        return { status: 400, body: { error: 'A valid recompute request identity is required.' } };
      }
      // Re-checked against current authority on every poll, not just at dispatch.
      const outcome = await service.result(requestId, principal);
      if (outcome) return outcomeResponse(outcome);
      return { status: 200, body: { outcome: null, inFlight: service.inFlight(requestId, principal) } };
    }

    return { status: 404, body: { error: 'Unknown recompute route.' } };
  };
}
