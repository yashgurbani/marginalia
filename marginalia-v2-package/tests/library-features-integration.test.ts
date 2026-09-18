import test from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryAnswer } from '../contracts/library-answer.ts';
import type { JournalRecap } from '../contracts/journal-recap.ts';
import type { Thread } from '../contracts/reader.ts';
import type { ShareFile } from '../contracts/share.ts';
import type { WhitelistSettings, WhitelistSite, WhitelistSiteChange } from '../contracts/whitelist.ts';
import { defaultAutoAssistSettings } from '../contracts/auto-assist.ts';
import { defaultInstantHelpSettings } from '../contracts/instant.ts';
import { mountLibrary } from '../ui/library/index.ts';
import { FakeLibraryAnswerTransport } from '../ui/answer/transport.ts';
import { FakeLibraryImportTransport } from '../ui/import/transport.ts';
import { FakeJournalRecapTransport } from '../ui/journal-recap/transport.ts';
import { FakeShareTransport } from '../ui/share/transport.ts';
import { FakeInstantTransport } from '../ui/instant/transport.ts';
import { FakeAutoAssistTransport } from '../ui/auto-assist/transport.ts';
import { WHITELIST_COPY } from '../ui/whitelist/whitelist.ts';
import type { WhitelistTransport } from '../ui/whitelist/transport.ts';
import type { ReaderKeyValueStore } from '../ui/persistence.ts';
import { button, deferred, dom, settle, until, type TestElement } from './t05-dom.ts';
import type { LibraryImportPreviewResponse, LibraryImportResult } from '../contracts/library-import.ts';

const now = '2026-09-18T10:00:00.000Z';

const thread: Thread = {
  id: 'thread-one', anchorId: 'anchor-one', sourceVersionId: 'source-one', sourceTitle: 'A saved source',
  sourceUrl: 'https://example.com/source', state: 'open', revision: 1, createdAt: now, updatedAt: now,
  deletedAt: null, notes: [], highlighted: false,
  anchor: { exact: 'Heat and pressure.', prefix: '', suffix: '', start: 0, end: 18 },
};

const importPreview = (): LibraryImportPreviewResponse => ({
  preview: { threadId: thread.id, sourceTitle: thread.sourceTitle, noteCount: 1, removedNoteCount: 0,
    removed: false, highlighted: true, state: 'open', digest: 'a'.repeat(64), status: 'new' },
  warnings: ['Replies and history are not part of this file.'],
});

const imported: LibraryImportResult = { imported: { threadId: thread.id, revision: 2 }, warnings: ['Saved work imported.'] };

const recap = (): JournalRecap => ({
  schema: 'marginalia.journal-summary.v1', kind: 'local-recap', label: 'Local recap', coverage: 'saved-activity',
  date: '2026-09-18', timeZone: 'Europe/Berlin', description: 'Local saved activity.',
  counts: { items: 2, sources: 1, threads: 1, bookmarks: 0, passages: 1, highlights: 0, notes: 1, replies: 0 },
  topics: [{ id: 'saved-activity:unassigned', label: 'Thermodynamics', basis: 'saved-activity',
    counts: { items: 2, sources: 1, threads: 1 }, sourceIds: ['source-one'], threadIds: [thread.id], terms: [], truncated: false }],
  snippets: [{ id: 'source:item-one', kind: 'source', text: 'Heat raises pressure.', truncated: false,
    savedAt: now, threadId: thread.id, threadLink: `/library#thread=${thread.id}`,
    source: { id: 'source-one', hash: 'hash-one', title: thread.sourceTitle, url: thread.sourceUrl } }],
});

const answer = (): LibraryAnswer => {
  const excerpt = 'Heat and pressure.';
  return { schema: 'marginalia.collection-answer.v1', query: 'heat pressure', mode: 'extractive-local', status: 'answered',
    answer: 'Extractive saved-passage answer.', citations: [{
      threadId: thread.id, sourceVersionId: thread.sourceVersionId, sourceHash: 'hash-one', sourceUrl: thread.sourceUrl,
      sourceTitle: thread.sourceTitle, anchor: thread.anchor, excerpt, matchTerms: ['heat', 'pressure'], kind: 'source',
      excerptStart: 0, excerptEnd: excerpt.length, reason: 'All question words found in this saved source passage.',
    }] };
};

const shareFile: ShareFile = {
  contents: '# A saved source\n\nHeat and pressure.', contentType: 'text/markdown; charset=utf-8',
  filename: 'marginalia-thread-thread-one.markdown',
};

function choose(root: TestElement, value: unknown, name = 'thread-one.json') {
  const input = root.querySelector('.m-library-import input'); assert.ok(input);
  const file = new File([JSON.stringify(value)], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { configurable: true, value: { 0: file, length: 1, item: (index: number) => index === 0 ? file : null } });
  input.fire('change');
}

function formWithInput(root: TestElement, type: string) {
  const form = root.querySelectorAll('form').find(value => value.querySelectorAll('input').some(input => input.type === type));
  assert.ok(form, `Form with ${type} input not found`); return form;
}

function conflictWhitelist(): { transport: WhitelistTransport; reads: () => number } {
  let reads = 0;
  const transport: WhitelistTransport = {
    async getSettings(): Promise<WhitelistSettings> {
      reads++;
      return reads === 1 ? { exclusions: [] } : { exclusions: [{ site: 'https://other.example', revision: 3, excluded: false, updatedAt: now }] };
    },
    async saveSite(_change: WhitelistSiteChange): Promise<WhitelistSite> {
      const error = new Error('changed'); error.name = 'Conflict'; throw error;
    },
  };
  return { transport, reads: () => reads };
}

function memoryStore(): ReaderKeyValueStore {
  const values = new Map<string, unknown>();
  return {
    async read<T>(key: string) { return values.get(key) as T | undefined; },
    async write(key: string, value: unknown) { values.set(key, structuredClone(value)); },
  };
}

test('Library mounts import, recap, answer, share, whitelist, and onboarding through real feature boundaries', async t => {
  const d = dom(t), importedTransport = new FakeLibraryImportTransport(importPreview(), imported);
  const recapTransport = new FakeJournalRecapTransport(recap()), answerTransport = new FakeLibraryAnswerTransport(answer());
  const shareTransport = new FakeShareTransport(shareFile), downloads: ShareFile[] = [];
  const whitelist = conflictWhitelist();
  const instant = new FakeInstantTransport(defaultInstantHelpSettings('Europe/Berlin'));
  const autoAssist = new FakeAutoAssistTransport(defaultAutoAssistSettings());
  let listCalls = 0;
  const mount = mountLibrary(d.root as unknown as HTMLElement, {
    listThreads: async () => { listCalls++; return [thread]; }, exportThread: async id => ({ id }),
    onOpenThread() {}, onClose() {},
    libraryFeatures: {
      importer: importedTransport, journalRecap: recapTransport, answer: answerTransport,
      share: shareTransport, shareDownload: file => downloads.push(file), whitelist: whitelist.transport,
      onboarding: { instantHelp: instant, autoAssist, store: memoryStore() },
    },
  });
  t.after(() => mount.destroy());

  await until(() => listCalls > 0 && d.root.textContent.includes('Download saved thread'));

  choose(d.root, { schema: 'marginalia.thread.v1', thread: { id: thread.id } });
  await until(() => d.root.textContent.includes('This saved work is ready to import.'));
  button(d.root, 'Import this saved work').click();
  await until(() => d.root.textContent.includes('Saved work imported.'));
  assert.deepEqual(importedTransport.imports, [{ value: { schema: 'marginalia.thread.v1', thread: { id: thread.id } }, previewDigest: 'a'.repeat(64) }]);
  assert.ok(listCalls >= 2);

  const answerInput = formWithInput(d.root, 'search').querySelector('input')!;
  answerInput.value = 'heat pressure'; formWithInput(d.root, 'search').fire('submit');
  await until(() => d.root.textContent.includes('Saved-passage answer'));
  assert.match(d.root.textContent, /Heat and pressure\./);
  assert.deepEqual(answerTransport.requests.at(-1), { query: 'heat pressure', threadIds: [] });

  const shareSelect = d.root.querySelector('.m-share select'); assert.ok(shareSelect);
  shareSelect.value = 'markdown'; shareSelect.fire('change');
  button(d.root, 'Prepare file').click();
  await until(() => d.root.textContent.includes('Your file is ready.'));
  button(d.root, 'Download file').click();
  assert.deepEqual(downloads, [shareFile]);
  assert.deepEqual(shareTransport.requests, [{ threadId: thread.id, format: 'markdown' }]);

  button(d.root, 'Activity').click();
  await until(() => d.root.textContent.includes('Daily recap'));
  const recapForm = formWithInput(d.root, 'date');
  const date = recapForm.querySelector('input')!; date.value = '2026-09-17'; recapForm.fire('submit');
  await until(() => recapTransport.requests.length >= 2);
  assert.deepEqual(recapTransport.requests.at(-1), { date: '2026-09-17', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  assert.match(d.root.textContent, /Thermodynamics/);

  button(d.root, 'Settings').click();
  await until(() => d.root.textContent.includes('Choose your reading help') && d.root.textContent.includes(WHITELIST_COPY.loaded));
  const siteInput = d.root.querySelector('.m-whitelist input')!; siteInput.value = 'keep.example';
  d.root.querySelector('.m-whitelist form')!.fire('submit');
  await until(() => d.root.textContent.includes(WHITELIST_COPY.stale));
  assert.equal(siteInput.value, 'keep.example');
  assert.equal(whitelist.reads(), 2);
});

test('Library feature mounts fence pending work after destroy', async t => {
  const d = dom(t), pending = deferred<LibraryImportPreviewResponse>(), started = deferred<void>();
  const transport = {
    async preview() { started.resolve(); return pending.promise; },
    async importSavedWork() { return imported; },
  };
  const mount = mountLibrary(d.root as unknown as HTMLElement, {
    listThreads: async () => [], exportThread: async id => ({ id }), onOpenThread() {}, onClose: () => {},
    libraryFeatures: { importer: transport },
  });
  t.after(() => mount.destroy());
  choose(d.root, { schema: 'marginalia.thread.v1', thread: { id: thread.id } });
  await started.promise;
  mount.destroy(); pending.resolve(importPreview()); await settle();
  assert.equal(d.root.textContent, '');
});

test('restoring a removed thread resynchronizes Share when opening the restored thread fails', async t => {
  const d = dom(t), removed = { ...thread, deletedAt: now }, shareTransport = new FakeShareTransport(shareFile);
  const mount = mountLibrary(d.root as unknown as HTMLElement, {
    listThreads: async () => [removed], exportThread: async id => ({ id }),
    restoreThread: async () => thread, onOpenThread: () => { throw new Error('open failed'); }, onClose() {},
    libraryFeatures: { share: shareTransport },
  });
  t.after(() => mount.destroy());
  await until(() => d.root.textContent.includes('No saved thread is ready for download.'));
  button(d.root, 'Removed').click();
  await until(() => d.root.querySelectorAll('button').some(value => value.textContent === 'Restore and open'));
  button(d.root, 'Restore and open').click();
  await until(() => d.root.textContent.includes('The thread was restored but could not be opened.'));
  const select = d.root.querySelector('.m-share select'); assert.ok(select);
  assert.equal(select.disabled, false);
  assert.match(d.root.textContent, /A saved source/);
});
