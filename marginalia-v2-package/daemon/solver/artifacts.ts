import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  SOLVER_LIMITS,
  type SolverArtifactBinding,
  type SolverRejectionCode,
  type SolverValidation,
} from '../../contracts/solver.ts';
import { isDigest } from '../../contracts/digest.ts';
import { BOUNDED_READ_OPEN_FLAGS, directoryIdentity, isBoundedRegularDescriptor } from '../jobs/workspace-integrity.ts';

/**
 * Filesystem authority for a recompute. Every path is re-resolved here; nothing
 * trusts a stored string, a reply field, or an earlier check.
 */
export const RECOMPUTE_DIRECTORY = '.recompute';

export type ResolvedSolverArtifacts = {
  workspace: string;
  solverPath: string;
  solverSha256: string;
  solverBytes: number;
  runtimeExecutable: string;
  runtimeSha256?: string;
};

export type PreparedSolverInput = {
  inputPath: string;
  directory: string;
  bytes: number;
};

const failure = (code: SolverRejectionCode, reason: string): { ok: false; code: SolverRejectionCode; reason: string } =>
  ({ ok: false, code, reason });

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** The reply contract already restricts this shape; it is re-checked because reply data is untrusted. */
export function safeRelativeSolverPath(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false;
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

async function assertRealDirectory(path: string): Promise<SolverValidation<string>> {
  try { return { ok: true, value: (await directoryIdentity(path)).path }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return failure('artifact-unknown', 'The job workspace is no longer available.');
    return failure('path-unsafe', 'The job workspace is not a real directory.');
  }
}

/**
 * Reads a bounded regular file through a no-follow handle and hashes what was
 * actually read, not what a prior stat described.
 */
async function hashRegularFile(path: string, maxBytes: number): Promise<SolverValidation<{ sha256: string; bytes: number }>> {
  let first;
  try { first = await lstat(path); } catch { return failure('artifact-unknown', 'The saved solver file is no longer present in its job workspace.'); }
  if (!first.isFile() || first.isSymbolicLink()) return failure('path-unsafe', 'The saved solver path is not a regular file.');
  if (first.size > maxBytes) return failure('artifact-modified', 'The saved solver file is larger than this version accepts.');
  let actual;
  try { actual = await realpath(path); } catch { return failure('artifact-unknown', 'The saved solver file could not be resolved.'); }
  if (!samePath(actual, path)) return failure('path-unsafe', 'The saved solver path resolves somewhere else.');
  const handle = await open(path, BOUNDED_READ_OPEN_FLAGS);
  try {
    const opened = await handle.stat();
    if (!isBoundedRegularDescriptor(opened, maxBytes)) return failure('path-unsafe', 'The opened solver file is not a bounded regular file.');
    if (opened.size !== first.size || opened.mtimeMs !== first.mtimeMs || opened.ino !== first.ino || opened.dev !== first.dev) {
      return failure('artifact-modified', 'The saved solver file changed before it was opened.');
    }
    const bytes = Buffer.alloc(opened.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ino !== opened.ino || after.dev !== opened.dev) {
      return failure('artifact-modified', 'The saved solver file changed while it was being read.');
    }
    return { ok: true, value: { sha256: createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex'), bytes: bytesRead } };
  } finally { await handle.close(); }
}

/**
 * Resolves and re-verifies the pinned solver artifact and its interpreter.
 * A hash that does not match the record the job committed is a rejection, not a warning.
 */
export async function resolveSolverArtifacts(binding: SolverArtifactBinding): Promise<SolverValidation<ResolvedSolverArtifacts>> {
  if (!isAbsolute(binding.workspace)) return failure('path-unsafe', 'An absolute job workspace path is required.');
  if (!isAbsolute(binding.runtimeExecutable)) return failure('path-unsafe', 'An absolute interpreter path is required.');
  if (!safeRelativeSolverPath(binding.solverRelativePath)) return failure('path-unsafe', 'The solver path is not a safe relative workspace path.');
  if (!isDigest(binding.solverSha256)) return failure('artifact-unknown', 'The solver artifact has no pinned content hash.');

  const workspace = await assertRealDirectory(binding.workspace);
  if (!workspace.ok) return workspace;
  const solverPath = resolve(workspace.value, binding.solverRelativePath);
  if (!inside(workspace.value, solverPath)) return failure('path-unsafe', 'The solver file is outside its job workspace.');

  const solver = await hashRegularFile(solverPath, SOLVER_LIMITS.maxSolverBytes);
  if (!solver.ok) return solver;
  if (solver.value.sha256 !== binding.solverSha256) {
    return failure('artifact-modified', 'The saved solver file no longer matches the version this reply committed.');
  }

  let runtimeInfo;
  try { runtimeInfo = await lstat(binding.runtimeExecutable); } catch { return failure('artifact-unknown', 'The configured interpreter is not present.'); }
  if (!runtimeInfo.isFile() || runtimeInfo.isSymbolicLink()) return failure('path-unsafe', 'The configured interpreter is not a regular file.');
  const runtimeActual = await realpath(binding.runtimeExecutable);
  const runtimeCanonical = await lstat(runtimeActual);
  if (!runtimeCanonical.isFile() || runtimeCanonical.isSymbolicLink() || runtimeCanonical.dev !== runtimeInfo.dev || runtimeCanonical.ino !== runtimeInfo.ino) {
    return failure('path-unsafe', 'The interpreter path resolves somewhere else.');
  }
  if (inside(workspace.value, runtimeActual)) {
    return failure('path-unsafe', 'The interpreter must not live inside the job workspace it executes.');
  }

  let runtimeSha256: string | undefined;
  if (binding.runtimeSha256 !== undefined) {
    if (!isDigest(binding.runtimeSha256)) return failure('artifact-unknown', 'The interpreter has an invalid pinned hash.');
    const hashed = await hashRegularFile(runtimeActual, 512 * 1024 * 1024);
    if (!hashed.ok) return hashed;
    if (hashed.value.sha256 !== binding.runtimeSha256) return failure('artifact-modified', 'The configured interpreter no longer matches its pinned hash.');
    runtimeSha256 = hashed.value.sha256;
  }

  return { ok: true, value: {
    workspace: workspace.value,
    solverPath,
    solverSha256: solver.value.sha256,
    solverBytes: solver.value.bytes,
    runtimeExecutable: runtimeActual,
    ...(runtimeSha256 ? { runtimeSha256 } : {}),
  } };
}

/**
 * Writes the input tuple the solver will read. The host writes it; the sandboxed
 * process only reads it. A fresh directory per attempt keeps committed job
 * artifacts (packet.json, reply.json) untouched.
 */
export async function prepareSolverInput(workspace: string, requestId: string, attemptToken: string, payload: string): Promise<SolverValidation<PreparedSolverInput>> {
  if (!/^[\w-]{1,100}$/.test(requestId) || !/^[\w-]{1,100}$/.test(attemptToken)) {
    return failure('invalid-request', 'The recompute attempt has an unsafe directory identity.');
  }
  const root = await assertRealDirectory(workspace);
  if (!root.ok) return root;
  const holder = resolve(root.value, RECOMPUTE_DIRECTORY);
  if (!inside(root.value, holder)) return failure('path-unsafe', 'The recompute directory escapes its workspace.');
  await mkdir(holder, { recursive: true });
  const holderInfo = await lstat(holder);
  if (!holderInfo.isDirectory() || holderInfo.isSymbolicLink() || !samePath(await realpath(holder), holder)) {
    return failure('path-unsafe', 'The recompute directory is not a real directory.');
  }
  const directory = resolve(holder, `${requestId}.${attemptToken}`);
  if (!inside(holder, directory)) return failure('path-unsafe', 'The recompute attempt directory escapes its workspace.');
  try {
    await mkdir(directory, { recursive: false });
  } catch {
    return failure('path-unsafe', 'The recompute attempt directory already exists.');
  }
  const inputPath = resolve(directory, 'input.json');
  const temporary = `${inputPath}.tmp`;
  await writeFile(temporary, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, inputPath);
  const written = await lstat(inputPath);
  if (!written.isFile() || written.isSymbolicLink()) return failure('path-unsafe', 'The prepared input is not a regular file.');
  return { ok: true, value: { inputPath, directory, bytes: Buffer.byteLength(payload, 'utf8') } };
}

export async function discardSolverInput(directory: string): Promise<void> {
  // Best effort. A leftover bounded input file is not a correctness failure.
  try { await rm(directory, { recursive: true, force: true, maxRetries: 2 }); } catch { /* ignore */ }
}

export function newAttemptToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * The path `prepareSolverInput` would write, computed without touching the disk.
 *
 * Planning a recompute must not create anything, but the plan still has to name the
 * exact policy the click would run, and the input path is one argument of that
 * command. This is pure path arithmetic; `prepareSolverInput` remains the only
 * function that writes.
 */
export function nominalSolverInputPath(workspace: string, requestId: string, attemptToken: string): string {
  return resolve(workspace, RECOMPUTE_DIRECTORY, `${requestId}.${attemptToken}`, 'input.json');
}
