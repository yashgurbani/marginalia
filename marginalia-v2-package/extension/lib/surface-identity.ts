import { pageIdentity } from './protocol.ts';

type BrowserFrame = { documentId?: string; documentLifecycle?: string; url?: string } | null | undefined;

type CaptureIdentity = { document: string };

type WorkspaceSender = {
  tabId?: number;
  documentId?: string;
  documentLifecycle?: string;
  url?: string;
  origin?: string;
  frameId?: number;
  incognito?: boolean;
};

type WorkspaceContext = {
  contextType?: string;
  tabId?: number;
  documentId?: string;
  documentUrl?: string;
  documentOrigin?: string;
  frameId?: number;
  incognito?: boolean;
};

type WorkspaceTab = { id?: number; url?: string; incognito?: boolean; discarded?: boolean };
type WorkspaceContextFilter = { contextTypes: string[]; documentIds: string[]; tabIds: number[] };

function activeDocument(frame: BrowserFrame, expectedDocument: string): boolean {
  return frame?.documentId === expectedDocument && frame.documentLifecycle === 'active';
}

export function liveSourceMatches(frame: BrowserFrame, expectedDocument: string, expectedUrl: string): boolean {
  return activeDocument(frame, expectedDocument) && typeof frame?.url === 'string' && pageIdentity(frame.url) === expectedUrl;
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

/** Verify an extension-owned workspace against Chrome's live TAB context. */
export async function requireWorkspaceSurface(
  sender: WorkspaceSender,
  expectedTabId: number,
  expectedUrl: string,
  expectedOrigin: string,
  getContexts: (filter: WorkspaceContextFilter) => Promise<WorkspaceContext[]>,
  getTab: (tabId: number) => Promise<WorkspaceTab>,
): Promise<void> {
  if (sender.tabId !== expectedTabId || !sender.documentId || sender.documentLifecycle !== 'active' || sender.url !== expectedUrl || sender.origin !== expectedOrigin || sender.frameId !== 0 || sender.incognito) {
    throw new Error('Reopen this margin from the source.');
  }

  const filter = { contextTypes: ['TAB'], documentIds: [sender.documentId], tabIds: [expectedTabId] };
  const matches = (context: WorkspaceContext) => context.contextType === 'TAB'
    && context.tabId === expectedTabId
    && context.documentId === sender.documentId
    && context.documentUrl === expectedUrl
    && context.documentOrigin === expectedOrigin
    && context.frameId === 0
    && context.incognito === false;

  const before = await getContexts(filter);
  if (!before.some(matches)) throw new Error('Reopen this margin from the source.');
  const tab = await getTab(expectedTabId);
  if (tab.id !== expectedTabId || tab.url !== expectedUrl || tab.incognito || tab.discarded) throw new Error('Reopen this margin from the source.');
  const after = await getContexts(filter);
  if (!after.some(matches)) throw new Error('Reopen this margin from the source.');
}
