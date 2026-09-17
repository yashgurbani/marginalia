import type { SamplesInterpolationReadiness } from '../contracts/sample-provenance.ts';

/** Technical diagnostics remain in the contract layer, not in reader-facing copy.
 * Do not echo its reason: it may contain field names or untrusted record content.
 */
export function sampleReadinessMessage(state: Extract<SamplesInterpolationReadiness, { ok: false }>['state']): string {
  if (state === 'historical') return 'These saved values lack a complete record of how they were made. The original grid is still available; recompute before using it with current inputs.';
  if (state === 'mismatch') return 'These saved values do not match this reply or its current inputs. The original grid is still available; recompute for these inputs.';
  return 'These saved values could not be checked safely. The original grid is still available; recompute before using these values.';
}
