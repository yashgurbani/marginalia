import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, link, symlink, rename, readdir, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { archiveWorkspace, assertInside, directoryIdentity, readWorkspaceBytes } from '../daemon/jobs/workspace-integrity.ts';
import { prepareWorkspace } from '../daemon/jobs/workspace.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 't06-files-')), workspace = join(root, 'job'); await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true })); return { root, workspace };
}
async function boundedRead(read: Promise<Buffer | undefined>) {
  let timer: NodeJS.Timeout;
  const blocked = new Promise<{ kind: 'blocked' }>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'blocked' }), 2_000); timer.unref();
  });
  const settled = read.then(value => ({ kind: 'settled' as const, value }), error => ({ kind: 'rejected' as const, error }));
  const result = await Promise.race([settled, blocked]); clearTimeout(timer!); return result;
}
test('workspace files use owner-only permissions on POSIX', async t => {
  if (process.platform === 'win32') { t.skip('File modes are ACL-controlled on Windows.'); return; }
  const { root } = await fixture(t);
  const packet = { schema: 'marginalia.job-packet.v1' as const, intent: 'explore' as const, question: 'Question',
    source: { url: 'https://example.org', title: 'Example', pageType: null, capturedAt: null, sourceHash: 'hash', sourceVersionId: 'source' },
    selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
    adjacentContext: { before: '', after: '', basis: 'bounded-character-context' as const }, availableCapabilities: [], omissions: [] };
  const workspace = await prepareWorkspace(root, 'attempt', packet, '{}');
  assert.equal((await stat(join(workspace, 'packet.json'))).mode & 0o777, 0o600);
});
test('bounded descriptor read rejects links, extra bytes and stale directory identity', async t => {
  const { root, workspace } = await fixture(t), identity = await directoryIdentity(workspace);
  await writeFile(join(workspace, 'packet.json'), 'reviewed');
  assert.equal((await readWorkspaceBytes(identity, 'packet.json', 8))!.toString(), 'reviewed');
  await assert.rejects(readWorkspaceBytes(identity, 'packet.json', 7), /bounded/);
  await link(join(workspace, 'packet.json'), join(workspace, 'hardlink'));
  await assert.rejects(readWorkspaceBytes(identity, 'packet.json', 8), /authoritative/);
  await rm(join(workspace, 'hardlink'));
  await assert.rejects(readWorkspaceBytes(identity, '../outside', 100), /Invalid/);
  assert.equal(await readWorkspaceBytes(identity, 'missing', 100), undefined);
  await rename(workspace, join(root, 'old')); await mkdir(workspace); await writeFile(join(workspace, 'packet.json'), 'reviewed');
  await assert.rejects(readWorkspaceBytes(identity, 'packet.json', 8), /identity/);
  assert.throws(() => assertInside(root, root), /escapes/);
  assert.throws(() => assertInside(root, join(root, '..', 'escape')), /escapes/);
});
test('workspace identity canonicalizes an aliased ancestor but rejects a linked workspace', async t => {
  const { root } = await fixture(t), parent = join(root, 'real-parent'), workspace = join(parent, 'job');
  const alias = join(root, 'parent-alias'), linkedWorkspace = join(root, 'workspace-link');
  await mkdir(workspace, { recursive: true });
  try {
    await symlink(parent, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(workspace, linkedWorkspace, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('This host does not permit creating directory links.'); return;
  }
  const identity = await directoryIdentity(join(alias, 'job'));
  assert.equal(identity.path, await realpath(workspace));
  await assert.rejects(directoryIdentity(linkedWorkspace), /unsafe/);
});
test('history is outside the active workspace, exclusive, and does not overwrite prior evidence', async t => {
  const { root, workspace } = await fixture(t), identity = await directoryIdentity(workspace);
  await writeFile(join(workspace, 'packet.json'), 'old-packet'); await writeFile(join(workspace, 'reply.json'), 'old-reply');
  await writeFile(join(workspace, 'SKILL.md'), 'reviewed-instructions');
  await archiveWorkspace(identity, 'parent');
  assert.deepEqual(await readdir(workspace), ['SKILL.md']);
  assert.equal(await readFile(join(root, '.history', 'job', 'parent', 'reply.json'), 'utf8'), 'old-reply');
  await writeFile(join(workspace, 'packet.json'), 'new-packet');
  await assert.rejects(archiveWorkspace(identity, 'parent'), /EEXIST/);
  assert.equal(await readFile(join(workspace, 'packet.json'), 'utf8'), 'new-packet');
  await assert.rejects(archiveWorkspace(identity, '../escape'), /identifier/);
});
test('a linked history directory is rejected before creating descendants through it', async t => {
  if (process.platform === 'win32') { t.skip('Native Windows link/reparse behavior requires its own host run.'); return; }
  const { root, workspace } = await fixture(t), outside = join(root, 'outside'); await mkdir(outside);
  await symlink(outside, join(root, '.history'));
  await writeFile(join(workspace, 'packet.json'), 'unchanged');
  await assert.rejects(archiveWorkspace(await directoryIdentity(workspace), 'attempt'), /unsafe/);
  assert.deepEqual(await readdir(outside), []); assert.equal(await readFile(join(workspace, 'packet.json'), 'utf8'), 'unchanged');
  await symlink(join(workspace, 'packet.json'), join(workspace, 'link.json'));
  await assert.rejects(readWorkspaceBytes(await directoryIdentity(workspace), 'link.json', 100), /authoritative/);
});
test('a reply path swapped for a FIFO is rejected without blocking', { skip: process.platform === 'win32' && 'POSIX FIFO only' }, async t => {
  const { workspace } = await fixture(t), path = join(workspace, 'reply.json'), identity = await directoryIdentity(workspace);
  await writeFile(path, '{}');
  const read = readWorkspaceBytes(identity, 'reply.json', 100, 100);
  await delay(20, undefined, { ref: false }); await unlink(path); execFileSync('mkfifo', ['-m', '600', path]);
  const result = await boundedRead(read);
  assert.notEqual(result.kind, 'blocked');
  if (result.kind === 'settled') assert.equal(result.value, undefined);
});
test('a directory swapped onto a reply path is rejected after open without blocking', async t => {
  const { workspace } = await fixture(t), path = join(workspace, 'reply.json'), identity = await directoryIdentity(workspace);
  await writeFile(path, '{}');
  const read = readWorkspaceBytes(identity, 'reply.json', 100, 100);
  await delay(20, undefined, { ref: false }); await unlink(path); await mkdir(path);
  const result = await boundedRead(read);
  assert.notEqual(result.kind, 'blocked');
  if (result.kind === 'settled') assert.equal(result.value, undefined);
});
