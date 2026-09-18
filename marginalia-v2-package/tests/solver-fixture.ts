import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SOLVER_MANIFEST_SCHEMA } from '../contracts/solver.ts';

export async function writeSolverManifest(workspace: string, source: string, inputs: readonly { name: string; min: number; max: number; default: number; unit: string }[], outputs: readonly string[]) {
  await writeFile(join(workspace, 'solver', 'manifest.json'), JSON.stringify({ schema: SOLVER_MANIFEST_SCHEMA,
    files: [{ path: 'solver/main.js', sha256: createHash('sha256').update(source).digest('hex') }], inputs, outputs }));
}
