import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, writeFile, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export type DirectoryIdentity = { readonly path: string; readonly dev: number; readonly ino: number };
export function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}
export function assertInside(root: string, path: string): void {
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Workspace path escapes its root.');
}
export async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  if (!isAbsolute(path)) throw new Error('Workspace identity must be absolute.');
  const info = await lstat(path), canonical = await realpath(path);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(canonical, path)) throw new Error('Workspace directory is unsafe.');
  const result = { path: canonical, dev: info.dev, ino: info.ino };
  await assertDirectoryCurrent(result); return result;
}
export async function assertDirectoryCurrent(root: DirectoryIdentity): Promise<void> {
  const info = await lstat(root.path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== root.dev || info.ino !== root.ino || !samePath(await realpath(root.path), root.path)) {
    throw new Error('Workspace directory identity changed.');
  }
}
/** Bounded, stable descriptor read; path checks supplement, not replace, OS confinement. */
export async function readWorkspaceBytes(root: DirectoryIdentity, name: string, maximum: number, settleMs = 0): Promise<Buffer | undefined> {
  if (basename(name) !== name || name === '.' || name === '..' || !Number.isSafeInteger(maximum) || maximum < 0) throw new Error('Invalid authoritative workspace file.');
  await assertDirectoryCurrent(root);
  const path = join(root.path, name);
  let first;
  try { first = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!first.isFile() || first.isSymbolicLink() || first.nlink !== 1 || first.size > maximum || !samePath(await realpath(path), path)) throw new Error('Workspace file is not a bounded regular authoritative file.');
  if (settleMs) await delay(settleMs);
  await assertDirectoryCurrent(root);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== first.size || before.mtimeMs !== first.mtimeMs || before.dev !== first.dev || before.ino !== first.ino) return;
    const bytes = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < bytes.length) { const result = await handle.read(bytes, used, bytes.length - used, used); if (!result.bytesRead) break; used += result.bytesRead; }
    const after = await handle.stat(), pathAfter = await lstat(path);
    await assertDirectoryCurrent(root);
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || after.dev !== before.dev || after.nlink !== 1 ||
      !pathAfter.isFile() || pathAfter.isSymbolicLink() || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino) return;
    return bytes.subarray(0, used);
  } finally { await handle.close(); }
}
/** Archive only known output/packet files outside the provider-readable directory. Never
 * overwrite an older history. Partial failure remains visible and requires a fresh attempt. */
export async function archiveWorkspace(root: DirectoryIdentity, completedAttemptId: string): Promise<void> {
  if (!/^[\w-]{1,100}$/.test(completedAttemptId)) throw new Error('Invalid completed attempt identifier.');
  const owner = await directoryIdentity(dirname(root.path));
  let current = owner;
  for (const name of ['.history', basename(root.path)]) {
    await assertDirectoryCurrent(current);
    const path = join(current.path, name);
    try { await mkdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    current = await directoryIdentity(path);
  }
  await assertDirectoryCurrent(current);
  const history = join(current.path, completedAttemptId);
  await mkdir(history); // EEXIST is intentionally not recoverable by overwriting history.
  const destination = await directoryIdentity(history);
  for (const name of ['packet.json', 'reply.partial.json', 'reply.json']) {
    await assertDirectoryCurrent(root); await assertDirectoryCurrent(destination);
    const from = join(root.path, name), to = join(history, name);
    let first;
    try { first = await lstat(from); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!first.isFile() || first.isSymbolicLink() || first.nlink !== 1) throw new Error('Unsafe continuation archive source.');
    const bytes = await readWorkspaceBytes(root, name, 1024 * 1024);
    if (!bytes) throw new Error('Continuation archive source changed.');
    await writeFile(to, bytes, { flag: 'wx' });
    await assertDirectoryCurrent(root); await assertDirectoryCurrent(destination);
    const after = await lstat(from);
    if (!after.isFile() || after.isSymbolicLink() || after.ino !== first.ino || after.dev !== first.dev || after.mtimeMs !== first.mtimeMs || after.size !== first.size) throw new Error('Continuation archive source changed.');
    await unlink(from);
  }
}
