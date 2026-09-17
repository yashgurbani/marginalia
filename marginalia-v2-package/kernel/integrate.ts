import { compileExpression, validName } from './expression.ts';

export type ModelEvent = {
  id: string;
  when: string;
  direction: 'any' | 'rising' | 'falling';
  terminal: boolean;
};

/** Legacy-compatible kernel shape. Contract ModelBlocks are adapted in model.ts. */
export type Model = {
  kind: 'ode' | 'map';
  state: string[];
  rhs: Record<string, string>;
  initial: Record<string, string>;
  horizon: number;
  method?: 'rk4' | 'rk45';
  step?: number;
  maxSteps: number;
  coordinate?: 't' | 'n';
  events?: ModelEvent[];
  /** Independently known mathematical domain endpoint; never candidate authority. */
  stopBefore?: number;
};

export type TrajectoryEvent = {
  id: string;
  time: number;
  bracket: [number, number];
  direction: ModelEvent['direction'];
  terminal: boolean;
};

export type Trajectory = {
  columns: string[];
  rows: number[][];
  end: 'complete' | 'event' | 'limit' | 'undefined';
  message?: string;
  steps: number;
  events?: TrajectoryEvent[];
};

const MAX_VALUE = 1e8;
const MIN_STEP = 1e-10;
const MAX_EVENTS = 512;
const coefficients = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const times = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const fourth = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

function finiteState(values: number[]) {
  return values.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_VALUE);
}

function crossed(before: number, after: number, direction: ModelEvent['direction']) {
  if (direction === 'rising') return before < 0 && after >= 0 || before === 0 && after > 0;
  if (direction === 'falling') return before > 0 && after <= 0 || before === 0 && after < 0;
  return before !== after && (before === 0 || after === 0 || (before < 0 && after > 0) || (before > 0 && after < 0));
}

function eventFraction(before: number, after: number) {
  if (before === 0) return 0;
  if (after === 0) return 1;
  const scale = Math.max(Math.abs(before), Math.abs(after));
  const first = Math.abs(before) / scale;
  return first / (first + Math.abs(after) / scale);
}

export function integrate(model: Model, parameters: Record<string, number>): Trajectory {
  const coordinate = model.coordinate ?? 't';
  if (!['ode', 'map'].includes(model.kind) || model.state.length < 1 || model.state.length > 6 || new Set(model.state).size !== model.state.length || model.state.some(s => !validName(s) || [coordinate, 'pi', 'e'].includes(s) || Object.hasOwn(parameters, s))) throw new Error('Unsupported state definition.');
  if (!Number.isFinite(model.horizon) || model.horizon <= 0 || model.horizon > 10_000 || !Number.isInteger(model.maxSteps) || model.maxSteps < 1 || model.maxSteps > 20_000) throw new Error('Model exceeds computation limits.');
  if (model.kind === 'map' && (!Number.isInteger(model.horizon) || (model.coordinate !== undefined && coordinate !== 'n'))) throw new Error('A map needs whole iterations and the n coordinate.');
  if (model.kind === 'ode' && (!['rk4', 'rk45'].includes(model.method ?? 'rk45') || coordinate !== 't')) throw new Error('Unsupported integration method.');
  if (model.step !== undefined && (!Number.isFinite(model.step) || model.step <= 0 || model.step > 10_000)) throw new Error('The integration step is out of bounds.');
  if (model.stopBefore !== undefined && (!Number.isFinite(model.stopBefore) || model.stopBefore <= 0)) throw new Error('The known mathematical domain endpoint is invalid.');
  if (model.kind === 'map' && model.events?.length) throw new Error('Events are supported only for ODE models.');
  if (Object.keys(parameters).some(s => !validName(s) || [coordinate, 'pi', 'e'].includes(s)) || !Object.values(parameters).every(Number.isFinite)) throw new Error('Invalid parameters.');

  const names = [...Object.keys(parameters), ...model.state, coordinate];
  const rhs = model.state.map(name => compileExpression(model.rhs[name], names));
  let y = model.state.map(name => compileExpression(model.initial[name], Object.keys(parameters))(parameters));
  if (!finiteState(y)) throw new Error('The initial state is outside the calculation range.');
  const eventSpecs = model.events ?? [];
  if (eventSpecs.length > 16 || new Set(eventSpecs.map(event => event.id)).size !== eventSpecs.length) throw new Error('The model has too many events or duplicate event identifiers.');
  if (eventSpecs.some(event => /[<>=!&|]/.test(event.when))) throw new Error('Local event detection supports continuous zero-crossing expressions, not Boolean predicates. Recompute with a supported solver.');
  const eventFunctions = eventSpecs.map(event => compileExpression(event.when, names));
  const stateValues = (at: number, state: number[]) => ({ ...parameters, [coordinate]: at, ...Object.fromEntries(model.state.map((name, i) => [name, state[i]])) });
  const evaluateEvents = (at: number, state: number[]) => eventFunctions.map(fn => fn(stateValues(at, state)));
  const derivative = (at: number, state: number[]) => rhs.map(fn => fn(stateValues(at, state)));
  const combine = (base: number[], k: number[][], weights: number[], step: number) => base.map((value, i) => value + step * weights.reduce((sum, weight, j) => sum + weight * k[j][i], 0));

  let t = 0;
  let h = model.kind === 'map' ? 1 : Math.min(model.step ?? Math.min(model.horizon / 128, 0.05), model.horizon);
  let steps = 0;
  let previousEvents: number[] = [];
  const result: Trajectory = { columns: [coordinate, ...model.state], rows: [[0, ...y]], end: 'complete', steps: 0 };
  const recordedEvents: TrajectoryEvent[] = [];
  const lastEventTimes = new Map<string, number>();

  try {
    previousEvents = evaluateEvents(0, y);
    for (let index = 0; index < eventSpecs.length; index++) {
      if (previousEvents[index] !== 0 || eventSpecs[index].direction !== 'any') continue;
      const event = eventSpecs[index];
      recordedEvents.push({ id: event.id, time: 0, bracket: [0, 0], direction: event.direction, terminal: event.terminal });
      lastEventTimes.set(event.id, 0);
      if (event.terminal) {
        result.end = 'event';
        result.events = recordedEvents;
        result.message = `Terminal event ${event.id} occurred at the initial state. This finite event does not establish long-term behavior.`;
        return result;
      }
    }

    while (t < model.horizon && steps < model.maxSteps) {
      steps++;
      if (!finiteState(y)) {
        result.end = 'limit';
        result.message = 'The curve exceeded the calculation range. This does not establish long-term behavior.';
        break;
      }
      h = Math.min(h, model.horizon - t);
      if (model.stopBefore !== undefined && t + h >= model.stopBefore) {
        result.end = 'limit';
        result.message = 'The next numerical step would reach a known singularity. The curve and event record stop at the last accepted state.';
        break;
      }
      let next: number[];
      let acceptedStep = h;
      if (model.kind === 'map') {
        next = derivative(t, y);
        acceptedStep = 1;
      } else if (model.method === 'rk4') {
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
          if (h < MIN_STEP) {
            result.end = 'limit';
            result.message = 'The calculation needs a smaller step than supported. This does not establish long-term behavior.';
            break;
          }
          continue;
        }
        acceptedStep = h;
        h = Math.min(newStep, model.step ?? model.horizon / 64);
      }

      if (!finiteState(next)) {
        result.end = 'limit';
        result.message = 'The curve exceeded the calculation range. This does not establish long-term behavior.';
        break;
      }

      const beforeTime = t;
      const nextTime = t + acceptedStep;
      const nextEvents = evaluateEvents(nextTime, next);
      const candidates = eventSpecs.flatMap((event, index) => {
        if (!crossed(previousEvents[index], nextEvents[index], event.direction)) return [];
        const fraction = eventFraction(previousEvents[index], nextEvents[index]);
        const time = t + fraction * acceptedStep;
        const last = lastEventTimes.get(event.id);
        if (last !== undefined && Math.abs(time - last) <= Number.EPSILON * Math.max(1, Math.abs(time)) * 8) return [];
        return [{ event, fraction, time }];
      }).sort((a, b) => a.fraction - b.fraction);

      let terminal: (typeof candidates)[number] | undefined;
      let eventBudgetExceeded = false;
      for (const candidate of candidates) {
        if (recordedEvents.length >= MAX_EVENTS) { eventBudgetExceeded = true; break; }
        recordedEvents.push({ id: candidate.event.id, time: candidate.time, bracket: [beforeTime, nextTime], direction: candidate.event.direction, terminal: candidate.event.terminal });
        lastEventTimes.set(candidate.event.id, candidate.time);
        if (candidate.event.terminal) { terminal = candidate; break; }
      }

      if (eventBudgetExceeded) {
        result.end = 'limit';
        result.message = 'The calculation reached its 512-event record limit. The shown trajectory stops at the last accepted state; this does not establish long-term behavior.';
        // Events from the unaccepted step are not part of the displayed trajectory.
        while (recordedEvents.length && recordedEvents.at(-1)!.time > beforeTime) recordedEvents.pop();
        break;
      }

      if (terminal) {
        y = y.map((value, index) => value + terminal!.fraction * (next[index] - value));
        t = terminal.time;
        result.rows.push([t, ...y]);
        result.end = 'event';
        result.message = `Terminal event ${terminal.event.id} occurred near ${t} inside the numerical bracket [${beforeTime}, ${nextTime}]. This finite event does not establish long-term behavior.`;
        break;
      }

      t = nextTime;
      y = next;
      previousEvents = nextEvents;
      result.rows.push([t, ...y]);
    }
  } catch {
    result.end = 'undefined';
    result.message = 'The model is undefined at these inputs. The last finite values are shown.';
  }

  if (t < model.horizon && result.end === 'complete') {
    result.end = 'limit';
    result.message = 'The calculation reached its step limit. This does not establish long-term behavior.';
  }
  result.steps = steps;
  if (recordedEvents.length) result.events = recordedEvents;
  return result;
}
