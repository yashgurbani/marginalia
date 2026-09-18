import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { JobConsentAuthority, JobSnapshot } from '../../contracts/jobs.ts';
import type { CandidateReply } from '../../contracts/reply.ts';
import { SOLVER_LIMITS, type SolverArtifactBinding } from '../../contracts/solver.ts';
import type { SolverArtifactBindingSource } from '../solver/adapters.ts';
import { hashRegularFile } from '../solver/artifacts.ts';
import { assertDirectoryCurrent, assertInside, directoryIdentity, readWorkspaceBytes } from './workspace-integrity.ts';
import { JobConflictError, type JobStore, type SolverBindingCommit } from './store.ts';

type CommitSolverBindingsInput = {
  store: JobStore;
  authority: JobConsentAuthority;
  job: Readonly<JobSnapshot>;
  attemptId: string;
  expectedRevision: number;
  reply: CandidateReply;
  workspace?: string;
};

/**
 * Pins every solver file immediately before the synchronous reply-acceptance
 * transaction. A solver-bearing reply without a stable bounded artifact is not
 * committed as recomputable work.
 */
export async function commitSucceededReplyWithSolverBindings(input: CommitSolverBindingsInput): Promise<void> {
  const bindings = await collectBindings(input.job.id, input.attemptId, input.reply, input.workspace);
  input.authority.withResultAcceptance(input.job, input.attemptId, () =>
    input.store.succeed(input.job.id, input.attemptId, input.expectedRevision, input.reply, bindings));
}

/** The persisted binding table is the concrete source mounted by the solver context adapter. */
export function createJobSolverArtifactBindings(store: Pick<JobStore, 'solverArtifactBinding'>): SolverArtifactBindingSource {
  return {
    async resolve(replyVersionId: string, solverId: string): Promise<SolverArtifactBinding | undefined> {
      return store.solverArtifactBinding(replyVersionId, solverId);
    },
  };
}

async function collectBindings(jobId: string, attemptId: string, reply: CandidateReply, workspace?: string): Promise<SolverBindingCommit[]> {
  const solvers = reply.blocks.filter((block): block is Extract<CandidateReply['blocks'][number], { type: 'solver' }> => block.type === 'solver');
  if (!solvers.length) return [];
  if (!workspace) throw new JobConflictError('The completed solver workspace is unavailable.');

  const root = await directoryIdentity(resolve(workspace));
  const runtimeExecutable = await realpath(process.execPath);
  const runtime = await hashRegularFile(runtimeExecutable, 512 * 1024 * 1024);
  if (!runtime.ok) throw new JobConflictError('The interpreter binary could not be pinned. Ask again to rebuild this solver.');
  const runtimeIdentity = process.release.name;
  const runtimeVersion = process.version;
  const generation = `directory:${root.dev}:${root.ino}`;
  const bindings: SolverBindingCommit[] = [];
  for (const solver of solvers) {
    const solverPath = resolve(root.path, solver.path);
    assertInside(root.path, solverPath);
    const holderPath = dirname(solverPath);
    const holder = holderPath === root.path ? root : await directoryIdentity(holderPath);
    if (holder !== root) assertInside(root.path, holder.path);
    const bytes = await readWorkspaceBytes(holder, basename(solverPath), SOLVER_LIMITS.maxSolverBytes);
    if (!bytes) throw new JobConflictError('A saved solver changed while its reply was being committed.');
    await assertDirectoryCurrent(root);
    bindings.push({
      solverId: solver.id,
      jobId,
      attemptId,
      workspace: root.path,
      workspaceDev: String(root.dev),
      workspaceIno: String(root.ino),
      workspaceGeneration: generation,
      solverRelativePath: solver.path,
      solverSha256: createHash('sha256').update(bytes).digest('hex'),
      runtimeExecutable,
      runtimeSha256: runtime.value.sha256,
      runtimeIdentity,
      runtimeVersion,
    });
  }
  return bindings;
}
