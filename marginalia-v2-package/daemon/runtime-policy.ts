import { structuredReplySchema } from './jobs/structured-reply.ts';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { ReplyCapability } from '../contracts/reply.ts';
import { modeForIntent } from './jobs/mode.ts';
import { createCodexPolicy, PINNED_CODEX_VERSION, type JsonValue } from './codex-policy.ts';
import { policyFingerprint } from './providers/policy-gate.ts';

export function createRuntimePolicy(codexHome: string, homeMode?: 'dedicated' | 'ordinary') {
  const policyAuditEpoch = randomUUID();
  let definitionSchema: Record<string, JsonValue> | undefined;
  function policyFor(workspace: string, mode: 'structured-final' | 'workspace-files', model: string, provider: 'app-server' | 'mcp-server') {
    const common = { homeMode, version: PINNED_CODEX_VERSION, platform: process.platform as 'win32' | 'linux' | 'darwin',
      adapter: provider, model, workspace, codexHome: codexHome, auditId: policyAuditEpoch };
    if (mode === 'structured-final') {
      definitionSchema ??= JSON.parse(readFileSync(new URL('../contracts/reply.schema.json', import.meta.url), 'utf8')) as Record<string, JsonValue>;
      return createCodexPolicy({ ...common, operation: 'definition', outputSchema: structuredReplySchema(provider, definitionSchema) as Record<string, JsonValue> });
    }
    return createCodexPolicy({ ...common, operation: 'generation' });
  }
  return { policyFor, jobDefaults: {
    provider: 'app-server' as const, mode: 'workspace-files' as const, modeFor: modeForIntent, solverAuthoring: false,
    capabilities: ['samples', 'solver', 'media.audio', 'media.image', 'media.video', 'network.citations', 'network.shelf'] satisfies ReplyCapability[],
    policyFor: (workspace: string, mode: 'structured-final' | 'workspace-files', model: string, provider: 'app-server' | 'mcp-server') => policyFingerprint(policyFor(workspace, mode, model, provider)),
  } };
}
