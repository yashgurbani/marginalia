import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderStore } from '../daemon/store.ts';
import { LibrarySettingsService, ModelControlsMigrationError } from '../daemon/library.ts';
import { JobStore } from '../daemon/jobs/store.ts';
import { defaultInstantHelpSettings, INSTANT_HELP_KEY } from '../contracts/instant.ts';
import { MODEL_CONTROLS_KEY, MODEL_KINDS, defaultModelControls, defaultModelChoice, parseModelChoice, parseModelControls,
  parseModelControlsChange, resolveModelChoice, parseEffectiveModelChoice, modelRecipientLabel, modelFallbackNotice,
  type ReaderModelCapabilities, type EffectiveModelChoice } from '../contracts/model-controls.ts';
import type { FrozenJobContext, StartJobInput } from '../contracts/jobs.ts';
import type { ProviderHandle } from '../contracts/job-runner.ts';

const caps: ReaderModelCapabilities = { provider: 'app-server', version: '0.153.4', revision: 'b'.repeat(64), models: [
  { model: 'gpt-5.6-luna', availability: 'available', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { model: 'gpt-6-astra', availability: 'available', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
] };
const expected = (s: ReturnType<LibrarySettingsService['modelControls']>) => ({ expectedRevision: s.revision, expectedCompatibilityKey: s.compatibilityKey });
function fixture(t: { after: (fn: () => void) => void }) {
  const reader = new ReaderStore(':memory:'); t.after(() => reader.close());
  return { reader, library: new LibrarySettingsService(reader) };
}
function put(reader: ReaderStore, key: string, value: unknown) {
  reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}

test('D40 has nine independent defaults, exactly four old deep kinds change to Luna', t => {
  const { library } = fixture(t), value = library.modelControls();
  assert.deepEqual(Object.keys(value.choices), [...MODEL_KINDS]);
  assert.equal(value.choices.instant.effort, 'medium');
  assert.deepEqual(MODEL_KINDS.filter(k => k !== 'instant' && k !== 'define' && value.choices[k].model === 'gpt-5.6-luna'), ['unsure', 'instantiate', 'explore', 'derive']);
  for (const k of MODEL_KINDS) {
    assert.equal(value.choices[k].fast, false);
    assert.equal(value.choices[k].effort, k === 'instant' ? 'medium' : ['simulate', 'diagram', 'evidence'].includes(k) ? 'low' : 'max');
  }
  value.choices.define.effort = 'low';
  assert.equal(library.modelControls().choices.define.effort, 'max');
});

test('each row override persists independently and resolves the actual recipient', t => {
  const { library } = fixture(t);
  for (const kind of MODEL_KINDS) {
    const before = library.modelControls(), choice = { model: 'gpt-6-astra' as const, effort: 'high' as const, fast: false as const };
    const after = library.saveModelControls({ ...expected(before), kind, choice });
    const resolved = resolveModelChoice(after, kind, caps);
    assert.deepEqual(resolved.actual, choice); assert.deepEqual(resolved.requested, choice);
    assert.equal(resolved.settingsRevision, before.revision + 1);
    assert.equal(modelRecipientLabel(resolved), 'OpenAI Codex using GPT-6 Astra, high, Fast off');
    assert.equal(modelFallbackNotice(resolved), null);
    for (const other of MODEL_KINDS.filter(k => k !== kind)) assert.deepEqual(after.choices[other], before.choices[other]);
  }
});

test('invalid values, hidden fields, prototype keys, Fast and stale CAS refuse without mutation', t => {
  const { reader, library } = fixture(t), before = library.modelControls();
  for (const choice of [null, { model: 'gpt-6-astra;cmd', effort: 'low', fast: false }, { model: 'gpt-6-astra', effort: 'ultra', fast: false },
    { model: 'gpt-6-astra', effort: 'low', fast: true }, { model: 'gpt-6-astra', effort: 'low', fast: 'false' },
    { ...defaultModelChoice('define'), config: 'anything' }, JSON.parse('{"model":"gpt-6-astra","effort":"low","fast":false,"__proto__":{}}')]) assert.throws(() => parseModelChoice(choice));
  assert.throws(() => parseModelChoice(Object.create({ model: 'gpt-6-astra', effort: 'low', fast: false })));
  assert.throws(() => parseModelControls({ ...defaultModelControls(), unknown: true }));
  assert.throws(() => parseModelControlsChange({ ...expected(before), kind: 'explain', choice: defaultModelChoice('define') }));
  assert.throws(() => library.saveModelControls({ ...expected(before), expectedCompatibilityKey: 'f'.repeat(64), kind: 'define', choice: defaultModelChoice('define') }));
  assert.equal(reader.db.prepare('SELECT 1 FROM settings WHERE key=?').get(MODEL_CONTROLS_KEY), undefined);
  const after = library.saveModelControls({ ...expected(before), kind: 'derive', choice: defaultModelChoice('diagram') });
  assert.throws(() => library.resetModelControls(expected(before)));
  assert.deepEqual(library.modelControls(), after);
});

test('legacy explicit defaults and instant overrides survive; absent settings adopt D39a', t => {
  const { reader, library } = fixture(t);
  put(reader, 'library.models.v1', { fast: 'gpt-6-astra', deep: 'gpt-6-astra', revision: 2, updatedAt: new Date().toISOString() });
  put(reader, INSTANT_HELP_KEY, { ...defaultInstantHelpSettings(), model: 'gpt-6-astra', effort: 'high' });
  const old = reader.db.prepare('SELECT value FROM settings WHERE key=?').get('library.models.v1');
  const migrated = library.modelControls();
  for (const kind of MODEL_KINDS) { assert.equal(migrated.choices[kind].model, 'gpt-6-astra'); assert.equal(migrated.origins[kind], 'legacy'); }
  assert.equal(migrated.choices.instant.effort, 'high');
  const saved = library.saveModelControls({ ...expected(migrated), kind: 'define', choice: defaultModelChoice('define') });
  assert.deepEqual(reader.db.prepare('SELECT value FROM settings WHERE key=?').get('library.models.v1'), old);
  assert.throws(() => library.saveModels({ fast: 'gpt-5.6-luna', deep: 'gpt-6-astra', expectedRevision: 2 }));
  assert.equal(saved.choices.derive.model, 'gpt-6-astra');
  const reset = library.resetModelControls(expected(saved));
  assert.deepEqual(reset.choices, defaultModelControls().choices);
  assert.equal(reset.revision, saved.revision + 1);
});

test('unsupported legacy model is not substituted; explicit reset is revision bound and preserves original', t => {
  const { reader, library } = fixture(t);
  put(reader, 'library.models.v1', { fast: 'legacy-custom', deep: 'gpt-6-astra', revision: 1, updatedAt: new Date().toISOString() });
  const old = reader.db.prepare('SELECT value FROM settings WHERE key=?').get('library.models.v1');
  let migration!: ModelControlsMigrationError;
  assert.throws(() => library.modelControls(), error => { assert.ok(error instanceof ModelControlsMigrationError); migration = error; return true; });
  assert.throws(() => library.resetModelControls({ expectedRevision: 0, expectedCompatibilityKey: 'f'.repeat(64) }));
  const reset = library.resetModelControls({ expectedRevision: migration.expectedRevision, expectedCompatibilityKey: migration.expectedCompatibilityKey });
  assert.deepEqual(reset.choices, defaultModelControls().choices);
  assert.deepEqual(reader.db.prepare('SELECT value FROM settings WHERE key=?').get('library.models.v1'), old);
});

test('fallback only uses verified row default, is visible, and never rewrites preference', t => {
  const { library } = fixture(t), first = library.modelControls();
  const saved = library.saveModelControls({ ...expected(first), kind: 'derive', choice: defaultModelChoice('diagram') });
  const unavailable = structuredClone(caps); unavailable.models[1].availability = 'unavailable';
  const resolved = resolveModelChoice(saved, 'derive', unavailable);
  assert.deepEqual(resolved.actual, defaultModelChoice('derive'));
  assert.match(modelFallbackNotice(resolved)!, /unavailable.*GPT-5.6 Luna, max, Fast off/);
  assert.deepEqual(library.modelControls(), saved);
  unavailable.models[0].availability = 'unavailable'; assert.throws(() => resolveModelChoice(saved, 'derive', unavailable));
  unavailable.models[1].availability = 'unknown'; assert.throws(() => resolveModelChoice(saved, 'derive', unavailable), /unknown/);
  assert.throws(() => resolveModelChoice(saved, 'derive', { ...caps, models: [] }), /unknown/);
  const unsupported = structuredClone(caps); unsupported.models[1].efforts = [];
  assert.equal(resolveModelChoice(saved, 'derive', unsupported).fallback, 'unavailable-choice');
  assert.throws(() => parseEffectiveModelChoice({ ...resolved, actual: defaultModelChoice('instant') }), /fallback/);
  assert.throws(() => parseEffectiveModelChoice({ ...resolved, fallback: 'none' }), /fallback/);
});

test('settings restart, corrupt record and revision overflow are honest and non-destructive', t => {
  const root = mkdtempSync(join(tmpdir(), 'v18-settings-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'reader.db'); let reader = new ReaderStore(path);
  try {
    let library = new LibrarySettingsService(reader), before = library.modelControls();
    const saved = library.saveModelControls({ ...expected(before), kind: 'evidence', choice: defaultModelChoice('diagram') });
    reader.close(); reader = new ReaderStore(path); library = new LibrarySettingsService(reader);
    assert.deepEqual(library.modelControls(), saved);
    put(reader, MODEL_CONTROLS_KEY, { ...defaultModelControls(), revision: Number.MAX_SAFE_INTEGER });
    before = library.modelControls(); assert.throws(() => library.resetModelControls(expected(before)), /revision/);
    reader.db.prepare('UPDATE settings SET value=? WHERE key=?').run('{', MODEL_CONTROLS_KEY);
    assert.throws(() => library.modelControls()); assert.throws(() => library.resetModelControls(expected(before)));
    assert.equal((reader.db.prepare('SELECT value FROM settings WHERE key=?').get(MODEL_CONTROLS_KEY) as { value: string }).value, '{');
  } finally { reader.close(); }
});

function createJob(reader: ReaderStore, store: JobStore, choice: EffectiveModelChoice, id = 'job') {
  if (!reader.get('thread')) reader.apply({ id: 'keep', kind: 'keep', threadId: 'thread', capture: { url: 'https://example.org/article', title: 'Article', pageType: 'article', text: 'Start here.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'text-v1' }, anchor: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5 } });
  const thread = reader.get('thread')!, source = reader.sourceVersion(thread.sourceVersionId)!;
  const input: StartJobInput = { id, idempotencyKey: id, threadId: thread.id, intent: 'derive', question: 'Explain.', provider: 'app-server', model: choice.actual.model, mode: 'workspace-files', policyKey: 'a'.repeat(64), grantId: 'grant', preparedPayloadDigest: 'd'.repeat(64) };
  const context: FrozenJobContext = { threadId: thread.id, sourceVersionId: source.id, sourceUrl: thread.sourceUrl, sourceTitle: thread.sourceTitle, sourcePageType: source.pageType, sourceCapturedAt: source.capturedAt, sourceHash: source.hash, sourceText: source.text, passage: thread.anchor, question: input.question, intent: input.intent, preparedPayloadDigest: input.preparedPayloadDigest, modelSettingsRevision: choice.settingsRevision, modelCompatibilityKey: choice.settingsCompatibilityKey, outgoing: { schema: 'marginalia.job-packet.v1', intent: input.intent, question: input.question, source: { url: thread.sourceUrl, title: thread.sourceTitle, pageType: source.pageType, capturedAt: source.capturedAt, sourceHash: source.hash, sourceVersionId: source.id }, selection: { ...thread.anchor, originalEnd: 5, omittedCharacters: 0 }, adjacentContext: { before: '', after: ' here.', basis: 'bounded-character-context' }, availableCapabilities: [], omissions: [] } };
  return store.create(input, context, id, id);
}

test('durable execution choice survives restart; checkpoint rejects omission/change and late binding', t => {
  const root = mkdtempSync(join(tmpdir(), 'v18-jobs-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'reader.db'); let reader = new ReaderStore(path);
  try {
    let store = new JobStore(reader); const choice = resolveModelChoice(new LibrarySettingsService(reader).modelControls(), 'derive', caps);
    createJob(reader, store, choice); store.bindModelControls('job', choice);
    assert.deepEqual(store.bindModelControls('job', choice), choice);
    assert.throws(() => store.bindModelControls('job', { ...choice, capabilityRevision: 'c'.repeat(64) }), /immutable/);
    reader.close(); reader = new ReaderStore(path); store = new JobStore(reader);
    assert.deepEqual(store.modelControls('job'), choice);
    const a = store.createAttempt('job'); store.setDeadline('job', a.id, new Date(Date.now() + 60000).toISOString());
    store.markPreparing('job', a.id); store.markWorkspacePrepared('job', a.id);
    assert.throws(() => store.withDispatchHandoff(store.get('job')!, a.id, { assertSharedDatabase() {} }, () => undefined), /Reviewed model controls/);
    assert.throws(() => store.withDispatchHandoff(store.get('job')!, a.id, { assertSharedDatabase() {} }, () => undefined, { ...choice, capabilityRevision: 'c'.repeat(64) }), /Reviewed model controls/);
    assert.throws(() => store.withDispatchHandoff(store.get('job')!, a.id, { assertSharedDatabase() {} }, () => {
      reader.db.prepare('UPDATE jobs SET modelControls=NULL WHERE id=?').run('job');
    }, choice), /Reviewed model controls/);
    assert.deepEqual(store.modelControls('job'), choice);
    const mutable = structuredClone(choice);
    assert.throws(() => store.withDispatchHandoff(store.get('job')!, a.id, { assertSharedDatabase() {} }, () => {
      mutable.capabilityRevision = 'c'.repeat(64);
      reader.db.prepare('UPDATE jobs SET modelControls=? WHERE id=?').run(JSON.stringify(mutable), 'job');
    }, mutable), /Reviewed model controls/);
    assert.deepEqual(store.modelControls('job'), choice);
    store.withDispatchHandoff(store.get('job')!, a.id, { assertSharedDatabase() {} }, () => undefined, choice);
    const h: ProviderHandle = { jobId: a.id, provider: 'app-server', providerInstanceId: 'fixture', workspace: 'fixture', policyKey: 'a'.repeat(64), model: choice.actual.model, mode: 'workspace-files', state: 'running', tombstone: false };
    assert.throws(() => store.checkpoint(a.id, h), /controls binding/);
    assert.throws(() => store.checkpoint(a.id, { ...h, modelControls: { ...choice, capabilityRevision: 'c'.repeat(64) } }), /controls binding/);
    const accepted = store.checkpoint(a.id, { ...h, modelControls: choice });
    assert.deepEqual(accepted.modelControls, choice);
    reader.close(); reader = new ReaderStore(path); store = new JobStore(reader);
    assert.deepEqual(store.get('job')!.attempts[0].providerHandle!.modelControls, choice);
    createJob(reader, store, choice, 'legacy'); store.createAttempt('legacy');
    assert.throws(() => store.bindModelControls('legacy', choice), /before attempt/);
    assert.equal(store.modelControls('legacy'), undefined);
  } finally { reader.close(); }
});
