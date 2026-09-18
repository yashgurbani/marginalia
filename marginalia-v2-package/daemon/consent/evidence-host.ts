import { createHash } from 'node:crypto';
import type { PolicyHostEvidenceSource } from './evidence.ts';
import { observedLaunch } from '../providers/launch-facts.ts';

const required = [
  'dedicated-credential-origin-not-attested', 'inherited-environment-values-not-reviewed',
  'effective-instruction-and-capability-closure-not-observed', 'model-reachable-read-confinement-not-observed',
  'filesystem-write-confinement-not-observed', 'closed-tool-network-not-observed', 'model-traffic-separation-not-observed',
] as const;

/** Passive, real launch observations. It does not run implicit model turns or promote
 * requested sandbox flags, sign-in, a tools list, or a command-only probe into confinement.
 * Platform enforcement proof must come from an independently verified host implementation. */
export function createDedicatedHostEvidenceSource(): PolicyHostEvidenceSource & {
  /** Evidence completeness only. Operational availability is owned by the runtime factory. */
  readiness(): { ready: false; reasons: string[] };
} {
  return {
    readiness: () => ({ ready: false, reasons: [...required] }),
    async collect(context) {
      const facts = observedLaunch(context.audit);
      if (!facts || !facts.alive || facts.provider !== context.job.provider || facts.workspace !== context.request.workspace) return {};
      const reference = createHash('sha256').update(JSON.stringify([facts.executableSha256, facts.observedAt, facts.provider, facts.workspace, facts.codexHome])).digest('hex');
      return {
        environment: { scope: context.policy.evidenceScope, source: 'host-environment-audit', reference: `launch:${reference}`,
          // Launch records cannot certify a pre-existing home's credential origin or reviewed
          // environment values. Incomplete is intentional even though these paths/hashes are real.
          complete: false, value: { serverCwd: facts.workspace, codexHome: facts.codexHome, dedicatedHome: true,
            credentialsCopied: false, normalSettingsChanged: false, inheritedEnvironmentKeys: [...facts.inheritedEnvironmentKeys],
            inheritedEnvironmentValueDigests: { ...facts.environmentValueDigests }, environmentReviewed: false,
            windowsKeyCasingReviewed: facts.windowsKeyCasingReviewed, executableResolutionReviewed: true } },
      };
    },
    async authorizeRecovery() { throw new Error('Dedicated runtime recovery confinement evidence has not been established.'); },
  };
}
