import type { ProviderHandle, ProviderKind } from './job-runner.ts';
import type { CandidateReply, Intent, ReplyCapability } from './reply.ts';
import type { NoteVersionRef } from './reader.ts';
import type { ConsentAuthorization } from './consent.ts';
import type { OutgoingPart } from './consent.ts';

export type JobState = 'queued' | 'preparing' | 'sending' | 'running' | 'validating' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'outcome_unknown' | 'cancel_requested';

export type StartJobInput = {
  id: string;
  idempotencyKey: string;
  threadId: string;
  intent: Intent;
  question: string;
  provider: ProviderKind;
  model: string;
  mode: 'structured-final' | 'workspace-files';
  policyKey: string;
  grantId: string;
  /** Host-prepared digest of the exact model-visible envelope; excludes job/grant/attempt identity. */
  preparedPayloadDigest: string;
  answeredNote?: NoteVersionRef;
  parentReplyId?: string;
  capabilities?: ReplyCapability[];
};

/** Browser request shape before permission. Provider, model, policy and capabilities remain host-owned. */
export type PrepareJobInput = Pick<StartJobInput, 'id' | 'idempotencyKey' | 'threadId' | 'intent' | 'question' | 'answeredNote' | 'parentReplyId'>;
export type PreparedJobPlan = Omit<StartJobInput, 'grantId'>;
export type PreparedJobResult = { consent: import('./consent.ts').PrepareConsentInput; job: PreparedJobPlan };

export type FollowupJobInput = {
  id: string;
  idempotencyKey: string;
  question: string;
  grantId: string;
  preparedPayloadDigest: string;
};

export type PrepareFollowupJobInput = Pick<FollowupJobInput, 'id' | 'idempotencyKey' | 'question'>;

export type RetryJobInput = { id: string; idempotencyKey: string; grantId: string; preparedPayloadDigest: string };
export type PrepareRetryJobInput = Pick<RetryJobInput, 'id' | 'idempotencyKey'>;

/** Actual installed instruction bytes included in the reviewed model prompt, not model data. */
export type HostInstructionBundle = {
  kind: 'define' | 'simulate' | 'evidence' | 'explore' | 'instantiate' | 'derive' | 'diagram'; text: string; sha256: string;
  documents: { path: string; sha256: string }[];
};

export type FrozenJobContext = {
  /** Optional for persisted jobs created before instruction-bundle loading was installed. */
  hostInstructions?: HostInstructionBundle;
  threadId: string;
  sourceVersionId: string;
  sourceUrl: string;
  sourceTitle: string;
  sourcePageType: string | null;
  sourceCapturedAt: string | null;
  sourceHash: string;
  sourceText: string;
  passage: { exact: string; prefix: string; suffix: string; start: number; end: number };
  answeredNote?: { noteId: string; revision: number; text: string };
  question: string;
  intent: Intent;
  parentReplyId?: string;
  parentJobId?: string;
  parentAttemptId?: string;
  retryOfJobId?: string;
  preparedPayloadDigest: string;
  modelSettingsRevision: number;
  modelCompatibilityKey: string;
  outgoing: ProviderJobPacket;
};

export type ProviderJobPacket = {
  schema: 'marginalia.job-packet.v1';
  intent: Intent;
  question: string;
  source: { url: string; title: string; pageType: string | null; capturedAt: string | null; sourceHash: string; sourceVersionId: string };
  selection: { exact: string; prefix: string; suffix: string; start: number; end: number; originalEnd: number; omittedCharacters: number };
  adjacentContext: { before: string; after: string; basis: 'section-adjacent-context' | 'bounded-character-context' | 'whole-page-opening' };
  answeredNote?: { noteId: string; revision: number; text: string; originalCharacters: number; omittedCharacters: number };
  parentReplyId?: string;
  /** Host-frozen excerpt of the immutable accepted parent reply for a provider fork. */
  parentReply?: { replyVersionId: string; attribution: 'Prior generated work, not source evidence.'; excerpt: string; omittedBytes: number; sha256?: string };
  availableCapabilities: ReplyCapability[];
  omissions: string[];
};

export type JobAttempt = {
  id: string;
  jobId: string;
  number: number;
  state: JobState;
  revision: number;
  dispatchClaimed: boolean;
  handoffMarked: boolean;
  workspacePrepared: boolean;
  predecessorAttemptId?: string;
  authorizationFingerprint?: string;
  providerHandle?: ProviderHandle;
  /** Exact reviewed provider-bound parts retained only after durable handoff. */
  sentContent?: OutgoingPart[];
  startedAt?: string;
  deadlineAt?: string;
  endedAt?: string;
  reason?: string;
};

export type JobSnapshot = {
  /** Host-owned durable budget. Retries share a build; reviewed follow-ups start a new one.
   * Optional only for older serialized snapshots. Reading this value never spends it. */
  clarificationBudget?: { buildId: string; limit: 1; used: 0 | 1 };
  id: string;
  threadId: string;
  idempotencyKey: string;
  packetDigest: string;
  preparedPayloadDigest: string;
  provider: ProviderKind;
  model: string;
  mode: 'structured-final' | 'workspace-files';
  policyKey: string;
  grantId: string;
  state: JobState;
  cancelRequested: boolean;
  latestAttemptId?: string;
  provisional?: CandidateReply;
  replyVersionId?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  context: FrozenJobContext;
  attempts: JobAttempt[];
};

export type JobConsentStage = 'dispatch' | 'commit';
export type JobConsentDecision = { grantId: string; policyKey: string; auditScope?: string; eligibilityFingerprint?: string };

/** T13 implements this from current consent and independently observed policy evidence. */
export interface JobConsentAuthority {
  revalidate(job: Readonly<JobSnapshot>, stage: JobConsentStage): Promise<JobConsentDecision>;
  /** Explicit, non-consuming scope for provider evidence preparation. Not send authority. */
  withProviderPreparation?<T>(job: Readonly<JobSnapshot>, attemptId: string, observe: () => Promise<T>): Promise<T>;
  assertSharedDatabase(database: unknown): void;
  /** Synchronous final consent fence, called within the JobStore handoff transaction. */
  finalizeDispatch(job: Readonly<JobSnapshot>, attemptId: string, expectedEligibilityFingerprint: string): ConsentAuthorization;
  /** Runs the acceptance callback inside the same SQLite transaction as the final consent fence. */
  withResultAcceptance<T>(job: Readonly<JobSnapshot>, attemptId: string, commit: () => T): T;
  recordOutcome(attemptId: string, outcome: string): void;
}
