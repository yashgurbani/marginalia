import { compileExpression, validName } from './expression.ts';

export type Model = { kind: 'ode' | 'map'; state: string[]; rhs: Record<string, string>; initial: Record<string, string>; horizon: number; method?: 'rk4' | 'rk45'; maxSteps: number };
export type Trajectory = { columns: string[]; rows: number[][]; end: 'complete' | 'limit' | 'undefined'; message?: string; steps: number };
const MAX_VALUE = 1e8;
const coefficients = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const times = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const fourth = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

export function integrate(model: Model, parameters: Record<string, number>): Trajectory {
  if (!['ode', 'map'].includes(model.kind) || model.state.length < 1 || model.state.length > 6 || new Set(model.state).size !== model.state.length || model.state.some(s => !validName(s) || ['t', 'pi', 'e'].includes(s) || Object.hasOwn(parameters, s))) throw new Error('Unsupported state definition.');
  if (!Number.isFinite(model.horizon) || model.horizon <= 0 || model.horizon > 1000 || !Number.isInteger(model.maxSteps) || model.maxSteps < 1 || model.maxSteps > 20000) throw new Error('Model exceeds computation limits.');
  if (model.kind === 'map' && !Number.isInteger(model.horizon)) throw new Error('A map needs a whole number of iterations.');
  if (model.kind === 'ode' && !['rk4', 'rk45'].includes(model.method ?? 'rk45')) throw new Error('Unsupported integration method.');
  if (Object.keys(parameters).some(s => !validName(s) || ['t', 'pi', 'e'].includes(s)) || !Object.values(parameters).every(Number.isFinite)) throw new Error('Invalid parameters.');
  const names = [...Object.keys(parameters), ...model.state, 't'];
  const rhs = model.state.map(name => compileExpression(model.rhs[name], names));
  let y = model.state.map(name => compileExpression(model.initial[name], Object.keys(parameters))(parameters));
  let t = 0;
  let h = Math.min(model.horizon / 128, 0.05);
  let steps = 0;
  const result: Trajectory = { columns: ['t', ...model.state], rows: [[0, ...y]], end: 'complete', steps: 0 };
  const derivative = (at: number, state: number[]) => {
    const values = { ...parameters, t: at, ...Object.fromEntries(model.state.map((name, i) => [name, state[i]])) };
    return rhs.map(fn => fn(values));
  };
  const combine = (base: number[], k: number[][], weights: number[], step: number) => base.map((value, i) => value + step * weights.reduce((sum, weight, j) => sum + weight * k[j][i], 0));
  try {
    while (t < model.horizon && steps < model.maxSteps) {
      steps++;
      if (y.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_VALUE)) { result.end = 'limit'; result.message = 'The curve exceeded the calculation range. This does not establish long-term behavior.'; break; }
      h = Math.min(h, model.horizon - t);
      let next: number[];
      if (model.kind === 'map') { next = derivative(t, y); h = 1; }
      else if (model.method === 'rk4') {
        const k1 = derivative(t, y);
        const k2 = derivative(t + h / 2, combine(y, [k1], [0.5], h));
        const k3 = derivative(t + h / 2, combine(y, [k2], [0.5], h));
        const k4 = derivative(t + h, combine(y, [k3], [1], h));
        next = combine(y, [k1, k2, k3, k4], [1 / 6, 1 / 3, 1 / 3, 1 / 6], h);
      } else {
        const k: number[][] = [];
        for (let j = 0; j < 7; j++) k.push(derivative(t + times[j] * h, combine(y, k, coefficients[j], h)));
        next = combine(y, k, coefficients[6], h);
        const low = combine(y, k, fourth, h);
        const error = Math.max(...next.map((value, i) => Math.abs(value - low[i]) / (1e-8 + 1e-6 * Math.max(Math.abs(value), Math.abs(y[i])))));
        const newStep = h * Math.max(0.2, Math.min(3, error === 0 ? 3 : 0.9 * error ** -0.2));
        if (error > 1) {
          h = newStep;
          if (h < 1e-10) { result.end = 'limit'; result.message = 'The calculation needs a smaller step than supported.'; break; }
          continue;
        }
        const acceptedStep = h;
        h = Math.min(newStep, model.horizon / 64);
        if (next.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_VALUE)) { result.end = 'limit'; result.message = 'The curve exceeded the calculation range.'; break; }
        t += acceptedStep; y = next; result.rows.push([t, ...y]); continue;
      }
      if (next.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_VALUE)) { result.end = 'limit'; result.message = 'The curve exceeded the calculation range.'; break; }
      t += h; y = next; result.rows.push([t, ...y]);
    }
  } catch {
    result.end = 'undefined'; result.message = 'The model is undefined at these inputs. The last finite values are shown.';
  }
  if (t < model.horizon && result.end === 'complete') { result.end = 'limit'; result.message = 'The calculation reached its step limit.'; }
  result.steps = steps;
  return result;
}
