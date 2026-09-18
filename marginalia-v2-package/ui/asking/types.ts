import type { ConsentDecisionRequest, ConsentGrant, ConsentPreview } from '../../contracts/consent.ts';
import type { FollowupJobInput, JobSnapshot, PrepareFollowupJobInput, PrepareJobInput, PreparedJobResult, PrepareRetryJobInput, RetryJobInput, StartJobInput } from '../../contracts/jobs.ts';
import type { NoteVersionRef, QuoteAnchor, ReplyVersion, ReplyViewState, SourceVersion } from '../../contracts/reader.ts';
import type { CandidateReply, Intent, ValidationContext, ValidationResult } from '../../contracts/reply.ts';
import type { ReaderSkillSelection } from '../../contracts/reader-skills.ts';

/** Saved identities plus the current T05 capture lifetime. No moving selection or guessed IDs. */
export type AskingBinding = {
  threadId: string;
  anchorId: string;
  captureId: string;
  sourceVersionId: string;
  sourceHash: string;
  sourceUrl: string;
  sourceTitle: string;
  sourcePageType: string | null;
  sourceCapturedAt: string | null;
  sourceText: string;
  anchor: QuoteAnchor;
  answeredNote?: NoteVersionRef & { text: string };
};

/** UI facts supplied by the trusted T05 host; never a credential or permission authority. */
export type AskingAccess = {
  /** Change on disconnect, pairing replacement/revocation, and revocation/exclusion/security changes (including ABA). */
  epoch: string;
  paired: boolean;
  canAuthorize: boolean;
  excluded: boolean;
  supported: boolean;
  helper: 'connected' | 'off' | 'disconnected' | 'unknown';
  surface: 'native-panel' | 'localhost' | 'floating';
  /** Only from diagnostics for this dedicated runtime; absence means unknown, not signed in. */
  login?: 'signed-in' | 'signed-out' | 'unknown';
};

/** HTTP result is {job, preview}; the internal PreparedJobResult uses {job, consent}. */
export type AskingDisclosure = { unverified: string[]; disclosureVersion: string | null };
export type AskingPreparation = AskingDisclosure & { job: PreparedJobResult['job']; preview: ConsentPreview };
export type AskingAvailability = AskingDisclosure & { configured: boolean; available: boolean; unavailableReason?: string };
export type SavedAskingReply = { reply: ReplyVersion; source: SourceVersion; view?: ReplyViewState };
export type AskingHost = {
  availability(signal: AbortSignal): Promise<AskingAvailability>;
  prepare(input: PrepareJobInput, signal: AbortSignal): Promise<AskingPreparation>;
  prepareRetry(jobId: string, input: PrepareRetryJobInput, signal: AbortSignal): Promise<AskingPreparation>;
  prepareFollowup(jobId: string, input: PrepareFollowupJobInput, signal: AbortSignal): Promise<AskingPreparation>;
  decide(input: ConsentDecisionRequest, signal: AbortSignal): Promise<ConsentGrant>;
  start(input: StartJobInput, signal: AbortSignal): Promise<JobSnapshot>;
  retry(jobId: string, input: RetryJobInput, signal: AbortSignal): Promise<JobSnapshot>;
  followup(jobId: string, input: FollowupJobInput, signal: AbortSignal): Promise<JobSnapshot>;
  inspect(jobId: string, signal: AbortSignal): Promise<JobSnapshot>;
  listJobs(threadId: string, signal: AbortSignal): Promise<JobSnapshot[]>;
  cancel(jobId: string, signal: AbortSignal): Promise<JobSnapshot>;
  readReply(threadId: string, replyVersionId: string, signal: AbortSignal): Promise<SavedAskingReply>;
};

/** Pass the existing browser-safe contracts/reply.validateReply. This is not a host seal. */
export type AskingValidator = (candidate: unknown, context: ValidationContext) => ValidationResult;
export type PageDefinition = { text: string; start: number; end: number; label: 'from this page' };
export type AskingPhase = 'local' | 'suggestions' | 'preparing' | 'consent' | 'deciding' | 'submitting'
  | 'queued' | 'sending' | 'working' | 'provisional' | 'validating' | 'loading-reply' | 'committed'
  | 'cancel_requested' | 'cancelled' | 'failed' | 'timed_out' | 'unknown' | 'reply-unavailable'
  | 'unavailable' | 'denied' | 'excluded' | 'stale' | 'closed' | 'reopening';
export type AskingBlocker = 'excluded' | 'unsupported' | 'browser-owned-required' | 'unpaired' | 'helper-off'
  | 'disconnected' | 'signed-out' | 'runtime-unavailable' | 'invalid-response' | 'unsaved-context' | 'expired-preview';

/** Recorded identifiers/times only. This does not attest to bytes sent, retrieval, or scientific truth. */
export type CompletionTrace = {
  jobId: string;
  attemptId: string;
  replyVersionId: string;
  provider: JobSnapshot['provider'];
  model: string;
  grantId: string;
  preparedPayloadDigest: string;
  sourceVersionId: string;
  sourceHash: string;
  requestedAt: string;
  savedAt: string;
  attemptEndedAt?: string;
  parentReplyId?: string;
  answeredNote?: NoteVersionRef;
};
export type AskingResult = SavedAskingReply & { trace: CompletionTrace; binding: AskingBinding };
export type AskingState = {
  phase: AskingPhase;
  message: string;
  blocker?: AskingBlocker;
  question?: string;
  intent?: Intent;
  /** Correlates T05 replay events, including a lost start response. Not proof that a job was accepted. */
  requestId?: string;
  definition?: PageDefinition;
  preparation?: AskingPreparation;
  job?: JobSnapshot;
  /** Validated host-observed partial; never passed to the committed renderer. */
  provisional?: CandidateReply;
  result?: AskingResult;
  /** Retain the immutable parent while reviewing/working on its follow-up. */
  previousResult?: AskingResult;
  sending: boolean;
  canAsk: boolean;
  canCancel: boolean;
  canRetry: boolean;
  canCheck: boolean;
  canFollowup: boolean;
  elapsedSeconds?: number;
  /** Local dispatch submission is not proof of provider send or stop. */
  submitted: boolean;
};

export type AskingSuggestion = { id: string; label: string; intent: Intent; question: string; time?: 'quick' | 'longer' };
export type AskingSkillChoice = ReaderSkillSelection;
export type AskingExposure = {
  kind: 'shown' | 'choice' | 'no-choice';
  captureId: string;
  threadId: string;
  positions: string[];
  choice?: string;
};
