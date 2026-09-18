import type { SolverExecuteRequest, SolverOutcome, SolverPlan, SolverPlanOutcome, SolverPlanRequest, SolverRejectionCode, SolverResult, SolverUnavailableCode, SOLVER_EXECUTE_SCHEMA, SOLVER_PLAN_REQUEST_SCHEMA, SOLVER_STATE_KEY_INPUT_MAX_BYTES } from '../contracts/solver.ts';
import { isDigest } from '../contracts/digest.ts';
import type { RecomputeRequest } from '../renderer/index.ts';
import type { HelperClient } from './helper.ts';

const PLAN_REQUEST_SCHEMA: typeof SOLVER_PLAN_REQUEST_SCHEMA = 'marginalia.solver-plan-request.v1';
const EXECUTE_SCHEMA: typeof SOLVER_EXECUTE_SCHEMA = 'marginalia.solver-execute.v1';
const MAX_CANONICAL_BYTES: typeof SOLVER_STATE_KEY_INPUT_MAX_BYTES = 256 * 1024 + 16 * 1024;
const REQUEST_ID = /^[\w-]{1,100}$/;

export type RecomputePathId = 'local-kernel' | 'saved-samples' | 'saved-solver' | 'ask-again';
export const RECOMPUTE_PATHS: Readonly<Record<RecomputePathId, string>> = Object.freeze({
  'local-kernel': 'Local kernel: the packaged renderer recalculates here, in this page.',
  'saved-samples': 'Saved samples: values the author recorded, read only inside the bounds they recorded.',
  'saved-solver': 'Saved solver rerun: the local helper reruns a solver a model already wrote. No model turn.',
  'ask-again': 'Ask again: a new model turn you start, after you review exactly what is sent and to whom.',
});

export type SolverRecomputeState =
  | 'idle' | 'succeeded' | 'denied' | 'unconfirmed-confinement'
  | 'unavailable' | 'failed' | 'cancelled' | 'unknown';

export type SolverRecomputeView = {
  path: 'saved-solver';
  state: SolverRecomputeState;
  modelTurns: 0;
  headline: string;
  detail: string;
  result?: SolverResult;
};

export async function solverStateKeyFrom(canonical: string): Promise<string> {
  if (typeof canonical !== 'string' || canonical.length === 0) {
    throw new TypeError('A view state key is computed from a non-empty canonical reply string.');
  }
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.byteLength > MAX_CANONICAL_BYTES) {
    throw new RangeError('The canonical reply string is larger than any validated reply can produce.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function recomputeIdentity(fields: {
  replyVersionId: string; blockId: string; solverId: string; stateKey: string;
}): string {
  return JSON.stringify([fields.replyVersionId, fields.blockId, fields.solverId, fields.stateKey]);
}

export type SolverRecomputeTransport = {
  prepare(request: SolverPlanRequest, signal?: AbortSignal): Promise<SolverPlanOutcome>;
  execute(request: SolverExecuteRequest, signal?: AbortSignal): Promise<SolverOutcome>;
  result(requestId: string, signal?: AbortSignal): Promise<SolverOutcome | null>;
};

export function helperSolverTransport(
  client: Pick<HelperClient, 'prepareSolver' | 'executeSolver' | 'solverResult'>,
): SolverRecomputeTransport {
  return {
    prepare: (request, signal) => client.prepareSolver(request, signal),
    execute: (request, signal) => client.executeSolver(request, signal),
    result: (requestId, signal) => client.solverResult(requestId, signal),
  };
}

const rejectionDetail: Record<SolverRejectionCode, string> = {
  'reply-changed': 'The saved solver, or the reply it belongs to, is no longer the one this result would describe.',
  'unknown-reply': 'The saved solver, or the reply it belongs to, is no longer the one this result would describe.',
  'unknown-solver': 'The saved solver, or the reply it belongs to, is no longer the one this result would describe.',
  'artifact-unknown': 'The saved solver, or the reply it belongs to, is no longer the one this result would describe.',
  'artifact-modified': 'The saved solver, or the reply it belongs to, is no longer the one this result would describe.',
  'path-unsafe': 'The saved solver, or the reply it belongs to, is no longer the one this result would describe.',
  'generation-drift': 'The saved solver, or the reply it belongs to, is no longer the one this result would describe.',
  'authorization-refused': 'You have not granted this recompute, or the grant has expired. Grant it again to run it.',
  'authorization-expired': 'You have not granted this recompute, or the grant has expired. Grant it again to run it.',
  'inputs-invalid': 'The inputs, or what the solver printed, did not fit what this reply declares.',
  'limits-invalid': 'The inputs, or what the solver printed, did not fit what this reply declares.',
  'unsupported-capability': 'The inputs, or what the solver printed, did not fit what this reply declares.',
  'output-invalid': 'The inputs, or what the solver printed, did not fit what this reply declares.',
  'invalid-request': 'The prepared plan no longer matches this request. Run the recompute again.',
  'plan-unknown': 'The prepared plan no longer matches this request. Run the recompute again.',
  'plan-expired': 'The prepared plan no longer matches this request. Run the recompute again.',
  'policy-mismatch': 'The prepared plan no longer matches this request. Run the recompute again.',
  'handoff-refused': 'The prepared plan no longer matches this request. Run the recompute again.',
  'request-identity-mismatch': 'The prepared plan no longer matches this request. Run the recompute again.',
};

const unavailableHeadline: Record<Exclude<SolverUnavailableCode, 'isolation-evidence-unavailable'>, string> = {
  'not-configured': 'Saved-solver recomputation is not set up on this machine. Nothing ran.',
  'platform-unverified': 'This operating system has no reviewed saved-solver policy yet. Nothing ran.',
  'limit-enforcement-unavailable': 'The time and output limits could not be enforced here, so nothing ran.',
  'transport-unavailable': 'The local helper could not start the solver. Nothing ran.',
};

const baseView = (state: SolverRecomputeState, headline: string, detail: string, result?: SolverResult): SolverRecomputeView =>
  ({ path: 'saved-solver', state, modelTurns: 0, headline, detail, ...(result ? { result } : {}) });

function outcomeView(outcome: SolverOutcome | SolverPlanOutcome, stateKey: string): SolverRecomputeView {
  if (outcome.status === 'succeeded') {
    if (!isDigest(stateKey) || !isDigest(outcome.result.stateKey) || outcome.result.stateKey !== stateKey) {
      return baseView('unknown', 'Your inputs changed while this ran, so the result was discarded.',
        'Nothing was painted over your current view. Run it again for these inputs.');
    }
    return outcome.origin === 'execution'
      ? baseView('succeeded', 'The saved solver ran on this machine and returned new values.',
          'No model turn was made. Nothing was sent to a model, and the source is unchanged.', outcome.result)
      : baseView('succeeded', 'This exact question already had an answer on this machine.',
          'The saved values came back without running anything again. No model turn was made.', outcome.result);
  }
  if (outcome.status === 'rejected') {
    const detail = rejectionDetail[outcome.code]
      ?? 'The prepared plan no longer matches this request. Run the recompute again.';
    return baseView('denied', 'The local helper refused this recompute. Nothing ran.', detail);
  }
  if (outcome.status === 'unavailable') {
    if (outcome.code === 'isolation-evidence-unavailable') {
      return baseView('unconfirmed-confinement', 'This machine could not confirm the isolated environment. Nothing ran.',
        'Asking for confinement is not proof of it. The helper reports only what it actually observed, and here it observed nothing it could confirm.');
    }
    return baseView('unavailable', unavailableHeadline[outcome.code],
      'No result was accepted. No model turn was made.');
  }
  if (outcome.status === 'failed') {
    const exit = typeof outcome.exitCode === 'number' && Number.isFinite(outcome.exitCode)
      ? ` It exited with code ${outcome.exitCode}.` : '';
    return baseView('failed', 'The saved solver ran and failed.', `No values were produced. No model turn was made.${exit}`);
  }
  if (outcome.status === 'cancelled') {
    return baseView('cancelled', 'You cancelled this recompute.',
      'The helper may still be stopping the process. No values were accepted.');
  }
  return baseView('unknown', 'The outcome of this recompute is unconfirmed.',
    'It may or may not have run. Nothing was accepted as a result. Running it again reuses the same request, so it cannot run twice.');
}

const unknownView = () => baseView('unknown', 'The outcome of this recompute is unconfirmed.',
  'It may or may not have run. Nothing was accepted as a result. Running it again reuses the same request, so it cannot run twice.');

function matchingPlan(plan: unknown, options: SolverRecomputeOptions, request: RecomputeRequest): plan is SolverPlan {
  if (typeof plan !== 'object' || plan === null) return false;
  const candidate = plan as Partial<SolverPlan>;
  return candidate.schema === 'marginalia.solver-plan.v1' && candidate.modelTurns === 0
    && candidate.replyVersionId === options.replyVersionId && candidate.blockId === request.blockId
    && candidate.solverId === request.solverId && typeof candidate.planId === 'string'
    && typeof candidate.planToken === 'string';
}

function isTransportError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'HelperTransportError' || error.name === 'HelperConnectionChanged');
}

export type SolverRecomputeOptions = {
  transport: SolverRecomputeTransport;
  replyVersionId: string;
  newRequestId?: () => string;
  now?: () => string;
};

export type SolverRecompute = {
  run(request: RecomputeRequest, signal?: AbortSignal): Promise<SolverRecomputeView>;
  idle(): SolverRecomputeView;
  forget(): void;
};

export function createSolverRecompute(options: SolverRecomputeOptions): SolverRecompute {
  const ids = new Map<string, string>();
  const attempted = new Set<string>();
  const inFlight = new Map<string, Promise<SolverRecomputeView>>();
  const clear = (identity: string) => { ids.delete(identity); attempted.delete(identity); };
  const finish = (identity: string, outcome: SolverOutcome | SolverPlanOutcome, stateKey: string) => {
    if (outcome.status !== 'outcome_unknown') clear(identity);
    return outcomeView(outcome, stateKey);
  };

  return {
    run(request, signal) {
      const flightIdentity = recomputeIdentity({ replyVersionId: options.replyVersionId,
        blockId: request.blockId, solverId: request.solverId, stateKey: request.stateKey });
      const active = inFlight.get(flightIdentity);
      if (active) return active;
      const work = (async (): Promise<SolverRecomputeView> => {
        const stateKey = await solverStateKeyFrom(request.stateKey);
        const identity = recomputeIdentity({ replyVersionId: options.replyVersionId,
          blockId: request.blockId, solverId: request.solverId, stateKey });
        let requestId = ids.get(identity);
        if (!requestId) {
          requestId = REQUEST_ID.test(request.requestId) ? request.requestId
            : (options.newRequestId?.() ?? globalThis.crypto.randomUUID());
          ids.set(identity, requestId);
        }
        if (attempted.has(identity)) {
          try {
            const earlier = await options.transport.result(requestId!, signal);
            if (earlier) return finish(identity, earlier, stateKey);
          } catch (error) {
            if (!isTransportError(error)) return unknownView();
          }
        }
        attempted.add(identity);
        let planned: SolverPlanOutcome;
        try {
          planned = await options.transport.prepare({ schema: PLAN_REQUEST_SCHEMA,
            replyVersionId: options.replyVersionId, blockId: request.blockId, solverId: request.solverId,
            inputs: request.parameters, stateKey }, signal);
        } catch { return unknownView(); }
        if (planned.status !== 'planned') return finish(identity, planned, stateKey);
        if (!matchingPlan(planned.plan, options, request)) {
          clear(identity);
          return baseView('denied', 'The prepared plan does not match what you asked for, so nothing ran.',
            'Run the recompute again to prepare a matching plan.');
        }
        try {
          const outcome = await options.transport.execute({ schema: EXECUTE_SCHEMA, requestId: requestId!,
            planId: planned.plan.planId, planToken: planned.plan.planToken, replyVersionId: options.replyVersionId,
            blockId: request.blockId, solverId: request.solverId, inputs: request.parameters, stateKey,
            requestedAt: (options.now ?? (() => new Date().toISOString()))() }, signal);
          return finish(identity, outcome, stateKey);
        } catch { return unknownView(); }
      })();
      inFlight.set(flightIdentity, work);
      void work.finally(() => {
        if (inFlight.get(flightIdentity) === work) inFlight.delete(flightIdentity);
      }).catch(() => {});
      return work;
    },
    idle: () => baseView('idle', 'Nothing has been recomputed yet.',
      'This runs only when you click Recompute. Selecting text, reopening this reply, reconnecting the helper and recovering a session never run it.'),
    forget() { ids.clear(); attempted.clear(); inFlight.clear(); },
  };
}

export function renderRecomputeOutcome(doc: Document, view: SolverRecomputeView): HTMLElement {
  const section = doc.createElement('section'); section.className = 'm-recompute';
  section.dataset.path = view.path; section.dataset.state = view.state;
  const path = doc.createElement('p'); path.className = 'm-meta';
  path.textContent = `Path used: ${RECOMPUTE_PATHS['saved-solver']}`;
  const headline = doc.createElement('p'); headline.setAttribute('role', 'status'); headline.textContent = view.headline;
  const detail = doc.createElement('p'); detail.className = 'm-meta'; detail.textContent = view.detail;
  const unused = doc.createElement('p'); unused.className = 'm-meta';
  unused.textContent = `Not used: ${RECOMPUTE_PATHS['local-kernel']} ${RECOMPUTE_PATHS['saved-samples']} ${RECOMPUTE_PATHS['ask-again']}`;
  section.append(path, headline, detail, unused);
  return section;
}

export function mountSolverRecompute(container: HTMLElement, client: HelperClient, replyVersionId: string) {
  const recompute = createSolverRecompute({ transport: helperSolverTransport(client), replyVersionId });
  return {
    onRecompute: async (request: RecomputeRequest) => {
      const view = await recompute.run(request);
      if (!container.isConnected) return;
      const previous = container.querySelector<HTMLElement>('.m-recompute');
      const rendered = renderRecomputeOutcome(container.ownerDocument, view);
      if (previous) previous.replaceWith(rendered); else container.append(rendered);
    },
    forget: () => recompute.forget(),
  };
}
