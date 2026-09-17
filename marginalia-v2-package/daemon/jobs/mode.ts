import type { Intent } from '../../contracts/reply.ts';
/** Host choice only. Fast contextual definitions are read-only; deep help supports first-frame files. */
export function modeForIntent(intent: Intent): 'structured-final' | 'workspace-files' {
  return intent === 'define' ? 'structured-final' : 'workspace-files';
}
