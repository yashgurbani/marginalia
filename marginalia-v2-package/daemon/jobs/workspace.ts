import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { archiveWorkspace, assertDirectoryCurrent, assertInside, directoryIdentity, readWorkspaceBytes, samePath } from './workspace-integrity.ts';
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
  await archiveWorkspace(await directoryIdentity(root), completedAttemptId);
  await atomicWrite(join(root, 'packet.json'), canonicalReplyData(packet));
  return root;
}

export async function verifyContinuationWorkspace(workspace: string, schema: string): Promise<string> {
  const identity = await directoryIdentity(workspace), root = identity.path;
  // T20 has no reviewed saved-solver manifest here. Reject every extra provider-readable artifact.
  const allowed = new Set(['packet.json', 'reply.partial.json', 'reply.json', 'reply.schema.json', 'SKILL.md']);
  for (const name of await readdir(root)) {
    if (!allowed.has(name)) throw new Error(`Undeclared continuation artifact: ${name}`);
    const info = await lstat(join(root, name));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Continuation artifact is unsafe.');
  }
  for (const [name, expected] of [['reply.schema.json', schema], ['SKILL.md', JOB_WORKSPACE_INSTRUCTIONS]] as const) {
    const bytes = await readWorkspaceBytes(identity, name, Buffer.byteLength(expected));
    if (!bytes || !bytes.equals(Buffer.from(expected))) throw new Error(`Continuation ${name} differs from reviewed content.`);
  }
  await assertDirectoryCurrent(identity);
  return root;
}

export async function restoreCompletedWorkspace(workspaceRoot: string, workspace: string, packet: ProviderJobPacket): Promise<string> {
  const root = await realpath(workspaceRoot), identity = await directoryIdentity(workspace);
  assertInside(root, identity.path);
  // Only direct job directories, never .history or an arbitrary deeper directory.
  if (!samePath(dirname(identity.path), root)) throw new Error('Completed workspace is not a direct job directory.');
  const expected = canonicalReplyData(packet);
  const bytes = await readWorkspaceBytes(identity, 'packet.json', Buffer.byteLength(expected));
  if (!bytes || !bytes.equals(Buffer.from(expected))) throw new Error('Completed workspace packet differs from the persisted request.');
  return identity.path;
}

export async function readReplyFile(workspace: string, name: 'reply.partial.json' | 'reply.json', sourceText: string,
  capabilities: readonly ReplyCapability[]): Promise<CandidateReply | undefined> {
  if (!FILES.has(name)) throw new Error('Unsupported reply filename.');
  const identity = await directoryIdentity(workspace);
  const bytes = await readWorkspaceBytes(identity, name, REPLY_LIMITS.bytes, 40);
  if (!bytes) return;
  const validated = parseAndValidateReply(bytes.toString('utf8'), { sourceText, capabilities, requireOrigins: true });
  if (!validated.ok) throw new Error(validated.errors.join('\n'));
  if (name === 'reply.partial.json' && validated.value.status !== 'partial') throw new Error('The provisional file must declare partial status.');
  if (name === 'reply.json' && validated.value.status !== 'complete') throw new Error('The final file must declare complete status.');
  return validated.value;
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
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
