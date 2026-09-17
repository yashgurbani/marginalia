import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { REPLY_LIMITS, parseAndValidateReply, type CandidateReply, type ReplyCapability } from '../../contracts/reply.ts';
import type { ProviderJobPacket } from '../../contracts/jobs.ts';
import { canonicalReplyData } from '../../contracts/reply.ts';
import { JOB_WORKSPACE_INSTRUCTIONS } from './envelope.ts';

const FILES = new Set(['reply.partial.json', 'reply.json']);

export async function prepareWorkspace(root: string, attemptId: string, packet: ProviderJobPacket, schema: string): Promise<string> {
  if (!/^[\w-]{1,100}$/.test(attemptId)) throw new Error('Invalid attempt workspace identifier.');
  await mkdir(root, { recursive: true });
  const actualRoot = await realpath(root);
  const workspace = resolve(actualRoot, attemptId);
  assertInside(actualRoot, workspace);
  await mkdir(workspace, { recursive: false });
  await atomicWrite(join(workspace, 'packet.json'), canonicalReplyData(packet));
  await atomicWrite(join(workspace, 'reply.schema.json'), schema);
  await atomicWrite(join(workspace, 'SKILL.md'), JOB_WORKSPACE_INSTRUCTIONS);
  return realpath(workspace);
}

export async function prepareContinuationWorkspace(workspace: string, completedAttemptId: string, packet: ProviderJobPacket, schema: string): Promise<string> {
  const root = await verifyContinuationWorkspace(workspace, schema);
  const owner = await realpath(dirname(root));
  const historyRoot = resolve(owner, '.history');
  const history = resolve(historyRoot, basename(root), completedAttemptId);
  assertInside(owner, history);
  await mkdir(history, { recursive: true });
  for (const directory of [historyRoot, resolve(historyRoot, basename(root)), history]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !(await samePath(await realpath(directory), directory))) throw new Error('Continuation history path is unsafe.');
  }
  for (const name of ['packet.json', 'reply.partial.json', 'reply.json']) {
    const from = resolve(root, name), to = resolve(history, name);
    try {
      const info = await lstat(from);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Continuation workspace contains an unsafe authoritative file.');
      await rename(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await atomicWrite(join(root, 'packet.json'), canonicalReplyData(packet));
  return root;
}

export async function verifyContinuationWorkspace(workspace: string, schema: string): Promise<string> {
  if ((await lstat(workspace)).isSymbolicLink()) throw new Error('Continuation workspace link is unsafe.');
  const root = await realpath(workspace);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Continuation workspace is unsafe.');
  // T20 has no reviewed saved-solver manifest here. Reject every extra provider-readable artifact.
  const allowed = new Set(['packet.json', 'reply.partial.json', 'reply.json', 'reply.schema.json', 'SKILL.md']);
  for (const name of await readdir(root)) {
    if (!allowed.has(name)) throw new Error(`Undeclared continuation artifact: ${name}`);
    const info = await lstat(join(root, name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Continuation artifact is unsafe.');
  }
  for (const [name, expected] of [['reply.schema.json', schema], ['SKILL.md', JOB_WORKSPACE_INSTRUCTIONS]] as const) {
    if ((await lstat(join(root, name))).size !== Buffer.byteLength(expected)) throw new Error(`Continuation ${name} differs from reviewed content.`);
    if ((await readFile(join(root, name), 'utf8')) !== expected) throw new Error(`Continuation ${name} differs from reviewed content.`);
  }
  return root;
}

export async function restoreCompletedWorkspace(workspaceRoot: string, workspace: string, packet: ProviderJobPacket): Promise<string> {
  const root = await realpath(workspaceRoot);
  if ((await lstat(workspace)).isSymbolicLink()) throw new Error('Completed workspace link is unsafe.');
  const actual = await realpath(workspace);
  assertInside(root, actual);
  const info = await lstat(actual);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Completed workspace is unsafe.');
  const packetPath = join(actual, 'packet.json');
  const expected = canonicalReplyData(packet), packetInfo = await lstat(packetPath);
  if (!packetInfo.isFile() || packetInfo.isSymbolicLink() || packetInfo.size !== Buffer.byteLength(expected) ||
    (await readFile(packetPath, 'utf8')) !== expected) {
    throw new Error('Completed workspace packet differs from the persisted request.');
  }
  return actual;
}

export async function readReplyFile(workspace: string, name: 'reply.partial.json' | 'reply.json', sourceText: string,
  capabilities: readonly ReplyCapability[]): Promise<CandidateReply | undefined> {
  if (!FILES.has(name)) throw new Error('Unsupported reply filename.');
  const root = await realpath(workspace);
  const path = resolve(root, name);
  assertInside(root, path);
  let first;
  try { first = await lstat(path); } catch { return; }
  if (!first.isFile() || first.isSymbolicLink() || first.size > REPLY_LIMITS.bytes) throw new Error('Reply file is not a bounded regular file.');
  const actual = await realpath(path);
  if (!(await samePath(actual, path))) throw new Error('Reply file path is not authoritative.');
  await delay(40);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const beforeRead = await handle.stat();
    if (!beforeRead.isFile() || beforeRead.size !== first.size || beforeRead.mtimeMs !== first.mtimeMs ||
      (first.ino && beforeRead.ino !== first.ino) || (first.dev && beforeRead.dev !== first.dev)) return;
    const bytes = Buffer.alloc(Math.min(REPLY_LIMITS.bytes + 1, beforeRead.size + 1));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > REPLY_LIMITS.bytes) throw new Error('Reply file exceeds its byte limit.');
    const afterRead = await handle.stat();
    if (afterRead.size !== beforeRead.size || afterRead.mtimeMs !== beforeRead.mtimeMs || afterRead.ino !== beforeRead.ino || afterRead.dev !== beforeRead.dev) return;
    const validated = parseAndValidateReply(bytes.subarray(0, bytesRead).toString('utf8'), { sourceText, capabilities });
    if (!validated.ok) throw new Error(validated.errors.join('\n'));
    if (name === 'reply.partial.json' && validated.value.status !== 'partial') throw new Error('The provisional file must declare partial status.');
    if (name === 'reply.json' && validated.value.status !== 'complete') throw new Error('The final file must declare complete status.');
    return validated.value;
  } finally { await handle.close(); }
}

export function provisionalForDisplay(reply: CandidateReply): CandidateReply {
  return {
    ...reply,
    status: 'partial',
    // A provisional classification may show its machinery, but never its headline claim.
    blocks: reply.blocks.map(block => block.type === 'classification' ? { ...block, headline: false } : block),
  };
}

async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, path);
}

function assertInside(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`${sep}..${sep}`)) throw new Error('Workspace path escapes its root.');
}

async function samePath(a: string, b: string) {
  return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}
