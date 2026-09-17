import { computeIndependentChecks, type CandidateReply, type IndependentCheckResult } from '../contracts/reply.ts';
import type { JsonValue } from '../contracts/reader.ts';
import { compileExpression } from '../kernel/expression.ts';
import { runModel } from '../kernel/model.ts';
import type { Trajectory } from '../kernel/integrate.ts';
import type { interpolateSamples } from '../kernel/samples.ts';

export type RendererState = { parameters: Record<string, number>; view: Record<string, JsonValue> };
export type Calculation<T> = { ok: true; value: T } | { ok: false; reason: string };
export type ReplyCalculation = {
  models: Map<string, Calculation<Trajectory>>;
  derived: Map<string, Calculation<number>>;
  samples: Map<string, ReturnType<typeof interpolateSamples>>;
  checks: IndependentCheckResult[];
};

/** Reader state is separate from, and never written into, the authored reply. */
export function initialRendererState(reply: CandidateReply, initial?: Partial<RendererState>): RendererState {
  const parameters: Record<string, number> = {};
  for (const p of reply.parameters) {
    const value = initial?.parameters?.[p.name];
    parameters[p.name] = typeof value === 'number' && Number.isFinite(value) && value >= p.min && value <= p.max ? value : p.default;
  }
  // Only this renderer's bounded scalar view preferences are restored.
  const view: Record<string, JsonValue> = {};
  let remainingText = 256 * 1024;
  const entries = Object.entries(initial?.view ?? {}).sort(([a], [b]) => Number(/^(draft$|answerDraft:|assumption:)/.test(b)) - Number(/^(draft$|answerDraft:|assumption:)/.test(a)));
  for (const [key, value] of entries.slice(0, 1024)) {
    if (key.length > 128) continue;
    if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) view[key] = value;
    else if (typeof value === 'string') {
      const limit = key === 'draft' ? 8192 : key.startsWith('assumption:') ? 2048 : 512;
      const restored = value.slice(0, Math.min(limit, remainingText)); remainingText -= restored.length; view[key] = restored;
    }
  }
  return { parameters, view };
}

export function calculateReply(reply: CandidateReply, parameters: Record<string, number>): ReplyCalculation {
  const models: ReplyCalculation['models'] = new Map();
  const derived: ReplyCalculation['derived'] = new Map();
  const samples: ReplyCalculation['samples'] = new Map();
  const independentChecks = computeIndependentChecks(reply, parameters);
  let remainingSteps = 40_000;
  for (const block of reply.blocks) {
    try {
      if (block.type === 'model') {
        if (remainingSteps < 1 || block.kind === 'map' && block.iterations > remainingSteps) models.set(block.id, { ok: false, reason: 'This reply reached its shared local computation budget. Explicit recomputation is required.' });
        else {
          const known = independentChecks.find(check => check.model === block.id && check.status === 'pass' && check.outcome?.kind === 'diverges');
          const stopBefore = known?.outcome?.kind === 'diverges' ? known.outcome.time : undefined;
          const value = runModel(block.kind === 'ode' ? { ...block, maxSteps: Math.min(block.maxSteps, remainingSteps) } : block, parameters, { stopBefore });
          remainingSteps -= value.steps;
          models.set(block.id, { ok: true, value });
        }
      }
      if (block.type === 'derived') {
        if (Object.keys(parameters).some(name => name === 'pi' || name === 'e')) throw new Error('A declared parameter conflicts with a mathematical constant; this calculation is unavailable.');
        if (block.model && !reply.blocks.some(model => model.id === block.model && model.type === 'model')) throw new Error('This quantity does not reference a declared model.');
        const value = compileExpression(block.expression, Object.keys(parameters))(parameters);
        derived.set(block.id, Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'This quantity is undefined for these inputs.' });
      }
      if (block.type === 'samples') {
        if (!reply.blocks.some(model => model.id === block.model && model.type === 'model')) throw new Error('These samples do not reference a declared model. Their recorded grid remains available, but no current result is inferred.');
        samples.set(block.id, { ok: false, reason: 'The sample generation binding is being checked. The recorded grid remains available below.' });
      }
    } catch (error) {
      const failure = { ok: false as const, reason: error instanceof Error ? error.message : 'The calculation could not finish.' };
      if (block.type === 'model') models.set(block.id, failure);
      if (block.type === 'derived') derived.set(block.id, failure);
      if (block.type === 'samples') samples.set(block.id, failure);
    }
  }
  const checks = independentChecks.map(check => {
    if (check.status !== 'pass') return check;
    const model = reply.blocks.find(b => b.id === check.model);
    const request = reply.checks.find(c => c.id === check.requestId);
    let reason: string | undefined;
    if (model?.type !== 'model' || model.kind !== 'ode' || model.events?.length) reason = 'This local criterion does not support event-modified models.';
    else if (!models.get(model.id)?.ok) reason = 'The declared model could not be admitted by the local kernel.';
    else if (request) {
      const unit = (role: string) => reply.parameters.find(p => p.name === request.inputs[role])?.unit;
      if (unit('gamma') !== '1/s' || !['1/s²', '1/s^2'].includes(unit('f') ?? '') || unit('y0') !== '1/s') reason = 'This criterion requires damping and start in 1/s, and forcing in 1/s². Other unit interpretations are not verified.';
    }
    if (!check.outcome || !Number.isFinite(check.outcome.kind === 'diverges' ? check.outcome.time : check.outcome.value)) reason = 'The exact result exceeds the supported numeric range.';
    return reason ? { ...check, status: 'unsupported' as const, reason, headline: undefined, outcome: undefined } : check;
  });
  // Even an overly large RK4 step must never display a continuation past a known pole.
  // A recognized mathematical pole remains a domain boundary even when units or
  // events make the separate classification presentation unsupported.
  for (const check of independentChecks) {
    if (check.status !== 'pass' || check.outcome?.kind !== 'diverges') continue;
    const result = models.get(check.model); if (!result?.ok) continue;
    const time = check.outcome.time;
    if (result.value.rows.some(row => row[0] >= time) || result.value.events?.some(event => event.time >= time)) models.set(check.model, { ok: true, value: { ...result.value, rows: result.value.rows.filter(row => row[0] < time), events: result.value.events?.filter(event => event.time < time), end: 'limit', message: 'The plotted curve stops before the independently calculated singularity. Values and events beyond it are not a continuation of this solution.' } });
  }
  return { models, derived, samples, checks };
}

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : 'undefined';
}
