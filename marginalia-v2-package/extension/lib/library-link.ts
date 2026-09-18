import { validHelperOrigin } from './helper-origin.ts';

export function libraryThreadUrl(origin: string, threadId?: string): string {
  const helper = validHelperOrigin(origin);
  if (!helper) throw new Error('Invalid local helper origin.');
  const url = new URL('/', helper);
  if (threadId !== undefined) {
    if (!threadId || threadId.length > 200 || /[\u0000-\u001f\u007f]/.test(threadId)) throw new Error('Invalid saved thread identity.');
    url.hash = 'thread=' + encodeURIComponent(threadId);
  }
  return url.href;
}
