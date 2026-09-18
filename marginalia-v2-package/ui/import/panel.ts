import { LIBRARY_IMPORT_LIMIT_BYTES, type LibraryImportPreviewResponse, type LibraryImportResult } from '../../contracts/library-import.ts';
import type { LibraryImportTransport } from './transport.ts';

export type LibraryImportMount = { clear(): void; destroy(): void };
export type LibraryImportOptions = { onImported?(result: LibraryImportResult): void | Promise<void> };

export function mountLibraryImport(host: HTMLElement, transport: LibraryImportTransport, options: LibraryImportOptions = {}): LibraryImportMount {
  const doc = host.ownerDocument;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value;
  };
  const root = node('section', undefined, 'm-library-import');
  const title = node('h3', 'Import saved work');
  const limit = node('p', 'Choose one Marginalia JSON file. The import limit is 2 MB.', 'm-library-import__description');
  const omissions = node('p', 'Replies, views, attachments and history are left out.', 'm-library-import__description');
  const label = node('label', undefined, 'm-library-import__picker');
  const input = doc.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json'; input.multiple = false;
  label.append(node('span', 'Saved work file'), input);
  const filename = node('p', '', 'm-library-import__filename');
  const preview = node('div', undefined, 'm-library-import__preview');
  const status = node('p', '', 'm-library-import__status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(title, limit, omissions, label, filename, preview, status); host.replaceChildren(root);
  let generation = 0, destroyed = false, importing = false, controller: AbortController | undefined;
  let selected: { value: unknown; preview: LibraryImportPreviewResponse } | undefined;
  let warningList: HTMLUListElement | undefined;

  const clear = () => {
    ++generation; controller?.abort(); controller = undefined; selected = undefined; importing = false;
    input.value = ''; filename.textContent = ''; preview.replaceChildren(); status.textContent = ''; warningList = undefined;
  };

  input.addEventListener('change', () => { void choose(input.files?.item(0)); });

  async function choose(file: File | null | undefined) {
    const own = ++generation; controller?.abort(); controller = new AbortController(); selected = undefined;
    preview.replaceChildren(); status.textContent = ''; filename.textContent = file?.name ?? '';
    if (!file) return;
    if (file.size > LIBRARY_IMPORT_LIMIT_BYTES) { status.textContent = 'This file is larger than the 2 MB import limit.'; return; }
    try {
      const serialized = await file.text();
      if (!current(own)) return;
      if (new TextEncoder().encode(serialized).byteLength > LIBRARY_IMPORT_LIMIT_BYTES) {
        status.textContent = 'This file is larger than the 2 MB import limit.'; return;
      }
      const value: unknown = JSON.parse(serialized);
      const response = await transport.preview(value, controller.signal);
      if (!current(own)) return;
      selected = { value, preview: response }; renderPreview(response);
    } catch (error) {
      if (current(own) && !aborted(error)) status.textContent = 'This file could not be previewed as Marginalia saved work.';
    } finally { if (current(own)) controller = undefined; }
  }

  function renderPreview(response: LibraryImportPreviewResponse) {
    const value = response.preview, content = node('div');
    content.append(node('h4', value.sourceTitle || 'Untitled saved source'));
    const state = value.removed ? 'Removed saved work' : `${stateLabel(value.state)} saved work`;
    content.append(node('p', `${value.noteCount} ${plural(value.noteCount, 'note')}. ${value.removedNoteCount} removed. ${state}.`));
    if (value.highlighted) content.append(node('p', 'The saved passage is highlighted.'));
    content.append(node('p', value.status === 'imported' ? 'This saved work was imported before.' : 'This saved work is ready to import.'));
    const warningTitle = node('h5', 'Import notes'); warningList = node('ul'); renderWarnings(response.warnings);
    const action = node('button', 'Import this saved work'); action.type = 'button';
    action.addEventListener('click', () => { void confirm(action); });
    content.append(warningTitle, warningList, action); preview.replaceChildren(content);
  }

  function renderWarnings(warnings: readonly string[]) {
    if (!warningList) return;
    warningList.replaceChildren(...warnings.map(warning => node('li', warning)));
  }

  async function confirm(action: HTMLButtonElement) {
    if (!selected || importing || destroyed) return;
    importing = true; action.disabled = true; status.textContent = 'Importing saved work.';
    const currentSelection = selected;
    try {
      const result = await transport.importSavedWork(currentSelection.value, currentSelection.preview.preview.digest);
      if (destroyed || selected !== currentSelection) return;
      renderWarnings([...new Set([...currentSelection.preview.warnings, ...result.warnings])]);
      status.textContent = 'Saved work imported.';
      try { await options.onImported?.(result); }
      catch { if (!destroyed) status.textContent = 'Saved work was imported. The library could not refresh.'; }
    } catch { if (!destroyed && selected === currentSelection) status.textContent = 'Saved work could not be imported.'; }
    finally { importing = false; if (!destroyed && selected === currentSelection) action.disabled = false; }
  }

  function current(own: number) { return !destroyed && own === generation; }
  return { clear, destroy() { if (destroyed) return; clear(); destroyed = true; root.remove(); } };
}

function plural(count: number, noun: string) { return count === 1 ? noun : `${noun}s`; }
function stateLabel(state: string) { return state.charAt(0).toUpperCase() + state.slice(1); }
function aborted(error: unknown) { return error instanceof DOMException && error.name === 'AbortError'; }
