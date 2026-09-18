import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { archiveWorkspace, assertDirectoryCurrent, assertInside, directoryIdentity, readWorkspaceBytes, samePath } from './workspace-integrity.ts';
import { REPLY_LIMITS, parseAndValidateReply, type CandidateReply, type ReplyCapability } from '../../contracts/reply.ts';
import type { ProviderJobPacket } from '../../contracts/jobs.ts';
import { canonicalReplyData } from '../../contracts/reply.ts';
import { SOLVER_AUTHORING_PATH, SOLVER_LIMITS, SOLVER_MANIFEST_PATH, validateSolverAuthoringManifest, type SolverArtifactBinding } from '../../contracts/solver.ts';
import { JOB_WORKSPACE_INSTRUCTIONS } from './envelope.ts';

const FILES = new Set(['reply.partial.json', 'reply.json']);
const SOLVER_DIRECTORY = dirname(SOLVER_AUTHORING_PATH);

export type ContinuationSolverAuthority = {
  jobId: string;
  attemptId: string;
  reply: CandidateReply;
  bindings: readonly { solverId: string; binding: SolverArtifactBinding }[];
};

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

export async function prepareContinuationWorkspace(workspace: string, completedAttemptId: string, packet: ProviderJobPacket, schema: string,
  solverAuthority?: ContinuationSolverAuthority): Promise<string> {
  const root = await verifyContinuationWorkspace(workspace, schema, solverAuthority);
  await archiveWorkspace(await directoryIdentity(root), completedAttemptId);
  await atomicWrite(join(root, 'packet.json'), canonicalReplyData(packet));
  return root;
}

export async function verifyContinuationWorkspace(workspace: string, schema: string,
  solverAuthority?: ContinuationSolverAuthority): Promise<string> {
  const identity = await directoryIdentity(workspace), root = identity.path;
  const allowed = new Set(['packet.json', 'reply.partial.json', 'reply.json', 'reply.schema.json', 'SKILL.md']);
  if (solverAuthority?.reply.blocks.some(block => block.type === 'solver')) allowed.add(SOLVER_DIRECTORY);
  for (const name of await readdir(root)) {
    if (!allowed.has(name)) throw new Error(`Undeclared continuation artifact: ${name}`);
    if (name === SOLVER_DIRECTORY) continue;
    const info = await lstat(join(root, name));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Continuation artifact is unsafe.');
  }
  for (const [name, expected] of [['reply.schema.json', schema], ['SKILL.md', JOB_WORKSPACE_INSTRUCTIONS]] as const) {
    const bytes = await readWorkspaceBytes(identity, name, Buffer.byteLength(expected));
    if (!bytes || !bytes.equals(Buffer.from(expected))) throw new Error(`Continuation ${name} differs from reviewed content.`);
  }
  if (solverAuthority) await verifyContinuationSolver(identity, solverAuthority);
  await assertDirectoryCurrent(identity);
  return root;
}

async function verifyContinuationSolver(root: Awaited<ReturnType<typeof directoryIdentity>>, authority: ContinuationSolverAuthority): Promise<void> {
  const solvers = authority.reply.blocks.filter((block): block is Extract<CandidateReply['blocks'][number], { type: 'solver' }> => block.type === 'solver');
  if (!solvers.length) {
    if (authority.bindings.length) throw new Error('Continuation solver authority does not match the reviewed reply.');
    return;
  }
  if (solvers.length !== authority.bindings.length || new Set(authority.bindings.map(entry => entry.solverId)).size !== authority.bindings.length) {
    throw new Error('Continuation solver authority is incomplete.');
  }
  const holder = await directoryIdentity(resolve(root.path, SOLVER_DIRECTORY));
  assertInside(root.path, holder.path);
  const names = await readdir(holder.path);
  if (names.length !== 2 || !names.includes(basename(SOLVER_AUTHORING_PATH)) || !names.includes(basename(SOLVER_MANIFEST_PATH))) {
    throw new Error('Undeclared continuation solver artifact.');
  }
  const manifestBytes = await readWorkspaceBytes(holder, basename(SOLVER_MANIFEST_PATH), SOLVER_LIMITS.maxManifestBytes);
  if (!manifestBytes) throw new Error('Continuation solver manifest is unavailable.');
  let document: unknown;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); }
  catch { throw new Error('Continuation solver manifest is invalid.'); }
  const manifest = validateSolverAuthoringManifest(document, authority.reply);
  if (!manifest.ok) throw new Error(manifest.reason);
  for (const solver of solvers) {
    const entry = authority.bindings.find(candidate => candidate.solverId === solver.id);
    if (!entry) throw new Error('Continuation solver authority is incomplete.');
    const binding = entry.binding;
    if (binding.jobId !== authority.jobId || binding.attemptId !== authority.attemptId ||
      !samePath(binding.workspace, root.path) || binding.workspaceGeneration !== `directory:${root.dev}:${root.ino}` ||
      binding.solverRelativePath !== solver.path || binding.solverRelativePath !== manifest.value.files[0].path ||
      binding.solverSha256 !== manifest.value.files[0].sha256) {
      throw new Error('Continuation solver differs from its host-pinned binding.');
    }
    const solverPath = resolve(root.path, binding.solverRelativePath);
    assertInside(root.path, solverPath);
    if (!samePath(dirname(solverPath), holder.path)) throw new Error('Continuation solver path is unsafe.');
    const bytes = await readWorkspaceBytes(holder, basename(solverPath), SOLVER_LIMITS.maxSolverBytes);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== binding.solverSha256) {
      throw new Error('Continuation solver differs from its host-pinned binding.');
    }
  }
  const finalManifest = await readWorkspaceBytes(holder, basename(SOLVER_MANIFEST_PATH), SOLVER_LIMITS.maxManifestBytes);
  const finalNames = await readdir(holder.path);
  if (!finalManifest?.equals(manifestBytes) || finalNames.length !== names.length || names.some(name => !finalNames.includes(name))) {
    throw new Error('Continuation solver artifacts changed during verification.');
  }
  const binding = authority.bindings[0].binding;
  const finalSolver = await readWorkspaceBytes(holder, basename(binding.solverRelativePath), SOLVER_LIMITS.maxSolverBytes);
  if (!finalSolver || createHash('sha256').update(finalSolver).digest('hex') !== binding.solverSha256) {
    throw new Error('Continuation solver artifacts changed during verification.');
  }
  await assertDirectoryCurrent(holder);
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

/** Final delivery bytes only, with the same directory/file guards as structured admission. */
export async function readRawSkillReply(workspace: string): Promise<string | undefined> {
  const identity = await directoryIdentity(workspace);
  const bytes = await readWorkspaceBytes(identity, 'reply.json', REPLY_LIMITS.bytes, 1);
  if (!bytes) return;
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
