import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage, createHook } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, link, symlink, rename, readdir, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveWorkspace, assertInside, directoryIdentity, readWorkspaceBytes } from '../daemon/jobs/workspace-integrity.ts';
import { prepareContinuationWorkspace, prepareWorkspace, verifyContinuationWorkspace, type ContinuationSolverAuthority } from '../daemon/jobs/workspace.ts';
import { SOLVER_MANIFEST_SCHEMA } from '../contracts/solver.ts';
import type { CandidateReply } from '../contracts/reply.ts';
import { withFixtureOrigins } from './origins-fixture.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 't06-files-')), workspace = join(root, 'job'); await mkdir(workspace);
  t.after(() => rm(root, { recursive: true, force: true })); return { root, workspace };
}
const SOLVER_SOURCE = 'process.stdout.write(JSON.stringify({answer:2}));\n';
const continuationPacket = (question = 'Question') => ({ schema: 'marginalia.job-packet.v1' as const, intent: 'simulate' as const, question,
  source: { url: 'https://example.org', title: 'Example', pageType: null, capturedAt: null, sourceHash: 'hash', sourceVersionId: 'source' },
  selection: { exact: 'Start', prefix: '', suffix: '', start: 0, end: 5, originalEnd: 5, omittedCharacters: 0 },
  adjacentContext: { before: '', after: '', basis: 'bounded-character-context' as const }, availableCapabilities: ['solver' as const], omissions: [] });
function solverReply(): CandidateReply {
  return withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Saved computation', summary: 'Saved computation.',
    sourceBindings: [], parameters: [{ name: 'x', label: 'Input', default: 1, min: 0, max: 10, unit: '' }],
    assumptions: [], limitations: [], requiredCapabilities: ['solver'], blocks: [
      { id: 'answer', type: 'derived', name: 'answer', expression: 'x + 1', unit: '', label: 'Answer' },
      { id: 'solver-1', type: 'solver', path: 'solver/main.js', inputNames: ['x'], outputBlocks: ['answer'] },
    ], checks: [], staticFallback: 'Saved computation.' });
}
async function solverContinuationFixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'p05-continuation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const schema = '{}', packet = continuationPacket(), workspace = await prepareWorkspace(root, 'job', packet, schema);
  await mkdir(join(workspace, 'solver'));
  await writeFile(join(workspace, 'solver', 'main.js'), SOLVER_SOURCE);
  const solverSha256 = createHash('sha256').update(SOLVER_SOURCE).digest('hex');
  await writeFile(join(workspace, 'solver', 'manifest.json'), JSON.stringify({ schema: SOLVER_MANIFEST_SCHEMA,
    files: [{ path: 'solver/main.js', sha256: solverSha256 }],
    inputs: [{ name: 'x', min: 0, max: 10, default: 1, unit: '' }], outputs: ['answer'] }));
  await writeFile(join(workspace, 'reply.json'), JSON.stringify(solverReply()));
  const identity = await directoryIdentity(workspace);
  const authority: ContinuationSolverAuthority = { jobId: 'parent-job', attemptId: 'parent-attempt', reply: solverReply(),
    bindings: [{ solverId: 'solver-1', binding: { jobId: 'parent-job', attemptId: 'parent-attempt', workspace,
      workspaceGeneration: `directory:${identity.dev}:${identity.ino}`, solverRelativePath: 'solver/main.js', solverSha256,
      runtimeExecutable: process.execPath, runtimeIdentity: process.release.name, runtimeVersion: process.version } }] };
  return { root, workspace, schema, packet, authority, solverSha256 };
}
async function boundedRead(read: Promise<Buffer | undefined>) {
  let timer: NodeJS.Timeout;
  const blocked = new Promise<{ kind: 'blocked' }>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'blocked' }), 2_000); timer.unref();
  });
  const settled = read.then(value => ({ kind: 'settled' as const, value }), error => ({ kind: 'rejected' as const, error }));
  const result = await Promise.race([settled, blocked]); clearTimeout(timer!); return result;
}
async function swapAfterValidation(
  read: () => Promise<Buffer | undefined>, swap: () => Promise<void> | void,
) {
  const scope = new AsyncLocalStorage<boolean>();
  let signalReady!: () => void;
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const hook = createHook({ init(_asyncId, type) {
    if (type === 'Timeout' && scope.getStore() === true) signalReady();
  } });
  hook.enable();
  try {
    const pending = scope.run(true, read);
    const gate = await Promise.race([
      ready.then(() => ({ kind: 'ready' as const })),
      pending.then(value => ({ kind: 'settled' as const, value }), error => ({ kind: 'rejected' as const, error })),
    ]);
    if (gate.kind === 'rejected') throw gate.error;
    if (gate.kind === 'settled') throw new Error('Workspace read settled before its post-validation gate.');
    await swap();
    return boundedRead(pending);
  } finally { hook.disable(); }
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
  const result = await swapAfterValidation(
    () => readWorkspaceBytes(identity, 'reply.json', 100, 100),
    async () => { await unlink(path); execFileSync('mkfifo', ['-m', '600', path]); },
  );
  assert.notEqual(result.kind, 'blocked');
  if (result.kind === 'settled') assert.equal(result.value, undefined);
});
test('a directory swapped onto a reply path is rejected after open without blocking', async t => {
  const { workspace } = await fixture(t), path = join(workspace, 'reply.json'), identity = await directoryIdentity(workspace);
  await writeFile(path, '{}');
  const result = await swapAfterValidation(
    () => readWorkspaceBytes(identity, 'reply.json', 100, 100),
    async () => { await unlink(path); await mkdir(path); },
  );
  assert.notEqual(result.kind, 'blocked');
  if (result.kind === 'settled') assert.equal(result.value, undefined);
});

test('an unchanged host-pinned solver survives continuation workspace preparation', async t => {
  const f = await solverContinuationFixture(t);
  await prepareContinuationWorkspace(f.workspace, 'parent-attempt', continuationPacket('Follow up'), f.schema, f.authority);
  assert.equal(await readFile(join(f.workspace, 'solver', 'main.js'), 'utf8'), SOLVER_SOURCE);
  assert.equal(createHash('sha256').update(await readFile(join(f.workspace, 'solver', 'main.js'))).digest('hex'), f.solverSha256);
  assert.equal((await readFile(join(f.workspace, 'packet.json'), 'utf8')).includes('Follow up'), true);
  assert.equal((await readFile(join(f.root, '.history', 'job', 'parent-attempt', 'reply.json'), 'utf8')).includes('Saved computation'), true);
});

for (const scenario of ['replaced solver and manifest', 'unlisted file', 'unlisted directory', 'hard link'] as const) {
  test(`continuation refuses ${scenario} before workspace mutation`, async t => {
    const f = await solverContinuationFixture(t), solver = join(f.workspace, 'solver', 'main.js');
    if (scenario === 'replaced solver and manifest') {
      const changed = 'process.stdout.write(JSON.stringify({answer:999}));\n';
      await writeFile(solver, changed);
      const manifest = JSON.parse(await readFile(join(f.workspace, 'solver', 'manifest.json'), 'utf8'));
      manifest.files[0].sha256 = createHash('sha256').update(changed).digest('hex');
      await writeFile(join(f.workspace, 'solver', 'manifest.json'), JSON.stringify(manifest));
    }
    if (scenario === 'unlisted file') await writeFile(join(f.workspace, 'extra.js'), 'extra');
    if (scenario === 'unlisted directory') await mkdir(join(f.workspace, 'extra'));
    if (scenario === 'hard link') await link(solver, join(f.root, 'solver-link'));
    const packetBefore = await readFile(join(f.workspace, 'packet.json'), 'utf8');
    const replyBefore = await readFile(join(f.workspace, 'reply.json'), 'utf8');
    await assert.rejects(prepareContinuationWorkspace(f.workspace, 'parent-attempt', continuationPacket('Follow up'), f.schema, f.authority));
    assert.equal(await readFile(join(f.workspace, 'packet.json'), 'utf8'), packetBefore);
    assert.equal(await readFile(join(f.workspace, 'reply.json'), 'utf8'), replyBefore);
    assert.equal((await readdir(f.root)).includes('.history'), false);
  });
}

test('continuation refuses a special solver file before workspace mutation', { skip: process.platform === 'win32' && 'POSIX FIFO only' }, async t => {
  const f = await solverContinuationFixture(t), solver = join(f.workspace, 'solver', 'main.js');
  await unlink(solver); execFileSync('mkfifo', ['-m', '600', solver]);
  const packetBefore = await readFile(join(f.workspace, 'packet.json'), 'utf8');
  await assert.rejects(prepareContinuationWorkspace(f.workspace, 'parent-attempt', continuationPacket('Follow up'), f.schema, f.authority));
  assert.equal(await readFile(join(f.workspace, 'packet.json'), 'utf8'), packetBefore);
  assert.equal((await readdir(f.root)).includes('.history'), false);
});

test('a mutable solver manifest never relaxes the deny-all continuation default', async t => {
  const f = await solverContinuationFixture(t);
  await assert.rejects(verifyContinuationWorkspace(f.workspace, f.schema), /Undeclared continuation artifact: solver/);
});
