import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShareFile, ShareFormat } from '../contracts/share.ts';
import { ShareClient } from '../ui/share/client.ts';
import { mountShare, SHARE_COPY } from '../ui/share/share.ts';
import { FakeShareTransport, type ShareTransport } from '../ui/share/transport.ts';
import { button, deferred, dom, until } from './t05-dom.ts';

function file(format: ShareFormat = 'markdown'): ShareFile {
  const contentType = format === 'markdown' ? 'text/markdown; charset=utf-8'
    : format === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
  return { contents: '<img src=x onerror=alert(1)>\nSaved note.', contentType, filename: `marginalia-thread-thread-one.${format}` };
}

test('share mount moves through idle, preparing and ready before a local download', async t => {
  const d = dom(t), pending = deferred<ShareFile>(), downloads: ShareFile[] = [];
  const transport: ShareTransport = { prepare: async () => pending.promise };
  const mount = mountShare(d.root as unknown as HTMLElement, { threadId: 'thread-one', transport, download: value => downloads.push(value) });
  t.after(() => mount.destroy());
  assert.equal(mount.state(), 'idle'); assert.match(d.root.textContent, /Choose a file type and prepare the copy\./);
  button(d.root, SHARE_COPY.prepare).click();
  assert.equal(mount.state(), 'preparing'); assert.match(d.root.textContent, /Preparing the file\./);
  pending.resolve(file()); await until(() => mount.state() === 'ready');
  assert.match(d.root.textContent, /Review it before downloading\./);
  assert.match(d.root.querySelector('pre')!.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(d.root.querySelector('img'), null);
  button(d.root, SHARE_COPY.download).click(); assert.deepEqual(downloads, [file()]);
  assert.equal(d.root.querySelectorAll('button').every(value => value.tagName === 'BUTTON'), true);
  assert.equal(d.root.querySelector('[aria-live="polite"]')?.tagName, 'P');
});

test('share mount exposes failed state and can prepare again', async t => {
  const d = dom(t), fake = new FakeShareTransport(async () => { throw new Error('unavailable'); });
  const mount = mountShare(d.root as unknown as HTMLElement, { threadId: 'thread-one', transport: fake }); t.after(() => mount.destroy());
  button(d.root, SHARE_COPY.prepare).click(); await until(() => mount.state() === 'failed');
  assert.match(d.root.textContent, /could not be prepared/);
  fake.response = file('markdown'); button(d.root, SHARE_COPY.prepare).click(); await until(() => mount.state() === 'ready');
  assert.equal(fake.requests.length, 2);
});

test('share client uses the download-only route and validates file metadata', async () => {
  const paths: string[] = [], client = new ShareClient({ async download(path) { paths.push(path); return file('text'); } });
  assert.deepEqual(await client.prepare('thread one', 'text'), file('text'));
  assert.deepEqual(paths, ['/api/share/thread?thread=thread+one&format=text']);
  await assert.rejects(new ShareClient({ async download() { return { ...file(), filename: '../thread.md' }; } }).prepare('thread-one', 'markdown'), /invalid thread copy/);
});

test('share copy has no banned reader-facing words', () => {
  const banned = /\b(artifact|provenance|ledger|transform|tier|job|schema|sandbox|MCP|AI|confidence)\b/i;
  for (const value of Object.values(SHARE_COPY)) assert.doesNotMatch(value, banned);
});
