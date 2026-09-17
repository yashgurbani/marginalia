import { browser } from 'wxt/browser';

export const DEFAULT_HELPER_ORIGIN = 'http://127.0.0.1:43120';
export const HELPER_ORIGIN_KEY = 'helperOrigin';

/** Accept only an explicit HTTP loopback origin with a concrete port. */
export function validHelperOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = /^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?$/.exec(value);
  if (!match) return null;
  try {
    const url = new URL(value);
    const port = Number(match[1] ?? '80');
    if (!Number.isInteger(port) || port > 65535) return null;
    return url.origin;
  } catch { return null; }
}

export async function helperOrigin(): Promise<string> {
  const value = (await browser.storage.local.get(HELPER_ORIGIN_KEY))[HELPER_ORIGIN_KEY];
  if (value === undefined) return DEFAULT_HELPER_ORIGIN;
  const origin = validHelperOrigin(value);
  if (!origin) throw new Error('Invalid local helper address. Correct it in extension settings.');
  return origin;
}
