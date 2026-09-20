import type { Intent } from './reply.ts';

/** Disabled S1 vocabulary only. Parsing grants no source, send or resume authority. */
export type TargetRef = { threadId: string; sourceVersionId: string; sourceHash: string };
export type SelectedNoteRef = TargetRef & { noteId: string; revision: number };
export type NoteChoice = {
  schema: 'marginalia.note-choice.v2';
  proposalId: string;
  proposalGeneration: number;
  target: TargetRef;
  included: SelectedNoteRef[];
  /** Only actually reviewed exclusions; local receipt, never provider context. */
  excluded: SelectedNoteRef[];
};
export type NoteOperationKind = 'notes-together' | 'relate-notes';
export type NoteOperation = { kind: NoteOperationKind; recipeVersion: 1; choice: NoteChoice };
export type RequestOperation = { kind: 'ordinary' } | NoteOperation;

/** Complete immutable content, with the member's own disclosed source provenance. */
export type FrozenSelectedNote = SelectedNoteRef & {
  text: string;
  textSha256: string;
  originalCharacters: number;
  includedCharacters: number;
  originalBytes: number;
  includedBytes: number;
  omittedCharacters: 0;
  omittedBytes: 0;
  sourceUrl: string;
  sourceTitle: string;
  sourceCapturedAt: string | null;
};
export type NoteInclusionManifest = {
  schema: 'marginalia.note-inclusion.v2';
  operation: NoteOperationKind;
  recipeVersion: 1;
  intent: Intent;
  target: TargetRef;
  proposalId: string;
  proposalGeneration: number;
  included: FrozenSelectedNote[];
  /** Local only, along with selectionDigest and eligibilityDigest. */
  excluded: SelectedNoteRef[];
  contentDigest: string;
  selectionDigest: string;
  eligibilityDigest: string;
};
export type IncludedNoteProvenance = SelectedNoteRef & { textSha256: string };
/** Host-owned accepted-reply record. Exclusions and note text are deliberately absent. */
export type NoteOperationProvenance = {
  schema: 'marginalia.note-operation-provenance.v2';
  jobId: string;
  operation: NoteOperationKind;
  recipeVersion: 1;
  intent: Intent;
  target: TargetRef;
  included: IncludedNoteProvenance[];
  contentDigest: string;
  selectionDigest: string;
  eligibilityDigest: string;
};

export class InvalidNoteInclusionError extends Error {
  override name = 'InvalidNoteInclusion';
  readonly code: 'invalid-note-inclusion' | 'proposal-limit' | 'empty-note';
  constructor(code: 'invalid-note-inclusion' | 'proposal-limit' | 'empty-note', message: string) {
    super(message);
    this.code = code;
  }
}

const targetKeys = ['threadId', 'sourceVersionId', 'sourceHash'];
const refKeys = [...targetKeys, 'noteId', 'revision'];
const frozenKeys = [...refKeys, 'text', 'textSha256', 'originalCharacters', 'includedCharacters',
  'originalBytes', 'includedBytes', 'omittedCharacters', 'omittedBytes', 'sourceUrl', 'sourceTitle', 'sourceCapturedAt'];
const digests = ['contentDigest', 'selectionDigest', 'eligibilityDigest'];
const forms: readonly Intent[] = ['define', 'simulate', 'instantiate', 'derive', 'diagram', 'evidence', 'explore', 'unsure'];
function invalid(message: string): never { throw new InvalidNoteInclusionError('invalid-note-inclusion', message); }
const id = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 100 && !/[^\w-]/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && !/[^a-f0-9]/.test(value);
const counter = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a record.');
  const row = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(row);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) {
    invalid('Missing or unknown fields.');
  }
  return row;
}
function targetFields(row: Record<string, unknown>): void {
  if (!id(row.threadId) || !id(row.sourceVersionId) || !hash(row.sourceHash)) invalid('Invalid source reference.');
}
function refFields(row: Record<string, unknown>): void {
  targetFields(row);
  if (!id(row.noteId) || !counter(row.revision) || row.revision < 1) invalid('Invalid note reference.');
}
export function validateTargetRef(value: unknown): asserts value is TargetRef {
  targetFields(record(value, targetKeys));
}
export function validateSelectedNoteRef(value: unknown): asserts value is SelectedNoteRef {
  refFields(record(value, refKeys));
}
function proposalFields(row: Record<string, unknown>): void {
  if (!id(row.proposalId) || !counter(row.proposalGeneration)) invalid('Invalid proposal identity.');
  validateTargetRef(row.target);
}
function members(included: unknown, excluded: unknown, validateIncluded: (value: unknown) => void): void {
  if (!Array.isArray(included) || !Array.isArray(excluded) || included.length === 0) invalid('Choose at least one note.');
  if (included.length > 32 || excluded.length > 32) {
    throw new InvalidNoteInclusionError('proposal-limit', 'At most 32 included and 32 reviewed excluded notes.');
  }
  const seen = new Set<string>();
  for (const [rows, validate] of [[included, validateIncluded], [excluded, validateSelectedNoteRef]] as const) {
    for (const row of rows) {
      validate(row);
      // A saved note has one global identity: changing revision/source cannot evade exclusion.
      const noteId = (row as SelectedNoteRef).noteId;
      if (seen.has(noteId)) invalid('Duplicate note identity.');
      seen.add(noteId);
    }
  }
}
/** Checks structure only; no lookup, sorting, latest-version substitution or mutation. */
export function validateNoteChoice(value: unknown): asserts value is NoteChoice {
  const row = record(value, ['schema', 'proposalId', 'proposalGeneration', 'target', 'included', 'excluded']);
  if (row.schema !== 'marginalia.note-choice.v2') invalid('Unsupported choice schema.');
  proposalFields(row);
  members(row.included, row.excluded, validateSelectedNoteRef);
}
export function validateRequestOperation(value: unknown): asserts value is RequestOperation {
  if (value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'ordinary') {
    record(value, ['kind']);
    return;
  }
  const row = record(value, ['kind', 'recipeVersion', 'choice']);
  if (!operationKind(row.kind) || row.recipeVersion !== 1) invalid('Unsupported note operation or recipe version.');
  validateNoteChoice(row.choice);
}
function operationKind(value: unknown): value is NoteOperationKind {
  return value === 'notes-together' || value === 'relate-notes';
}
function operationFields(row: Record<string, unknown>): void {
  if (!operationKind(row.operation) || row.recipeVersion !== 1 || !forms.includes(row.intent as Intent)) {
    invalid('Invalid operation, recipe version or answer form.');
  }
  for (const key of digests) if (!hash(row[key])) invalid('Invalid digest format.');
  validateTargetRef(row.target);
}
/** Length consistency is checked here; the host must separately verify immutable text/hash authority. */
export function validateFrozenSelectedNote(value: unknown): asserts value is FrozenSelectedNote {
  const row = record(value, frozenKeys);
  refFields(row);
  if (typeof row.text !== 'string') invalid('Invalid note text.');
  if (!row.text.trim()) throw new InvalidNoteInclusionError('empty-note', 'Selected note is empty.');
  const bytes = new TextEncoder().encode(row.text).length;
  if (row.text.length > 20000 || !hash(row.textSha256) || row.originalCharacters !== row.text.length
    || row.includedCharacters !== row.text.length || row.originalBytes !== bytes || row.includedBytes !== bytes
    || row.omittedCharacters !== 0 || row.omittedBytes !== 0) invalid('Selected note must retain complete saved text and exact lengths.');
  if (typeof row.sourceUrl !== 'string' || !row.sourceUrl || typeof row.sourceTitle !== 'string'
    || (row.sourceCapturedAt !== null && typeof row.sourceCapturedAt !== 'string')) invalid('Invalid disclosed source provenance.');
}
/** Pure shape validation, not digest verification, eligibility checks or supported-form admission. */
export function validateNoteInclusionManifest(value: unknown): asserts value is NoteInclusionManifest {
  const row = record(value, ['schema', 'operation', 'recipeVersion', 'intent', 'target', 'proposalId',
    'proposalGeneration', 'included', 'excluded', ...digests]);
  if (row.schema !== 'marginalia.note-inclusion.v2') invalid('Unsupported manifest schema.');
  operationFields(row);
  proposalFields(row);
  members(row.included, row.excluded, validateFrozenSelectedNote);
}
export function validateNoteOperationProvenance(value: unknown): asserts value is NoteOperationProvenance {
  const row = record(value, ['schema', 'jobId', 'operation', 'recipeVersion', 'intent', 'target', 'included', ...digests]);
  if (row.schema !== 'marginalia.note-operation-provenance.v2' || !id(row.jobId)) invalid('Invalid provenance identity.');
  operationFields(row);
  members(row.included, [], value => {
    const note = record(value, [...refKeys, 'textSha256']);
    refFields(note);
    if (!hash(note.textSha256)) invalid('Invalid content hash format.');
  });
}
