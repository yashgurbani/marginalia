import { createHash } from 'node:crypto';
import type { FrozenJobContext, JobSnapshot, StartJobInput } from '../../contracts/jobs.ts';
import { utf8Prefix } from './outgoing-budget.ts';

/** The host supplies the immutable accepted parent's serialized reply. Never recapture the
 * current page/note on a follow-up, and never treat prior generated work as source evidence. */
export function frozenFollowup(parent: Readonly<JobSnapshot>, input: StartJobInput,
  selection: { settingsRevision: number; compatibilityKey: string }, parentReplyId: string, parentReplyText: string, resume: boolean): FrozenJobContext {
  if (parent.state !== 'succeeded' || !parent.latestAttemptId || parent.replyVersionId !== parentReplyId ||
      input.parentReplyId !== parentReplyId || input.threadId !== parent.threadId) throw new Error('Follow-up parent identity changed.');
  const context: FrozenJobContext = { ...structuredClone(parent.context), intent: input.intent, question: input.question,
    parentJobId: parent.id, parentAttemptId: resume ? parent.latestAttemptId : undefined, parentReplyId,
    retryOfJobId: undefined, preparedPayloadDigest: input.preparedPayloadDigest,
    modelSettingsRevision: selection.settingsRevision, modelCompatibilityKey: selection.compatibilityKey };
  const excerpt = utf8Prefix(parentReplyText, 4_000);
  context.outgoing = { ...context.outgoing, intent: input.intent, question: input.question, parentReplyId,
    availableCapabilities: [...input.capabilities ?? []],
    parentReply: { replyVersionId: parentReplyId, attribution: 'Prior generated work, not source evidence.', excerpt,
      omittedBytes: Buffer.byteLength(parentReplyText) - Buffer.byteLength(excerpt),
      sha256: createHash('sha256').update(parentReplyText).digest('hex') },
    omissions: context.outgoing.omissions.filter(text => text !== 'The accepted parent reply was truncated to a 4,000-byte host-owned excerpt.' &&
      !text.startsWith('UTF-8 preview budget reduced previous generated reply:')) };
  if (context.outgoing.parentReply!.omittedBytes) context.outgoing.omissions.push('The accepted parent reply was truncated to a 4,000-byte host-owned excerpt.');
  return context;
}
