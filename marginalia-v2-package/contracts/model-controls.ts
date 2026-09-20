/** Local preferences are not provider capability evidence or send authorization. */
export const MODEL_CONTROLS_KEY = 'library.model-controls.v2';
export const MODEL_KINDS = ['instant', 'define', 'unsure', 'instantiate', 'explore', 'derive', 'evidence', 'simulate', 'diagram'] as const;
export const CONTROL_MODELS = ['gpt-5.6-luna', 'gpt-6-astra'] as const;
export const CONTROL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ModelControlKind = typeof MODEL_KINDS[number];
export type ControlModel = typeof CONTROL_MODELS[number];
export type ControlEffort = typeof CONTROL_EFFORTS[number];
/** Fast cannot be enabled until a separately reviewed pinned-provider fixture exists. */
export const FAST_AVAILABILITY = 'unknown' as const;
export const FAST_UNAVAILABLE_MESSAGE = 'Fast availability unknown';
export type ModelChoice = { model: ControlModel; effort: ControlEffort; fast: false };
export type ChoiceOrigin = 'default' | 'legacy' | 'reader';
export type ModelControls = {
  version: 2; revision: number; updatedAt: string | null;
  choices: Record<ModelControlKind, ModelChoice>;
  origins: Record<ModelControlKind, ChoiceOrigin>;
};
export type ModelControlsSnapshot = ModelControls & { compatibilityKey: string };
export type ModelControlsChange = {
  expectedRevision: number; expectedCompatibilityKey: string;
  kind: ModelControlKind; choice: ModelChoice;
};
export type ModelControlsReset = { expectedRevision: number; expectedCompatibilityKey: string };
export type ReaderModelCapability = {
  model: ControlModel; availability: 'available' | 'unavailable' | 'unknown'; efforts: ControlEffort[];
};
/** Supplied by the host's reader-provider discovery, never by page or settings input. */
export type ReaderModelCapabilities = {
  provider: 'app-server'; version: '0.153.4'; revision: string;
  models: ReaderModelCapability[];
};
export type EffectiveModelChoice = {
  version: 1; kind: ModelControlKind; requested: ModelChoice; actual: ModelChoice;
  settingsRevision: number; settingsCompatibilityKey: string; capabilityRevision: string;
  provider: 'app-server'; providerVersion: '0.153.4'; recipient: 'openai-codex';
  fallback: 'none' | 'unavailable-choice';
};

export function defaultModelChoice(kind: ModelControlKind): ModelChoice {
  requireKind(kind);
  return { model: kind === 'simulate' || kind === 'diagram' || kind === 'evidence' ? 'gpt-6-astra' : 'gpt-5.6-luna',
    effort: kind === 'instant' ? 'medium' : kind === 'simulate' || kind === 'diagram' || kind === 'evidence' ? 'low' : 'max', fast: false };
}
export function defaultModelControls(): ModelControls {
  return { version: 2, revision: 0, updatedAt: null,
    choices: Object.fromEntries(MODEL_KINDS.map(kind => [kind, defaultModelChoice(kind)])) as ModelControls['choices'],
    origins: Object.fromEntries(MODEL_KINDS.map(kind => [kind, 'default'])) as ModelControls['origins'] };
}
export function requireKind(value: unknown): asserts value is ModelControlKind {
  if (!MODEL_KINDS.includes(value as ModelControlKind)) throw new Error('Unknown request type.');
}
function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d))) throw new Error('Invalid model controls record.');
}
function revision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid model controls revision.');
}
function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid model controls identity.');
}
export function parseModelChoice(value: unknown): ModelChoice {
  shape(value, ['model', 'effort', 'fast']);
  if (!CONTROL_MODELS.includes(value.model as ControlModel) || !CONTROL_EFFORTS.includes(value.effort as ControlEffort)) throw new Error('Unsupported model or effort.');
  if (value.fast !== false) throw new Error(FAST_UNAVAILABLE_MESSAGE);
  return { model: value.model as ControlModel, effort: value.effort as ControlEffort, fast: false };
}
export function parseModelControls(value: unknown): ModelControls {
  shape(value, ['version', 'revision', 'updatedAt', 'choices', 'origins']);
  if (value.version !== 2) throw new Error('Unsupported model controls version.');
  revision(value.revision);
  if (value.updatedAt !== null && (typeof value.updatedAt !== 'string' || value.updatedAt.length > 40 || !Number.isFinite(Date.parse(value.updatedAt)))) throw new Error('Invalid model controls date.');
  shape(value.choices, MODEL_KINDS); shape(value.origins, MODEL_KINDS);
  const choices = {} as ModelControls['choices'], origins = {} as ModelControls['origins'];
  for (const kind of MODEL_KINDS) {
    choices[kind] = parseModelChoice(value.choices[kind]);
    const origin = value.origins[kind];
    if (origin !== 'default' && origin !== 'legacy' && origin !== 'reader') throw new Error('Invalid model choice origin.');
    origins[kind] = origin;
  }
  return { version: 2, revision: value.revision, updatedAt: value.updatedAt as string | null, choices, origins };
}
export function parseModelControlsReset(value: unknown): ModelControlsReset {
  shape(value, ['expectedRevision', 'expectedCompatibilityKey']); revision(value.expectedRevision); digest(value.expectedCompatibilityKey);
  return { expectedRevision: value.expectedRevision, expectedCompatibilityKey: value.expectedCompatibilityKey };
}
export function parseModelControlsChange(value: unknown): ModelControlsChange {
  shape(value, ['expectedRevision', 'expectedCompatibilityKey', 'kind', 'choice']);
  const expected = parseModelControlsReset({ expectedRevision: value.expectedRevision, expectedCompatibilityKey: value.expectedCompatibilityKey });
  requireKind(value.kind);
  return { ...expected, kind: value.kind, choice: parseModelChoice(value.choice) };
}
export function parseReaderModelCapabilities(value: unknown): ReaderModelCapabilities {
  shape(value, ['provider', 'version', 'revision', 'models']); digest(value.revision);
  if (value.provider !== 'app-server' || value.version !== '0.153.4' || !Array.isArray(value.models) || value.models.length > CONTROL_MODELS.length) throw new Error('Reader model capabilities unavailable.');
  const seen = new Set<ControlModel>();
  const models = value.models.map(entry => {
    shape(entry, ['model', 'availability', 'efforts']);
    const model = entry.model as ControlModel;
    if (!CONTROL_MODELS.includes(model) || seen.has(model) || !['available', 'unavailable', 'unknown'].includes(entry.availability as string) ||
        !Array.isArray(entry.efforts) || entry.efforts.length > CONTROL_EFFORTS.length || new Set(entry.efforts).size !== entry.efforts.length ||
        entry.efforts.some(e => !CONTROL_EFFORTS.includes(e))) throw new Error('Invalid reader model capability.');
    seen.add(model);
    return { model, availability: entry.availability as ReaderModelCapability['availability'], efforts: [...entry.efforts] as ControlEffort[] };
  });
  return { provider: 'app-server', version: '0.153.4', revision: value.revision, models };
}
/** Missing/unknown entries never mean unavailable and never authorize fallback. */
export function resolveModelChoice(settings: ModelControlsSnapshot, kind: ModelControlKind, observed: ReaderModelCapabilities): EffectiveModelChoice {
  const { compatibilityKey, ...record } = settings;
  digest(compatibilityKey); const controls = parseModelControls(record); requireKind(kind);
  const capabilities = parseReaderModelCapabilities(observed), requested = controls.choices[kind];
  const status = (choice: ModelChoice) => {
    const entry = capabilities.models.find(row => row.model === choice.model);
    return !entry || entry.availability === 'unknown' ? 'unknown' : entry.availability === 'unavailable' || !entry.efforts.includes(choice.effort) ? 'unavailable' : 'available';
  };
  const availability = status(requested);
  if (availability === 'unknown') throw new Error('Model availability unknown. Review Settings before sending.');
  const actual = availability === 'available' ? requested : defaultModelChoice(kind);
  if (status(actual) !== 'available') throw new Error('The default choice is unavailable or unverified. Choose an available model in Settings.');
  return { version: 1, kind, requested: { ...requested }, actual: { ...actual }, settingsRevision: controls.revision,
    settingsCompatibilityKey: compatibilityKey, capabilityRevision: capabilities.revision, provider: 'app-server',
    providerVersion: '0.153.4', recipient: 'openai-codex', fallback: availability === 'available' ? 'none' : 'unavailable-choice' };
}
export function parseEffectiveModelChoice(value: unknown): EffectiveModelChoice {
  shape(value, ['version', 'kind', 'requested', 'actual', 'settingsRevision', 'settingsCompatibilityKey', 'capabilityRevision', 'provider', 'providerVersion', 'recipient', 'fallback']);
  requireKind(value.kind); revision(value.settingsRevision); digest(value.settingsCompatibilityKey); digest(value.capabilityRevision);
  if (value.version !== 1 || value.provider !== 'app-server' || value.providerVersion !== '0.153.4' || value.recipient !== 'openai-codex' ||
      (value.fallback !== 'none' && value.fallback !== 'unavailable-choice')) throw new Error('Invalid effective model choice.');
  const requested = parseModelChoice(value.requested), actual = parseModelChoice(value.actual);
  if (value.fallback === 'none' ? !sameModelChoice(requested, actual) : sameModelChoice(requested, actual) || !sameModelChoice(actual, defaultModelChoice(value.kind))) throw new Error('Invalid model fallback.');
  return { version: 1, kind: value.kind, requested, actual, settingsRevision: value.settingsRevision,
    settingsCompatibilityKey: value.settingsCompatibilityKey, capabilityRevision: value.capabilityRevision,
    provider: 'app-server', providerVersion: '0.153.4', recipient: 'openai-codex', fallback: value.fallback };
}
export function sameModelChoice(a: ModelChoice, b: ModelChoice): boolean {
  return a.model === b.model && a.effort === b.effort && a.fast === b.fast;
}
/** Stable canonical identity for hashing by the host and equality at durable boundaries. */
export function effectiveModelChoiceKey(value: EffectiveModelChoice): string {
  return JSON.stringify(parseEffectiveModelChoice(value));
}
export function modelRecipientLabel(value: EffectiveModelChoice): string {
  const choice = parseEffectiveModelChoice(value).actual;
  return `OpenAI Codex using ${choice.model === 'gpt-5.6-luna' ? 'GPT-5.6 Luna' : 'GPT-6 Astra'}, ${choice.effort}, Fast off`;
}
export function modelFallbackNotice(value: EffectiveModelChoice): string | null {
  const choice = parseEffectiveModelChoice(value);
  return choice.fallback === 'none' ? null : `Your choice is unavailable. This request will use ${modelRecipientLabel(choice)}.`;
}
