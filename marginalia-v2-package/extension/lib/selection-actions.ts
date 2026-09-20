import type { QuoteAnchor, SourceCapture } from '../../contracts/reader.ts';
import type { JournalState } from '../../ui/journal.ts';
import { validSnapshot, type Snapshot } from './protocol.ts';

export type SelectionAction = 'keep' | 'note' | 'ask' | 'simulate';
export type PanelAction = Exclude<SelectionAction, 'keep'> | 'read-later';
export type ActionRequest = {
  id: string; action: PanelAction; browserDocument: string; snapshot: Snapshot; expires: number;
};
export const KEEP_RECEIPT_LIMIT = 4;
export const KEEP_RECEIPT_BYTES = 2_000_000;
export const KEEP_RECEIPT_TTL = 5 * 60_000;
export type KeepReceipt = { operation: string; threadId: string; snapshot: Snapshot & { browserDocument: string }; expires: number };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export type NativeCommand = 'keep-selection' | 'simulate-selection' | 'open-margin';
export const nativeCommand = (value: unknown): value is NativeCommand => value === 'keep-selection' || value === 'simulate-selection' || value === 'open-margin';
export type CommandCapture = { type: 'command-capture'; version: 1; command: NativeCommand; request: string };
export function validCommandCapture(value: unknown): value is CommandCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 4 && r.type === 'command-capture' && r.version === 1 && nativeCommand(r.command) && uuid(r.request);
}
export function validCommandReply(value: unknown, request: string): value is { request: string; snapshot: Snapshot } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 2 && uuid(r.request) && r.request === request && validSnapshot(r.snapshot);
}
export function validKeepReceipt(value: unknown): value is KeepReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Partial<KeepReceipt>;
  return Object.keys(r).length === 4 && uuid(r.operation) && uuid(r.threadId) && Number.isSafeInteger(r.expires) &&
    validSnapshot(r.snapshot) && typeof r.snapshot.browserDocument === 'string' && r.snapshot.browserDocument.length > 0 && r.snapshot.browserDocument.length <= 64;
}
export const selectionAction = (value: unknown): value is SelectionAction =>
  value === 'keep' || value === 'note' || value === 'ask' || value === 'simulate';
export type ContentActionRequest = { type: 'selection-action'; version: 1; action: SelectionAction; gesture: string; operation: string; document: string; revision: number };
export function validContentAction(value: unknown): value is ContentActionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 7 && r.type === 'selection-action' && r.version === 1 && selectionAction(r.action) &&
    uuid(r.gesture) && uuid(r.operation) &&
    typeof r.document === 'string' && r.document.length > 0 && r.document.length <= 64 &&
    Number.isSafeInteger(r.revision) && Number(r.revision) >= 0;
}
export function sameAnchor(a: QuoteAnchor | null, b: QuoteAnchor | null) {
  return a === null || b === null ? a === b :
    (a.kind ?? 'quote') === (b.kind ?? 'quote') && a.start === b.start && a.end === b.end &&
    a.exact === b.exact && a.prefix === b.prefix && a.suffix === b.suffix;
}
export function sameSelection(a: Snapshot, b: Snapshot) {
  return a.document === b.document && a.revision === b.revision &&
    a.capture.url === b.capture.url && a.capture.text === b.capture.text && sameAnchor(a.anchor, b.anchor);
}
function sameCapture(a: SourceCapture, b: SourceCapture) {
  // A URL or an empty sourceVersionId is never evidence of capture equality.
  return a.url === b.url && a.text === b.text && a.title === b.title && a.pageType === b.pageType &&
    a.extractionVersion === b.extractionVersion && a.author === b.author &&
    a.publicationDate === b.publicationDate && a.venue === b.venue && JSON.stringify(a.sections) === JSON.stringify(b.sections);
}
export function sameCommandSelection(a: Snapshot, b: Snapshot) {
  return sameSelection(a, b) && sameCapture(a.capture, b.capture);
}
export function retainedKeep(state: JournalState, snapshot: Snapshot): string | undefined {
  if (!snapshot.anchor) return;
  // Only the retained keep packet proves local capture identity. Unbound records
  // and synced records lacking their original capture stay independent.
  for (const change of state.pending) {
    if (change.kind !== 'keep' || !sameCapture(change.capture, snapshot.capture) || !sameAnchor(change.anchor, snapshot.anchor)) continue;
    const thread = state.threads.find(thread => thread.id === change.threadId && !thread.deletedAt);
    if (thread && thread.sourceUrl === snapshot.capture.url && sameAnchor(thread.anchor, snapshot.anchor)) return thread.id;
  }
}
export function actionMatches(request: ActionRequest, browserDocument: string, snapshot: Snapshot, now = Date.now()) {
  return request.expires > now && request.browserDocument === browserDocument && sameSelection(request.snapshot, snapshot);
}
