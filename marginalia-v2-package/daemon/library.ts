import { createHash } from 'node:crypto';
import type { ModelSelection, ModelSettings, ModelSettingsChange, ModelTier, VocabularyEntry } from '../contracts/library.ts';
import type { Thread } from '../contracts/reader.ts';
import { ConflictError, type ReaderStore } from './store.ts';

const MODELS_KEY = 'library.models.v1';
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const DEFAULT_MODELS = Object.freeze({ fast: 'gpt-5.6-luna', deep: 'gpt-6-astra' });

type StoredModels = { fast: string; deep: string; revision: number; updatedAt: string };

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
    if (!/^[a-f0-9]{64}$/.test(permissionFingerprint)) throw new Error('Invalid permission identity.');
    validateModel(choice.model);
    if (!Number.isSafeInteger(choice.settingsRevision) || choice.settingsRevision < 0 || !/^[a-f0-9]{64}$/.test(choice.compatibilityKey)) throw new Error('Invalid model compatibility identity.');
    return digest(['marginalia.continuation.v1', choice.model, choice.settingsRevision, choice.compatibilityKey, permissionFingerprint]);
  }

  vocabulary(): VocabularyEntry[] {
    return this.reader.db.prepare('SELECT term,origin,status,firstSeen,lastSeen FROM vocabulary ORDER BY term COLLATE NOCASE,term').all() as VocabularyEntry[];
  }

  deleteVocabulary(term: string): { deleted: boolean; term: string } {
    const normalized = validateTerm(term);
    return this.reader.db.transaction(() => {
      const result = this.reader.db.prepare('DELETE FROM vocabulary WHERE term=?').run(normalized);
      if (result.changes) this.reader.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)')
        .run('vocabulary-deleted', JSON.stringify({ term: normalized }), new Date().toISOString());
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
function validateTerm(value: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 1 || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid vocabulary term.');
  return value;
}
function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) throw new Error(`Invalid ${label} identifier.`);
}
function withCompatibility(value: { fast: string; deep: string; revision: number; updatedAt: string | null }): ModelSettings {
  return { ...value, compatibilityKey: digest(['marginalia.models.v1', value.fast, value.deep, value.revision]) };
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
