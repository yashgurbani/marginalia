import test from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryImportPreviewResponse, LibraryImportResult } from '../contracts/library-import.ts';
import { LibraryImportClient } from '../ui/import/client.ts';
import { mountLibraryImport } from '../ui/import/panel.ts';
import { FakeLibraryImportTransport, type LibraryImportTransport } from '../ui/import/transport.ts';
import { button, dom, until, type TestElement } from './t05-dom.ts';

const raw = { schema: 'marginalia.thread.v1', thread: { id: 'thread-one' } };
const preview = (warnings = ['First warning.', 'Second warning.']): LibraryImportPreviewResponse => ({
  preview: { threadId: 'thread-one', sourceTitle: 'A saved source', noteCount: 2, removedNoteCount: 1,
    removed: false, highlighted: true, state: 'parked', digest: 'a'.repeat(64), status: 'new' }, warnings,
});
const imported: LibraryImportResult = { imported: { threadId: 'thread-one', revision: 7 }, warnings: ['Import complete.'] };

function choose(root: TestElement, file: File) {
  const input = root.querySelector('input'); assert.ok(input);
  Object.defineProperty(input, 'files', { configurable: true, value: { 0: file, length: 1, item: (index: number) => index === 0 ? file : null } });
  input.fire('change');
}

test('import mount previews one named JSON file, shows every warning, and refreshes only after success', async t => {
  const d = dom(t), fake = new FakeLibraryImportTransport(preview(), imported); let refreshes = 0;
  const mount = mountLibraryImport(d.root as unknown as HTMLElement, fake, { onImported: () => { refreshes++; } });
  t.after(() => mount.destroy());
  assert.match(d.root.textContent, /The import limit is 2 MB\./);
  assert.match(d.root.textContent, /Replies, views, attachments and history are left out\./);
  choose(d.root, new File([JSON.stringify(raw)], 'thread-one.json', { type: 'application/json' }));
  await until(() => d.root.textContent.includes('This saved work is ready to import.'));
  assert.match(d.root.textContent, /thread-one\.json/);
  assert.match(d.root.textContent, /A saved source/);
  assert.equal(d.root.querySelectorAll('li').length, 2);
  assert.match(d.root.textContent, /First warning\./); assert.match(d.root.textContent, /Second warning\./);
  assert.equal(refreshes, 0); button(d.root, 'Import this saved work').click();
  await until(() => d.root.textContent.includes('Saved work imported.'));
  assert.equal(refreshes, 1); assert.match(d.root.textContent, /Import complete\./); assert.equal(d.root.querySelectorAll('li').length, 3);
  assert.deepEqual(fake.previews, [raw]);
  assert.deepEqual(fake.imports, [{ value: raw, previewDigest: 'a'.repeat(64) }]);
});

test('import mount rejects oversized files before preview and does not refresh after a failed import', async t => {
  const d = dom(t); let refreshes = 0, previews = 0;
  const transport: LibraryImportTransport = {
    async preview() { previews++; return preview(); },
    async importSavedWork() { throw new Error('failed'); },
  };
  const mount = mountLibraryImport(d.root as unknown as HTMLElement, transport, { onImported: () => { refreshes++; } });
  t.after(() => mount.destroy());
  choose(d.root, new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'too-large.json'));
  await until(() => d.root.textContent.includes('larger than the 2 MB import limit'));
  assert.equal(previews, 0);
  choose(d.root, new File([JSON.stringify(raw)], 'thread-one.json', { type: 'application/json' }));
  await until(() => d.root.textContent.includes('ready to import'));
  button(d.root, 'Import this saved work').click();
  await until(() => d.root.textContent.includes('Saved work could not be imported.'));
  assert.equal(refreshes, 0);
});

test('import client uses raw bodies, the preview digest, and runtime response guards', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const gateway = { async request(path: string, body: unknown) {
    calls.push({ path, body }); return path.endsWith('/preview') ? preview() : imported;
  } };
  const client = new LibraryImportClient(gateway);
  await client.preview(raw); await client.importSavedWork(raw, 'digest with space');
  assert.deepEqual(calls, [
    { path: '/api/import/thread/preview', body: raw },
    { path: '/api/import/thread?previewDigest=digest%20with%20space', body: raw },
  ]);
  await assert.rejects(new LibraryImportClient({ async request() { return { preview: {} }; } }).preview(raw), /invalid import preview/);
});
