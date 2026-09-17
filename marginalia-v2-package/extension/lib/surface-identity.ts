type BrowserFrame = { documentId?: string; documentLifecycle?: string } | null | undefined;

type CaptureIdentity = { document: string };

function activeDocument(frame: BrowserFrame, expectedDocument: string): boolean {
  return frame?.documentId === expectedDocument && frame.documentLifecycle === 'active';
}

/**
 * Ask the expected top-level browser document for its content capture identity.
 * Browser document IDs and capture IDs belong to separate identity domains.
 */
export async function requestCaptureIdentity(
  expectedDocument: string,
  getFrame: () => Promise<BrowserFrame>,
  requestIdentity: (browserDocument: string) => Promise<unknown>,
): Promise<string> {
  const before = await getFrame();
  if (!activeDocument(before, expectedDocument)) throw new Error('Reopen the margin after navigation.');

  const identity = await requestIdentity(expectedDocument) as Partial<CaptureIdentity> | null;

  const after = await getFrame();
  if (!activeDocument(after, expectedDocument)) throw new Error('Reopen the margin after navigation.');
  if (!identity || typeof identity !== 'object' || typeof identity.document !== 'string' || !identity.document || identity.document.length > 64) {
    throw new Error('Reopen the margin after navigation.');
  }
  return identity.document;
}
