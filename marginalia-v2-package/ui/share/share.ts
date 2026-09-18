import { SHARE_FORMATS, type ShareFile, type ShareFormat } from '../../contracts/share.ts';
import type { ShareTransport } from './transport.ts';

export type ShareState = 'idle' | 'preparing' | 'ready' | 'failed';
export type ShareDeps = { threadId: string; transport: ShareTransport; download?(file: ShareFile): void };
export type ShareMount = { destroy(): void; state(): ShareState };

export const SHARE_COPY = Object.freeze({
  title: 'Download saved thread',
  description: 'Choose a file type, review the full file, then download it to this device.',
  format: 'File type', markdown: 'Markdown', html: 'HTML', text: 'Plain text',
  prepare: 'Prepare file', download: 'Download file',
  idle: 'Choose a file type and prepare the copy.', preparing: 'Preparing the file.',
  ready: 'Your file is ready. Review it before downloading.',
  failed: 'The file could not be prepared. Try again.', preview: 'File contents',
});

export function mountShare(host: HTMLElement, deps: ShareDeps): ShareMount {
  const doc = host.ownerDocument, root = doc.createElement('section'); root.className = 'm-share';
  const title = node('h3', SHARE_COPY.title), description = node('p', SHARE_COPY.description);
  const label = node('label'), labelText = node('span', SHARE_COPY.format), select = doc.createElement('select');
  for (const format of SHARE_FORMATS) {
    const option = doc.createElement('option'); option.value = format; option.textContent = SHARE_COPY[format]; select.append(option);
  }
  label.append(labelText, select);
  const prepare = node('button', SHARE_COPY.prepare); prepare.type = 'button';
  const previewHeading = node('h4', SHARE_COPY.preview), preview = node('pre'); previewHeading.hidden = true; preview.hidden = true;
  const download = node('button', SHARE_COPY.download); download.type = 'button'; download.hidden = true;
  const status = node('p', SHARE_COPY.idle); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(title, description, label, prepare, previewHeading, preview, download, status); host.replaceChildren(root);
  let currentState: ShareState = 'idle', file: ShareFile | undefined, destroyed = false, generation = 0;
  let controller: AbortController | undefined;
  setState('idle');

  select.addEventListener('change', reset);
  prepare.addEventListener('click', () => { void prepareFile(); });
  download.addEventListener('click', () => { if (file) (deps.download ?? saveFile)(file); });

  function reset() {
    ++generation; controller?.abort(); controller = undefined; file = undefined; preview.textContent = '';
    previewHeading.hidden = true; preview.hidden = true; download.hidden = true; setState('idle');
  }
  async function prepareFile() {
    const own = ++generation; controller?.abort(); controller = new AbortController(); file = undefined;
    preview.textContent = ''; previewHeading.hidden = true; preview.hidden = true; download.hidden = true; setState('preparing');
    try {
      const result = await deps.transport.prepare(deps.threadId, select.value as ShareFormat, controller.signal);
      if (!current(own)) return;
      file = result; preview.textContent = result.contents; previewHeading.hidden = false; preview.hidden = false; download.hidden = false; setState('ready');
    } catch (error) { if (current(own) && !aborted(error)) setState('failed'); }
    finally { if (current(own)) controller = undefined; }
  }
  function setState(value: ShareState) {
    currentState = value; root.dataset.state = value; status.textContent = SHARE_COPY[value]; prepare.disabled = value === 'preparing'; select.disabled = value === 'preparing';
  }
  function current(own: number) { return !destroyed && own === generation; }
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
    const value = doc.createElement(tag); if (text !== undefined) value.textContent = text; return value;
  }
  return { state: () => currentState, destroy() { if (destroyed) return; reset(); destroyed = true; root.remove(); } };
}

function saveFile(file: ShareFile) {
  const url = URL.createObjectURL(new Blob([file.contents], { type: file.contentType }));
  const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click(); URL.revokeObjectURL(url);
}
function aborted(error: unknown) { return error instanceof DOMException && error.name === 'AbortError'; }
