import type { ProviderRequest } from '../../contracts/job-runner.ts';

const STRUCTURED_FINAL_SUFFIX = '\nReturn only JSON matching this schema; do not write files:\n';

/** Canonical text sent by the MCP adapter. Consent previews and hashes must use this exact formatter. */
export function formatMcpPrompt(request: Pick<ProviderRequest, 'prompt' | 'mode' | 'outputSchema'>): string {
  if (request.mode !== 'structured-final') return request.prompt;
  if (!request.outputSchema) throw new Error('output-schema-required');
  return `${request.prompt}${STRUCTURED_FINAL_SUFFIX}${JSON.stringify(request.outputSchema)}`;
}
