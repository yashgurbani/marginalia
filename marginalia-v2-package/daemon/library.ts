import { MODEL_CONTROLS_KEY, MODEL_KINDS, defaultModelControls, parseModelChoice, parseModelControls, parseModelControlsChange, parseModelControlsReset, type ModelControls, type ModelControlsSnapshot, type ModelControlsChange, type ModelControlsReset } from '../contracts/model-controls.ts';
import { createHash } from 'node:crypto';
import { AUTO_ASSIST_KEY, AUTO_ASSIST_POSTURE_LIMITS, AUTO_DEFINITION_BATCH_SIZE, AUTO_DEFINITION_BUDGET_PERCENT, defaultAutoAssistSettings, type AutoAssistSettings, type AutoAssistSettingsChange } from '../contracts/auto-assist.ts';
import { defaultInstantHelpSettings, INSTANT_HELP_KEY, INSTANT_MODELS, type InstantHelpSettings, type InstantHelpSettingsChange } from '../contracts/instant.ts';
import { isDigest } from '../contracts/digest.ts';
import type { LibraryMatchKind, LibrarySearchResult, ModelSelection, ModelSettings, ModelSettingsChange, ModelTier, RelatedLibraryResult, VocabularyEntry, VocabularyObservation, VocabularyObservationResult, VocabularyOrigin, VocabularyOriginKind, VocabularySourceReference } from '../contracts/library.ts';
import type { Thread } from '../contracts/reader.ts';
import { ConflictError, type ReaderStore } from './store.ts';

const MODELS_KEY = 'library.models.v1';
const GATHERING_KEY = 'library.vocabulary-gathering.v1';
const SKIP_PREFIX = 'library.vocabulary-skip.v1:';
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const DEFAULT_MODELS = Object.freeze({ fast: 'gpt-5.6-luna', deep: 'gpt-6-astra' });

type StoredModels = { fast: string; deep: string; revision: number; updatedAt: string };

/** A reader may explicitly reset unsupported legacy choices; originals remain untouched. */
export class ModelControlsMigrationError extends Error {
  readonly expectedRevision = 0;
  readonly expectedCompatibilityKey: string;
  constructor(identity: string) {
    super('An older model choice is unsupported. Review it or explicitly reset model choices.');
    this.name = 'ModelControlsMigrationError';
    this.expectedCompatibilityKey = identity;
  }
}

/**
 * Library and reader-controlled settings over the existing ReaderStore database.
 * This service owns no parallel persistence and deliberately leaves grants/exclusions to T13.
 */
export class LibrarySettingsService {
  readonly reader: ReaderStore;

  constructor(reader: ReaderStore) {
    this.reader = reader;
  }

  listThreads(includeRemoved = true): Thread[] {
    return this.reader.list(undefined, includeRemoved);
  }

  exportThread(id: string): unknown {
    requireId(id, 'thread');
    return this.reader.exportThread(id);
  }

  search(query: string, limit = 20): LibrarySearchResult[] {
    const terms = searchTerms(query);
    const bounded = resultLimit(limit);
    if (!terms.length) return [];
    return this.searchTerms(terms, bounded, false);
  }

  related(threadId: string, limit = 5): RelatedLibraryResult[] {
    requireId(threadId, 'thread');
    const thread = this.reader.get(threadId);
    if (!thread || thread.deletedAt) throw new Error('This thread is unavailable.');
    // Inspect only the first 300 characters of the saved anchor, at most eight terms.
    const terms = searchTerms(thread.anchor.exact.slice(0, 300), 150).filter(term => term.length >= 4 && !RELATED_STOP_WORDS.has(term)).slice(0, 8);
    if (!terms.length) return [];
    return this.searchTerms(terms, resultLimit(limit, 8), true, thread.sourceVersionId)
      .filter((result): result is RelatedLibraryResult => result.kind === 'source')
      .map(result => ({ ...result, explanation: `Local word overlap with this saved passage: ${quotedTerms(result.matchedTerms)}. Up to eight words from its first 300 characters are compared; this does not establish a supporting source.` }));
  }

  private searchTerms(terms: string[], limit: number, sourceOnly: boolean, excludeSourceVersionId?: string): LibrarySearchResult[] {
    const expression = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(sourceOnly ? ' OR ' : ' AND ');
    const rows = this.reader.db.prepare(`SELECT entityId,kind,content FROM search WHERE search MATCH ? ${sourceOnly ? "AND kind='source'" : ''}
      AND ((kind='source' AND EXISTS(SELECT 1 FROM threads t JOIN anchors a ON a.id=t.anchorId WHERE a.sourceVersionId=search.entityId AND t.deletedAt IS NULL))
        OR (kind='note' AND EXISTS(SELECT 1 FROM notes n JOIN threads t ON t.id=n.threadId WHERE n.id=search.entityId AND n.deletedAt IS NULL AND t.deletedAt IS NULL))
        OR (kind='reply' AND EXISTS(SELECT 1 FROM reply_versions r JOIN threads t ON t.id=r.threadId WHERE r.id=search.entityId AND r.deletedAt IS NULL AND t.deletedAt IS NULL)))
      ORDER BY rank,kind,entityId LIMIT ?`)
      .all(expression, Math.max(limit * 6, limit)) as { entityId: string; kind: LibraryMatchKind; content: string }[];
    const results: LibrarySearchResult[] = [];
    for (const row of rows) {
      const context = this.resolveSearchRow(row);
      if (!context || context.thread.deletedAt || context.thread.sourceVersionId === excludeSourceVersionId) continue;
      const source = this.reader.sourceVersion(context.thread.sourceVersionId);
      if (!source) continue;
      const sourceLocation = row.kind === 'source' ? locatePassage(source.text, terms) : locateAnchor(source.text, context.thread.anchor.exact, context.thread.anchor.start);
      if (!sourceLocation) continue;
      const matchedTerms = terms.filter(term => wordLocations(row.kind === 'source' ? sourceLocation.passage : row.content, term).length > 0);
      if (!matchedTerms.length) continue;
      const matchLocation = locatePassage(row.content, terms) ?? { passage: row.content.slice(0, 240), start: 0, end: Math.min(row.content.length, 240) };
      const evidenceLabel = row.kind === 'source' ? 'source passage' : row.kind === 'note' ? 'reader note' : 'saved reply — not source evidence';
      results.push({ threadId: context.thread.id, sourceVersionId: context.thread.sourceVersionId,
        sourceTitle: context.thread.sourceTitle, sourceUrl: context.thread.sourceUrl, kind: row.kind,
        passage: sourceLocation.passage, start: sourceLocation.start, end: sourceLocation.end,
        matchExcerpt: matchLocation.passage, matchedTerms,
        explanation: row.kind === 'source'
          ? `Local text match in the saved source: ${quotedTerms(matchedTerms)}.`
          : `Local match in a ${evidenceLabel}; the cited passage is the source anchor, not generated evidence.`,
        evidenceLabel });
      if (results.length >= limit) break;
    }
    return results;
  }

  private resolveSearchRow(row: { entityId: string; kind: LibraryMatchKind }) {
    let threadId: string | undefined;
    if (row.kind === 'source') threadId = (this.reader.db.prepare(`SELECT t.id FROM threads t JOIN anchors a ON a.id=t.anchorId
      WHERE a.sourceVersionId=? AND t.deletedAt IS NULL ORDER BY t.updatedAt DESC,t.id LIMIT 1`).get(row.entityId) as { id: string } | undefined)?.id;
    else if (row.kind === 'note') threadId = (this.reader.db.prepare(`SELECT threadId AS id FROM notes WHERE id=? AND deletedAt IS NULL`).get(row.entityId) as { id: string } | undefined)?.id;
    else threadId = (this.reader.db.prepare(`SELECT threadId AS id FROM reply_versions WHERE id=? AND deletedAt IS NULL`).get(row.entityId) as { id: string } | undefined)?.id;
    return threadId ? { thread: this.reader.get(threadId)! } : undefined;
  }

  /** Additive V2 persistence seam. Existing send routes stay on V1 until backend integration. */
  modelControls(): ModelControlsSnapshot {
    const row = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(MODEL_CONTROLS_KEY) as { value: string } | undefined;
    if (row) {
      if (row.value.length > 16_384) throw new Error('Saved model controls are too large.');
      return modelControlsSnapshot(parseModelControls(JSON.parse(row.value)));
    }
    const value = defaultModelControls();
    // A persisted legacy value is explicit, even when it equals the old default.
    // Keep the original record; unsupported IDs require reader review.
    const legacy = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(MODELS_KEY) as { value: string } | undefined;
    if (legacy) {
      if (legacy.value.length > 16_384) throw new Error('Saved legacy model choices are too large.');
      const previous = this.models();
      for (const kind of MODEL_KINDS) {
        if (kind === 'instant') continue;
        try { value.choices[kind] = parseModelChoice({ ...value.choices[kind], model: kind === 'define' ? previous.fast : previous.deep }); }
        catch { throw new ModelControlsMigrationError(digest(['legacy-model-controls', legacy.value, this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(INSTANT_HELP_KEY) ?? null])); }
        value.origins[kind] = 'legacy';
      }
    }
    const instant = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(INSTANT_HELP_KEY) as { value: string } | undefined;
    if (instant) {
      const previous = this.instantHelp();
      value.choices.instant = parseModelChoice({ model: previous.model, effort: previous.effort, fast: false });
      value.origins.instant = 'legacy';
    }
    return modelControlsSnapshot(value);
  }

  saveModelControls(input: ModelControlsChange): ModelControlsSnapshot {
    const change = parseModelControlsChange(input);
    return this.reader.db.transaction(() => {
      const current = this.modelControls();
      this.assertModelControlsRevision(current, change);
      const { compatibilityKey: _key, ...next } = current;
      next.choices[change.kind] = change.choice;
      next.origins[change.kind] = 'reader';
      return this.persistModelControls(next);
    })();
  }

  resetModelControls(input: ModelControlsReset): ModelControlsSnapshot {
    const change = parseModelControlsReset(input);
    return this.reader.db.transaction(() => {
      let current: ModelControlsSnapshot;
      try { current = this.modelControls(); }
      catch (error) {
        if (!(error instanceof ModelControlsMigrationError)) throw error;
        if (change.expectedRevision !== error.expectedRevision || change.expectedCompatibilityKey !== error.expectedCompatibilityKey) throw new ConflictError('Legacy model choices changed. Review them again.');
        return this.persistModelControls(defaultModelControls());
      }
      this.assertModelControlsRevision(current, change);
      return this.persistModelControls({ ...defaultModelControls(), revision: current.revision });
    })();
  }

  private assertModelControlsRevision(current: ModelControlsSnapshot, change: ModelControlsReset) {
    if (current.revision !== change.expectedRevision || current.compatibilityKey !== change.expectedCompatibilityKey) throw new ConflictError('Model choices changed elsewhere. Reload Settings before saving.');
    if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Model controls revision needs review.');
  }

  private persistModelControls(value: ModelControls): ModelControlsSnapshot {
    const next = parseModelControls({ ...value, revision: value.revision + 1, updatedAt: new Date().toISOString() });
    this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(MODEL_CONTROLS_KEY, JSON.stringify(next));
    const result = modelControlsSnapshot(next);
    this.reader.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)')
      .run('model-controls-changed', JSON.stringify({ revision: result.revision, compatibilityKey: result.compatibilityKey }), next.updatedAt);
    return result;
  }

  models(): ModelSettings {
    const row = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(MODELS_KEY) as { value: string } | undefined;
    if (!row) return withCompatibility({ ...DEFAULT_MODELS, revision: 0, updatedAt: null });
    try {
      const value = JSON.parse(row.value) as StoredModels;
      validateStoredModels(value);
      return withCompatibility(value);
    } catch {
      throw new Error('Saved model choices are unavailable. Review the settings database before changing them.');
    }
  }

  saveModels(change: ModelSettingsChange): ModelSettings {
    if (this.reader.db.prepare('SELECT 1 FROM settings WHERE key=?').get(MODEL_CONTROLS_KEY)) throw new ConflictError('Use the per-request model settings.');
    validateModel(change.fast);
    validateModel(change.deep);
    if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new Error('Invalid settings revision.');
    return this.reader.db.transaction(() => {
      const current = this.models();
      if (current.revision !== change.expectedRevision) throw new ConflictError('Model choices changed elsewhere. Reload Settings before saving.');
      if (current.fast === change.fast && current.deep === change.deep) return current;
      const next: StoredModels = { fast: change.fast, deep: change.deep, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(MODELS_KEY, JSON.stringify(next));
      const value = withCompatibility(next);
      this.reader.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)')
        .run('model-settings-changed', JSON.stringify({ revision: value.revision, compatibilityKey: value.compatibilityKey }), next.updatedAt);
      return value;
    })();
  }

  modelFor(tier: ModelTier): ModelSelection {
    if (tier !== 'fast' && tier !== 'deep') throw new Error('Unknown model choice.');
    const settings = this.models();
    return { model: settings[tier], settingsRevision: settings.revision, compatibilityKey: settings.compatibilityKey };
  }

  /**
   * T06 combines this host-owned model identity with T13's current permission fingerprint
   * before creating a Codex policy. A mismatch means start/fork, never resume.
   */
  continuationIdentity(choice: ModelSelection, permissionFingerprint: string): string {
    if (!isDigest(permissionFingerprint)) throw new Error('Invalid permission identity.');
    validateModel(choice.model);
    if (!Number.isSafeInteger(choice.settingsRevision) || choice.settingsRevision < 0 || !isDigest(choice.compatibilityKey)) throw new Error('Invalid model compatibility identity.');
    return digest(['marginalia.continuation.v1', choice.model, choice.settingsRevision, choice.compatibilityKey, permissionFingerprint]);
  }

  vocabulary(): VocabularyEntry[] {
    const entries = this.reader.db.prepare('SELECT termKey,term,status,firstSeen,lastSeen FROM vocabulary ORDER BY term COLLATE NOCASE,term').all() as Array<Omit<VocabularyEntry, 'origins'> & { termKey: string }>;
    const origins = this.reader.db.prepare('SELECT operationId,termKey,origin,observedAt,sourceKind,sourceId,sourceRevision FROM vocabulary_origins ORDER BY observedAt,operationId').all() as VocabularyOriginRow[];
    return entries.map(({ termKey, ...entry }) => ({ ...entry, origins: origins.filter(origin => origin.termKey === termKey).map(readOrigin) }));
  }

  autoAssist(): AutoAssistSettings {
    const row = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(AUTO_ASSIST_KEY) as { value: string } | undefined;
    if (!row) return defaultAutoAssistSettings();
    const value = JSON.parse(row.value) as AutoAssistSettings;
    validateAutoAssistSettings(value);
    return value;
  }

  saveAutoAssist(change: AutoAssistSettingsChange): AutoAssistSettings {
    if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new Error('Invalid settings revision.');
    const { expectedRevision, ...fields } = change;
    const next: AutoAssistSettings = { ...fields, version: 1, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    validateAutoAssistSettings(next);
    return this.reader.db.transaction(() => {
      if (this.autoAssist().revision !== expectedRevision) throw new ConflictError('Auto assist settings changed elsewhere. Reload Settings before saving.');
      this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(AUTO_ASSIST_KEY, JSON.stringify(next));
      this.reader.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)')
        .run('auto-assist-settings-changed', JSON.stringify({ revision: next.revision }), next.updatedAt);
      return next;
    }).immediate();
  }

  instantHelp(): InstantHelpSettings {
    const row = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(INSTANT_HELP_KEY) as { value: string } | undefined;
    if (!row) return defaultInstantHelpSettings();
    const value = JSON.parse(row.value) as InstantHelpSettings;
    validateInstantSettings(value);
    return value;
  }

  saveInstantHelp(change: InstantHelpSettingsChange): InstantHelpSettings {
    if (this.reader.db.prepare('SELECT 1 FROM settings WHERE key=?').get(MODEL_CONTROLS_KEY)) {
      const previous = this.instantHelp();
      if (change.model !== previous.model || change.effort !== previous.effort) throw new ConflictError('Use the per-request model settings.');
    }
    if (!Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new Error('Invalid settings revision.');
    const { expectedRevision, ...fields } = change;
    const next: InstantHelpSettings = { ...fields, version: 1, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    validateInstantSettings(next);
    return this.reader.db.transaction(() => {
      if (this.instantHelp().revision !== expectedRevision) throw new ConflictError('Instant help settings changed elsewhere. Reload Settings before saving.');
      this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(INSTANT_HELP_KEY, JSON.stringify(next));
      this.reader.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)')
        .run('instant-help-settings-changed', JSON.stringify({ revision: next.revision }), next.updatedAt);
      return next;
    }).immediate();
  }

  vocabularyGathering(): import('../contracts/library.ts').VocabularyGatheringSettings {
    const row = this.reader.db.prepare('SELECT value FROM settings WHERE key=?').get(GATHERING_KEY) as { value: string } | undefined;
    if (!row) return { enabled: true, revision: 0 };
    const value = JSON.parse(row.value);
    if (!value || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('Saved vocabulary gathering settings need review.');
    return { enabled: value.enabled, revision: value.revision };
  }

  saveVocabularyGathering(change: { enabled: boolean; expectedRevision: number }) {
    if (!change || typeof change.enabled !== 'boolean' || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0) throw new Error('Invalid vocabulary gathering setting.');
    return this.reader.db.transaction(() => {
      const current = this.vocabularyGathering();
      if (current.revision !== change.expectedRevision) throw new ConflictError('Vocabulary gathering changed elsewhere. Review the current setting.');
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Vocabulary gathering revision needs review.');
      const next = { enabled: change.enabled, revision: current.revision + 1 };
      this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(GATHERING_KEY, JSON.stringify(next));
      return next;
    })();
  }

  skipVocabulary(term: string): { term: string; skipped: true } {
    const normalized = normalizeTerm(term);
    this.reader.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(SKIP_PREFIX + normalized.toLowerCase(), 'true');
    return { term: normalized, skipped: true };
  }

  canGatherVocabulary(term: string): boolean {
    if (!this.vocabularyGathering().enabled) return false;
    // Suppression survives deleting the visible vocabulary entry and its origins.
    return !this.reader.db.prepare('SELECT 1 FROM settings WHERE key=?').get(SKIP_PREFIX + normalizeTerm(term).toLowerCase());
  }

  recordVocabularyObservation(input: VocabularyObservation): VocabularyObservationResult {
    const observation = validateObservation(input), termKey = observation.term;
    const fingerprint = digest(['marginalia.vocabulary-observation.v1', observation]);
    return this.reader.db.transaction(() => {
      const previous = this.reader.db.prepare('SELECT digest,termKey,deletedAt FROM vocabulary_operations WHERE operationId=?').get(observation.operationId) as { digest: string; termKey: string | null; deletedAt: string | null } | undefined;
      if (previous) {
        if (previous.digest !== fingerprint) throw new ConflictError('This vocabulary action identifier was already used for different content.');
        if (!previous.termKey || previous.deletedAt) return { recorded: false, deleted: true };
        return { recorded: false, deleted: false, entry: this.vocabulary().find(entry => vocabularyKey(entry.term) === previous.termKey) };
      }
      validateVocabularySource(this.reader, observation.source, observation.term);
      const existing = this.reader.db.prepare('SELECT termKey,firstSeen,lastSeen FROM vocabulary WHERE termKey=?').get(termKey) as { termKey: string; firstSeen: string; lastSeen: string } | undefined;
      if (!existing) this.reader.db.prepare('INSERT INTO vocabulary VALUES(?,?,?,?,?)').run(termKey, observation.term, 'active', observation.observedAt, observation.observedAt);
      else this.reader.db.prepare('UPDATE vocabulary SET firstSeen=?,lastSeen=? WHERE termKey=?').run(observation.observedAt < existing.firstSeen ? observation.observedAt : existing.firstSeen, observation.observedAt > existing.lastSeen ? observation.observedAt : existing.lastSeen, termKey);
      const stored = storeSource(observation.source);
      this.reader.db.prepare('INSERT INTO vocabulary_origins VALUES(?,?,?,?,?,?,?)').run(observation.operationId, termKey, observation.origin, observation.observedAt, stored.kind, stored.id, stored.revision);
      this.reader.db.prepare('INSERT INTO vocabulary_operations VALUES(?,?,?,?,NULL)').run(observation.operationId, fingerprint, termKey, observation.observedAt);
      this.reader.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)').run('vocabulary-observed', JSON.stringify({ operationId: observation.operationId }), observation.observedAt);
      return { recorded: true, deleted: false, entry: this.vocabulary().find(entry => vocabularyKey(entry.term) === termKey)! };
    })();
  }

  deleteVocabulary(term: string): { deleted: boolean; term: string } {
    const normalized = normalizeTerm(term), termKey = vocabularyKey(normalized);
    return this.reader.db.transaction(() => {
      const now = new Date().toISOString();
      this.reader.db.prepare('UPDATE vocabulary_operations SET termKey=NULL,deletedAt=? WHERE termKey=?').run(now, termKey);
      const result = this.reader.db.prepare('DELETE FROM vocabulary WHERE termKey=?').run(termKey);
      if (result.changes) this.reader.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)').run('vocabulary-deleted', JSON.stringify({ deleted: true }), now);
      return { deleted: result.changes > 0, term: normalized };
    })();
  }
}

function validateModel(value: string): void {
  if (typeof value !== 'string' || !MODEL_NAME.test(value)) throw new Error('Use a valid model name.');
}
function validateStoredModels(value: StoredModels): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid model settings.');
  validateModel(value.fast); validateModel(value.deep);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid model settings.');
}
function normalizeTerm(value: string): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) throw new Error('Invalid vocabulary term.');
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if ([...normalized].length < 1 || [...normalized].length > 300) throw new Error('Invalid vocabulary term.');
  return normalized;
}
function vocabularyKey(value: string): string { return normalizeTerm(value); }
function validateObservation(value: VocabularyObservation): VocabularyObservation {
  if (!value || typeof value !== 'object') throw new Error('Invalid vocabulary observation.');
  requireExactKeys(value as unknown as Record<string, unknown>, ['operationId', 'term', 'origin', 'observedAt', 'source'], 'vocabulary observation');
  requireId(value.operationId, 'vocabulary action');
  if (value.origin !== 'stated') throw new Error('Only an explicit Remember action can add vocabulary.');
  if (typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))) throw new Error('Invalid vocabulary observation time.');
  if (!value.source || typeof value.source !== 'object' || !['reader', 'note', 'definition'].includes(value.source.kind)) throw new Error('Invalid vocabulary source reference.');
  return { ...value, term: normalizeTerm(value.term), source: structuredClone(value.source) };
}
function validateVocabularySource(reader: ReaderStore, source: VocabularySourceReference, term: string): void {
  if (source.kind === 'reader') {
    if (Object.keys(source).length !== 1) throw new Error('Invalid reader vocabulary source.');
    return;
  }
  if (source.kind === 'note') {
    requireExactKeys(source as unknown as Record<string, unknown>, ['kind', 'noteId', 'revision'], 'note vocabulary source');
    requireId(source.noteId, 'note');
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) throw new Error('Invalid note revision.');
    const note = reader.noteVersion({ noteId: source.noteId, revision: source.revision });
    if (!note || !note.text.normalize('NFC').includes(term)) throw new Error('The saved note version does not contain this term.');
    return;
  }
  requireExactKeys(source as unknown as Record<string, unknown>, ['kind', 'jobId', 'replyVersionId'], 'definition vocabulary source');
  requireId(source.jobId, 'job'); requireId(source.replyVersionId, 'reply');
  if (!reader.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()) throw new Error('The succeeded definition result could not be verified.');
  const row = reader.db.prepare("SELECT state,replyVersionId FROM jobs WHERE id=?").get(source.jobId) as { state: string; replyVersionId: string | null } | undefined;
  const reply = reader.reply(source.replyVersionId);
  if (!row || row.state !== 'succeeded' || row.replyVersionId !== source.replyVersionId || reply?.reply.intent !== 'define') throw new Error('The succeeded definition result could not be verified.');
}
type VocabularyOriginRow = { operationId: string; termKey: string; origin: string; observedAt: string; sourceKind: string; sourceId: string | null; sourceRevision: number | null };
function readOrigin(row: VocabularyOriginRow): VocabularyOrigin {
  const origin: VocabularyOriginKind = ['used', 'looked-up', 'stated', 'legacy'].includes(row.origin) ? row.origin as VocabularyOriginKind : 'legacy';
  let source: VocabularySourceReference = { kind: 'reader' };
  if (row.sourceKind === 'note' && row.sourceId && Number.isSafeInteger(row.sourceRevision)) source = { kind: 'note', noteId: row.sourceId, revision: row.sourceRevision! };
  else if (row.sourceKind === 'definition' && row.sourceId) {
    try { const value = JSON.parse(row.sourceId) as { jobId: string; replyVersionId: string }; source = { kind: 'definition', jobId: value.jobId, replyVersionId: value.replyVersionId }; } catch { /* Historical unreadable references remain reader-visible legacy origins. */ }
  }
  return { operationId: row.operationId, origin, observedAt: row.observedAt, source };
}
function storeSource(source: VocabularySourceReference): { kind: string; id: string | null; revision: number | null } {
  if (source.kind === 'reader') return { kind: source.kind, id: null, revision: null };
  if (source.kind === 'note') return { kind: source.kind, id: source.noteId, revision: source.revision };
  return { kind: source.kind, id: JSON.stringify({ jobId: source.jobId, replyVersionId: source.replyVersionId }), revision: null };
}
function requireExactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`Invalid ${label}.`);
}
function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) throw new Error(`Invalid ${label} identifier.`);
}

const RELATED_STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from', 'have', 'into', 'more', 'other', 'should', 'their', 'there', 'these', 'they', 'this', 'those', 'through', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your']);
function searchTerms(value: string, maximum = 12): string[] {
  if (typeof value !== 'string' || value.length > 300) throw new Error('Search must be 300 characters or fewer.');
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [])].slice(0, maximum);
}
function resultLimit(value: number, maximum = 50): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Result limit must be between 1 and ${maximum}.`);
  return value;
}
function quotedTerms(terms: string[]): string { return terms.slice(0, 4).map(term => `“${term}”`).join(', ') || 'the search words'; }
function locateAnchor(text: string, exact: string, expected: number) {
  const start = text.slice(expected, expected + exact.length) === exact ? expected : text.indexOf(exact);
  return start < 0 ? undefined : excerpt(text, start, start + Math.min(exact.length, 280));
}
function locatePassage(text: string, terms: string[]) {
  const locations = terms.flatMap(term => wordLocations(text, term).slice(0, 1)).sort((a, b) => a.at - b.at);
  if (!locations.length) return undefined;
  const first = locations[0], nearby = locations.filter(value => value.at - first.at < 280), last = nearby[nearby.length - 1];
  return excerpt(text, first.at, last.at + last.length);
}
function wordLocations(text: string, term: string) {
  // Match SQLite's case/diacritic-insensitive words without losing original UTF-16 offsets.
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const target = normalize(term);
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) {
    if (normalize(match[0]) === target) return [{ at: match.index, length: match[0].length }];
  }
  return [];
}
function excerpt(text: string, matchStart: number, matchEnd: number) {
  let start = Math.max(0, matchStart - 100), end = Math.min(text.length, Math.max(matchEnd + 100, start + 160));
  const before = text.lastIndexOf('\n', matchStart); if (before >= start) start = before + 1;
  const after = text.indexOf('\n', matchEnd); if (after >= 0 && after <= end) end = after;
  return { passage: text.slice(start, end), start, end };
}
function withCompatibility(value: { fast: string; deep: string; revision: number; updatedAt: string | null }): ModelSettings {
  return { ...value, compatibilityKey: digest(['marginalia.models.v1', value.fast, value.deep, value.revision]) };
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateInstantSettings(value: InstantHelpSettings) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.enabled !== 'boolean') throw new Error('Invalid instant help settings.');
  if (!INSTANT_MODELS.includes(value.model)) throw new Error('This instant help model is not supported.');
  if (value.effort !== 'medium' && value.effort !== 'high') throw new Error('This instant help effort is not supported.');
  if (value.defaultAction !== 'define' && value.defaultAction !== 'explain-simply') throw new Error('Invalid instant help action.');
  if (!value.tokenBudget || value.tokenBudget.period !== 'day' || typeof value.tokenBudget.timezone !== 'string' || !value.tokenBudget.timezone) throw new Error('Invalid instant help daily budget.');
  try { new Intl.DateTimeFormat('en', { timeZone: value.tokenBudget.timezone }); } catch { throw new Error('Invalid instant help timezone.'); }
  for (const number of [value.tokenBudget.limit, value.warmPages, value.idleMinutes]) if (!Number.isSafeInteger(number) || number < 1) throw new Error('Instant help limits must be positive whole numbers.');
  if (!value.disclosure || !Number.isSafeInteger(value.disclosure.version) || value.disclosure.version < 1) throw new Error('Invalid instant help disclosure.');
  for (const date of [value.updatedAt, value.disclosure.acknowledgedAt]) if (date !== null && (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) throw new Error('Invalid instant help date.');
}

function validateAutoAssistSettings(value: AutoAssistSettings) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.enabled !== 'boolean') throw new Error('Invalid auto assist settings.');
  if (value.method !== 'frequency-page-v0') throw new Error('This auto assist method is not available.');
  if (!Object.hasOwn(AUTO_ASSIST_POSTURE_LIMITS, value.posture)) throw new Error('This reading posture is not supported.');
  if (!value.autoDefinitions || value.autoDefinitions.budgetPercent !== AUTO_DEFINITION_BUDGET_PERCENT
    || value.autoDefinitions.batchSize !== AUTO_DEFINITION_BATCH_SIZE) throw new Error('Invalid automatic definition settings.');
  if (value.updatedAt !== null && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))) throw new Error('Invalid auto assist date.');
}

function modelControlsSnapshot(value: ModelControls): ModelControlsSnapshot {
  const normalized = parseModelControls(value);
  return { ...normalized, compatibilityKey: digest(['marginalia.model-controls.v2', normalized]) };
}
