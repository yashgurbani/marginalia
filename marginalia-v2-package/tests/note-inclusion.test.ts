import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  InvalidNoteInclusionError, validateFrozenSelectedNote, validateNoteChoice,
  validateNoteInclusionManifest, validateNoteOperationProvenance, validateRequestOperation,
  validateSelectedNoteRef, validateTargetRef,
} from '../contracts/note-inclusion.ts';
import type { FrozenSelectedNote, NoteChoice, NoteInclusionManifest, NoteOperationProvenance, SelectedNoteRef } from '../contracts/note-inclusion.ts';
import type { PrepareJobInput, PrepareNoteOperationJobInput, StartJobInput } from '../contracts/jobs.ts';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const target = { threadId: 'target-thread', sourceVersionId: 'article-A-v2', sourceHash: sha('A2') };
const ref = (noteId = 'note-B', revision = 2): SelectedNoteRef => ({
  threadId: 'thread-B', sourceVersionId: 'article-B-v1', sourceHash: sha('B1'), noteId, revision,
});
const choice = (): NoteChoice => ({ schema: 'marginalia.note-choice.v2', proposalId: 'proposal-1',
  proposalGeneration: 0, target: { ...target }, included: [ref()], excluded: [ref('note-C')] });
const frozen = (noteId = 'note-B', text = '  Old saved note 🌱\n'): FrozenSelectedNote => ({
  ...ref(noteId), text, textSha256: sha(text), originalCharacters: text.length,
  includedCharacters: text.length, originalBytes: Buffer.byteLength(text), includedBytes: Buffer.byteLength(text),
  omittedCharacters: 0, omittedBytes: 0, sourceUrl: 'https://b.example/article', sourceTitle: 'Article B', sourceCapturedAt: null,
});
const manifest = (): NoteInclusionManifest => ({ ...choice(), schema: 'marginalia.note-inclusion.v2',
  operation: 'relate-notes', recipeVersion: 1, intent: 'unsure', included: [frozen()],
  contentDigest: sha('content'), selectionDigest: sha('selection'), eligibilityDigest: sha('eligibility'),
});
const provenance = (): NoteOperationProvenance => ({ schema: 'marginalia.note-operation-provenance.v2',
  jobId: 'job-1', operation: 'relate-notes', recipeVersion: 1, intent: 'unsure', target: { ...target },
  included: [{ ...ref(), textSha256: sha('note') }], contentDigest: sha('content'),
  selectionDigest: sha('selection'), eligibilityDigest: sha('eligibility'),
});
const rejects = (validate: (value: unknown) => void, value: unknown, code = 'invalid-note-inclusion') =>
  assert.throws(() => validate(value), (error: unknown) => error instanceof InvalidNoteInclusionError && error.code === code);

test('cross-article historical references stay independent of target; validation never substitutes or reorders', () => {
  const input = choice();
  input.included.push({ ...ref('note-D', 1), threadId: 'thread-D', sourceVersionId: 'article-D-v0', sourceHash: sha('D0') });
  const before = structuredClone(input);
  Object.freeze(input.included);
  Object.freeze(input.excluded);
  Object.freeze(input);
  validateNoteChoice(input);
  assert.deepEqual(input, before);
  assert.equal(input.included[0].sourceVersionId, 'article-B-v1');
  assert.notEqual(input.target.sourceHash, input.included[0].sourceHash);
  const reversed = { ...input, included: [...input.included].reverse() };
  validateNoteChoice(reversed);
  assert.notDeepEqual(reversed.included, input.included);
});

test('32 included and 32 actual exclusions are independent bounds; overflow preserves the entire proposal', () => {
  const input = choice();
  input.included = Array.from({ length: 32 }, (_, i) => ref(`included-${i}`));
  input.excluded = Array.from({ length: 32 }, (_, i) => ref(`excluded-${i}`));
  validateNoteChoice(input);
  for (const side of ['included', 'excluded'] as const) {
    const tooMany = structuredClone(input);
    tooMany[side].push(ref(`${side}-33`));
    const before = structuredClone(tooMany);
    rejects(validateNoteChoice, tooMany, 'proposal-limit');
    assert.deepEqual(tooMany, before);
  }
  rejects(validateNoteChoice, { ...input, included: [] });
  validateNoteChoice({ ...input, excluded: [] });
});

test('same saved note cannot evade duplicates through a revision, thread or source change', () => {
  for (const side of ['included', 'excluded'] as const) {
    for (const replacement of [ref(), ref('note-B', 3), { ...ref(), threadId: 'other-thread' },
      { ...ref(), sourceVersionId: 'article-B-v2', sourceHash: sha('B2') }]) {
      const input = choice();
      input[side].push(replacement);
      rejects(validateNoteChoice, input);
    }
  }
  const input = choice();
  input.excluded.push(ref('note-C', 3));
  rejects(validateNoteChoice, input);
});

test('strict records reject foreign authority, missing fields, unknown versions and malformed arrays', () => {
  for (const [validate, valid] of [
    [validateTargetRef, target], [validateSelectedNoteRef, ref()], [validateNoteChoice, choice()],
    [validateFrozenSelectedNote, frozen()], [validateNoteInclusionManifest, manifest()],
    [validateNoteOperationProvenance, provenance()],
    [validateRequestOperation, { kind: 'relate-notes', recipeVersion: 1, choice: choice() }],
  ] as const) {
    for (const key of Object.keys(valid)) {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[key];
      rejects(validate, missing);
    }
    for (const bad of [null, [], 'record', { ...valid, grantId: 'caller-grant' }, { ...valid, [Symbol('hidden')]: true }]) rejects(validate, bad);
  }
  rejects(validateNoteChoice, { ...choice(), schema: 'marginalia.note-choice.v1' });
  rejects(validateNoteChoice, { ...choice(), included: new Array(1) });
  rejects(validateNoteChoice, { ...choice(), excluded: {} });
  rejects(validateNoteChoice, { ...choice(), included: [{ ...ref(), text: 'forged content' }] });
  rejects(validateNoteChoice, { ...choice(), target: { ...target, noteId: 'target-is-not-a-member' } });
});

test('identifier, hash, revision and generation bounds are exact', () => {
  validateSelectedNoteRef({ ...ref(), noteId: 'a'.repeat(100), revision: Number.MAX_SAFE_INTEGER });
  validateNoteChoice({ ...choice(), proposalGeneration: Number.MAX_SAFE_INTEGER });
  for (const bad of ['', 'a'.repeat(101), 'with space', '../note', 'é', 'note\n', 'note\r', 4]) rejects(validateSelectedNoteRef, { ...ref(), noteId: bad });
  for (const bad of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), `${sha('note')}\n`, null]) {
    rejects(validateSelectedNoteRef, { ...ref(), sourceHash: bad });
    rejects(validateFrozenSelectedNote, { ...frozen(), textSha256: bad });
    rejects(validateNoteInclusionManifest, { ...manifest(), selectionDigest: bad });
  }
  for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) rejects(validateSelectedNoteRef, { ...ref(), revision: bad });
  for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) rejects(validateNoteChoice, { ...choice(), proposalGeneration: bad });
});

test('operations and answer forms stay separate; structural validity is not runtime recipe admission', () => {
  validateRequestOperation({ kind: 'ordinary' });
  rejects(validateRequestOperation, undefined);
  rejects(validateRequestOperation, { kind: 'ordinary', choice: choice() });
  for (const kind of ['notes-together', 'relate-notes']) {
    validateRequestOperation({ kind, recipeVersion: 1, choice: choice() });
    for (const recipeVersion of [0, 2, '1', null]) rejects(validateRequestOperation, { kind, recipeVersion, choice: choice() });
  }
  rejects(validateRequestOperation, { kind: 'reflection', recipeVersion: 1, choice: choice() });
  rejects(validateNoteInclusionManifest, { ...manifest(), intent: 'relate-notes' });
  // The form axis is preserved; only later admission can approve a recipe/form combination.
  validateNoteInclusionManifest({ ...manifest(), intent: 'diagram' });
});

test('complete whitespace and UTF-8 lengths survive; no 16 KiB collection cap or clipping', () => {
  for (const text of [' \nquoted "\\" 🌱 café\t', 'a'.repeat(20000), '界'.repeat(20000)]) {
    const note = frozen('note-B', text);
    const before = structuredClone(note);
    validateFrozenSelectedNote(note);
    validateNoteInclusionManifest({ ...manifest(), included: [note] });
    assert.deepEqual(note, before);
  }
  const many = { ...manifest(), included: Array.from({ length: 32 }, (_, i) => frozen(`note-${i}`, 'a'.repeat(20000))) };
  validateNoteInclusionManifest(many); // Shape-valid does not mean the actual outgoing envelope fits.
  for (const text of ['', ' \t\n']) rejects(validateFrozenSelectedNote, frozen('note-B', text), 'empty-note');
  rejects(validateFrozenSelectedNote, frozen('note-B', 'a'.repeat(20001)));
  const note = frozen();
  for (const key of ['originalCharacters', 'includedCharacters', 'originalBytes', 'includedBytes', 'omittedCharacters', 'omittedBytes'] as const) {
    rejects(validateFrozenSelectedNote, { ...note, [key]: note[key] + 1 });
  }
});

test('equal text in distinct notes is legitimate; excluded identities never enter the reply provenance shape', () => {
  const input = manifest();
  input.included.push(frozen('note-D', input.included[0].text));
  validateNoteInclusionManifest(input);
  validateNoteOperationProvenance(provenance());
  rejects(validateNoteOperationProvenance, { ...provenance(), excluded: input.excluded });
  rejects(validateNoteOperationProvenance, { ...provenance(), included: [frozen()] });
  rejects(validateNoteOperationProvenance, { ...provenance(), included: [provenance().included[0], provenance().included[0]] });
});

test('ordinary request types stay compatible without an operation; aggregate types cannot combine initial contexts', () => {
  const prepare = { id: 'job', idempotencyKey: 'key', threadId: 'thread', intent: 'unsure', question: 'Why?' } satisfies PrepareJobInput;
  const ordinary: StartJobInput = { ...prepare, provider: 'app-server', model: 'model', mode: 'workspace-files',
    policyKey: 'policy', grantId: 'grant', preparedPayloadDigest: sha('payload') };
  const aggregate: PrepareNoteOperationJobInput = { ...prepare, operation: { kind: 'notes-together', recipeVersion: 1, choice: choice() } };
  // @ts-expect-error An initial aggregate cannot also carry an answered note.
  const mixedNote: PrepareNoteOperationJobInput = { ...aggregate, answeredNote: { noteId: 'note', revision: 1 } };
  // @ts-expect-error An initial aggregate cannot inherit a generated parent.
  const mixedParent: PrepareNoteOperationJobInput = { ...aggregate, parentReplyId: 'parent' };
  // @ts-expect-error An initial aggregate cannot add a reader skill recipe.
  const mixedSkill: PrepareNoteOperationJobInput = { ...aggregate, readerSkill: { name: 'skill', catalogRevision: 'rev' } };
  assert.equal('operation' in ordinary, false);
  assert.equal(aggregate.operation.kind, 'notes-together');
  void [mixedNote, mixedParent, mixedSkill];
});
