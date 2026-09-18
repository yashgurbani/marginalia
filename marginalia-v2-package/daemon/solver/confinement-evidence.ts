import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodexPolicy, Platform, RuntimeBackend } from '../codex-policy.ts';
import type { RpcTransport } from '../providers/stdio.ts';
import type { SolverEvidenceSource } from './service.ts';
import {
  SolverPolicyError,
  type SolverCommandObservation,
  type SolverCommandTransport,
} from './transport.ts';

/**
 * Codex 0.153.4 exposes no observation that proves the sandbox requested for a
 * command/exec call was applied. A probe can falsify confinement when a forbidden
 * operation succeeds, but a denied operation cannot verify confinement. This
 * collector therefore reports named observations and never supplies policy evidence.
 */

export const CONFINEMENT_EVIDENCE_VERSION = 'marginalia.confinement-evidence.v1' as const;
export const PROBE_SENTINEL_PREFIX = 'marginalia-confinement-probe:' as const;

export type ConfinementProbeName = 'filesystem-write' | 'loopback-network' | 'windows-sandbox-readiness';
export type ConfinementProbeOutcome = 'denied' | 'not-denied' | 'inconclusive' | 'not-run';
export type ConfinementProbeResult = {
  readonly probe: ConfinementProbeName;
  readonly outcome: ConfinementProbeOutcome;
  readonly detail: string;
};

/** Never 'confined'. Falsification is sound on this evidence; verification is not. */
export type ConfinementVerdict = 'unverified' | 'not-confined';

export type ConfinementReadiness = {
  readonly version: typeof CONFINEMENT_EVIDENCE_VERSION;
  readonly platform: Platform;
  readonly backend: RuntimeBackend;
  readonly verdict: ConfinementVerdict;
  /** Always false. No observation available on any platform today proves the requested sandbox was applied to this exec. */
  readonly confinementObserved: false;
  readonly evidenceScope: string;
  readonly probes: readonly ConfinementProbeResult[];
  readonly issues: readonly string[];
};

export type ConfinementEvidenceOptions = {
  readonly transport: SolverCommandTransport;
  /** Daemon-owned directory outside every policy writable root. */
  readonly probeRoot: string;
  /** Read-only RPC handle, used for `windowsSandbox/readiness` only. Omitted means that probe is `not-run`. */
  readonly rpc?: Pick<RpcTransport, 'request'>;
  readonly probeTimeoutMs?: number;
  readonly newAttemptId?: () => string;
};

export interface ConfinementEvidenceCollector extends SolverEvidenceSource {
  readiness(): ConfinementReadiness | undefined;
  issues(): readonly string[];
  observe(policy: CodexPolicy): Promise<ConfinementReadiness>;
}

/** Builds a probe argv. The collector appends the filesystem target arguments. */
export function confinementProbeCommand(
  policy: CodexPolicy,
  probe: 'filesystem-write' | 'loopback-network',
): readonly string[] {
  if (policy.operation !== 'saved-solver') throw new SolverPolicyError('Only a saved-solver policy can be probed.');
  const prefix = `${PROBE_SENTINEL_PREFIX}${probe}=`;
  // Node --eval input is CommonJS even though this package is ESM.
  if (probe === 'filesystem-write') {
    const script = `const {writeFileSync}=require('node:fs');const {join}=require('node:path');const target=join(process.argv[1],\`probe-\${process.argv[2]}.tmp\`);try{writeFileSync(target,'',{flag:'wx'});process.stdout.write(${JSON.stringify(`${prefix}not-denied\n`)})}catch{process.stdout.write(${JSON.stringify(`${prefix}denied\n`)})}`;
    return [policy.commandExec.params.command[0], '-e', script];
  }
  const script = `const net=require('node:net');let settled=false;const socket=net.connect(49199,'127.0.0.1');const done=(outcome)=>{if(settled)return;settled=true;socket.destroy();process.stdout.write(${JSON.stringify(prefix)}+outcome+'\\n')};socket.setTimeout(2000,()=>done('inconclusive'));socket.once('connect',()=>done('not-denied'));socket.once('error',(error)=>done(['EPERM','EACCES','EPROTONOSUPPORT'].includes(error.code)?'denied':'inconclusive'))`;
  return [policy.commandExec.params.command[0], '-e', script];
}

export function readProbeSentinel(
  probe: ConfinementProbeName,
  observation: SolverCommandObservation,
): ConfinementProbeResult {
  if (observation.status !== 'exited') return { probe, outcome: 'inconclusive', detail: observation.reason };
  const lines = observation.stdout.text.replaceAll('\r\n', '\n').split('\n').filter(line => line.length > 0);
  const outcomes: ConfinementProbeOutcome[] = ['denied', 'not-denied', 'inconclusive'];
  const matches = outcomes.filter(outcome => lines.includes(`${PROBE_SENTINEL_PREFIX}${probe}=${outcome}`));
  if (lines.length !== 1 || matches.length !== 1) {
    return { probe, outcome: 'inconclusive', detail: 'The probe returned no single exact sentinel line.' };
  }
  return { probe, outcome: matches[0], detail: `The probe reported ${matches[0]}.` };
}

export function createConfinementEvidenceCollector(options: ConfinementEvidenceOptions): ConfinementEvidenceCollector {
  const timeoutMs = options.probeTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new SolverPolicyError('Probe timeout must be a safe integer from 1000 through 60000 ms.');
  }
  if (!options.probeRoot.trim()) throw new SolverPolicyError('A daemon-owned confinement probe root is required.');
  const newAttemptId = options.newAttemptId ?? randomUUID;
  let cached: ConfinementReadiness | undefined;

  async function execProbe(policy: Extract<CodexPolicy, { operation: 'saved-solver' }>, probe: 'filesystem-write' | 'loopback-network') {
    const executionAttemptId = `confinement-probe-${newAttemptId()}`;
    const target = join(options.probeRoot, `probe-${executionAttemptId}.tmp`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let result: ConfinementProbeResult;
    try {
      const observation = await options.transport.exec({
        command: probe === 'filesystem-write'
          ? [...confinementProbeCommand(policy, probe), options.probeRoot, executionAttemptId]
          : confinementProbeCommand(policy, probe),
        cwd: policy.commandExec.params.cwd,
        timeoutMs,
        sandboxPolicy: policy.sandboxPolicy,
      }, { maxOutputBytes: 4096, executionAttemptId, signal: controller.signal });
      result = readProbeSentinel(probe, observation);
    } catch (error) {
      result = { probe, outcome: 'inconclusive', detail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
    let cleanupIssue: string | undefined;
    if (probe === 'filesystem-write') {
      try { await unlink(target); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) cleanupIssue = 'confinement-probe-cleanup-failed:filesystem-write';
      }
    }
    return { result, cleanupIssue };
  }

  async function observe(policy: CodexPolicy): Promise<ConfinementReadiness> {
    if (policy.operation !== 'saved-solver') throw new SolverPolicyError('Only a saved-solver policy can be probed.');
    if (cached?.evidenceScope === policy.evidenceScope) return cached;
    const write = await execProbe(policy, 'filesystem-write');
    const network = await execProbe(policy, 'loopback-network');
    let readiness: ConfinementProbeResult;
    let windowsStatus: string | undefined;
    if (policy.platform !== 'win32') {
      readiness = { probe: 'windows-sandbox-readiness', outcome: 'not-run', detail: 'This platform exposes no sandbox-readiness method in Codex 0.153.4.' };
    } else if (!options.rpc) {
      readiness = { probe: 'windows-sandbox-readiness', outcome: 'not-run', detail: 'No read-only RPC handle was supplied.' };
    } else {
      try {
        const response = await options.rpc.request('windowsSandbox/readiness') as { status?: string };
        windowsStatus = response.status;
        readiness = { probe: 'windows-sandbox-readiness', outcome: 'inconclusive', detail: response.status === 'ready'
          ? 'Readiness is machine configuration, not proof this exec was confined.'
          : `Windows sandbox readiness reported ${String(response.status)}; machine configuration is not proof this exec was confined.` };
      } catch (error) {
        readiness = { probe: 'windows-sandbox-readiness', outcome: 'inconclusive', detail: error instanceof Error ? error.message : String(error) };
      }
    }
    const probes = [write.result, network.result, readiness];
    const issues = [`confinement-unobservable:${policy.platform}`];
    for (const result of probes) if (result.outcome === 'not-denied') issues.push(`confinement-falsified:${result.probe}`);
    if (windowsStatus === 'notConfigured' || windowsStatus === 'updateRequired') issues.push(`windows-sandbox-not-ready:${windowsStatus}`);
    for (const result of [write.result, network.result]) if (result.outcome === 'inconclusive') issues.push(`confinement-probe-inconclusive:${result.probe}`);
    for (const result of probes) if (result.outcome === 'not-run') issues.push(`confinement-probe-not-run:${result.probe}`);
    if (write.cleanupIssue) issues.push(write.cleanupIssue);
    const stableIssues = [...new Set(issues)];
    cached = Object.freeze({
      version: CONFINEMENT_EVIDENCE_VERSION,
      platform: policy.platform,
      backend: policy.reviewedProfile.runtimeBackend,
      verdict: stableIssues.some(issue => issue.startsWith('confinement-falsified:')) ? 'not-confined' : 'unverified',
      confinementObserved: false,
      evidenceScope: policy.evidenceScope,
      probes: Object.freeze(probes.map(result => Object.freeze(result))),
      issues: Object.freeze(stableIssues),
    });
    return cached;
  }

  return {
    observe,
    readiness: () => cached,
    issues: () => cached?.issues ?? ['confinement-unobservable:not-yet-observed'],
    async collect(policy) {
      await observe(policy);
      // Probing teaches the collector what to report; it is never a route to readiness.
      return undefined;
    },
  };
}
