import { createHash } from 'node:crypto';
import { readdir, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { JobConsentAuthority, JobSnapshot } from '../../contracts/jobs.ts';
import type { CandidateReply } from '../../contracts/reply.ts';
import { SOLVER_LIMITS, SOLVER_MANIFEST_PATH, SolverArtifactBindingError, permitsSolverAuthoring, validateSolverAuthoringManifest, type SolverArtifactBinding } from '../../contracts/solver.ts';
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
  if (input.reply.blocks.some(block => block.type === 'solver') &&
    !permitsSolverAuthoring(input.job.context.intent, input.job.mode, input.store.capabilities(input.job.id))) {
    throw new JobConflictError('The host did not permit solver authoring for this job.');
  }
  const bindings = await collectBindings(input.job.id, input.attemptId, input.reply, input.workspace);
  input.authority.withResultAcceptance(input.job, input.attemptId, () =>
    input.store.succeed(input.job.id, input.attemptId, input.expectedRevision, input.reply, bindings,
      ['evidence', 'explore'].includes(input.reply.intent) ? input.authority.evidenceObservations?.(input.job, input.attemptId) : undefined));
}

/** The persisted binding table is the concrete source mounted by the solver context adapter. */
export function createJobSolverArtifactBindings(store: Pick<JobStore, 'solverArtifactBinding'>): SolverArtifactBindingSource {
  return {
    async resolve(replyVersionId: string, solverId: string): Promise<SolverArtifactBinding | undefined> {
      const binding = store.solverArtifactBinding(replyVersionId, solverId);
      if (!binding) return;
      // Legacy host pins predate manifests. Every new binding carries manifest-v1.
      if (/^directory:[^:]+:[^:]+$/.test(binding.workspaceGeneration)) return binding;
      const root = await directoryIdentity(resolve(binding.workspace));
      const manifestPath = resolve(root.path, SOLVER_MANIFEST_PATH);
      assertInside(root.path, manifestPath);
      try {
        const holder = await directoryIdentity(dirname(manifestPath));
        assertInside(root.path, holder.path);
        const manifest = await readWorkspaceBytes(holder, basename(manifestPath), SOLVER_LIMITS.maxManifestBytes);
        if (!manifest) throw new SolverArtifactBindingError('manifest-required');
      } catch (error) {
        if (error instanceof SolverArtifactBindingError) throw error;
        throw new SolverArtifactBindingError('manifest-required');
      }
      return binding;
    },
  };
}

async function collectBindings(jobId: string, attemptId: string, reply: CandidateReply, workspace?: string): Promise<SolverBindingCommit[]> {
  const solvers = reply.blocks.filter((block): block is Extract<CandidateReply['blocks'][number], { type: 'solver' }> => block.type === 'solver');
  if (!solvers.length) return [];
  if (!workspace) throw new JobConflictError('The completed solver workspace is unavailable.');

  const root = await directoryIdentity(resolve(workspace));
  const holder = await directoryIdentity(resolve(root.path, 'solver'));
  assertInside(root.path, holder.path);
  const manifestBytes = await readWorkspaceBytes(holder, basename(SOLVER_MANIFEST_PATH), SOLVER_LIMITS.maxManifestBytes);
  if (!manifestBytes) throw new JobConflictError('This saved solver needs a manifest before it can run. Your saved reply remains available to read.');
  let document: unknown;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); }
  catch { throw new JobConflictError('The solver manifest must be a UTF-8 JSON document.'); }
  const manifest = validateSolverAuthoringManifest(document, reply);
  if (!manifest.ok) throw new JobConflictError(manifest.reason);
  const checkInventory = async () => {
    for (const name of await readdir(root.path)) {
      if (name === 'solver') continue;
      if (!['packet.json', 'reply.schema.json', 'SKILL.md', 'reply.json', 'reply.partial.json'].includes(name)) {
        throw new JobConflictError('The solver workspace contains an unlisted file.');
      }
      if (!await readWorkspaceBytes(root, name, SOLVER_LIMITS.maxSolverBytes)) throw new JobConflictError('A workspace delivery file changed.');
    }
    const names = await readdir(holder.path);
    if (names.length !== 2 || !names.includes('main.js') || !names.includes('manifest.json')) {
      throw new JobConflictError('The solver directory contains an unlisted file.');
    }
    await assertDirectoryCurrent(holder);
    await assertDirectoryCurrent(root);
  };
  await checkInventory();
  const runtimeExecutable = await realpath(process.execPath);
  const runtime = await hashRegularFile(runtimeExecutable, 512 * 1024 * 1024);
  if (!runtime.ok) throw new JobConflictError('The interpreter binary could not be pinned. Ask again to rebuild this solver.');
  const runtimeIdentity = process.release.name;
  const runtimeVersion = process.version;
  const generation = `manifest-v1:directory:${root.dev}:${root.ino}`;
  const bindings: SolverBindingCommit[] = [];
  for (const solver of solvers) {
    const solverPath = resolve(root.path, solver.path);
    assertInside(root.path, solverPath);
    const holderPath = dirname(solverPath);
    const holder = holderPath === root.path ? root : await directoryIdentity(holderPath);
    if (holder !== root) assertInside(root.path, holder.path);
    const bytes = await readWorkspaceBytes(holder, basename(solverPath), SOLVER_LIMITS.maxSolverBytes);
    if (!bytes) throw new JobConflictError('A saved solver changed while its reply was being committed.');
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.value.files[0].sha256) {
      throw new JobConflictError('The solver file does not match its manifest digest.');
    }
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
  const finalManifest = await readWorkspaceBytes(holder, basename(SOLVER_MANIFEST_PATH), SOLVER_LIMITS.maxManifestBytes);
  if (!finalManifest?.equals(manifestBytes)) throw new JobConflictError('The solver manifest changed during acceptance.');
  await checkInventory();
  return bindings;
}
