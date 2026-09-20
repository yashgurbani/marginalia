import { el, button } from '../dom.ts';
import { canonicalReplyData } from '../../contracts/reply.ts';
import type { egressRecord } from '../margin-model.ts';

const readerDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); };

export function mountReplySurface(shell: HTMLElement, scroll: HTMLElement, questionArea: HTMLElement, actions: {
  back(): void; liveReply(): void;
}) {
  const replyFrame = el('section', undefined, 'm-reply-frame'); replyFrame.hidden = true;
  const replyBody = el('div', undefined, 'm-reply-frame-body');
  const backStatus = el('p', '', 'm-meta'); backStatus.setAttribute('role', 'status'); backStatus.hidden = true;
  const back = button('Back', actions.back); back.className = 'm-back';
  const liveReply = button('Reply', actions.liveReply); liveReply.className = 'm-reply-title'; liveReply.hidden = true;
  replyFrame.append(back, backStatus, replyBody); scroll.append(replyFrame);
  let activityButton: HTMLButtonElement;
  let replyOpener: HTMLElement | undefined, homeScroll = 0, returningHome = false;
  let savedReplyHome: { node: HTMLElement; parent: HTMLElement; next: ChildNode | null } | undefined;
  function showFullReply(node: HTMLElement, opener?: HTMLElement) {
    if (replyFrame.hidden) { homeScroll = scroll.scrollTop; replyOpener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined); }
    if (savedReplyHome && savedReplyHome.node !== node) restoreSavedReply();
    if (node !== questionArea && node.parentElement !== replyBody) savedReplyHome = { node, parent: node.parentElement!, next: node.nextSibling };
    if (node.parentElement !== replyBody) replyBody.append(node);
    for (const child of Array.from(replyBody.children)) (child as HTMLElement).hidden = child !== node;
    node.hidden = false; replyFrame.hidden = false; shell.classList.add('m-reply-open');
    backStatus.hidden = true; scroll.scrollTop = 0; back.focus({ preventScroll: true });
  }
  function restoreSavedReply() {
    if (!savedReplyHome) return;
    const { node, parent, next } = savedReplyHome;
    if (parent.isConnected) parent.insertBefore(node, next?.parentNode === parent ? next : null);
    savedReplyHome = undefined;
  }
  return {
    replyFrame, replyBody, backStatus, back, liveReply, showFullReply, restoreSavedReply,
    mountActivity(map: HTMLElement, open: () => void) {
      activityButton = button('Work status', open);
      activityButton.className = 'm-activity'; activityButton.hidden = true; map.append(activityButton);
      return activityButton;
    },
    updateActivity(text: string, sending: boolean, elapsedSeconds?: number) {
      activityButton.hidden = !text; activityButton.dataset.sending = String(sending);
      activityButton.setAttribute('aria-label', 'Open What was sent: ' + (text || 'work status') + (elapsedSeconds !== undefined && elapsedSeconds >= 30 ? `, ${Math.floor(elapsedSeconds)} seconds` : '') + '.');
      activityButton.title = text; activityButton.textContent = text;
    },
    activityFor(value: { phase: string; elapsedSeconds?: number }) {
      const working = ['queued', 'sending', 'working', 'provisional', 'validating', 'loading-reply', 'cancel_requested'].includes(value.phase);
      return { text: working ? 'Working' : value.phase === 'committed' ? 'Ready' : value.phase === 'unknown' || value.phase === 'timed_out' ? 'Outcome unconfirmed' : value.phase === 'failed' ? 'Failed' : value.phase === 'cancelled' ? 'Cancelled' : '', elapsedSeconds: value.elapsedSeconds };
    },
    openEgress(egressSheet: HTMLElement, closeAction: () => void) {
      const close = button('Close', closeAction), content = el('div');
      content.setAttribute('role', 'status'); content.textContent = 'Reading the stored record…';
      egressSheet.replaceChildren(el('h2', 'What was sent'), close, content); close.focus();
      return content;
    },
    renderEgress(content: HTMLElement, record: ReturnType<typeof egressRecord>, measured: { reviewedBytes: number | null; handoffRecorded: boolean }) {
      content.replaceChildren(el('p', record.summary));
      content.append(el('h3', 'Size of reviewed content'), el('p', measured.reviewedBytes === null
        ? 'Unknown for this record. No measurement is backfilled.'
        : `${measured.reviewedBytes} UTF-8 bytes. The reviewed content size is recorded. Transmission size is unmeasured.`));
      content.append(el('h3', 'Provider handoff'), el('p', measured.handoffRecorded
        ? 'Recorded in the durable attempt record.'
        : 'No durable provider handoff is recorded.'));
      content.append(el('h3', 'Observed transmission'), el('p',
        'Not observed. This record can establish provider handoff. Transmission evidence is unavailable.'));
      for (const [label, value] of record.fields) content.append(el('h3', label), el('p', /^\d{4}-\d{2}-\d{2}T/.test(value) ? readerDate(value) : value));
      const packet = el('pre', canonicalReplyData(record.packet));
      packet.style.whiteSpace = 'pre-wrap'; packet.style.overflowWrap = 'anywhere';
      content.append(el('p', record.retention, 'm-meta'), el('h3', 'Retained reading packet'), packet);
    },
    failedEgress(content: HTMLElement, error: unknown) {
      content.textContent = error instanceof Error ? error.message : 'The stored record is unavailable. The outcome is unconfirmed.';
    },
    beginReturn() {
      if (returningHome || replyFrame.hidden) return false;
      returningHome = true; back.disabled = true; return true;
    },
    returnHome(renderContinuation: () => void, fallback: HTMLElement) {
      questionArea.hidden = true; replyFrame.hidden = true; shell.classList.remove('m-reply-open');
      scroll.scrollTop = homeScroll; renderContinuation();
      (replyOpener?.isConnected ? replyOpener : fallback).focus({ preventScroll: true });
    },
    failedReturn(error: unknown) {
      backStatus.textContent = error instanceof Error ? error.message : 'Saving failed. Your reply is kept here.'; backStatus.hidden = false;
    },
    endReturn() { returningHome = false; back.disabled = false; },
  };
}
