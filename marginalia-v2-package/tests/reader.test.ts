import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachQuote, highlightColour, wholePageAnchor } from '../contracts/reader.ts';

test('whole-page intent contains no fabricated quote or text range', () => {
  const anchor = wholePageAnchor();
  assert.deepEqual(anchor, { kind: 'whole-page', exact: '', prefix: '', suffix: '', start: 0, end: 0 });
  assert.deepEqual(attachQuote(anchor, 'Entirely replaced page'), { state: 'exact', candidates: [] });
  assert.deepEqual(attachQuote({ ...anchor, kind: 'quote' }, 'text'), { state: 'lost', candidates: [] });
});

test('repeated quotes use complete context, never nearest original position', () => {
  const anchor = { exact: 'same', prefix: 'before ', suffix: ' after', start: 7, end: 11 };
  assert.deepEqual(attachQuote(anchor, 'same. before same after'), { state: 'moved', candidates: [{ start: 13, end: 17 }] });
  assert.equal(attachQuote({ ...anchor, prefix: '', suffix: '' }, 'before same after same').state, 'unsure');
  assert.equal(attachQuote(anchor, 'before same after before same after').state, 'unsure');
  assert.equal(attachQuote(anchor, 'before some after').state, 'lost');
  const many = attachQuote({ ...anchor, exact: 'a', prefix: '', suffix: '' }, 'a'.repeat(1000));
  assert.equal(many.state, 'unsure');
  assert.equal(many.candidates.length, 100);
});

test('T07 F7 shared validation enforces source, section, anchor, identity and mutation bounds', async () => {
  const { validateReaderMutation: validate, InvalidReaderMutationError } = await import('../contracts/reader.ts');
  const valid = {
    id: 'keep', threadId: 'thread', kind: 'keep' as const,
    capture: { url: 'https://example.org/', title: 'Title', pageType: 'article', text: 'Some text', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'v1' },
    anchor: { exact: 'Some', prefix: '', suffix: ' text', start: 0, end: 4 }, note: '',
  };
  const invalid: unknown[] = [
    { ...valid, id: 'x'.repeat(101) }, { ...valid, threadId: 'bad/id' },
    ...[
      { url: 'not a URL' }, { url: 'https://user:password@example.org/' }, { url: 'file:///private' }, { url: 'https://example.org/' + 'x'.repeat(8000) },
      { title: 'x'.repeat(1001) }, { pageType: 'x'.repeat(101) }, { text: 'x'.repeat(1000001) },
      { capturedAt: 'not a date' }, { extractionVersion: '' }, { extractionVersion: 'x'.repeat(101) },
      { sections: Array.from({ length: 2001 }, () => ({ title: 'A', start: 0, end: 1 })) },
      ...[
        [{ title: '', start: 0, end: 1 }], [{ title: 'x'.repeat(1001), start: 0, end: 1 }],
        [{ title: 'A', start: -1, end: 1 }], [{ title: 'A', start: 0, end: 0 }],
        [{ title: 'A', start: 0.5, end: 1 }], [{ title: 'A', start: 0, end: 10 }],
        [{ title: 'A', start: 0, end: 5 }, { title: 'B', start: 4, end: 6 }],
      ].map(sections => ({ sections })),
    ].map(capture => ({ ...valid, capture: { ...valid.capture, ...capture } })),
    ...[
      { exact: 'Else' }, { prefix: 'x'.repeat(257) }, { suffix: 'x'.repeat(257) },
      { start: -1 }, { end: 10 }, { end: 3 }, { kind: 'whole-page' },
      { exact: 'x'.repeat(16001), start: 0, end: 16001 },
    ].map(anchor => ({ ...valid, anchor: { ...valid.anchor, ...anchor } })),
    { ...valid, note: 'x'.repeat(20001) },
    { id: 'edit', threadId: 'thread', kind: 'note', noteId: 'note', expectedRevision: 0, text: 'x'.repeat(20001) },
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(expectedRevision => ({ id: 'edit', threadId: 'thread', kind: 'note', noteId: 'note', text: '', expectedRevision })),
    { id: 'state', threadId: 'thread', kind: 'thread-state', expectedRevision: 1, state: 'unknown' },
    { id: 'highlight', threadId: 'thread', kind: 'highlight', expectedRevision: 1, highlighted: 'yes' },
    { id: 'highlight-colour', threadId: 'thread', kind: 'highlight', expectedRevision: 1, highlighted: true, highlightColour: '<script>' },
    { id: 'removed-highlight-colour', threadId: 'thread', kind: 'highlight', expectedRevision: 1, highlighted: false, highlightColour: 'green' },
    { id: 'remove', threadId: 'thread', kind: 'remove', expectedRevision: 1, removed: 'yes' },
  ];
  for (const mutation of invalid) assert.throws(() => validate(mutation), InvalidReaderMutationError);
  assert.doesNotThrow(() => validate(valid));
  assert.doesNotThrow(() => validate({ ...valid, anchor: wholePageAnchor() }));
  assert.doesNotThrow(() => validate({ ...valid, capture: { ...valid.capture, sections: [{ title: 'First', start: 0, end: 4 }, { title: 'Second', start: 5, end: 9 }] } }));
  assert.doesNotThrow(() => validate({ id: 'x'.repeat(100), threadId: 'thread', kind: 'note', noteId: 'n', text: 'x'.repeat(20000), expectedRevision: Number.MAX_SAFE_INTEGER }));
  assert.doesNotThrow(() => validate({ id: 'state', threadId: 'thread', kind: 'thread-state', expectedRevision: 0, state: 'open' }));
  assert.doesNotThrow(() => validate({ id: 'highlight', threadId: 'thread', kind: 'highlight', expectedRevision: 0, highlighted: true }));
  assert.equal(highlightColour(undefined), 'yellow');
  assert.throws(() => highlightColour('<script>'), InvalidReaderMutationError);
  assert.doesNotThrow(() => validate({ id: 'highlight-green', threadId: 'thread', kind: 'highlight', expectedRevision: 0, highlighted: true, highlightColour: 'green' }));
});

test('Keep and Highlight remain distinct through local persistence, helper round trip, reload and removal', async () => {
  let saved: JournalState | undefined;
  const persistence = { load: async () => structuredClone(saved), save: async (value: JournalState) => { saved = structuredClone(value); } };
  const journal = new ReaderJournal(persistence);
  const keep = { id: 'keep-mark', threadId: 'mark-thread', kind: 'keep' as const,
    capture: { url: 'https://example.org/mark', title: 'Marked source', pageType: 'article', text: 'Keep this passage.', capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'v1' },
    anchor: { exact: 'Keep this passage.', prefix: '', suffix: '', start: 0, end: 18 }, note: 'Senior note' };
  await journal.change(keep);
  assert.equal(journal.state.threads[0].highlighted, false, 'Keep alone is the underline state');
  await journal.change({ id: 'add-highlight', kind: 'highlight', threadId: keep.threadId, highlighted: true, highlightColour: 'green', expectedRevision: 1 });
  const sent: ReaderMutation[] = [];
  await journal.sync(async change => { sent.push(change); }, async () => structuredClone(journal.state.threads));
  assert.deepEqual(sent.map(change => change.kind), ['keep', 'highlight']);

  const reopened = new ReaderJournal(persistence);
  await reopened.load();
  assert.equal(reopened.state.threads[0].highlighted, true);
  assert.equal(reopened.state.threads[0].highlightColour, 'green');
  await reopened.change({ id: 'remove-highlight', kind: 'highlight', threadId: keep.threadId, highlighted: false, expectedRevision: 2 });
  assert.equal(reopened.state.threads[0].highlighted, false);
  assert.equal(reopened.state.threads[0].highlightColour, undefined);
  assert.equal(reopened.state.threads[0].notes[0].text, 'Senior note');
  assert.equal(reopened.state.threads[0].anchor.exact, keep.anchor.exact);
  assert.equal(reopened.state.threads[0].deletedAt, null);

  const legacy = structuredClone(saved!);
  delete (legacy.threads[0] as Partial<typeof legacy.threads[0]>).highlighted;
  saved = legacy;
  const migrated = new ReaderJournal(persistence);
  await migrated.load();
  assert.equal(migrated.state.threads[0].highlighted, true, 'a pre-split quote mark keeps its old tinted meaning');
});

// Bounded T07 continuation contracts. Native SQLite imports stay inside their tests,
// so journal semantics remain executable when the native dependency is unavailable.
import { ReaderJournal, type JournalState } from '../ui/journal.ts';
import type { ReaderMutation } from '../contracts/reader.ts';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

function continuationKeep(id: string): ReaderMutation {
  return { id, threadId: id, kind: 'keep', capture: { url: `https://example.org/${id}`, title: 'Source', pageType: 'article',
    text: 'Source text.', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'v1' }, anchor: wholePageAnchor(), note: 'Helper version' };
}
for (const missingField of [true, false]) test(`legacy pending Keep retains tint through acknowledgement, interruption and helper restart (missing=${missingField})`, async () => {
  const { ReaderStore } = await import('../daemon/store.ts');
  const directory = mkdtempSync(join(tmpdir(), 'legacy-tint-')), filename = join(directory, 'reader.sqlite');
  let helper = new ReaderStore(filename), saved: JournalState | undefined;
  const persistence = { load: async () => structuredClone(saved), save: async (state: JournalState) => { saved = structuredClone(state); } };
  try {
    const keep = continuationKeep('legacy-tint');
    if (keep.kind !== 'keep') throw new Error('fixture');
    keep.anchor = { exact: keep.capture.text, prefix: '', suffix: '', start: 0, end: keep.capture.text.length };
    const seed = new ReaderJournal(persistence); await seed.change(keep);
    delete saved!.markFormat;
    saved!.threads[0].highlighted = true;
    if (missingField) delete (saved!.threads[0] as Partial<import('../contracts/reader.ts').Thread>).highlighted;
    let journal = new ReaderJournal(persistence); await journal.load();
    assert.equal(journal.state.threads[0].highlighted, true);
    await assert.rejects(journal.sync(async change => {
      if (change.kind === 'highlight') throw new Error('interrupted after Keep acknowledgement');
      assert.deepEqual(change, keep); helper.apply(change);
    }, async () => helper.list()), /interrupted/);
    assert.equal(saved!.pending.length, 1); assert.equal(saved!.pending[0].kind, 'highlight');
    assert.equal(helper.get(keep.threadId)!.highlighted, false);
    const retainedId = saved!.pending[0].id;
    helper.close(); helper = new ReaderStore(filename);
    journal = new ReaderJournal(persistence); await journal.load();
    await journal.sync(async change => { assert.equal(change.id, retainedId); helper.apply(change); }, async () => helper.list());
    assert.equal(journal.state.threads[0].highlighted, true);
    helper.close(); helper = new ReaderStore(filename);
    const reopened = new ReaderJournal(persistence); await reopened.load();
    await reopened.sync(async () => assert.fail('replayed acknowledged mutation'), async () => helper.list());
    assert.equal(reopened.state.threads[0].highlighted, true); assert.deepEqual(reopened.state.pending, []);
  } finally { helper.close(); rmSync(directory, { recursive: true, force: true }); }
});
async function deviceFixture() {
  let saved: JournalState | undefined, fail = false;
  const persistence = {
    load: async () => structuredClone(saved),
    save: async (value: JournalState) => {
      if (fail) { fail = false; throw new Error('Storage full'); }
      saved = structuredClone(value);
    },
  };
  const journal = new ReaderJournal(persistence);
  await journal.change(continuationKeep('chosen'));
  await journal.change(continuationKeep('other'));
  await journal.sync(async () => {}, async () => journal.state.threads);
  const helper = structuredClone(journal.state.threads);
  const edit: ReaderMutation = { id: 'chosen-edit', threadId: 'chosen', kind: 'note', noteId: 'chosen-note', expectedRevision: 1, text: 'Device version' };
  await journal.change(edit);
  await journal.sync(async () => { throw Object.assign(new Error('Helper changed'), { name: 'Conflict' }); }, async () => helper);
  return { journal, helper, persistence, edit, fail: () => { fail = true; },
    read: () => structuredClone(saved!), write: (value: JournalState) => { saved = structuredClone(value); } };
}

test('T07 continuation device choice survives the next helper list, reload and later device edits', async () => {
  const { journal, helper, persistence, edit } = await deviceFixture();
  await journal.acceptCurrentConflict(edit.id); // The unchanged T05 caller path.
  assert.equal(journal.state.resolutions?.at(-1)?.resolution, 'kept-device');
  assert.equal(journal.state.resolutions?.at(-1)?.deviceVersion?.notes[0].text, 'Device version');
  assert.deepEqual(journal.state.pending, [], 'keeping locally must not invent an upload');
  let sent = 0;
  await journal.sync(async () => { sent++; }, async () => helper);
  const reopened = new ReaderJournal(persistence);
  await reopened.load();
  await reopened.sync(async () => { sent++; }, async () => helper);
  assert.equal(reopened.state.threads.find(t => t.id === 'chosen')?.notes[0].text, 'Device version');
  assert.equal(sent, 0);
  await reopened.change({ ...edit, id: 'later-edit', expectedRevision: 2, text: 'Later device version' });
  await reopened.sync(async () => { sent++; }, async () => helper);
  assert.equal(reopened.state.threads.find(t => t.id === 'chosen')?.notes[0].text, 'Later device version');
  assert.equal(reopened.state.resolutions?.[0].deviceVersion?.notes[0].text, 'Device version', 'history is immutable, not the current working copy');
  assert.equal(sent, 1);
  await reopened.sync(async () => { sent++; }, async () => []);
  assert.equal(reopened.state.threads.find(t => t.id === 'chosen')?.notes[0].text, 'Later device version');
});

test('T07 continuation device choice preserves same-thread pending intent and other conflicts', async () => {
  const { journal, helper, persistence, edit } = await deviceFixture();
  await journal.change({ id: 'park-chosen', threadId: 'chosen', kind: 'thread-state', expectedRevision: 2, state: 'parked' });
  await assert.rejects(journal.change({ id: 'other-conflict', threadId: 'other', kind: 'note', noteId: 'other-note', expectedRevision: 0, text: 'Other retained draft' }));
  await journal.change(continuationKeep('unrelated'));
  const pending = structuredClone(journal.state.pending), otherConflict = structuredClone(journal.state.conflicts[1]);
  await journal.keepDeviceVersion(edit.id);
  assert.deepEqual(journal.state.pending, pending);
  assert.deepEqual(journal.state.conflicts, [otherConflict]);
  const reopened = new ReaderJournal(persistence), sent: string[] = [];
  await reopened.sync(async change => { sent.push(change.id); }, async () => helper);
  assert.deepEqual(sent, ['park-chosen', 'unrelated']);
  assert.deepEqual(reopened.state.conflicts, [otherConflict]);
  assert.equal(reopened.state.threads.find(t => t.id === 'chosen')?.state, 'parked');
  assert.equal(reopened.state.threads.find(t => t.id === 'chosen')?.notes[0].text, 'Device version');
  assert.equal(reopened.state.pending.length, 0);
});

test('T07 continuation device choice persistence failure blocks sync until explicit durable retry', async () => {
  const fixture = await deviceFixture();
  const before = fixture.read();
  fixture.fail();
  await assert.rejects(fixture.journal.keepDeviceVersion(fixture.edit.id), /Storage full/);
  assert.deepEqual(fixture.read(), before, 'the last successful physical save is unchanged');
  assert.equal(fixture.journal.unsaved, true);
  assert.equal(fixture.journal.state.resolutions?.at(-1)?.resolution, 'kept-device');
  let sent = 0, listed = 0;
  await assert.rejects(fixture.journal.sync(async () => { sent++; }, async () => { listed++; return fixture.helper; }), /not durable/);
  assert.deepEqual([sent, listed], [0, 0]);
  await fixture.journal.retryPersistence();
  const reopened = new ReaderJournal(fixture.persistence);
  await reopened.sync(async () => { sent++; }, async () => fixture.helper);
  assert.equal(reopened.state.threads[0].notes[0].text, 'Device version');
  assert.equal(reopened.unsaved, false);
});

test('T07 continuation device absence and explicit helper acceptance are distinct durable decisions', async () => {
  const fixture = await deviceFixture();
  const absent = fixture.read();
  absent.threads = absent.threads.filter(t => t.id !== 'chosen');
  fixture.write(absent);
  const journal = new ReaderJournal(fixture.persistence);
  await journal.keepDeviceVersion(fixture.edit.id);
  await journal.sync(async () => assert.fail('No upload was chosen'), async () => fixture.helper);
  assert.equal(journal.state.resolutions?.at(-1)?.deviceVersion, null);
  assert.equal(journal.state.threads.some(t => t.id === 'chosen'), false);
  const reopened = new ReaderJournal(fixture.persistence);
  await reopened.load();
  await assert.rejects(reopened.change({ ...fixture.edit, id: 'review-again' }), /draft was kept/);
  await reopened.resolveConflict('review-again', fixture.helper);
  await reopened.sync(async () => {}, async () => fixture.helper);
  assert.equal(reopened.state.threads.find(t => t.id === 'chosen')?.notes[0].text, 'Helper version');
  assert.equal(reopened.state.resolutions?.at(-1)?.resolution, 'accepted-remote');
  assert.deepEqual(reopened.state.resolutions?.at(-1)?.releasesDeviceChoices, [fixture.edit.id]);
});

test('T07 continuation device failed choice is recoverable without overwriting another tabs saved version', async () => {
  const fixture = await deviceFixture();
  fixture.fail();
  await assert.rejects(fixture.journal.keepDeviceVersion(fixture.edit.id), /Storage full/);
  const other = new ReaderJournal(fixture.persistence);
  await other.load();
  await other.resolveConflict(fixture.edit.id, fixture.helper);
  await fixture.journal.reconcilePersistence();
  assert.equal(fixture.journal.state.threads.find(t => t.id === 'chosen')?.notes[0].text, 'Helper version');
  const recovered = fixture.journal.state.resolutions?.find(r => r.resolution === 'device-choice-recovered');
  assert.equal(recovered?.deviceVersion?.notes[0].text, 'Device version');
  assert.equal(fixture.journal.state.conflicts[0].change.id, fixture.edit.id);
  assert.match(fixture.journal.state.conflicts[0].message, /decision was not saved/);
  const reopened = new ReaderJournal(fixture.persistence);
  await reopened.load();
  assert.deepEqual(reopened.state.resolutions, fixture.journal.state.resolutions);
});

test('T07 continuation device releases only the explicitly selected thread and does not relabel legacy history', async () => {
  const fixture = await deviceFixture();
  await fixture.journal.keepDeviceVersion(fixture.edit.id);
  await fixture.journal.change({ ...fixture.edit, id: 'other-edit', threadId: 'other', noteId: 'other-note', text: 'Other device version' });
  await fixture.journal.sync(async () => { throw Object.assign(new Error('Changed'), { name: 'Conflict' }); }, async () => fixture.helper);
  await fixture.journal.keepDeviceVersion('other-edit');
  await assert.rejects(fixture.journal.change({ ...fixture.edit, id: 'release-chosen', expectedRevision: 0 }));
  await fixture.journal.resolveConflict('release-chosen', fixture.helper);
  await fixture.journal.sync(async () => {}, async () => fixture.helper);
  assert.equal(fixture.journal.state.threads.find(t => t.id === 'chosen')?.notes[0].text, 'Helper version');
  assert.equal(fixture.journal.state.threads.find(t => t.id === 'other')?.notes[0].text, 'Other device version');
  const legacy = fixture.read();
  legacy.resolutions = [{ change: fixture.edit, message: 'Legacy decision', resolvedAt: '2026-09-17T00:00:00Z', resolution: 'accepted-remote' }];
  fixture.write(legacy);
  const reopened = new ReaderJournal(fixture.persistence);
  await reopened.sync(async () => {}, async () => fixture.helper);
  assert.equal(reopened.state.resolutions?.[0].resolution, 'accepted-remote');
  assert.deepEqual(reopened.state.threads, fixture.helper);
});

// On-disk tests use only a new temporary directory and SQLite-created snapshots.
async function migrationFixture(run: (context: {
  ReaderStore: typeof import('../daemon/store.ts').ReaderStore;
  Database: typeof import('better-sqlite3');
  filename: string; root: string; directory: string;
}) => void) {
  const { ReaderStore } = await import('../daemon/store.ts');
  const { default: Database } = await import('better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'marginalia-t07-upgrade-'));
  const filename = join(directory, "readers work's.sqlite");
  try { run({ ReaderStore, Database, filename, root: `${filename}.backups`, directory }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
function backups(root: string, prefix: string) {
  return existsSync(root) ? readdirSync(root).filter(name => name.startsWith(prefix)).sort().map(name => join(root, name)) : [];
}
const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('T07 continuation SQLite rejects unknown markers before writes or backups', async () => {
  await migrationFixture(({ ReaderStore, Database, filename, root }) => {
    for (const marker of ['INSERT INTO migrations VALUES(5)', 'INSERT INTO migrations VALUES(7003)', 'PRAGMA user_version=1', 'PRAGMA application_id=42', 'ALTER TABLE migrations ADD COLUMN future TEXT', 'DROP TABLE migrations']) {
      if (existsSync(filename)) rmSync(filename);
      new ReaderStore(filename).close();
      const setup = new Database(filename);
      setup.pragma('journal_mode = DELETE');
      setup.exec(marker); setup.close();
      const before = readFileSync(filename);
      assert.throws(() => new ReaderStore(filename), { name: 'UnsupportedReaderSchema' });
      assert.deepEqual(readFileSync(filename), before);
      assert.equal(existsSync(root), false);
    }
  });
});

test('T07 continuation SQLite backup includes committed WAL data and predates the atomic upgrade', async () => {
  await migrationFixture(({ ReaderStore, Database, filename, root }) => {
    const seed = new ReaderStore(filename); seed.apply(continuationKeep('source')); seed.close();
    const writer = new Database(filename);
    try {
      writer.pragma('wal_autocheckpoint = 0');
      writer.exec('DELETE FROM migrations WHERE version=7004; DROP INDEX threads_list; INSERT OR IGNORE INTO migrations VALUES(3),(13)');
      writer.prepare('INSERT INTO settings VALUES(?,?)').run('wal-proof', 'committed before snapshot');
      const before = writer.prepare('SELECT * FROM source_versions').all();
      const migrated = new ReaderStore(filename);
      try {
        assert.equal(migrated.db.prepare('SELECT version FROM migrations WHERE version=7004').get() !== undefined, true);
        assert.deepEqual(migrated.db.prepare('SELECT * FROM source_versions').all(), before);
        assert.deepEqual(migrated.db.prepare('PRAGMA foreign_key_check').all(), []);
      } finally { migrated.close(); }
      const routine = backups(root, 'routine-');
      assert.equal(routine.length, 1); assert.deepEqual(backups(root, 'recovery-'), []);
      const snapshot = join(routine[0], 'reader.sqlite'), manifest = JSON.parse(readFileSync(join(routine[0], 'verified.json'), 'utf8'));
      assert.equal(sha256File(snapshot), manifest.sha256);
      const check = new Database(snapshot, { readonly: true, fileMustExist: true });
      try {
        assert.deepEqual(check.prepare('PRAGMA integrity_check').all(), [{ integrity_check: 'ok' }]);
        assert.equal(check.prepare('SELECT version FROM migrations WHERE version=7004').get(), undefined);
        assert.deepEqual(check.prepare('SELECT value FROM settings WHERE key=?').get('wal-proof'), { value: 'committed before snapshot' });
        assert.deepEqual(check.prepare('SELECT * FROM source_versions').all(), before);
      } finally { check.close(); }
      new ReaderStore(filename).close();
      assert.equal(backups(root, 'routine-').length, 1, 'opening an already-current schema does not back up again');
    } finally { writer.close(); }
  });
});

test('T07 continuation SQLite retains two routine backups and protects failure recovery until explicitly resolved', async () => {
  await migrationFixture(({ ReaderStore, Database, filename, root }) => {
    const seed = new ReaderStore(filename); seed.apply(continuationKeep('source')); seed.close();
    const setup = new Database(filename);
    setup.exec(`DELETE FROM migrations WHERE version=7004; DROP INDEX threads_list;
      CREATE TRIGGER fail_upgrade BEFORE INSERT ON migrations WHEN NEW.version=7004 BEGIN SELECT RAISE(ABORT,'migration interrupted'); END;`);
    setup.close();
    let protectedPath = '';
    assert.throws(() => new ReaderStore(filename), (error: unknown) => {
      const failure = error as Error & { backupPath: string; backupVerified: boolean };
      assert.equal(failure.name, 'ReaderMigration'); assert.equal(failure.backupVerified, true);
      protectedPath = failure.backupPath; return true;
    });
    const failed = new Database(filename);
    assert.equal(failed.prepare('SELECT version FROM migrations WHERE version=7004').get(), undefined);
    assert.equal(failed.prepare("SELECT name FROM sqlite_master WHERE name='threads_list'").get(), undefined);
    assert.equal((failed.prepare('SELECT count(*) AS n FROM threads').get() as { n: number }).n, 1);
    failed.exec('DROP TRIGGER fail_upgrade'); failed.close();
    const protectedDigest = sha256File(join(protectedPath, 'reader.sqlite'));
    for (let i = 0; i < 4; i++) {
      const writer = new Database(filename);
      writer.exec('DELETE FROM migrations WHERE version=7004; DROP INDEX IF EXISTS threads_list');
      writer.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('generation', String(i)); writer.close();
      new ReaderStore(filename).close();
      assert.ok(backups(root, 'routine-').length <= 2);
      assert.ok(existsSync(protectedPath));
      assert.equal(sha256File(join(protectedPath, 'reader.sqlite')), protectedDigest);
    }
    assert.equal(backups(root, 'routine-').length, 2);
    const generations = backups(root, 'routine-').map(directory => {
      const check = new Database(join(directory, 'reader.sqlite'), { readonly: true });
      try { return (check.prepare('SELECT value FROM settings WHERE key=?').get('generation') as { value: string }).value; }
      finally { check.close(); }
    }).sort();
    assert.deepEqual(generations, ['2', '3']);
    const resolved = ReaderStore.resolveRecoveryBackup(filename, basename(protectedPath));
    assert.equal(existsSync(protectedPath), false); assert.ok(existsSync(resolved));
    assert.equal(backups(root, 'routine-').length, 2);
    assert.equal(backups(root, 'recovery-').length, 0);
  });
});

test('T07 continuation SQLite backup failure refuses upgrade and unverified recovery is never rotated away', async () => {
  await migrationFixture(({ ReaderStore, Database, filename, root }) => {
    new ReaderStore(filename).close();
    const setup = new Database(filename);
    setup.exec('DELETE FROM migrations WHERE version=7001; DROP INDEX source_versions_material_identity'); setup.close();
    writeFileSync(root, 'occupied backup location');
    assert.throws(() => new ReaderStore(filename));
    const check = new Database(filename, { readonly: true });
    try { assert.equal(check.prepare('SELECT version FROM migrations WHERE version=7001').get(), undefined); }
    finally { check.close(); }
    rmSync(root); mkdirSync(root);
    const protectedName = 'recovery-1-00000000-0000-0000-0000-000000000000', protectedPath = join(root, protectedName);
    mkdirSync(protectedPath); writeFileSync(join(protectedPath, 'reader.sqlite'), 'interrupted, unverified snapshot');
    new ReaderStore(filename).close();
    assert.equal(readFileSync(join(protectedPath, 'reader.sqlite'), 'utf8'), 'interrupted, unverified snapshot');
    assert.throws(() => ReaderStore.resolveRecoveryBackup(filename, protectedName));
    assert.ok(existsSync(protectedPath));
    assert.throws(() => ReaderStore.resolveRecoveryBackup(filename, '../outside'));
    const memory = new ReaderStore(':memory:');
    try { assert.equal(memory.db.memory, true); assert.throws(() => ReaderStore.resolveRecoveryBackup(':memory:', protectedName)); }
    finally { memory.close(); }
    assert.equal(backups(root, 'routine-').length, 1);
  });
});
