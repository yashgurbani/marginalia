import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { RpcTransport } from '../providers/stdio.ts';
import type { ReaderStore } from '../store.ts';
import type { Pairing } from '../pairing.ts';
import type { ConsentSessionService } from '../consent/index.ts';
import type { JobService } from '../jobs/service.ts';
import { createJobSolverArtifactBindings } from '../jobs/solver-bindings.ts';
import { createJobSolverExecutionGate, uncollectedSolverConfinement, unavailableSolverCommitAuthority } from '../jobs/solver-gate.ts';
import { createSolverRoutes, SolverExecutionService, createConsentSolverAuthority, createStoreSolverContextSource,
  createConfinementEvidenceCollector, unavailableSolverEvidence, type SolverCommandTransport } from '../solver/index.ts';
import type { ApiRouteContext } from './types.ts';

type LaunchFailureAwareTransport = SolverCommandTransport & { lastLaunchFailureReason(): string | undefined };
const launchFailureReason = (transport: SolverCommandTransport) => {
  const candidate = transport as Partial<LaunchFailureAwareTransport>;
  return typeof candidate.lastLaunchFailureReason === 'function' ? candidate.lastLaunchFailureReason() : undefined;
};

export function createServerSolver(input: { database: string; store: ReaderStore; jobs: JobService; consent: ConsentSessionService;
  solverTransport?: SolverCommandTransport; solverRpc?: Pick<RpcTransport, 'request'>; solverProbeRoot?: string }) {
  const confinementEvidence = input.solverTransport && input.solverProbeRoot
    ? createConfinementEvidenceCollector({ transport: input.solverTransport, probeRoot: input.solverProbeRoot,
        ...(input.solverRpc ? { rpc: input.solverRpc } : {}) }) : undefined;
  const evidence = confinementEvidence ? {
    collect: confinementEvidence.collect.bind(confinementEvidence),
    issues: () => {
      const issues = confinementEvidence.issues(), failure = launchFailureReason(input.solverTransport!);
      return failure ? [...issues, `solver-transport-unavailable:${failure}`] : issues;
    },
  } : unavailableSolverEvidence('No saved-solver command transport is available.');
  return new SolverExecutionService({
    context: createStoreSolverContextSource({ replies: input.store, jobs: input.jobs.store,
      bindings: createJobSolverArtifactBindings(input.jobs.store), limits: { timeoutMs: 5_000, maxOutputBytes: 65_536 } }),
    authority: createConsentSolverAuthority({ permissions: input.consent, jobs: input.jobs.store }),
    gate: createJobSolverExecutionGate({ store: input.jobs.store,
      confinement: uncollectedSolverConfinement(`No saved-solver confinement evidence collector is mounted for ${process.platform}.`),
      authority: unavailableSolverCommitAuthority('No synchronous saved-solver permission re-read is mounted, so no recompute is committed.') }),
    evidence, transport: input.solverTransport, codexHome: resolve(dirname(input.database), 'solver-codex-home'), auditId: randomUUID(),
    unavailableReason: input.solverTransport ? undefined : 'No saved-solver command transport is available.',
  });
}

export function createSolverRouteHandler(solver: SolverExecutionService, store: ReaderStore, pairing: Pairing) {
  const handle = createSolverRoutes(solver);
  return async (context: ApiRouteContext) => {
    const { request, response, url, authOrigin, token, body, send } = context;
    if (!url.pathname.startsWith('/api/solver/')) return false;
    const solverBody = request.method === 'POST' ? await body(request) : undefined;
    let paired = pairing.session(token, authOrigin);
    if (!paired) { send(response, 401, { error: 'Pair with the local helper to recompute saved work.' }); return true; }
    const action = url.pathname.slice('/api/solver/'.length);
    if (action === 'prepare' || action === 'recompute') {
      const replyVersionId = solverBody && typeof solverBody === 'object' && !Array.isArray(solverBody)
        ? (solverBody as { replyVersionId?: unknown }).replyVersionId : undefined;
      const reply = typeof replyVersionId === 'string' ? store.reply(replyVersionId) : undefined;
      if (!reply || reply.deletedAt || store.get(reply.threadId)?.deletedAt) {
        send(response, 404, { error: 'This reply is unavailable.' }); return true;
      }
      paired = pairing.bindThread(token, authOrigin, reply.threadId);
      if (!paired) { send(response, 401, { error: 'Pair with the local helper to recompute saved work.' }); return true; }
    }
    const principal = paired.threadId ? { siteOrigin: authOrigin, threadId: paired.threadId, sessionId: paired.sessionId } : undefined;
    const handled = await handle({ method: request.method ?? 'GET', pathname: url.pathname, search: url.searchParams, body: solverBody, principal });
    if (handled) send(response, handled.status, handled.body);
    return !!handled;
  };
}

