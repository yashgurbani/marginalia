/** Ambient assistance requires an explicit helper policy decision. */
export async function ambientAssistanceAllowed(url: string, pageType: string, request: (path: string) => Promise<unknown>): Promise<boolean> {
  try {
    const query = new URLSearchParams({ sourceUrl: url, type: pageType, trigger: 'ambient' });
    const result = await request('/api/ambient/policy?' + query) as { policy?: { applies?: unknown; allowed?: unknown } } | null;
    return result?.policy?.applies === true && result.policy.allowed === true;
  } catch { return false; }
}
