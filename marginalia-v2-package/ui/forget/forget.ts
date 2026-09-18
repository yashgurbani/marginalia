import type { ForgetPageResult, ForgetTransport } from './transport.ts';

export type ForgetMount = { destroy(): void };
export type ForgetPageIdSource = (signal?: AbortSignal) => Promise<string | undefined>;

export function mountForget(host: HTMLElement, transport: ForgetTransport, getPageId: ForgetPageIdSource): ForgetMount {
  const doc = host.ownerDocument, root = doc.createElement('section'); root.className = 'm-forget';
  host.replaceChildren(root);
  let destroyed = false, working = false, controller: AbortController | undefined;

  function renderReady(status = '') {
    const explanation = doc.createElement('p');
    explanation.textContent = 'This drops the warm thread and prepared definitions for this page, while your notes, highlights, and threads stay.';
    const action = button('Forget this page', renderConfirmation), message = statusNode(status);
    root.replaceChildren(explanation, action, message);
  }

  function renderConfirmation() {
    if (destroyed || working) return;
    const question = doc.createElement('p'); question.textContent = 'Forget the prepared help for this page?';
    const confirm = button('Forget this page', forget), keep = button('Keep this page', () => renderReady());
    root.replaceChildren(question, confirm, keep, statusNode(''));
  }

  async function forget() {
    if (destroyed || working) return;
    working = true; controller = new AbortController();
    for (const action of root.querySelectorAll('button')) action.disabled = true;
    const status = root.querySelector('[role="status"]'); if (status) status.textContent = 'Forgetting this page.';
    try {
      const pageId = await getPageId(controller.signal);
      if (!pageId) { if (!destroyed) renderReady('Prepared help for this page has not been created.'); return; }
      const result = await transport.forgetPage(pageId, controller.signal);
      if (!destroyed) root.replaceChildren(statusNode(outcomeCopy(result)));
    } catch { if (!destroyed) renderReady('Forgetting this page failed.'); }
    finally { working = false; controller = undefined; }
  }

  function button(label: string, action: () => void) {
    const value = doc.createElement('button'); value.type = 'button'; value.textContent = label; value.addEventListener('click', action); return value;
  }
  function statusNode(text: string) {
    const value = doc.createElement('p'); value.setAttribute('role', 'status'); value.setAttribute('aria-live', 'polite'); value.textContent = text; return value;
  }

  renderReady();
  return { destroy() { if (destroyed) return; destroyed = true; controller?.abort(); root.remove(); } };
}

function outcomeCopy(result: ForgetPageResult): string {
  const subject = result.alreadyForgotten
    ? 'The warm thread and prepared definitions for this page were already forgotten'
    : 'The warm thread and prepared definitions for this page were forgotten';
  if (result.providerHistory === 'deleted') return `${subject}, and provider history was deleted.`;
  if (result.providerHistory === 'not-created') return `${subject}; no provider history was created.`;
  if (result.providerHistory === 'retained') return `${subject}, but provider history was retained.`;
  return `${subject}; provider history could not be verified.`;
}
