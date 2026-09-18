import type { ProviderKind } from './job-runner.ts';

/** Build capabilities, independent of ModelSelection and live runtime readiness.
 * The existing ProviderKind identifies a Codex transport, not a model vendor.
 * These records are display-only: they grant no dispatch or credential authority.
 * A future provider requires a host adapter, consent recipient and reviewed
 * execution policy before it may join the execution contract. */
export type ProviderCapability = Readonly<{
  label: string;
  detail: string;
  credentialBoundary: 'outside-browser';
} & (
  | { support: 'implemented'; recipient: 'openai-codex'; adapters: readonly ProviderKind[] }
  | { support: 'unavailable'; recipient?: never; adapters?: never }
)>;

export const providerCapabilities: readonly ProviderCapability[] = Object.freeze([
  Object.freeze({ label: 'OpenAI Codex', support: 'implemented', recipient: 'openai-codex',
    adapters: Object.freeze(['app-server', 'mcp-server'] as const), credentialBoundary: 'outside-browser',
    detail: 'This build includes Codex connections. Sign-in, permission and execution checks are still required. This list does not establish that asking is ready.' }),
  Object.freeze({ label: 'Local models', support: 'unavailable', credentialBoundary: 'outside-browser',
    detail: 'This build has no local-model connection. Entering a local model name does not run it on your computer.' }),
  Object.freeze({ label: 'Other providers', support: 'unavailable', credentialBoundary: 'outside-browser',
    detail: 'This build has no connection for other providers or their API keys.' }),
  Object.freeze({ label: 'Your own agent', support: 'unavailable', credentialBoundary: 'outside-browser',
    detail: 'This build has no connection for an external agent.' }),
]);
