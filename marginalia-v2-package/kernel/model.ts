import type { ModelBlock } from '../contracts/reply.ts';
import { integrate, type Model, type Trajectory } from './integrate.ts';

/** Runs a validated reply ModelBlock through the bounded local kernel. */
export function runModel(model: ModelBlock, parameters: Record<string, number>, domain?: { stopBefore?: number }): Trajectory {
  let adapted: Model;
  if (model.kind === 'ode') {
    adapted = {
      kind: 'ode', state: model.state, rhs: model.rhs, initial: model.initial,
      horizon: model.horizon, method: model.method, step: model.step,
      maxSteps: model.maxSteps, coordinate: 't', events: model.events, stopBefore: domain?.stopBefore,
    };
  } else {
    adapted = {
      kind: 'map', state: model.state, rhs: model.next, initial: model.initial,
      horizon: model.iterations, maxSteps: model.iterations, coordinate: 'n',
    };
  }
  return integrate(adapted, parameters);
}
