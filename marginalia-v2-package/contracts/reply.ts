import { compileExpression, validName } from '../kernel/expression.ts';
import { classifyGrowth, growthSentence, type GrowthConclusion, type GrowthInputs } from '../kernel/growth.ts';

export const REPLY_SCHEMA = 'marginalia.reply.v1' as const;
export const REPLY_LIMITS = Object.freeze({
  bytes: 256 * 1024,
  depth: 16,
  totalArrayItems: 2_000,
  blocks: 64,
  parameters: 32,
  sourceBindings: 64,
  assumptions: 64,
  limitations: 64,
  checks: 64,
  string: 16_384,
});

export type Intent = 'define' | 'simulate' | 'instantiate' | 'derive' | 'diagram' | 'evidence' | 'explore' | 'unsure';
export type ReplyStatus = 'partial' | 'complete';
export type SourceRelation = 'quoted' | 'computed' | 'interpreted' | 'analogy' | 'fetched';
export type ReplyCapability = 'samples' | 'solver' | 'media.audio' | 'media.image' | 'media.video' | 'network.citations' | 'network.shelf';

export type TextSelector = { exact: string; prefix?: string; suffix?: string };
export type SourceBinding = { name: string; meaning: string; relation: SourceRelation; selector: TextSelector };
export type Parameter = { name: string; label: string; default: number; min: number; max: number; unit: string };
export type Assumption = { id: string; text: string; editable: boolean };
export type CandidateCheck = {
  id: string;
  criterion: string;
  model: string;
  classification: string;
  inputs: Record<string, string>;
};

type BlockBase = { id: string; type: string };
export type TextBlock = BlockBase & { type: 'text'; md: string };
export type EquationBlock = BlockBase & { type: 'equation'; tex: string };
export type OdeModelBlock = BlockBase & {
  type: 'model'; kind: 'ode'; state: string[]; rhs: Record<string, string>; initial: Record<string, string>;
  horizon: number; method: 'rk4' | 'rk45'; step?: number; maxSteps: number;
  events?: { id: string; when: string; direction: 'any' | 'rising' | 'falling'; terminal: boolean }[];
};
export type MapModelBlock = BlockBase & {
  type: 'model'; kind: 'map'; state: string[]; next: Record<string, string>; initial: Record<string, string>;
  iterations: number;
};
export type ModelBlock = OdeModelBlock | MapModelBlock;
export type PlotBlock = BlockBase & {
  type: 'plot'; from: string; x: string; y: string[]; xRange?: [number, number]; yRange?: [number, number]; labels: Record<string, string>;
};
export type DerivedBlock = BlockBase & { type: 'derived'; name: string; expression: string; unit: string; label: string; model?: string };
export type ClassificationBlock = BlockBase & {
  type: 'classification'; model: string; headline: boolean; rule: string; check?: string;
  labels: Record<string, string>;
};
export type TableBlock = BlockBase & { type: 'table'; columns: { key: string; label: string; unit?: string }[]; rows: Record<string, string | number | boolean | null>[] };
export type DiagramBlock = BlockBase & {
  type: 'diagram';
  nodes: { id: string; label: string; binding?: string }[];
  edges: { id: string; from: string; to: string; label?: string }[];
  groups?: { id: string; label: string; nodes: string[] }[];
};
export type StepsBlock = BlockBase & { type: 'steps'; steps: { id: string; text?: string; tex?: string }[] };
export type CompareBlock = BlockBase & { type: 'compare'; variants: { id: string; label: string; blocks: string[] }[] };
export type QuestionBlock = BlockBase & { type: 'question'; prompt: string; answers: { id: string; label: string; value: string }[]; allowFreeText: boolean };
export type TurnBlock = BlockBase & { type: 'turn'; version: number; text: string; inReplyTo?: string };
export type CitationsBlock = BlockBase & {
  type: 'citations'; entries: { id: string; claim: string; support: string; source: string; date: string; fetched: boolean; url?: string }[];
};
export type ShelfBlock = BlockBase & { type: 'shelf'; items: { id: string; title: string; reason: string; url: string; timecodeSeconds?: number }[] };
export type SamplesBlock = BlockBase & {
  type: 'samples'; model: string;
  envelope: {
    axes: { name: string; min: number; max: number; count: number }[];
    /** Values held constant when this grid was generated. Optional only for persisted v1 compatibility. */
    fixedInputs?: Record<string, number>;
    interpolation: 'nearest' | 'linear'; errorEvidence: string;
    forbiddenRegions: { expression: string; reason: string }[];
  };
  samples: { at: Record<string, number>; values: Record<string, number> }[];
};
export type SolverBlock = BlockBase & { type: 'solver'; path: string; inputNames: string[]; outputBlocks: string[] };
export type MediaBlock = BlockBase & {
  type: 'media'; kind: 'audio' | 'image' | 'video'; url: string; alt?: string; transcript?: string;
  timecodes?: { seconds: number; label: string }[];
};

export type ReplyBlock = TextBlock | EquationBlock | ModelBlock | PlotBlock | DerivedBlock | ClassificationBlock |
  TableBlock | DiagramBlock | StepsBlock | CompareBlock | QuestionBlock | TurnBlock | CitationsBlock | ShelfBlock |
  SamplesBlock | SolverBlock | MediaBlock;

export type CandidateReply = {
  schema: typeof REPLY_SCHEMA;
  intent: Intent;
  status: ReplyStatus;
  title: string;
  summary: string;
  illustration?: { value: boolean; statement: string };
  sourceBindings: SourceBinding[];
  parameters: Parameter[];
  assumptions: Assumption[];
  limitations: string[];
  requiredCapabilities?: ReplyCapability[];
  blocks: ReplyBlock[];
  checks: CandidateCheck[];
  staticFallback: string;
};

export type ValidationContext = { sourceText: string; capabilities?: readonly ReplyCapability[] };
export type ValidationResult = { ok: true; value: CandidateReply; errors: [] } | { ok: false; errors: string[] };
export type ReplyParameterState = Readonly<Record<string, number>>;
export type IndependentCheckResult = {
  requestId: string;
  criterion: string;
  model: string;
  classification: string;
  /** A numerical pass can retain domain limits while headline admission is withheld. */
  status: 'pass' | 'fail' | 'unsupported';
  reason: string;
  outcome?: GrowthConclusion;
  /** Present only when shared admission permits a sentence; never grants host authority. */
  headline?: string;
};

const intents = new Set<Intent>(['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure']);
const statuses = new Set<ReplyStatus>(['partial', 'complete']);
const relations = new Set<SourceRelation>(['quoted', 'computed', 'interpreted', 'analogy', 'fetched']);
const capabilities = new Set<ReplyCapability>(['samples', 'solver', 'media.audio', 'media.image', 'media.video', 'network.citations', 'network.shelf']);

/** All intents carry samples; evidence adds citations, explore adds shelf, and simulate adds solver so readers can explicitly recompute saved solvers without model turns. */
export function capabilitiesForIntent(intent: Intent): readonly ReplyCapability[] {
  if (intent === 'simulate') return ['samples', 'solver'];
  if (intent === 'evidence') return ['samples', 'network.citations'];
  if (intent === 'explore') return ['samples', 'network.shelf'];
  return ['samples'];
}

const blockTypes = new Set(['text', 'equation', 'model', 'plot', 'derived', 'classification', 'table', 'diagram', 'steps', 'compare', 'question', 'turn', 'citations', 'shelf', 'samples', 'solver', 'media']);
const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const criterionName = /^[a-z][a-z0-9-]{0,63}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const rawHtml = /<\s*\/?\s*[a-z!][^>]*>/i;
const codeOrTemplate = /(?:```|`{3}|\$\{|\{\{)/;
const dangerousInlineUrl = /(?:javascript|data|file|blob|vbscript):/i;
const remoteMarkdownImage = /!\s*\[[^\]]*\]\s*\(/;
const unsafeTexCommand = /\\(?:html\w*|href|url|includegraphics|class|style|data|def|gdef|newcommand)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[], required: readonly string[] = allowed) {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) if (!set.has(key)) errors.push(`${path}.${key}: unknown field.`);
  for (const key of required) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required field is missing.`);
}

function stringValue(value: unknown, path: string, errors: string[], options: { max?: number; empty?: boolean; safeText?: boolean } = {}): value is string {
  if (typeof value !== 'string') { errors.push(`${path}: expected a string.`); return false; }
  if ((!options.empty && value.length === 0) || value.length > (options.max ?? REPLY_LIMITS.string)) errors.push(`${path}: string length is out of bounds.`);
  if (options.safeText && rawHtml.test(value)) errors.push(`${path}: raw HTML is not allowed.`);
  if (options.safeText && codeOrTemplate.test(value)) errors.push(`${path}: code fences and template syntax are not allowed.`);
  if (options.safeText && dangerousInlineUrl.test(value)) errors.push(`${path}: dangerous URL schemes are not allowed.`);
  if (options.safeText && remoteMarkdownImage.test(value)) errors.push(`${path}: Markdown cannot embed remote media.`);
  return true;
}

function texValue(value: unknown, path: string, errors: string[], max = 4096): value is string {
  if (!stringValue(value, path, errors, { max })) return false;
  if (rawHtml.test(value)) errors.push(`${path}: raw HTML is not allowed.`);
  if (unsafeTexCommand.test(value)) errors.push(`${path}: renderer-affecting TeX commands are not allowed.`);
  return true;
}

function idValue(value: unknown, path: string, errors: string[]): value is string {
  if (!stringValue(value, path, errors, { max: 64 })) return false;
  if (!identifier.test(value)) errors.push(`${path}: expected a bounded identifier.`);
  return identifier.test(value);
}

function finite(value: unknown, path: string, errors: string[], min = -1e12, max = 1e12): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path}: expected a finite number from ${min} through ${max}.`);
    return false;
  }
  return true;
}

function arrayValue(value: unknown, path: string, errors: string[], max: number, min = 0): value is unknown[] {
  if (!Array.isArray(value)) { errors.push(`${path}: expected an array.`); return false; }
  if (value.length > max) errors.push(`${path}: array exceeds the ${max}-item limit.`);
  if (value.length < min) errors.push(`${path}: array requires at least ${min} item(s).`);
  // Keep checking present items even when cardinality is invalid.
  return true;
}

function objectValue(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (!isRecord(value)) { errors.push(`${path}: expected a plain object.`); return false; }
  return true;
}

function validateJsonShape(value: unknown, errors: string[]) {
  const stack: { value: unknown; depth: number; path: string }[] = [{ value, depth: 0, path: '$' }];
  const seen = new Set<object>();
  let arrayItems = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > REPLY_LIMITS.depth) { errors.push(`${item.path}: object nesting exceeds ${REPLY_LIMITS.depth}.`); continue; }
    if (typeof item.value === 'string' && item.value.length > REPLY_LIMITS.string) errors.push(`${item.path}: string exceeds ${REPLY_LIMITS.string} characters.`);
    else if (typeof item.value === 'number' && !Number.isFinite(item.value)) errors.push(`${item.path}: numbers must be finite.`);
    else if (typeof item.value === 'undefined' || typeof item.value === 'function' || typeof item.value === 'symbol' || typeof item.value === 'bigint') errors.push(`${item.path}: value is not JSON data.`);
    else if (item.value && typeof item.value === 'object') {
      if (seen.has(item.value)) { errors.push(`${item.path}: cyclic objects are not valid JSON.`); continue; }
      seen.add(item.value);
      if (Array.isArray(item.value)) {
        arrayItems += item.value.length;
        if (arrayItems > REPLY_LIMITS.totalArrayItems) { errors.push(`$: arrays exceed the total ${REPLY_LIMITS.totalArrayItems}-item limit.`); return; }
        // Indexed traversal also rejects sparse-array holes as non-JSON values.
        for (let index = 0; index < item.value.length; index++) stack.push({ value: item.value[index], depth: item.depth + 1, path: `${item.path}[${index}]` });
      } else if (isRecord(item.value)) {
        for (const [key, child] of Object.entries(item.value)) stack.push({ value: child, depth: item.depth + 1, path: `${item.path}.${key}` });
      } else errors.push(`${item.path}: expected JSON objects with a plain prototype.`);
    }
  }
}

function validateExpression(source: unknown, names: readonly string[], path: string, errors: string[]) {
  if (!stringValue(source, path, errors, { max: 1024 })) return;
  try { compileExpression(source, names); } catch (error) { errors.push(`${path}: ${error instanceof Error ? error.message : 'invalid expression'}`); }
}

function privateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a === 192 && b === 168 ||
    a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 100 && b >= 64 && b <= 127;
}

/** Receives only the canonical bracketed IPv6 hostname produced by URL. */
function privateIpv6(host: string): boolean {
  const halves = host.slice(1, -1).split('::');
  const words = (part: string) => part ? part.split(':').map(word => Number.parseInt(word, 16)) : [];
  const left = words(halves[0]);
  const right = halves.length === 2 ? words(halves[1]) : [];
  const address = halves.length === 2 ? [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right] : left;
  if (address.length !== 8 || address.some(word => !Number.isInteger(word) || word < 0 || word > 0xffff)) return true;
  if (address.slice(0, 7).every(word => word === 0) && address[7] <= 1) return true; // unspecified / loopback
  if ((address[0] & 0xfe00) === 0xfc00 || (address[0] & 0xffc0) === 0xfe80) return true;
  // URL serializes both dotted and hexadecimal IPv4-mapped forms as hextets.
  if (address.slice(0, 5).every(word => word === 0) && address[5] === 0xffff) {
    return privateIpv4([address[6] >>> 8, address[6] & 255, address[7] >>> 8, address[7] & 255]);
  }
  return false;
}

function validateUrl(value: unknown, path: string, errors: string[]) {
  if (!stringValue(value, path, errors, { max: 2048 })) return;
  let url: URL;
  try { url = new URL(value); } catch { errors.push(`${path}: invalid URL.`); return; }
  if (url.protocol !== 'https:') errors.push(`${path}: only HTTPS URLs are allowed.`);
  if (url.username || url.password) errors.push(`${path}: URL credentials are not allowed.`);
  const host = url.hostname.toLowerCase();
  const name = host.replace(/\.$/, '');
  const local = host.startsWith('[') ? privateIpv6(host) :
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ? privateIpv4(host.split('.').map(Number)) :
    name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal');
  if (local) errors.push(`${path}: local and private destinations are not allowed.`);
  // DNS resolution, redirects and actual network enforcement belong to T13.
}

function validateSelector(selector: unknown, sourceText: string, path: string, errors: string[]) {
  if (!objectValue(selector, path, errors)) return;
  const errorsBefore = errors.length;
  keys(selector, ['exact', 'prefix', 'suffix'], path, errors, ['exact']);
  if (!stringValue(selector.exact, `${path}.exact`, errors, { max: 4_000 })) return;
  if (Object.hasOwn(selector, 'prefix')) stringValue(selector.prefix, `${path}.prefix`, errors, { max: 256, empty: true });
  if (Object.hasOwn(selector, 'suffix')) stringValue(selector.suffix, `${path}.suffix`, errors, { max: 256, empty: true });
  // stringValue records length errors but is primarily a type guard. Never search invalid text.
  if (errors.length !== errorsBefore) return;
  const exact = selector.exact;
  const prefix = typeof selector.prefix === 'string' ? selector.prefix : '';
  const suffix = typeof selector.suffix === 'string' ? selector.suffix : '';
  let from = 0;
  let matched = false;
  // Each unsuccessful match advances, and the search position is bounded by the source.
  while (from <= sourceText.length - exact.length) {
    const at = sourceText.indexOf(exact, from);
    if (at < 0) break;
    const before = sourceText.slice(Math.max(0, at - prefix.length), at);
    const after = sourceText.slice(at + exact.length, at + exact.length + suffix.length);
    if ((!prefix || before === prefix) && (!suffix || after === suffix)) { matched = true; break; }
    from = at + 1;
  }
  if (!matched) errors.push(`${path}: selector does not match the supplied source text.`);
}

function validateNamedExpressionMap(value: unknown, state: string[], names: string[], path: string, errors: string[]) {
  if (!objectValue(value, path, errors)) return;
  const stateSet = new Set(state);
  for (const key of Object.keys(value)) if (!stateSet.has(key)) errors.push(`${path}.${key}: key is not a declared state variable.`);
  for (const name of state) {
    if (!Object.hasOwn(value, name)) errors.push(`${path}.${name}: expression is required for each state variable.`);
    else validateExpression(value[name], names, `${path}.${name}`, errors);
  }
}

function validateBlock(block: unknown, index: number, parameterNames: string[], sourceNames: Set<string>, errors: string[]): ReplyBlock | undefined {
  const path = `$.blocks[${index}]`;
  if (!objectValue(block, path, errors)) return;
  if (!idValue(block.id, `${path}.id`, errors)) return;
  if (typeof block.type !== 'string' || !blockTypes.has(block.type)) { errors.push(`${path}.type: unsupported block type.`); return; }
  const common = ['id', 'type'];
  switch (block.type) {
    case 'text':
      keys(block, [...common, 'md'], path, errors); stringValue(block.md, `${path}.md`, errors, { safeText: true }); break;
    case 'equation':
      keys(block, [...common, 'tex'], path, errors); texValue(block.tex, `${path}.tex`, errors); break;
    case 'model': {
      const kind = block.kind;
      if (kind === 'ode') keys(block, [...common, 'kind', 'state', 'rhs', 'initial', 'horizon', 'method', 'step', 'maxSteps', 'events'], path, errors, [...common, 'kind', 'state', 'rhs', 'initial', 'horizon', 'method', 'maxSteps']);
      else if (kind === 'map') keys(block, [...common, 'kind', 'state', 'next', 'initial', 'iterations'], path, errors);
      else { errors.push(`${path}.kind: expected ode or map.`); break; }
      const state: string[] = [];
      if (arrayValue(block.state, `${path}.state`, errors, 6, 1)) block.state.forEach((name, n) => { if (idValue(name, `${path}.state[${n}]`, errors) && validName(name)) state.push(name); else if (typeof name === 'string' && !validName(name)) errors.push(`${path}.state[${n}]: invalid mathematical name.`); });
      const allNames = [...parameterNames, ...state, ...(kind === 'ode' ? ['t'] : ['n'])];
      if (kind === 'ode') {
        validateNamedExpressionMap(block.rhs, state, allNames, `${path}.rhs`, errors);
        validateNamedExpressionMap(block.initial, state, parameterNames, `${path}.initial`, errors);
        finite(block.horizon, `${path}.horizon`, errors, 1e-9, 1e6);
        if (block.method !== 'rk4' && block.method !== 'rk45') errors.push(`${path}.method: expected rk4 or rk45.`);
        if (Object.hasOwn(block, 'step')) finite(block.step, `${path}.step`, errors, 1e-9, 1e4);
        if (!finite(block.maxSteps, `${path}.maxSteps`, errors, 1, 20_000) || !Number.isInteger(block.maxSteps)) errors.push(`${path}.maxSteps: expected an integer.`);
        if (Object.hasOwn(block, 'events') && arrayValue(block.events, `${path}.events`, errors, 16)) block.events.forEach((event, n) => {
          const p = `${path}.events[${n}]`; if (!objectValue(event, p, errors)) return;
          keys(event, ['id', 'when', 'direction', 'terminal'], p, errors); idValue(event.id, `${p}.id`, errors); validateExpression(event.when, allNames, `${p}.when`, errors);
          if (typeof event.direction !== 'string' || !['any', 'rising', 'falling'].includes(event.direction)) errors.push(`${p}.direction: invalid direction.`);
          if (typeof event.terminal !== 'boolean') errors.push(`${p}.terminal: expected a boolean.`);
        });
      } else {
        validateNamedExpressionMap(block.next, state, allNames, `${path}.next`, errors);
        validateNamedExpressionMap(block.initial, state, parameterNames, `${path}.initial`, errors);
        if (!finite(block.iterations, `${path}.iterations`, errors, 1, 10_000) || !Number.isInteger(block.iterations)) errors.push(`${path}.iterations: expected an integer.`);
      }
      break;
    }
    case 'plot':
      keys(block, [...common, 'from', 'x', 'y', 'xRange', 'yRange', 'labels'], path, errors, [...common, 'from', 'x', 'y', 'labels']);
      idValue(block.from, `${path}.from`, errors); idValue(block.x, `${path}.x`, errors);
      if (arrayValue(block.y, `${path}.y`, errors, 6, 1)) block.y.forEach((name, n) => idValue(name, `${path}.y[${n}]`, errors));
      for (const key of ['xRange', 'yRange'] as const) if (Object.hasOwn(block, key)) validateRange(block[key], `${path}.${key}`, errors);
      validateStringMap(block.labels, `${path}.labels`, errors, 16); break;
    case 'derived':
      keys(block, [...common, 'name', 'expression', 'unit', 'label', 'model'], path, errors, [...common, 'name', 'expression', 'unit', 'label']);
      idValue(block.name, `${path}.name`, errors); validateExpression(block.expression, parameterNames, `${path}.expression`, errors);
      stringValue(block.unit, `${path}.unit`, errors, { max: 64, empty: true }); stringValue(block.label, `${path}.label`, errors, { max: 256, safeText: true });
      if (Object.hasOwn(block, 'model')) idValue(block.model, `${path}.model`, errors); break;
    case 'classification':
      keys(block, [...common, 'model', 'headline', 'rule', 'check', 'labels'], path, errors, [...common, 'model', 'headline', 'rule', 'labels']);
      idValue(block.model, `${path}.model`, errors); if (typeof block.headline !== 'boolean') errors.push(`${path}.headline: expected a boolean.`);
      stringValue(block.rule, `${path}.rule`, errors, { max: 512, safeText: true });
      if (Object.hasOwn(block, 'check')) idValue(block.check, `${path}.check`, errors);
      validateStringMap(block.labels, `${path}.labels`, errors, 16, true); break;
    case 'table':
      keys(block, [...common, 'columns', 'rows'], path, errors);
      if (arrayValue(block.columns, `${path}.columns`, errors, 32, 1)) block.columns.forEach((column, n) => { const p = `${path}.columns[${n}]`; if (!objectValue(column, p, errors)) return; keys(column, ['key', 'label', 'unit'], p, errors, ['key', 'label']); idValue(column.key, `${p}.key`, errors); stringValue(column.label, `${p}.label`, errors, { max: 256, safeText: true }); if (Object.hasOwn(column, 'unit')) stringValue(column.unit, `${p}.unit`, errors, { max: 64, empty: true }); });
      if (arrayValue(block.rows, `${path}.rows`, errors, 200)) block.rows.forEach((row, n) => { if (!objectValue(row, `${path}.rows[${n}]`, errors)) return; for (const [key, value] of Object.entries(row)) { if (!identifier.test(key) || !['string', 'number', 'boolean'].includes(typeof value) && value !== null) errors.push(`${path}.rows[${n}].${key}: invalid table cell.`); if (typeof value === 'string') stringValue(value, `${path}.rows[${n}].${key}`, errors, { max: 2048, safeText: true }); } });
      break;
    case 'diagram':
      validateDiagram(block, path, sourceNames, errors); break;
    case 'steps':
      keys(block, [...common, 'steps'], path, errors); if (arrayValue(block.steps, `${path}.steps`, errors, 64, 1)) block.steps.forEach((step, n) => { const p = `${path}.steps[${n}]`; if (!objectValue(step, p, errors)) return; keys(step, ['id', 'text', 'tex'], p, errors, ['id']); idValue(step.id, `${p}.id`, errors); if (Object.hasOwn(step, 'text')) stringValue(step.text, `${p}.text`, errors, { max: 2048, safeText: true }); if (Object.hasOwn(step, 'tex')) texValue(step.tex, `${p}.tex`, errors, 2048); if (!Object.hasOwn(step, 'text') && !Object.hasOwn(step, 'tex')) errors.push(`${p}: a text or tex value is required.`); }); break;
    case 'compare':
      keys(block, [...common, 'variants'], path, errors); if (arrayValue(block.variants, `${path}.variants`, errors, 8, 2)) block.variants.forEach((variant, n) => { const p = `${path}.variants[${n}]`; if (!objectValue(variant, p, errors)) return; keys(variant, ['id', 'label', 'blocks'], p, errors); idValue(variant.id, `${p}.id`, errors); stringValue(variant.label, `${p}.label`, errors, { max: 256, safeText: true }); validateIdArray(variant.blocks, `${p}.blocks`, errors, 32); }); break;
    case 'question':
      keys(block, [...common, 'prompt', 'answers', 'allowFreeText'], path, errors); stringValue(block.prompt, `${path}.prompt`, errors, { max: 1024, safeText: true }); if (typeof block.allowFreeText !== 'boolean') errors.push(`${path}.allowFreeText: expected a boolean.`);
      if (arrayValue(block.answers, `${path}.answers`, errors, 12)) block.answers.forEach((answer, n) => { const p = `${path}.answers[${n}]`; if (!objectValue(answer, p, errors)) return; keys(answer, ['id', 'label', 'value'], p, errors); idValue(answer.id, `${p}.id`, errors); stringValue(answer.label, `${p}.label`, errors, { max: 256, safeText: true }); stringValue(answer.value, `${p}.value`, errors, { max: 512, safeText: true }); }); break;
    case 'turn':
      keys(block, [...common, 'version', 'text', 'inReplyTo'], path, errors, [...common, 'version', 'text']); if (!finite(block.version, `${path}.version`, errors, 1, 1e9) || !Number.isInteger(block.version)) errors.push(`${path}.version: expected an integer.`); stringValue(block.text, `${path}.text`, errors, { max: 8192, safeText: true }); if (Object.hasOwn(block, 'inReplyTo')) idValue(block.inReplyTo, `${path}.inReplyTo`, errors); break;
    case 'citations':
      keys(block, [...common, 'entries'], path, errors); if (arrayValue(block.entries, `${path}.entries`, errors, 64)) block.entries.forEach((entry, n) => { const p = `${path}.entries[${n}]`; if (!objectValue(entry, p, errors)) return; keys(entry, ['id', 'claim', 'support', 'source', 'date', 'fetched', 'url'], p, errors, ['id', 'claim', 'support', 'source', 'date', 'fetched']); idValue(entry.id, `${p}.id`, errors); for (const key of ['claim', 'support', 'source'] as const) stringValue(entry[key], `${p}.${key}`, errors, { max: 4096, safeText: true }); if (!stringValue(entry.date, `${p}.date`, errors, { max: 10 }) || !datePattern.test(entry.date)) errors.push(`${p}.date: expected YYYY-MM-DD.`); if (typeof entry.fetched !== 'boolean') errors.push(`${p}.fetched: expected a boolean.`); if (Object.hasOwn(entry, 'url')) validateUrl(entry.url, `${p}.url`, errors); }); break;
    case 'shelf':
      keys(block, [...common, 'items'], path, errors); if (arrayValue(block.items, `${path}.items`, errors, 5)) block.items.forEach((item, n) => { const p = `${path}.items[${n}]`; if (!objectValue(item, p, errors)) return; keys(item, ['id', 'title', 'reason', 'url', 'timecodeSeconds'], p, errors, ['id', 'title', 'reason', 'url']); idValue(item.id, `${p}.id`, errors); stringValue(item.title, `${p}.title`, errors, { max: 512, safeText: true }); stringValue(item.reason, `${p}.reason`, errors, { max: 1024, safeText: true }); validateUrl(item.url, `${p}.url`, errors); if (Object.hasOwn(item, 'timecodeSeconds')) finite(item.timecodeSeconds, `${p}.timecodeSeconds`, errors, 0, 1e8); }); break;
    case 'samples':
      validateSamples(block, path, parameterNames, errors); break;
    case 'solver':
      keys(block, [...common, 'path', 'inputNames', 'outputBlocks'], path, errors); validateSafePath(block.path, `${path}.path`, errors); validateIdArray(block.inputNames, `${path}.inputNames`, errors, 32); validateIdArray(block.outputBlocks, `${path}.outputBlocks`, errors, 32); break;
    case 'media':
      keys(block, [...common, 'kind', 'url', 'alt', 'transcript', 'timecodes'], path, errors, [...common, 'kind', 'url']); if (typeof block.kind !== 'string' || !['audio', 'image', 'video'].includes(block.kind)) errors.push(`${path}.kind: invalid media kind.`); validateUrl(block.url, `${path}.url`, errors); if (Object.hasOwn(block, 'alt')) stringValue(block.alt, `${path}.alt`, errors, { max: 1024, safeText: true }); if (Object.hasOwn(block, 'transcript')) stringValue(block.transcript, `${path}.transcript`, errors, { max: 16_384, safeText: true }); if (!Object.hasOwn(block, 'alt') && !Object.hasOwn(block, 'transcript')) errors.push(`${path}: media requires alt text or a transcript.`); if (Object.hasOwn(block, 'timecodes') && arrayValue(block.timecodes, `${path}.timecodes`, errors, 200)) block.timecodes.forEach((timecode, n) => { const p = `${path}.timecodes[${n}]`; if (!objectValue(timecode, p, errors)) return; keys(timecode, ['seconds', 'label'], p, errors); finite(timecode.seconds, `${p}.seconds`, errors, 0, 1e8); stringValue(timecode.label, `${p}.label`, errors, { max: 512, safeText: true }); }); break;
  }
  return block as ReplyBlock;
}

function validateRange(value: unknown, path: string, errors: string[]) {
  if (!arrayValue(value, path, errors, 2, 2)) return;
  const valid = value.map((item, index) => finite(item, `${path}[${index}]`, errors));
  if (value.length === 2 && valid.every(Boolean) && (value[0] as number) >= (value[1] as number)) errors.push(`${path}: lower bound must be below upper bound.`);
}

function validateStringMap(value: unknown, path: string, errors: string[], max: number, noPlaceholders = false) {
  if (!objectValue(value, path, errors)) return;
  const entries = Object.entries(value); if (entries.length > max) errors.push(`${path}: object exceeds ${max} entries.`);
  for (const [key, item] of entries) {
    if (!identifier.test(key)) errors.push(`${path}.${key}: invalid key.`);
    if (stringValue(item, `${path}.${key}`, errors, { max: 1024, safeText: true }) && noPlaceholders && /\{[^}]+\}/.test(item)) errors.push(`${path}.${key}: classification labels cannot contain templates.`);
  }
}

function validateIdArray(value: unknown, path: string, errors: string[], max: number) {
  if (arrayValue(value, path, errors, max)) value.forEach((item, n) => idValue(item, `${path}[${n}]`, errors));
}

function validateDiagram(block: Record<string, unknown>, path: string, sourceNames: Set<string>, errors: string[]) {
  keys(block, ['id', 'type', 'nodes', 'edges', 'groups'], path, errors, ['id', 'type', 'nodes', 'edges']);
  const nodeIds = new Set<string>();
  if (arrayValue(block.nodes, `${path}.nodes`, errors, 100)) block.nodes.forEach((node, n) => { const p = `${path}.nodes[${n}]`; if (!objectValue(node, p, errors)) return; keys(node, ['id', 'label', 'binding'], p, errors, ['id', 'label']); if (idValue(node.id, `${p}.id`, errors)) { if (nodeIds.has(node.id)) errors.push(`${p}.id: duplicate node id.`); nodeIds.add(node.id); } stringValue(node.label, `${p}.label`, errors, { max: 512, safeText: true }); if (Object.hasOwn(node, 'binding') && idValue(node.binding, `${p}.binding`, errors) && !sourceNames.has(node.binding)) errors.push(`${p}.binding: unknown source binding.`); });
  const edgeIds = new Set<string>();
  if (arrayValue(block.edges, `${path}.edges`, errors, 200)) block.edges.forEach((edge, n) => { const p = `${path}.edges[${n}]`; if (!objectValue(edge, p, errors)) return; keys(edge, ['id', 'from', 'to', 'label'], p, errors, ['id', 'from', 'to']); if (idValue(edge.id, `${p}.id`, errors)) { if (edgeIds.has(edge.id)) errors.push(`${p}.id: duplicate edge id.`); edgeIds.add(edge.id); } for (const key of ['from', 'to'] as const) if (idValue(edge[key], `${p}.${key}`, errors) && !nodeIds.has(edge[key])) errors.push(`${p}.${key}: unknown diagram node.`); if (Object.hasOwn(edge, 'label')) stringValue(edge.label, `${p}.label`, errors, { max: 512, safeText: true }); });
  if (Object.hasOwn(block, 'groups') && arrayValue(block.groups, `${path}.groups`, errors, 32)) block.groups.forEach((group, n) => { const p = `${path}.groups[${n}]`; if (!objectValue(group, p, errors)) return; keys(group, ['id', 'label', 'nodes'], p, errors); idValue(group.id, `${p}.id`, errors); stringValue(group.label, `${p}.label`, errors, { max: 512, safeText: true }); if (arrayValue(group.nodes, `${p}.nodes`, errors, 100)) group.nodes.forEach((node, i) => { if (idValue(node, `${p}.nodes[${i}]`, errors) && !nodeIds.has(node)) errors.push(`${p}.nodes[${i}]: unknown diagram node.`); }); });
}

function validateSamples(block: Record<string, unknown>, path: string, parameterNames: string[], errors: string[]) {
  keys(block, ['id', 'type', 'model', 'envelope', 'samples'], path, errors); idValue(block.model, `${path}.model`, errors);
  const axes: string[] = [];
  if (objectValue(block.envelope, `${path}.envelope`, errors)) {
    const envelope = block.envelope; keys(envelope, ['axes', 'fixedInputs', 'interpolation', 'errorEvidence', 'forbiddenRegions'], `${path}.envelope`, errors, ['axes', 'interpolation', 'errorEvidence', 'forbiddenRegions']);
    if (arrayValue(envelope.axes, `${path}.envelope.axes`, errors, 6, 1)) envelope.axes.forEach((axis, n) => { const p = `${path}.envelope.axes[${n}]`; if (!objectValue(axis, p, errors)) return; keys(axis, ['name', 'min', 'max', 'count'], p, errors); if (idValue(axis.name, `${p}.name`, errors)) { if (axes.includes(axis.name)) errors.push(`${p}.name: duplicate sample axis.`); axes.push(axis.name); if (!parameterNames.includes(axis.name)) errors.push(`${p}.name: unknown parameter.`); } const min = finite(axis.min, `${p}.min`, errors); const max = finite(axis.max, `${p}.max`, errors); if (min && max && (axis.min as number) >= (axis.max as number)) errors.push(`${p}: min must be below max.`); if (!finite(axis.count, `${p}.count`, errors, 2, 200) || !Number.isInteger(axis.count)) errors.push(`${p}.count: expected an integer.`); });
    if (Object.hasOwn(envelope, 'fixedInputs') && objectValue(envelope.fixedInputs, `${path}.envelope.fixedInputs`, errors)) {
      const fixedNames = Object.keys(envelope.fixedInputs);
      if (fixedNames.length > REPLY_LIMITS.parameters) errors.push(`${path}.envelope.fixedInputs: object exceeds ${REPLY_LIMITS.parameters} entries.`);
      for (const [name, value] of Object.entries(envelope.fixedInputs)) {
        if (!identifier.test(name)) errors.push(`${path}.envelope.fixedInputs.${name}: invalid name.`);
        if (!parameterNames.includes(name)) errors.push(`${path}.envelope.fixedInputs.${name}: unknown parameter.`);
        if (axes.includes(name)) errors.push(`${path}.envelope.fixedInputs.${name}: fixed inputs and axes must be disjoint.`);
        finite(value, `${path}.envelope.fixedInputs.${name}`, errors);
      }
      for (const parameter of parameterNames) if (!axes.includes(parameter) && !Object.hasOwn(envelope.fixedInputs, parameter)) errors.push(`${path}.envelope.fixedInputs.${parameter}: every non-axis parameter requires its generation value.`);
    }
    if (envelope.interpolation !== 'nearest' && envelope.interpolation !== 'linear') errors.push(`${path}.envelope.interpolation: invalid interpolation method.`);
    stringValue(envelope.errorEvidence, `${path}.envelope.errorEvidence`, errors, { max: 4096, safeText: true });
    if (arrayValue(envelope.forbiddenRegions, `${path}.envelope.forbiddenRegions`, errors, 32)) envelope.forbiddenRegions.forEach((region, n) => { const p = `${path}.envelope.forbiddenRegions[${n}]`; if (!objectValue(region, p, errors)) return; keys(region, ['expression', 'reason'], p, errors); validateExpression(region.expression, axes, `${p}.expression`, errors); stringValue(region.reason, `${p}.reason`, errors, { max: 1024, safeText: true }); });
  }
  if (arrayValue(block.samples, `${path}.samples`, errors, 500)) block.samples.forEach((sample, n) => { const p = `${path}.samples[${n}]`; if (!objectValue(sample, p, errors)) return; keys(sample, ['at', 'values'], p, errors); for (const field of ['at', 'values'] as const) if (objectValue(sample[field], `${p}.${field}`, errors)) for (const [key, value] of Object.entries(sample[field])) { if (!identifier.test(key)) errors.push(`${p}.${field}.${key}: invalid name.`); finite(value, `${p}.${field}.${key}`, errors); } if (isRecord(sample.at)) { for (const axis of axes) if (!Object.hasOwn(sample.at, axis)) errors.push(`${p}.at.${axis}: every sample must locate each axis.`); for (const key of Object.keys(sample.at)) if (!axes.includes(key)) errors.push(`${p}.at.${key}: undeclared sample axis.`); } });
}

function validateSafePath(value: unknown, path: string, errors: string[]) {
  if (!stringValue(value, path, errors, { max: 256 })) return;
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..') || !/^[A-Za-z0-9._/-]+$/.test(value)) errors.push(`${path}: solver path must be a safe relative workspace path.`);
}

function requiredCapability(block: ReplyBlock): ReplyCapability | undefined {
  if (block.type === 'samples') return 'samples'; if (block.type === 'solver') return 'solver';
  if (block.type === 'citations') return 'network.citations'; if (block.type === 'shelf') return 'network.shelf';
  if (block.type === 'media') return `media.${block.kind}` as ReplyCapability;
  return undefined;
}

export function validateReply(input: unknown, context: ValidationContext): ValidationResult {
  try { return validateReplyData(input, context); }
  catch { return { ok: false, errors: ['$: candidate could not be read as plain JSON data.'] }; }
}

function validateReplyData(input: unknown, context: ValidationContext): ValidationResult {
  const errors: string[] = [];
  if (typeof context?.sourceText !== 'string') return { ok: false, errors: ['context.sourceText: expected the captured source text.'] };
  validateJsonShape(input, errors);
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  if (!objectValue(input, '$', errors)) return { ok: false, errors };
  keys(input, ['schema', 'intent', 'status', 'title', 'summary', 'illustration', 'sourceBindings', 'parameters', 'assumptions', 'limitations', 'requiredCapabilities', 'blocks', 'checks', 'staticFallback'], '$', errors, ['schema', 'intent', 'status', 'title', 'summary', 'sourceBindings', 'parameters', 'assumptions', 'limitations', 'blocks', 'checks', 'staticFallback']);
  if (input.schema !== REPLY_SCHEMA) errors.push('$.schema: unsupported reply schema.');
  if (!intents.has(input.intent as Intent)) errors.push('$.intent: unsupported intent.');
  if (!statuses.has(input.status as ReplyStatus)) errors.push('$.status: expected partial or complete.');
  stringValue(input.title, '$.title', errors, { max: 256, safeText: true });
  stringValue(input.summary, '$.summary', errors, { max: 1024, safeText: true });
  if (Object.hasOwn(input, 'illustration')) {
    if (objectValue(input.illustration, '$.illustration', errors)) { keys(input.illustration, ['value', 'statement'], '$.illustration', errors); if (typeof input.illustration.value !== 'boolean') errors.push('$.illustration.value: expected a boolean.'); stringValue(input.illustration.statement, '$.illustration.statement', errors, { max: 1024, safeText: true }); }
  }
  const sourceNames = new Set<string>();
  if (arrayValue(input.sourceBindings, '$.sourceBindings', errors, REPLY_LIMITS.sourceBindings)) input.sourceBindings.forEach((binding, n) => { const p = `$.sourceBindings[${n}]`; if (!objectValue(binding, p, errors)) return; keys(binding, ['name', 'meaning', 'relation', 'selector'], p, errors); if (idValue(binding.name, `${p}.name`, errors)) { if (sourceNames.has(binding.name)) errors.push(`${p}.name: duplicate source binding.`); sourceNames.add(binding.name); } stringValue(binding.meaning, `${p}.meaning`, errors, { max: 512, safeText: true }); if (!relations.has(binding.relation as SourceRelation)) errors.push(`${p}.relation: invalid source relation.`); validateSelector(binding.selector, context.sourceText, `${p}.selector`, errors); });
  const parameterNames: string[] = [];
  if (arrayValue(input.parameters, '$.parameters', errors, REPLY_LIMITS.parameters)) input.parameters.forEach((parameter, n) => { const p = `$.parameters[${n}]`; if (!objectValue(parameter, p, errors)) return; keys(parameter, ['name', 'label', 'default', 'min', 'max', 'unit'], p, errors); if (idValue(parameter.name, `${p}.name`, errors) && validName(parameter.name)) { if (parameterNames.includes(parameter.name)) errors.push(`${p}.name: duplicate parameter.`); parameterNames.push(parameter.name); } else if (typeof parameter.name === 'string' && !validName(parameter.name)) errors.push(`${p}.name: invalid mathematical name.`); stringValue(parameter.label, `${p}.label`, errors, { max: 256, safeText: true }); const min = finite(parameter.min, `${p}.min`, errors); const max = finite(parameter.max, `${p}.max`, errors); const def = finite(parameter.default, `${p}.default`, errors); if (min && max && (parameter.min as number) >= (parameter.max as number)) errors.push(`${p}: min must be below max.`); if (min && max && def && ((parameter.default as number) < (parameter.min as number) || (parameter.default as number) > (parameter.max as number))) errors.push(`${p}.default: value is outside parameter bounds.`); stringValue(parameter.unit, `${p}.unit`, errors, { max: 64, empty: true }); });
  if (arrayValue(input.assumptions, '$.assumptions', errors, REPLY_LIMITS.assumptions)) { const ids = new Set<string>(); input.assumptions.forEach((assumption, n) => { const p = `$.assumptions[${n}]`; if (!objectValue(assumption, p, errors)) return; keys(assumption, ['id', 'text', 'editable'], p, errors); if (idValue(assumption.id, `${p}.id`, errors)) { if (ids.has(assumption.id)) errors.push(`${p}.id: duplicate assumption id.`); ids.add(assumption.id); } stringValue(assumption.text, `${p}.text`, errors, { max: 2048, safeText: true }); if (typeof assumption.editable !== 'boolean') errors.push(`${p}.editable: expected a boolean.`); }); }
  if (arrayValue(input.limitations, '$.limitations', errors, REPLY_LIMITS.limitations)) input.limitations.forEach((item, n) => stringValue(item, `$.limitations[${n}]`, errors, { max: 2048, safeText: true }));
  const declaredCapabilities = new Set<ReplyCapability>();
  if (Object.hasOwn(input, 'requiredCapabilities') && arrayValue(input.requiredCapabilities, '$.requiredCapabilities', errors, capabilities.size)) input.requiredCapabilities.forEach((item, n) => { if (!capabilities.has(item as ReplyCapability)) errors.push(`$.requiredCapabilities[${n}]: unknown capability.`); else declaredCapabilities.add(item as ReplyCapability); });
  const blocks: ReplyBlock[] = [];
  const blockIds = new Set<string>();
  if (arrayValue(input.blocks, '$.blocks', errors, REPLY_LIMITS.blocks, 1)) input.blocks.forEach((block, n) => { const parsed = validateBlock(block, n, parameterNames, sourceNames, errors); if (parsed) { if (blockIds.has(parsed.id)) errors.push(`$.blocks[${n}].id: duplicate block id.`); blockIds.add(parsed.id); blocks.push(parsed); } });
  const checks: CandidateCheck[] = [];
  const checkIds = new Set<string>();
  if (arrayValue(input.checks, '$.checks', errors, REPLY_LIMITS.checks)) input.checks.forEach((check, n) => { const p = `$.checks[${n}]`; if (!objectValue(check, p, errors)) return; keys(check, ['id', 'criterion', 'model', 'classification', 'inputs'], p, errors); if (idValue(check.id, `${p}.id`, errors)) { if (checkIds.has(check.id)) errors.push(`${p}.id: duplicate check id.`); checkIds.add(check.id); } if (!stringValue(check.criterion, `${p}.criterion`, errors, { max: 64 }) || !criterionName.test(check.criterion)) errors.push(`${p}.criterion: invalid criterion name.`); idValue(check.model, `${p}.model`, errors); idValue(check.classification, `${p}.classification`, errors); validateStringMap(check.inputs, `${p}.inputs`, errors, 16); checks.push(check as CandidateCheck); });
  stringValue(input.staticFallback, '$.staticFallback', errors, { max: 8192, safeText: true });

  // Cross-reference traversal requires structurally valid nested collections.
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  for (const [index, block] of blocks.entries()) {
    const path = `$.blocks[${index}]`;
    const cap = requiredCapability(block);
    if (cap && !declaredCapabilities.has(cap)) errors.push(`${path}: block requires declared capability ${cap}.`);
    if (cap && context.capabilities && !context.capabilities.includes(cap)) errors.push(`${path}: capability ${cap} is unavailable.`);
    if ('from' in block && !blockIds.has(block.from)) errors.push(`${path}.from: unknown block reference.`);
    if ('model' in block && typeof block.model === 'string' && !blockIds.has(block.model)) errors.push(`${path}.model: unknown model reference.`);
    if (block.type === 'samples' && blocks.find((candidate) => candidate.id === block.model)?.type !== 'model') errors.push(`${path}.model: expected a model block reference.`);
    if (block.type === 'compare') for (const [v, variant] of block.variants.entries()) for (const [b, reference] of variant.blocks.entries()) if (!blockIds.has(reference) || reference === block.id) errors.push(`${path}.variants[${v}].blocks[${b}]: invalid block reference.`);
    if (block.type === 'solver') for (const [b, reference] of block.outputBlocks.entries()) if (!blockIds.has(reference) || reference === block.id) errors.push(`${path}.outputBlocks[${b}]: invalid block reference.`);
    if (block.type === 'classification' && block.check && !checkIds.has(block.check)) errors.push(`${path}.check: unknown requested check.`);
  }
  if (blocks.filter((block) => block.type === 'question').length > 1) errors.push('$.blocks: a reply may contain at most one clarifying question.');
  for (const [index, check] of checks.entries()) {
    if (!blockIds.has(check.model) || blocks.find((block) => block.id === check.model)?.type !== 'model') errors.push(`$.checks[${index}].model: expected a model block reference.`);
    if (!blockIds.has(check.classification) || blocks.find((block) => block.id === check.classification)?.type !== 'classification') errors.push(`$.checks[${index}].classification: expected a classification block reference.`);
    for (const [role, parameter] of Object.entries(check.inputs)) if (!parameterNames.includes(parameter)) errors.push(`$.checks[${index}].inputs.${role}: unknown parameter.`);
  }
  const byteLength = (() => { try { return new TextEncoder().encode(JSON.stringify(input)).byteLength; } catch { return REPLY_LIMITS.bytes + 1; } })();
  if (byteLength > REPLY_LIMITS.bytes) errors.push(`$: reply exceeds the ${REPLY_LIMITS.bytes}-byte limit.`);
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, value: input as CandidateReply, errors: [] };
}

export function parseAndValidateReply(json: string, context: ValidationContext): ValidationResult {
  if (typeof json !== 'string') return { ok: false, errors: ['$: expected JSON text.'] };
  if (new TextEncoder().encode(json).byteLength > REPLY_LIMITS.bytes) return { ok: false, errors: [`$: reply exceeds the ${REPLY_LIMITS.bytes}-byte limit.`] };
  let input: unknown;
  try { input = JSON.parse(json); } catch (error) { return { ok: false, errors: [`$: invalid JSON: ${error instanceof Error ? error.message : 'parse failure'}`] }; }
  return validateReply(input, context);
}

/** Stable JSON serialization shared by browser recomputation and host report sealing. */
export function canonicalReplyData(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical data must contain finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalReplyData).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalReplyData(record[key])}`).join(',')}}`;
  }
  throw new Error('Canonical data must be JSON.');
}

function independentFailure(request: CandidateCheck, reason: string): IndependentCheckResult {
  return { requestId: request.id, criterion: request.criterion, model: request.model, classification: request.classification, status: 'fail', reason };
}

function compactExpression(source: string): string {
  let compact = source.replace(/\s+/g, '');
  while (compact.startsWith('(') && compact.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < compact.length; i++) {
      if (compact[i] === '(') depth++;
      if (compact[i] === ')') depth--;
      if (depth === 0 && i < compact.length - 1) { wraps = false; break; }
    }
    if (!wraps) break;
    compact = compact.slice(1, -1);
  }
  return compact;
}

function parameterStateErrors(reply: CandidateReply, values: ReplyParameterState): string[] {
  const errors: string[] = [];
  const declared = new Set(reply.parameters.map((parameter) => parameter.name));
  for (const key of Object.keys(values)) if (!declared.has(key)) errors.push(`Unknown parameter ${key}.`);
  for (const parameter of reply.parameters) {
    const value = values[parameter.name];
    if (!Number.isFinite(value)) errors.push(`Parameter ${parameter.name} must be finite.`);
    else if (value < parameter.min || value > parameter.max) errors.push(`Parameter ${parameter.name} is outside its declared bounds.`);
  }
  return errors;
}

function growthHeadlineRestriction(reply: CandidateReply, model: OdeModelBlock, request: CandidateCheck): string | undefined {
  if (reply.status !== 'complete') return 'This reply is still provisional.';
  if (model.events?.length) return 'This criterion does not admit a headline for event-modified models.';
  const unit = (role: string) => reply.parameters.find(parameter => parameter.name === request.inputs[role])?.unit;
  if (unit('gamma') !== '1/s' || !['1/s²', '1/s^2'].includes(unit('f') ?? '') || unit('y0') !== '1/s') {
    return 'This criterion requires damping and start in 1/s, and forcing in 1/s². Other unit interpretations are not verified.';
  }
  return undefined;
}

function computeGrowthCheck(reply: CandidateReply, request: CandidateCheck, values: ReplyParameterState): IndependentCheckResult {
  const model = reply.blocks.find((block) => block.id === request.model);
  const classification = reply.blocks.find((block) => block.id === request.classification);
  if (!model || model.type !== 'model' || !classification || classification.type !== 'classification') return independentFailure(request, 'The requested model or classification is missing.');
  if (classification.model !== model.id || classification.check !== request.id) return independentFailure(request, 'The classification is not linked to this model and requested check.');
  if (model.kind !== 'ode' || model.state.length !== 1 || model.state[0] !== 'y') return independentFailure(request, 'growth-v1 supports only the declared scalar ODE state y.');
  if (Object.keys(request.inputs).sort().join(',') !== 'f,gamma,y0') return independentFailure(request, 'growth-v1 requires exactly gamma, f and y0 input mappings.');
  const gammaName = request.inputs.gamma;
  const forcingName = request.inputs.f;
  const startName = request.inputs.y0;
  if (new Set([gammaName, forcingName, startName]).size !== 3) return independentFailure(request, 'growth-v1 input mappings must refer to three different parameters.');
  const declared = new Set(reply.parameters.map((parameter) => parameter.name));
  if (![gammaName, forcingName, startName].every((name) => declared.has(name))) return independentFailure(request, 'growth-v1 input mapping refers to an undeclared parameter.');
  if (compactExpression(model.rhs.y) !== `y^2-${gammaName}*y+${forcingName}`) return independentFailure(request, 'The model right-hand side is not the verified growth-v1 equation.');
  if (compactExpression(model.initial.y) !== startName) return independentFailure(request, 'The model initial value is not the mapped y0 parameter.');
  try {
    const rhs = compileExpression(model.rhs.y, ['y', gammaName, forcingName, startName, 't']);
    const initial = compileExpression(model.initial.y, [gammaName, forcingName, startName]);
    const probe = { y: 0.37, [gammaName]: 0.51, [forcingName]: 0.12, [startName]: -0.2, t: 0.4 };
    const expected = probe.y * probe.y - probe[gammaName] * probe.y + probe[forcingName];
    if (Math.abs(rhs(probe) - expected) > 1e-12 || initial(probe) !== probe[startName]) return independentFailure(request, 'The declared expressions did not reproduce growth-v1 semantics.');
  } catch (error) {
    return independentFailure(request, `The declared model could not be evaluated: ${error instanceof Error ? error.message : 'evaluation failed'}`);
  }
  const inputs: GrowthInputs = { gamma: values[gammaName], f: values[forcingName], y0: values[startName] };
  try {
    const outcome = classifyGrowth(inputs);
    if (!Number.isFinite(outcome.kind === 'diverges' ? outcome.time : outcome.value)) return independentFailure(request, 'The exact result exceeds the supported numeric range.');
    const restriction = growthHeadlineRestriction(reply, model, request);
    // T18 also uses a numerical pass/outcome to bound plots before a pole. Do not
    // erase that domain information merely because the headline is inadmissible.
    return {
      requestId: request.id, criterion: request.criterion, model: request.model, classification: request.classification,
      status: 'pass', reason: restriction ?? 'The renderer-owned growth-v1 criterion matched the declared model and current bounded parameters.',
      outcome, ...(restriction ? {} : { headline: growthSentence(inputs, model.horizon) }),
    };
  } catch (error) {
    return independentFailure(request, error instanceof Error ? error.message : 'growth-v1 evaluation failed.');
  }
}

/** Browser-safe independent checks. This computes bounded criteria but grants no host authority. */
export function computeIndependentChecks(reply: CandidateReply, parameters: ReplyParameterState): IndependentCheckResult[] {
  const errors = parameterStateErrors(reply, parameters);
  return reply.checks.map((request) => {
    if (errors.length) return independentFailure(request, errors.join(' '));
    if (request.criterion === 'growth-v1') return computeGrowthCheck(reply, request, parameters);
    return { requestId: request.id, criterion: request.criterion, model: request.model, classification: request.classification, status: 'unsupported', reason: `No independent implementation is installed for ${request.criterion}.` };
  });
}
