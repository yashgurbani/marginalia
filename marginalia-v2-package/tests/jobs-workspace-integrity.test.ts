import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, link, symlink, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveWorkspace, assertInside, directoryIdentity, readWorkspaceBytes } from '../daemon/jobs/workspace-integrity.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 't06-files-')), workspace = join(root, 'job'); await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true })); return { root, workspace };
}
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
