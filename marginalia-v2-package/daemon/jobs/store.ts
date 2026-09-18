import type { UnformattedSkillOutput } from '../../contracts/reader-skills.ts';
import { checkedUnformatted, authoredSkillText, skillReplyAllowed, rejectedSkillOutput, skillOutputHash } from '../reader-skills.ts';
import type { EvidenceRetrieval } from '../../contracts/evidence.ts';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ProviderHandle } from '../../contracts/job-runner.ts';
import type { OutgoingPart } from '../../contracts/consent.ts';
import { isDigest } from '../../contracts/digest.ts';
import { canonicalReplyData, validateReply, parseAndValidateReply, type CandidateReply, type ReplyCapability } from '../../contracts/reply.ts';
import type { FrozenJobContext, JobAttempt, JobConsentAuthority, JobSnapshot, JobState, StartJobInput } from '../../contracts/jobs.ts';
import type { SolverArtifactBinding } from '../../contracts/solver.ts';
import type { ReaderStore } from '../store.ts';

export type SolverBindingCommit = SolverArtifactBinding & {
  runtimeSha256: string;
  solverId: string;
  workspaceDev: string;
  workspaceIno: string;
};

export type SolverGateDecisionRecord = {
  decidedAt: string; requestIdentity: string; executionAttemptId: string;
  replyVersionId: string; solverId: string;
  siteOrigin: string; threadId: string; sessionId: string; stateKey: string;
  decision: 'allowed' | 'denied' | 'already-claimed' | 'released';
  reasonCode: string; reason: string;
  confinement: 'observed' | 'uncollected'; confinementReference: string | null; confinementReason: string | null;
  policyFingerprint: string; evidenceScope: string; modelTurns: 0;
};

export type SolverExecutionClaimInput = SolverGateDecisionRecord & {
  jobId: string; attemptId: string;
  workspaceGeneration: string; profileManifestSha256: string; solverSha256: string;
  handoffToken: string; leaseId: string; leaseExpiresAt: string;
};

export type SolverExecutionClaimResult =
  | { decision: 'committed'; workspaceGeneration: string }
  | { decision: 'already-claimed'; state: 'dispatched' | 'settled'; reason: string }
  | { decision: 'refused'; code: 'binding-missing' | 'binding-moved' | 'job-not-succeeded'; reason: string };

type JobRow = {
  id: string; threadId: string; idempotencyKey: string; packetDigest: string; requestDigest: string; preparedPayloadDigest: string; provider: JobSnapshot['provider']; model: string;
  mode: JobSnapshot['mode']; policyKey: string; grantId: string; state: JobState; cancelRequested: number; latestAttemptId: string | null;
  provisional: string | null; replyVersionId: string | null; reason: string | null; context: string; capabilities: string;
  createdAt: string; updatedAt: string;
};
type AttemptRow = {
  id: string; jobId: string; number: number; state: JobState; revision: number; dispatchClaimed: number; handoffMarked: number; workspacePrepared: number; providerHandle: string | null;
  predecessorAttemptId: string | null; authorizationFingerprint: string | null;
  sentContent: string | null; startedAt: string | null; deadlineAt: string | null; endedAt: string | null; reason: string | null;
};

const terminal = new Set<JobState>(['succeeded', 'failed', 'cancelled', 'timed_out', 'outcome_unknown']);
export const packetDigest = (value: unknown) => createHash('sha256').update(canonicalReplyData(JSON.parse(JSON.stringify(value)))).digest('hex');

export class JobConflictError extends Error { override name = 'JobConflict'; }
export const CLARIFICATION_LIMIT_FALLBACK = 'This build already asked its one clarifying question. The additional question was withheld.';
export class ClarificationLimitError extends JobConflictError {
  constructor() { super(CLARIFICATION_LIMIT_FALLBACK); }
}

export class JobStore {
  readonly db: Database.Database;
  private reader: ReaderStore;
  constructor(reader: ReaderStore) {
    this.reader = reader;
    this.db = reader.db;
    this.migrate();
  }
  private migrate() {
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS jobs(
          id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id), idempotencyKey TEXT NOT NULL UNIQUE,
          packetDigest TEXT NOT NULL, requestDigest TEXT NOT NULL DEFAULT '', preparedPayloadDigest TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL,
          policyKey TEXT NOT NULL, grantId TEXT NOT NULL, state TEXT NOT NULL, cancelRequested INTEGER NOT NULL DEFAULT 0,
          latestAttemptId TEXT, provisional TEXT, replyVersionId TEXT REFERENCES reply_versions(id), reason TEXT,
          context TEXT NOT NULL, capabilities TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS job_skill_outputs(
          jobId TEXT PRIMARY KEY REFERENCES jobs(id), attemptId TEXT NOT NULL, json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS job_skill_pending(
          attemptId TEXT PRIMARY KEY REFERENCES job_attempts(id), text TEXT NOT NULL, sha256 TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS job_attempts(
          id TEXT PRIMARY KEY, jobId TEXT NOT NULL REFERENCES jobs(id), number INTEGER NOT NULL, state TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0, dispatchClaimed INTEGER NOT NULL DEFAULT 0, handoffMarked INTEGER NOT NULL DEFAULT 0, workspacePrepared INTEGER NOT NULL DEFAULT 0, providerHandle TEXT,
          predecessorAttemptId TEXT, authorizationFingerprint TEXT,
          sentContent TEXT, startedAt TEXT, deadlineAt TEXT, endedAt TEXT, reason TEXT, UNIQUE(jobId,number)
        );
        CREATE TABLE IF NOT EXISTS build_clarifications(
          buildId TEXT PRIMARY KEY REFERENCES jobs(id), attemptId TEXT NOT NULL REFERENCES job_attempts(id),
          questionDigest TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS provider_thread_leases(
          provider TEXT NOT NULL, providerThreadId TEXT NOT NULL, attemptId TEXT NOT NULL UNIQUE REFERENCES job_attempts(id),
          predecessorAttemptId TEXT, successorAttemptId TEXT, PRIMARY KEY(provider,providerThreadId,attemptId)
        );
        CREATE TABLE IF NOT EXISTS job_preparations(
          jobId TEXT PRIMARY KEY, planDigest TEXT NOT NULL, bindingDigest TEXT NOT NULL,
          createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL, consumedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS solver_artifact_bindings(
          replyVersionId TEXT NOT NULL REFERENCES reply_versions(id), solverId TEXT NOT NULL,
          jobId TEXT NOT NULL REFERENCES jobs(id), attemptId TEXT NOT NULL REFERENCES job_attempts(id),
          workspace TEXT NOT NULL, workspaceDev TEXT NOT NULL, workspaceIno TEXT NOT NULL, workspaceGeneration TEXT NOT NULL,
          solverRelativePath TEXT NOT NULL, solverSha256 TEXT NOT NULL, runtimeExecutable TEXT NOT NULL,
          runtimeIdentity TEXT NOT NULL, runtimeVersion TEXT NOT NULL, runtimeSha256 TEXT,
          PRIMARY KEY(replyVersionId,solverId)
        );
        CREATE TABLE IF NOT EXISTS solver_execution_claims(
          requestIdentity TEXT PRIMARY KEY, executionAttemptId TEXT NOT NULL,
          replyVersionId TEXT NOT NULL, solverId TEXT NOT NULL,
          jobId TEXT NOT NULL REFERENCES jobs(id), attemptId TEXT NOT NULL REFERENCES job_attempts(id),
          workspaceGeneration TEXT NOT NULL, profileManifestSha256 TEXT NOT NULL, solverSha256 TEXT NOT NULL,
          policyFingerprint TEXT NOT NULL, evidenceScope TEXT NOT NULL, stateKey TEXT NOT NULL,
          siteOrigin TEXT NOT NULL, threadId TEXT NOT NULL, sessionId TEXT NOT NULL,
          handoffToken TEXT NOT NULL, leaseId TEXT NOT NULL, leaseExpiresAt TEXT NOT NULL,
          state TEXT NOT NULL, claimedAt TEXT NOT NULL, releasedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS solver_gate_decisions(
          id INTEGER PRIMARY KEY AUTOINCREMENT, decidedAt TEXT NOT NULL,
          requestIdentity TEXT NOT NULL, executionAttemptId TEXT NOT NULL,
          replyVersionId TEXT NOT NULL, solverId TEXT NOT NULL,
          siteOrigin TEXT NOT NULL, threadId TEXT NOT NULL, sessionId TEXT NOT NULL, stateKey TEXT NOT NULL,
          decision TEXT NOT NULL, reasonCode TEXT NOT NULL, reason TEXT NOT NULL,
          confinement TEXT NOT NULL, confinementReference TEXT, confinementReason TEXT,
          policyFingerprint TEXT NOT NULL, evidenceScope TEXT NOT NULL, modelTurns INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO migrations(version) VALUES(3);
      `);
      ensureColumn(this.db, 'jobs', 'preparedPayloadDigest', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(this.db, 'jobs', 'requestDigest', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(this.db, 'job_attempts', 'predecessorAttemptId', 'TEXT');
      ensureColumn(this.db, 'job_attempts', 'authorizationFingerprint', 'TEXT');
      ensureColumn(this.db, 'job_attempts', 'handoffMarked', 'INTEGER NOT NULL DEFAULT 0');
      ensureColumn(this.db, 'job_attempts', 'workspacePrepared', 'INTEGER NOT NULL DEFAULT 0');
      ensureColumn(this.db, 'job_attempts', 'sentContent', 'TEXT');
      // Preserve already published questions when upgrading a pre-budget database.
      const existing = this.db.prepare(`SELECT j.id,j.latestAttemptId,j.provisional,r.json AS reply
        FROM jobs j LEFT JOIN reply_versions r ON r.id=j.replyVersionId ORDER BY j.createdAt,j.id`).all() as
        { id: string; latestAttemptId: string | null; provisional: string | null; reply: string | null }[];
      for (const job of existing) {
        if (!job.latestAttemptId) continue;
        for (const serialized of [job.provisional, job.reply]) {
          if (!serialized) continue;
          const question = (JSON.parse(serialized) as CandidateReply).blocks.find(block => block.type === 'question');
          if (question) this.db.prepare('INSERT OR IGNORE INTO build_clarifications VALUES(?,?,?)')
            .run(this.buildId(job.id), job.latestAttemptId, packetDigest(question));
        }
      }
      // Old bindings have no trustworthy interpreter identity. Nullable migration
      // columns make those rows fail closed when read instead of inventing metadata.
      ensureColumn(this.db, 'solver_artifact_bindings', 'runtimeIdentity', 'TEXT');
      ensureColumn(this.db, 'solver_artifact_bindings', 'runtimeVersion', 'TEXT');
    })();
  }
  private event(kind: string, payload: unknown) {
    this.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)').run(kind, JSON.stringify(payload), new Date().toISOString());
  }
  findByIdempotencyKey(key: string): (JobSnapshot & { requestDigest: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE idempotencyKey=?').get(key) as JobRow | undefined;
    if (!row) return;
    return Object.assign(this.snapshot(row), { requestDigest: row.requestDigest });
  }
  savePreparation(jobId: string, planDigest: string, bindingDigest: string) {
    if (!/^[\w-]{1,100}$/.test(jobId) || !isDigest(planDigest) || !isDigest(bindingDigest)) throw new Error('Invalid prepared work binding.');
    this.db.transaction(() => {
      const current = this.db.prepare('SELECT consumedAt FROM job_preparations WHERE jobId=?').get(jobId) as { consumedAt: string | null } | undefined;
      if (current?.consumedAt) throw new JobConflictError('This prepared work was already consumed. Use a new job identifier.');
      const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      this.db.prepare(`INSERT INTO job_preparations(jobId,planDigest,bindingDigest,createdAt,expiresAt,consumedAt) VALUES(?,?,?,?,?,NULL)
        ON CONFLICT(jobId) DO UPDATE SET planDigest=excluded.planDigest,bindingDigest=excluded.bindingDigest,createdAt=excluded.createdAt,expiresAt=excluded.expiresAt,consumedAt=NULL`)
        .run(jobId, planDigest, bindingDigest, createdAt, expiresAt);
      this.event('job-prepared', { jobId, bindingDigest, expiresAt });
    })();
  }
  create(input: StartJobInput, context: FrozenJobContext, digest: string, requestDigest: string): JobSnapshot {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT id,packetDigest,requestDigest FROM jobs WHERE idempotencyKey=?').get(input.idempotencyKey) as { id: string; packetDigest: string; requestDigest: string } | undefined;
      if (prior) {
        if (prior.requestDigest !== requestDigest || prior.id !== input.id) throw new JobConflictError('This request key already identifies different work.');
        return this.get(prior.id)!;
      }
      if (this.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(input.id)) throw new JobConflictError('This job identifier already exists.');
      this.db.prepare(`INSERT INTO jobs(id,threadId,idempotencyKey,packetDigest,requestDigest,preparedPayloadDigest,provider,model,mode,policyKey,grantId,state,context,capabilities,createdAt,updatedAt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?,?)`).run(input.id, input.threadId, input.idempotencyKey, digest, requestDigest, input.preparedPayloadDigest, input.provider, input.model,
          input.mode, input.policyKey, input.grantId, JSON.stringify(context), JSON.stringify(input.capabilities ?? []), now, now);
      this.event('job-created', { jobId: input.id, threadId: input.threadId, state: 'queued' });
      return this.get(input.id)!;
    })();
  }
  createAndAttempt(input: StartJobInput, context: FrozenJobContext, digest: string, requestDigest: string, planDigest: string): { job: JobSnapshot; attempt?: JobAttempt } {
    return this.db.transaction(() => {
      const preparation = this.db.prepare('SELECT * FROM job_preparations WHERE jobId=?').get(input.id) as { planDigest: string; bindingDigest: string; expiresAt: string; consumedAt: string | null } | undefined;
      if (!preparation || preparation.consumedAt || preparation.planDigest !== planDigest || preparation.bindingDigest !== input.preparedPayloadDigest || Date.parse(preparation.expiresAt) <= Date.now()) {
        throw new JobConflictError('The reviewed outgoing content is unavailable or expired. Review it again.');
      }
      const job = this.create(input, context, digest, requestDigest);
      if (job.latestAttemptId) return { job };
      const attempt = this.createAttempt(job.id);
      this.db.prepare('UPDATE job_preparations SET consumedAt=? WHERE jobId=? AND consumedAt IS NULL').run(new Date().toISOString(), input.id);
      return { job: this.get(job.id)!, attempt };
    })();
  }
  failQueuedWithoutAttempt(jobId: string) {
    this.db.transaction(() => {
      const job = this.get(jobId);
      if (!job || job.latestAttemptId || job.state !== 'queued') return;
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET state='failed',reason='daemon-restarted-before-attempt-reservation',updatedAt=? WHERE id=?").run(now, jobId);
      this.event('job-state', { jobId, state: 'failed', reason: 'daemon-restarted-before-attempt-reservation' });
    })();
  }
  createAttempt(jobId: string): JobAttempt {
    return this.db.transaction(() => {
      const job = this.get(jobId);
      if (!job) throw new Error('This work is unavailable.');
      if (job.cancelRequested) throw new JobConflictError('Cancelled work cannot be dispatched.');
      if (job.unformatted) throw new JobConflictError('Retry this skill through a new reviewed request.');
      const row = this.db.prepare('SELECT COALESCE(MAX(number),0) AS n FROM job_attempts WHERE jobId=?').get(jobId) as { n: number };
      const attempt: JobAttempt = { id: randomUUID(), jobId, number: row.n + 1, state: 'queued', revision: 0, dispatchClaimed: false, handoffMarked: false, workspacePrepared: false };
      this.db.prepare('INSERT INTO job_attempts(id,jobId,number,state,predecessorAttemptId) VALUES(?,?,?,?,?)').run(attempt.id, jobId, attempt.number, attempt.state, job.context.parentAttemptId ?? null);
      if (job.context.parentAttemptId) {
        const reservation = this.db.prepare('UPDATE provider_thread_leases SET successorAttemptId=? WHERE attemptId=? AND successorAttemptId IS NULL')
          .run(attempt.id, job.context.parentAttemptId);
        if (reservation.changes !== 1) throw new JobConflictError('The provider thread already has a follow-up or no durable predecessor lease.');
      }
      this.db.prepare("UPDATE jobs SET latestAttemptId=?,state='queued',reason=NULL,updatedAt=? WHERE id=?").run(attempt.id, new Date().toISOString(), jobId);
      this.event('job-attempt-created', { jobId, attemptId: attempt.id, number: attempt.number, state: 'queued' });
      return attempt;
    })();
  }
  get(id: string): JobSnapshot | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow | undefined;
    if (!row) return;
    return this.snapshot(row);
  }
  jobForAttempt(attemptId: string): JobSnapshot | undefined {
    const row = this.db.prepare('SELECT jobId FROM job_attempts WHERE id=?').get(attemptId) as { jobId: string } | undefined;
    return row ? this.get(row.jobId) : undefined;
  }
  list(threadId?: string): JobSnapshot[] {
    const rows = (threadId ? this.db.prepare('SELECT * FROM jobs WHERE threadId=? ORDER BY createdAt,id').all(threadId)
      : this.db.prepare('SELECT * FROM jobs ORDER BY createdAt,id').all()) as JobRow[];
    return rows.map(row => this.snapshot(row));
  }
  private snapshot(row: JobRow): JobSnapshot {
    const attempts = this.db.prepare('SELECT * FROM job_attempts WHERE jobId=? ORDER BY number').all(row.id) as AttemptRow[];
    const rawOutput = this.db.prepare('SELECT attemptId,json FROM job_skill_outputs WHERE jobId=?').get(row.id) as { attemptId: string; json: string } | undefined;
    if (rawOutput && rawOutput.json.length > 256 * 1024 * 6 + 4096) throw new JobConflictError('Saved unformatted output exceeds its bound.');
    const unformatted = rawOutput && row.state === 'failed' && !row.replyVersionId && rawOutput.attemptId === row.latestAttemptId
      ? checkedUnformatted(JSON.parse(rawOutput.json)) : undefined;
    if (rawOutput && (!unformatted || packetDigest(unformatted.readerSkill) !== packetDigest((JSON.parse(row.context) as FrozenJobContext).readerSkill ?? null))) throw new JobConflictError('Invalid saved unformatted result.');
    return {
      ...(unformatted ? { unformatted } : {}),
      clarificationBudget: this.clarificationBudget(row.id),
      id: row.id, threadId: row.threadId, idempotencyKey: row.idempotencyKey, packetDigest: row.packetDigest, preparedPayloadDigest: row.preparedPayloadDigest, provider: row.provider,
      model: row.model, mode: row.mode, policyKey: row.policyKey, grantId: row.grantId, state: row.state,
      cancelRequested: !!row.cancelRequested, latestAttemptId: row.latestAttemptId ?? undefined,
      provisional: row.provisional ? JSON.parse(row.provisional) : undefined, replyVersionId: row.replyVersionId ?? undefined,
      reason: row.reason ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt, context: JSON.parse(row.context),
      attempts: attempts.map(a => ({ id: a.id, jobId: a.jobId, number: a.number, state: a.state, revision: a.revision,
        dispatchClaimed: !!a.dispatchClaimed, handoffMarked: !!a.handoffMarked, workspacePrepared: !!a.workspacePrepared, predecessorAttemptId: a.predecessorAttemptId ?? undefined,
        authorizationFingerprint: a.authorizationFingerprint ?? undefined, providerHandle: a.providerHandle ? publicProviderHandle(JSON.parse(a.providerHandle)) : undefined,
        sentContent: a.sentContent ? JSON.parse(a.sentContent) : undefined,
        startedAt: a.startedAt ?? undefined, deadlineAt: a.deadlineAt ?? undefined, endedAt: a.endedAt ?? undefined, reason: a.reason ?? undefined })),
    };
  }
  private buildId(jobId: string): string {
    const visited = new Set<string>();
    let current = jobId;
    while (!visited.has(current)) {
      visited.add(current);
      const row = this.db.prepare('SELECT context,threadId FROM jobs WHERE id=?').get(current) as { context: string; threadId: string } | undefined;
      if (!row) throw new JobConflictError('The build lineage is unavailable.');
      const retryOf = (JSON.parse(row.context) as FrozenJobContext).retryOfJobId;
      if (!retryOf) return current;
      const parent = this.db.prepare('SELECT threadId FROM jobs WHERE id=?').get(retryOf) as { threadId: string } | undefined;
      if (!parent || parent.threadId !== row.threadId) throw new JobConflictError('The retry build lineage is unavailable.');
      current = retryOf;
    }
    throw new JobConflictError('The retry build lineage is invalid.');
  }
  private clarificationBudget(jobId: string): NonNullable<JobSnapshot['clarificationBudget']> {
    const buildId = this.buildId(jobId);
    return { buildId, limit: 1, used: this.db.prepare('SELECT 1 FROM build_clarifications WHERE buildId=?').get(buildId) ? 1 : 0 };
  }
  /** Called only inside the transaction publishing a validated candidate. Identical partial/final
   * observations from one attempt are one question; another attempt cannot ask it again. */
  private claimClarification(jobId: string, attemptId: string, reply: CandidateReply) {
    const questions = reply.blocks.filter(block => block.type === 'question');
    if (!questions.length) return;
    if (questions.length > 1) throw new ClarificationLimitError();
    const buildId = this.buildId(jobId), questionDigest = packetDigest(questions[0]);
    const previous = this.db.prepare('SELECT attemptId,questionDigest FROM build_clarifications WHERE buildId=?').get(buildId) as
      { attemptId: string; questionDigest: string } | undefined;
    if (previous) {
      if (previous.attemptId !== attemptId || previous.questionDigest !== questionDigest) throw new ClarificationLimitError();
      return;
    }
    this.db.prepare('INSERT INTO build_clarifications VALUES(?,?,?)').run(buildId, attemptId, questionDigest);
  }
  capabilities(jobId: string): ReplyCapability[] {
    const row = this.db.prepare('SELECT capabilities FROM jobs WHERE id=?').get(jobId) as { capabilities: string } | undefined;
    return row ? JSON.parse(row.capabilities) : [];
  }
  solverArtifactBinding(replyVersionId: string, solverId: string): SolverArtifactBinding | undefined {
    const row = this.db.prepare(`SELECT jobId,attemptId,workspace,workspaceGeneration,solverRelativePath,solverSha256,
      runtimeExecutable,runtimeIdentity,runtimeVersion,runtimeSha256
      FROM solver_artifact_bindings WHERE replyVersionId=? AND solverId=?`).get(replyVersionId, solverId) as (SolverArtifactBinding & { runtimeIdentity: string | null; runtimeVersion: string | null; runtimeSha256: string | null }) | undefined;
    if (!row?.runtimeIdentity || !row.runtimeVersion) return;
    return { jobId: row.jobId, attemptId: row.attemptId, workspace: row.workspace, workspaceGeneration: row.workspaceGeneration,
      solverRelativePath: row.solverRelativePath, solverSha256: row.solverSha256, runtimeExecutable: row.runtimeExecutable,
      runtimeIdentity: row.runtimeIdentity, runtimeVersion: row.runtimeVersion,
      ...(row.runtimeSha256 ? { runtimeSha256: row.runtimeSha256 } : {}) };
  }
  recordSolverGateDecision(record: SolverGateDecisionRecord): void {
    this.db.transaction(() => insertSolverGateDecision(this.db, record))();
  }
  commitSolverExecutionClaim(input: SolverExecutionClaimInput): SolverExecutionClaimResult {
    return this.db.transaction((): SolverExecutionClaimResult => {
      const binding = this.db.prepare(`SELECT jobId,attemptId,workspaceGeneration,solverSha256 FROM solver_artifact_bindings
        WHERE replyVersionId=? AND solverId=?`).get(input.replyVersionId, input.solverId) as {
          jobId: string; attemptId: string; workspaceGeneration: string; solverSha256: string;
        } | undefined;
      if (!binding) {
        const reason = 'The saved solver is no longer bound to this reply.';
        insertSolverGateDecision(this.db, { ...input, decision: 'denied', reasonCode: 'binding-missing', reason });
        return { decision: 'refused', code: 'binding-missing', reason };
      }
      if (binding.workspaceGeneration !== input.workspaceGeneration || binding.solverSha256 !== input.solverSha256 ||
        binding.jobId !== input.jobId || binding.attemptId !== input.attemptId) {
        const reason = 'The saved solver workspace moved after this recompute was prepared.';
        insertSolverGateDecision(this.db, { ...input, decision: 'denied', reasonCode: 'binding-moved', reason });
        return { decision: 'refused', code: 'binding-moved', reason };
      }
      const job = this.db.prepare('SELECT state,latestAttemptId,replyVersionId FROM jobs WHERE id=?').get(input.jobId) as {
        state: string; latestAttemptId: string | null; replyVersionId: string | null;
      } | undefined;
      if (!job || job.state !== 'succeeded' || job.latestAttemptId !== input.attemptId || job.replyVersionId !== input.replyVersionId) {
        const reason = 'The work that produced this saved solver is no longer a succeeded current attempt.';
        insertSolverGateDecision(this.db, { ...input, decision: 'denied', reasonCode: 'job-not-succeeded', reason });
        return { decision: 'refused', code: 'job-not-succeeded', reason };
      }
      const claimed = this.db.prepare('SELECT state FROM solver_execution_claims WHERE requestIdentity=?')
        .get(input.requestIdentity) as { state: string } | undefined;
      if (claimed?.state === 'dispatched' || claimed?.state === 'settled') {
        const state = claimed.state;
        const reason = `This saved-solver recompute is already ${state}.`;
        insertSolverGateDecision(this.db, { ...input, decision: 'already-claimed', reasonCode: 'already-claimed', reason });
        return { decision: 'already-claimed', state, reason };
      }
      if (claimed?.state === 'released') {
        this.db.prepare('DELETE FROM solver_execution_claims WHERE requestIdentity=?').run(input.requestIdentity);
      }
      this.db.prepare(`INSERT INTO solver_execution_claims
        (requestIdentity,executionAttemptId,replyVersionId,solverId,jobId,attemptId,workspaceGeneration,profileManifestSha256,solverSha256,
         policyFingerprint,evidenceScope,stateKey,siteOrigin,threadId,sessionId,handoffToken,leaseId,leaseExpiresAt,state,claimedAt,releasedAt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'dispatched',?,NULL)`).run(
        input.requestIdentity, input.executionAttemptId, input.replyVersionId, input.solverId, input.jobId, input.attemptId,
        binding.workspaceGeneration, input.profileManifestSha256, input.solverSha256, input.policyFingerprint, input.evidenceScope,
        input.stateKey, input.siteOrigin, input.threadId, input.sessionId, input.handoffToken, input.leaseId, input.leaseExpiresAt, input.decidedAt);
      insertSolverGateDecision(this.db, { ...input, decision: 'allowed', reasonCode: 'committed', reason: input.reason });
      return { decision: 'committed', workspaceGeneration: binding.workspaceGeneration };
    })();
  }
  releaseSolverExecutionClaim(input: { requestIdentity: string; executionAttemptId: string; handoffToken: string; leaseId: string; reason: string; at: string }): void {
    this.db.transaction(() => {
      const claim = this.db.prepare(`SELECT replyVersionId,solverId,siteOrigin,threadId,sessionId,stateKey,policyFingerprint,evidenceScope
        FROM solver_execution_claims WHERE requestIdentity=? AND executionAttemptId=? AND handoffToken=? AND leaseId=? AND state='dispatched'`)
        .get(input.requestIdentity, input.executionAttemptId, input.handoffToken, input.leaseId) as Omit<SolverGateDecisionRecord,
          'decidedAt' | 'requestIdentity' | 'executionAttemptId' | 'decision' | 'reasonCode' | 'reason' | 'confinement' |
          'confinementReference' | 'confinementReason' | 'modelTurns'> | undefined;
      const released = this.db.prepare(`UPDATE solver_execution_claims SET state='released',releasedAt=?
        WHERE requestIdentity=? AND executionAttemptId=? AND handoffToken=? AND leaseId=? AND state='dispatched'`)
        .run(input.at, input.requestIdentity, input.executionAttemptId, input.handoffToken, input.leaseId);
      if (released.changes !== 1 || !claim) throw new JobConflictError('The exact saved-solver execution claim was not found to release.');
      const allowed = this.db.prepare(`SELECT confinementReference FROM solver_gate_decisions
        WHERE requestIdentity=? AND executionAttemptId=? AND decision='allowed' ORDER BY id DESC LIMIT 1`)
        .get(input.requestIdentity, input.executionAttemptId) as { confinementReference: string | null } | undefined;
      insertSolverGateDecision(this.db, { ...claim, decidedAt: input.at, requestIdentity: input.requestIdentity,
        executionAttemptId: input.executionAttemptId, decision: 'released', reasonCode: 'claim-released', reason: input.reason,
        confinement: 'observed', confinementReference: allowed?.confinementReference ?? null, confinementReason: null, modelTurns: 0 });
    })();
  }
  solverGateDecisions(requestIdentity?: string): SolverGateDecisionRecord[] {
    const rows = (requestIdentity
      ? this.db.prepare('SELECT * FROM solver_gate_decisions WHERE requestIdentity=? ORDER BY id').all(requestIdentity)
      : this.db.prepare('SELECT * FROM solver_gate_decisions ORDER BY id').all()) as Array<SolverGateDecisionRecord & { modelTurns: number }>;
    return rows.map(row => ({ decidedAt: row.decidedAt, requestIdentity: row.requestIdentity, executionAttemptId: row.executionAttemptId,
      replyVersionId: row.replyVersionId, solverId: row.solverId, siteOrigin: row.siteOrigin, threadId: row.threadId,
      sessionId: row.sessionId, stateKey: row.stateKey, decision: row.decision, reasonCode: row.reasonCode, reason: row.reason,
      confinement: row.confinement, confinementReference: row.confinementReference, confinementReason: row.confinementReason,
      policyFingerprint: row.policyFingerprint, evidenceScope: row.evidenceScope, modelTurns: 0 }));
  }
  checkpoint(attemptId: string, incoming: ProviderHandle): ProviderHandle {
    return this.db.transaction(() => {
      const a = this.db.prepare('SELECT * FROM job_attempts WHERE id=?').get(attemptId) as AttemptRow | undefined;
      if (!a || incoming.jobId !== attemptId) throw new JobConflictError('Unknown provider attempt.');
      const job = this.get(a.jobId)!;
      if (job.provider !== incoming.provider || job.model !== incoming.model || job.mode !== incoming.mode || job.policyKey !== incoming.policyKey) throw new JobConflictError('Provider checkpoint binding changed.');
      const current = a.providerHandle ? JSON.parse(a.providerHandle) as ProviderHandle : undefined;
      if (terminal.has(a.state)) throw new JobConflictError('This provider attempt is already terminal.');
      if (a.dispatchClaimed) {
        if (!current || incoming.revision !== a.revision || incoming.providerInstanceId !== current.providerInstanceId) throw new JobConflictError('Stale or duplicate provider dispatch checkpoint.');
        if (a.state === 'validating' && incoming.state !== 'completed' && !incoming.tombstone && !job.cancelRequested) {
          throw new JobConflictError('A completed provider checkpoint cannot return to working.');
        }
        for (const key of ['workspace', 'threadId', 'turnId'] as const) {
          if (current[key] && !incoming[key]) throw new JobConflictError('Provider identity cannot be erased.');
          if (current[key] && incoming[key] && current[key] !== incoming[key]) throw new JobConflictError('Provider identity changed.');
        }
      } else if (!a.handoffMarked) throw new JobConflictError('Provider dispatch was not durably handed off.');
      else if (!incoming.providerInstanceId) throw new JobConflictError('Provider instance identity is required before dispatch.');

      if (incoming.rawFinalOutput !== undefined && (!job.context.readerSkill || (incoming.state !== 'completed' && !rejectedSkillOutput(incoming)) ||
          authoredSkillText(incoming.rawFinalOutput, 'raw') !== incoming.rawFinalOutput)) throw new JobConflictError('Invalid final authored output.');
      let canonical: ProviderHandle = publicProviderHandle(incoming);
      if (job.cancelRequested) canonical = { ...canonical, tombstone: true, output: undefined, rawFinalOutput: undefined,
        state: canonical.state === 'completed' || canonical.state === 'cancelled' ? 'cancelled'
          : canonical.state === 'outcome_unknown' ? 'outcome_unknown' : 'cancel_requested' };
      const revision = a.revision + 1;
      canonical.revision = revision;
      const mapped = job.context.readerSkill && !canonical.tombstone && !job.cancelRequested && rejectedSkillOutput(canonical) && incoming.rawFinalOutput !== undefined
        ? 'validating' : mapProviderState(canonical.state, canonical.tombstone, job.cancelRequested);
      const effective = terminal.has(a.state) ? a.state : mapped;
      const now = new Date().toISOString();
      this.claimThreadLease(job, a, canonical);
      if (incoming.rawFinalOutput !== undefined && !job.cancelRequested && !canonical.tombstone && job.latestAttemptId === attemptId && !terminal.has(job.state)) {
        this.db.prepare('INSERT INTO job_skill_pending(attemptId,text,sha256) VALUES(?,?,?) ON CONFLICT(attemptId) DO UPDATE SET text=excluded.text,sha256=excluded.sha256')
          .run(attemptId, incoming.rawFinalOutput, skillOutputHash(incoming.rawFinalOutput));
      }
      if (terminal.has(effective) || job.cancelRequested || canonical.tombstone) this.clearPendingSkillOutput(attemptId);
      this.db.prepare(`UPDATE job_attempts SET state=?,revision=?,dispatchClaimed=1,providerHandle=?,startedAt=COALESCE(startedAt,?),
        endedAt=?,reason=? WHERE id=?`).run(effective, revision, JSON.stringify(canonical), now, terminal.has(effective) ? now : null, canonical.reason ?? null, attemptId);
      const currentAttempt = job.latestAttemptId === attemptId;
      if (currentAttempt && !terminal.has(job.state)) this.db.prepare('UPDATE jobs SET state=?,reason=?,updatedAt=? WHERE id=?')
        .run(mapped, canonical.reason ?? null, now, job.id);
      if (currentAttempt && !terminal.has(job.state)) this.event('job-state', { jobId: job.id, attemptId, state: mapped, reason: canonical.reason });
      return canonical;
    })();
  }
  /** Adapter stop may acknowledge an already durable host fence, without revising or reopening it. */
  acknowledgeStopFence(attemptId: string, incoming: ProviderHandle): ProviderHandle | undefined {
    const job = this.jobForAttempt(attemptId), attempt = job?.attempts.find(a => a.id === attemptId);
    const current = attempt?.providerHandle;
    if (!job || !attempt || !current || !incoming.tombstone || incoming.jobId !== attemptId ||
      incoming.provider !== current.provider || incoming.providerInstanceId !== current.providerInstanceId ||
      incoming.workspace !== current.workspace || incoming.policyKey !== current.policyKey ||
      incoming.model !== current.model || incoming.mode !== current.mode ||
      incoming.threadId !== current.threadId || incoming.turnId !== current.turnId ||
      incoming.revision !== current.revision || job.latestAttemptId !== attemptId ||
      !job.cancelRequested || !['timed_out', 'cancelled', 'outcome_unknown'].includes(job.state)) return;
    return { ...incoming, revision: current.revision, tombstone: true, output: undefined, rawFinalOutput: undefined };
  }
  private claimThreadLease(job: JobSnapshot, attempt: AttemptRow, handle: ProviderHandle) {
    if (!handle.threadId) return;
    const existing = this.db.prepare('SELECT * FROM provider_thread_leases WHERE attemptId=?').get(attempt.id) as { providerThreadId: string } | undefined;
    if (existing) {
      if (existing.providerThreadId !== handle.threadId) throw new JobConflictError('Provider thread identity changed.');
      return;
    }
    const predecessor = attempt.predecessorAttemptId;
    if (predecessor) {
      const prior = this.db.prepare('SELECT * FROM provider_thread_leases WHERE attemptId=?').get(predecessor) as { provider: string; providerThreadId: string; successorAttemptId: string | null } | undefined;
      if (!prior || prior.provider !== handle.provider || prior.providerThreadId !== handle.threadId || prior.successorAttemptId !== attempt.id) throw new JobConflictError('Provider thread predecessor is stale or already advanced.');
    } else if (this.db.prepare('SELECT 1 FROM provider_thread_leases WHERE provider=? AND providerThreadId=?').get(handle.provider, handle.threadId)) {
      throw new JobConflictError('Provider thread is already owned by another attempt chain.');
    }
    this.db.prepare('INSERT INTO provider_thread_leases(provider,providerThreadId,attemptId,predecessorAttemptId) VALUES(?,?,?,?)')
      .run(handle.provider, handle.threadId, attempt.id, predecessor ?? null);
  }
  requestCancel(jobId: string): { job: JobSnapshot; handle?: ProviderHandle } {
    return this.db.transaction(() => {
      const job = this.get(jobId);
      if (!job) throw new Error('This work is unavailable.');
      if (job.state === 'succeeded' || ['failed', 'cancelled', 'timed_out'].includes(job.state)) return { job };
      const attempt = job.attempts.find(a => a.id === job.latestAttemptId);
      const now = new Date().toISOString();
      if (attempt) this.clearPendingSkillOutput(attempt.id);
      const nextState = job.state === 'outcome_unknown' ? 'outcome_unknown' : 'cancel_requested';
      this.db.prepare('UPDATE jobs SET cancelRequested=1,state=?,updatedAt=? WHERE id=?').run(nextState, now, jobId);
      if (attempt && !terminal.has(attempt.state)) this.db.prepare("UPDATE job_attempts SET state='cancel_requested',reason='user-cancelled' WHERE id=?").run(attempt.id);
      this.event('job-state', { jobId, attemptId: attempt?.id, state: nextState });
      return { job: this.get(jobId)!, handle: attempt?.providerHandle };
    })();
  }
  cancelBeforeHandoff(jobId: string, attemptId: string): boolean {
    return this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
      if (!job || !attempt || job.latestAttemptId !== attemptId || !job.cancelRequested || attempt.handoffMarked || attempt.dispatchClaimed || terminal.has(job.state)) return false;
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET state='cancelled',reason='cancelled-before-provider-handoff',updatedAt=? WHERE id=?").run(now, jobId);
      this.db.prepare("UPDATE job_attempts SET state='cancelled',endedAt=?,reason='cancelled-before-provider-handoff' WHERE id=?").run(now, attemptId);
      this.clearPendingSkillOutput(attemptId);
      this.event('job-state', { jobId, attemptId, state: 'cancelled', reason: 'cancelled-before-provider-handoff' });
      return true;
    })();
  }
  markTimedOut(jobId: string, attemptId: string): ProviderHandle | undefined {
    return this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
      if (!job || !attempt || job.latestAttemptId !== attemptId || terminal.has(job.state) || job.state === 'succeeded') return;
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET cancelRequested=1,state='timed_out',reason='deadline-reached-provider-stop-unconfirmed',updatedAt=? WHERE id=?").run(now, jobId);
      this.db.prepare("UPDATE job_attempts SET state='timed_out',endedAt=?,reason='deadline-reached-provider-stop-unconfirmed' WHERE id=?").run(now, attemptId);
      this.clearPendingSkillOutput(attemptId);
      this.event('job-state', { jobId, attemptId, state: 'timed_out', reason: 'deadline-reached-provider-stop-unconfirmed' });
      return attempt.providerHandle;
    })();
  }
  saveProvisional(jobId: string, attemptId: string, reply: CandidateReply) {
    this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
      if (!job || !attempt || job.latestAttemptId !== attemptId || job.cancelRequested || terminal.has(job.state)) return;
      if (!validateReply(reply, { sourceText: job.context.sourceText, capabilities: this.capabilities(jobId) }).ok) return;
      if (job.context.readerSkill && !skillReplyAllowed(reply)) throw new JobConflictError('Unsupported reader skill reply.');
      this.claimClarification(jobId, attemptId, reply);
      const serialized = JSON.stringify(reply);
      const previous = this.db.prepare('SELECT provisional FROM jobs WHERE id=?').get(jobId) as { provisional: string | null };
      if (previous.provisional === serialized) return;
      this.db.prepare('UPDATE jobs SET provisional=?,updatedAt=? WHERE id=?').run(serialized, new Date().toISOString(), jobId);
      this.event('job-provisional', { jobId, attemptId, status: 'partial' });
    })();
  }
  succeed(jobId: string, attemptId: string, expectedRevision: number, reply: CandidateReply, solverBindings: readonly SolverBindingCommit[] = [], evidence?: EvidenceRetrieval) {
    return this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
      if (!job || !attempt) throw new Error('This work is unavailable.');
      if (job.cancelRequested) throw new JobConflictError('The result arrived after cancellation.');
      if (job.context.readerSkill) {
        if (attempt.deadlineAt && Date.parse(attempt.deadlineAt) <= Date.now()) throw new JobConflictError('The skill result arrived after its deadline.');
        const thread = this.reader.get(job.threadId), source = thread && this.reader.sourceVersion(thread.sourceVersionId);
        if (!thread || thread.deletedAt || !source || source.id !== job.context.sourceVersionId || source.hash !== job.context.sourceHash) throw new JobConflictError('The skill source differs from its frozen request.');
      }
      if (job.latestAttemptId !== attemptId || attempt.state !== 'validating' || !attempt.dispatchClaimed ||
        attempt.revision !== expectedRevision || attempt.providerHandle?.state !== 'completed') throw new JobConflictError('This attempt is no longer eligible to commit.');
      if (job.context.readerSkill && !skillReplyAllowed(reply)) throw new JobConflictError('Unsupported reader skill reply.');
      this.claimClarification(jobId, attemptId, reply);
      const committed = this.reader.commitReply({ id: `${job.id}-reply`, threadId: job.threadId, reply,
        parentId: job.context.parentReplyId, readerSkill: job.context.readerSkill, answeredNote: job.context.answeredNote && { noteId: job.context.answeredNote.noteId, revision: job.context.answeredNote.revision } }, this.capabilities(job.id), ['evidence', 'explore'].includes(reply.intent) ? {
          sessionScope: evidence?.sessionScope ?? 'open-session', retrievalComplete: evidence?.retrievalComplete ?? false, observed: evidence?.observed ?? [],
          boundSourceVersion: { id: job.context.sourceVersionId, hash: job.context.sourceHash, capturedAt: job.context.sourceCapturedAt },
        } : undefined);
      const insertBinding = this.db.prepare(`INSERT INTO solver_artifact_bindings
        (replyVersionId,solverId,jobId,attemptId,workspace,workspaceDev,workspaceIno,workspaceGeneration,solverRelativePath,solverSha256,runtimeExecutable,runtimeIdentity,runtimeVersion,runtimeSha256)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const binding of solverBindings) {
        if (binding.jobId !== job.id || binding.attemptId !== attemptId) throw new JobConflictError('A saved solver binding does not belong to the committing attempt.');
        if (!isDigest(binding.runtimeSha256)) throw new JobConflictError('A saved solver requires a pinned interpreter binary.');
        insertBinding.run(committed.id, binding.solverId, binding.jobId, binding.attemptId, binding.workspace,
          binding.workspaceDev, binding.workspaceIno, binding.workspaceGeneration, binding.solverRelativePath,
          binding.solverSha256, binding.runtimeExecutable, binding.runtimeIdentity, binding.runtimeVersion, binding.runtimeSha256 ?? null);
      }
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET state='succeeded',replyVersionId=?,provisional=NULL,reason=NULL,updatedAt=? WHERE id=?").run(committed.id, now, job.id);
      this.db.prepare("UPDATE job_attempts SET state='succeeded',endedAt=?,reason=NULL WHERE id=?").run(now, attemptId);
      this.clearPendingSkillOutput(attemptId);
      this.event('job-state', { jobId, attemptId, state: 'succeeded', replyVersionId: committed.id });
      return this.get(job.id)!;
    })();
  }
  /** Internal settlement/recovery only. Never included in JobSnapshot or events. */
  pendingSkillOutput(attemptId: string): string | undefined {
    const row = this.db.prepare(`SELECT p.text,p.sha256 FROM job_skill_pending p
      JOIN job_attempts a ON a.id=p.attemptId JOIN jobs j ON j.id=a.jobId
      WHERE a.id=? AND j.latestAttemptId=a.id AND j.cancelRequested=0 AND j.state='validating' AND a.state='validating'`)
      .get(attemptId) as { text: string; sha256: string } | undefined;
    if (!row || authoredSkillText(row.text, 'raw') !== row.text || skillOutputHash(row.text) !== row.sha256) return;
    return row.text;
  }
  private clearPendingSkillOutput(attemptId: string) {
    this.db.prepare('DELETE FROM job_skill_pending WHERE attemptId=?').run(attemptId);
    this.db.prepare("UPDATE job_attempts SET providerHandle=json_remove(providerHandle,'$.rawFinalOutput') WHERE id=? AND providerHandle IS NOT NULL").run(attemptId);
  }
  saveUnformatted(jobId: string, attemptId: string, expectedRevision: number, input: UnformattedSkillOutput) {
    return this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
      const output = checkedUnformatted(input);
      const thread = job && this.reader.get(job.threadId);
      if (!output || !job?.context.readerSkill || !thread || thread.deletedAt || !attempt || job.cancelRequested ||
          job.latestAttemptId !== attemptId || job.state !== 'validating' || attempt.state !== 'validating' ||
          !attempt.dispatchClaimed || attempt.revision !== expectedRevision || (attempt.providerHandle?.state !== 'completed' && !rejectedSkillOutput(attempt.providerHandle)) ||
          job.replyVersionId || packetDigest(output.readerSkill) !== packetDigest(job.context.readerSkill) ||
          (attempt.deadlineAt && Date.parse(attempt.deadlineAt) <= Date.now())) throw new JobConflictError('This unformatted result is no longer eligible to save.');
      const source = this.reader.sourceVersion(thread.sourceVersionId);
      if (!source || source.id !== job.context.sourceVersionId || source.hash !== job.context.sourceHash) throw new JobConflictError('The source differs from the frozen request.');
      if (job.mode === 'structured-final' && this.pendingSkillOutput(attemptId) !== output.text) throw new JobConflictError('The authored final output changed before saving.');
      const candidate = parseAndValidateReply(output.text, { sourceText: job.context.sourceText, capabilities: this.capabilities(jobId), requireOrigins: true });
      if (candidate.ok && candidate.value.status === 'complete' && skillReplyAllowed(candidate.value)) throw new JobConflictError('A valid skill reply cannot be relabelled as unformatted.');
      this.db.prepare('INSERT INTO job_skill_outputs(jobId,attemptId,json) VALUES(?,?,?)').run(jobId, attemptId, JSON.stringify(output));
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET state='failed',provisional=NULL,reason='reply-validation-failed',updatedAt=? WHERE id=?").run(now, jobId);
      this.db.prepare("UPDATE job_attempts SET state='failed',endedAt=?,reason='reply-validation-failed' WHERE id=?").run(now, attemptId);
      this.clearPendingSkillOutput(attemptId);
      this.event('job-state', { jobId, attemptId, state: 'failed', reason: 'reply-validation-failed' });
      return this.get(jobId)!;
    })();
  }
  setState(jobId: string, attemptId: string, state: Extract<JobState, 'failed' | 'outcome_unknown' | 'cancelled' | 'validating'>, reason?: string) {
    return this.db.transaction(() => {
      const job = this.get(jobId);
      if (!job || terminal.has(job.state) || job.latestAttemptId !== attemptId) return job;
      const actual = job.cancelRequested && state !== 'outcome_unknown' ? 'cancelled' : state;
      const now = new Date().toISOString();
      this.db.prepare('UPDATE jobs SET state=?,reason=?,updatedAt=? WHERE id=?').run(actual, reason ?? null, now, jobId);
      if (reason === CLARIFICATION_LIMIT_FALLBACK) this.db.prepare('UPDATE jobs SET provisional=NULL WHERE id=?').run(jobId);
      this.db.prepare('UPDATE job_attempts SET state=?,reason=?,endedAt=? WHERE id=?').run(actual, reason ?? null, terminal.has(actual) ? now : null, attemptId);
      if (terminal.has(actual)) this.clearPendingSkillOutput(attemptId);
      this.event('job-state', { jobId, attemptId, state: actual, reason });
      return this.get(jobId);
    })();
  }
  markPreparing(jobId: string, attemptId: string) {
    this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
      if (!job || !attempt || job.latestAttemptId !== attemptId || job.cancelRequested || job.state !== 'queued' || attempt.handoffMarked) return;
      this.db.prepare("UPDATE jobs SET state='preparing',updatedAt=? WHERE id=?").run(new Date().toISOString(), jobId);
      this.db.prepare("UPDATE job_attempts SET state='preparing' WHERE id=?").run(attemptId);
      this.event('job-state', { jobId, attemptId, state: 'preparing' });
    })();
  }
  releaseUndispatchedContinuation(attemptId: string) {
    this.db.transaction(() => {
      const attempt = this.db.prepare('SELECT * FROM job_attempts WHERE id=?').get(attemptId) as AttemptRow | undefined;
      const predecessor = attempt?.predecessorAttemptId ?? undefined;
      if (!attempt || !predecessor || attempt.dispatchClaimed || attempt.workspacePrepared) return;
      this.db.prepare('UPDATE provider_thread_leases SET successorAttemptId=NULL WHERE attemptId=? AND successorAttemptId=?').run(predecessor, attemptId);
    })();
  }
  forkUndispatchedContinuation(attemptId: string) {
    this.db.transaction(() => {
      const attempt = this.db.prepare('SELECT * FROM job_attempts WHERE id=?').get(attemptId) as AttemptRow | undefined;
      if (!attempt || !attempt.predecessorAttemptId || attempt.dispatchClaimed || attempt.workspacePrepared || attempt.handoffMarked) return;
      this.db.prepare('UPDATE provider_thread_leases SET successorAttemptId=NULL WHERE attemptId=? AND successorAttemptId=?')
        .run(attempt.predecessorAttemptId, attemptId);
      this.db.prepare('UPDATE job_attempts SET predecessorAttemptId=NULL WHERE id=?').run(attemptId);
    })();
  }
  markWorkspacePrepared(jobId: string, attemptId: string) {
    this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(value => value.id === attemptId);
      if (!job || !attempt || job.latestAttemptId !== attemptId || terminal.has(job.state)) throw new JobConflictError('This workspace is no longer current.');
      this.db.prepare('UPDATE job_attempts SET workspacePrepared=1 WHERE id=?').run(attemptId);
    })();
  }
  bindAuthorization(attemptId: string, fingerprint: string): boolean {
    if (!isDigest(fingerprint)) throw new JobConflictError('Consent authorization fingerprint is invalid.');
    return this.db.transaction(() => {
      const attempt = this.db.prepare('SELECT * FROM job_attempts WHERE id=?').get(attemptId) as AttemptRow | undefined;
      if (!attempt || attempt.dispatchClaimed) throw new JobConflictError('This attempt can no longer change authorization.');
      if (attempt.authorizationFingerprint && attempt.authorizationFingerprint !== fingerprint) throw new JobConflictError('Attempt authorization changed.');
      let compatible = true;
      if (attempt.predecessorAttemptId) {
        const predecessor = this.db.prepare('SELECT authorizationFingerprint FROM job_attempts WHERE id=?').get(attempt.predecessorAttemptId) as { authorizationFingerprint: string | null } | undefined;
        compatible = !!predecessor?.authorizationFingerprint && predecessor.authorizationFingerprint === fingerprint;
        if (!compatible) {
          this.db.prepare('UPDATE provider_thread_leases SET successorAttemptId=NULL WHERE attemptId=? AND successorAttemptId=?').run(attempt.predecessorAttemptId, attemptId);
          this.db.prepare('UPDATE job_attempts SET predecessorAttemptId=NULL WHERE id=?').run(attemptId);
        }
      }
      this.db.prepare('UPDATE job_attempts SET authorizationFingerprint=? WHERE id=?').run(fingerprint, attemptId);
      return compatible;
    })();
  }
  /** expected is captured before asynchronous workspace and runtime preparation. */
  withDispatchHandoff<T>(expected: Readonly<JobSnapshot>, attemptId: string, authority: Pick<JobConsentAuthority, 'assertSharedDatabase'>, finalize: (current: Readonly<JobSnapshot>) => T): T {
    authority.assertSharedDatabase(this.db);
    return this.db.transaction(() => {
      const current = this.get(expected.id);
      this.assertDispatchFence(expected, current, attemptId);
      const result = finalize(current!);
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new JobConflictError('Dispatch finalization must be synchronous.');
      this.assertDispatchFence(expected, this.get(expected.id), attemptId);
      const update = this.db.prepare('UPDATE job_attempts SET handoffMarked=1 WHERE id=? AND jobId=? AND revision=? AND state=? AND handoffMarked=0 AND dispatchClaimed=0')
        .run(attemptId, expected.id, expected.attempts.find(a => a.id === attemptId)!.revision, expected.attempts.find(a => a.id === attemptId)!.state);
      if (update.changes !== 1) throw new JobConflictError('The provider handoff changed during finalization.');
      this.event('job-provider-handoff', { jobId: expected.id, attemptId });
      return result;
    })();
  }
  recordSentContent(attemptId: string, content: readonly OutgoingPart[]) {
    const serialized = JSON.stringify(structuredClone(content));
    const updated = this.db.prepare(`UPDATE job_attempts SET sentContent=?
      WHERE id=? AND handoffMarked=1 AND dispatchClaimed=1 AND sentContent IS NULL`).run(serialized, attemptId);
    if (updated.changes !== 1) throw new JobConflictError('Sent content could not be attached to the provider handoff.');
  }
  private assertDispatchFence(expected: Readonly<JobSnapshot>, current: JobSnapshot | undefined, attemptId: string) {
    const before = expected.attempts.find(a => a.id === attemptId), now = current?.attempts.find(a => a.id === attemptId);
    if (!current || !before || !now || current.latestAttemptId !== attemptId || expected.latestAttemptId !== attemptId ||
      current.cancelRequested || current.state !== expected.state || !['queued', 'preparing'].includes(current.state) ||
      now.state !== before.state || !['queued', 'preparing'].includes(now.state) ||
      now.revision !== before.revision || now.handoffMarked || now.dispatchClaimed || !now.workspacePrepared || !before.workspacePrepared ||
      !now.deadlineAt || now.deadlineAt !== before.deadlineAt || !Number.isFinite(Date.parse(now.deadlineAt)) || Date.parse(now.deadlineAt) <= Date.now() ||
      current.packetDigest !== expected.packetDigest || current.preparedPayloadDigest !== expected.preparedPayloadDigest ||
      current.policyKey !== expected.policyKey || current.grantId !== expected.grantId || current.provider !== expected.provider ||
      current.model !== expected.model || current.mode !== expected.mode || packetDigest(current.context) !== packetDigest(expected.context) ||
      now.authorizationFingerprint !== before.authorizationFingerprint || now.predecessorAttemptId !== before.predecessorAttemptId) {
      throw new JobConflictError('This attempt or its prepared content changed before provider handoff.');
    }
  }
  setDeadline(jobId: string, attemptId: string, deadlineAt: string) {
    this.db.transaction(() => {
      const job = this.get(jobId), attempt = job?.attempts.find(a => a.id === attemptId);
      if (!job || !attempt || job.latestAttemptId !== attemptId || terminal.has(job.state)) throw new JobConflictError('This attempt cannot be dispatched.');
      this.db.prepare('UPDATE job_attempts SET deadlineAt=COALESCE(deadlineAt,?) WHERE id=?').run(deadlineAt, attemptId);
    })();
  }
}

function insertSolverGateDecision(db: Database.Database, record: SolverGateDecisionRecord): void {
  db.prepare(`INSERT INTO solver_gate_decisions
    (decidedAt,requestIdentity,executionAttemptId,replyVersionId,solverId,siteOrigin,threadId,sessionId,stateKey,
     decision,reasonCode,reason,confinement,confinementReference,confinementReason,policyFingerprint,evidenceScope,modelTurns)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    record.decidedAt, record.requestIdentity, record.executionAttemptId, record.replyVersionId, record.solverId,
    record.siteOrigin, record.threadId, record.sessionId, record.stateKey, record.decision, record.reasonCode, record.reason,
    record.confinement, record.confinementReference, record.confinementReason, record.policyFingerprint, record.evidenceScope, 0);
}

function ensureColumn(db: Database.Database, table: string, name: string, declaration: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
}

function mapProviderState(state: ProviderHandle['state'], tombstone: boolean, cancelled: boolean): JobState {
  if (cancelled || tombstone) return state === 'outcome_unknown' ? 'outcome_unknown' : state === 'cancel_requested' || state === 'starting' || state === 'running' ? 'cancel_requested' : 'cancelled';
  if (state === 'starting') return 'sending';
  if (state === 'running') return 'running';
  if (state === 'completed') return 'validating';
  return state;
}

/** Raw observation never crosses the public job boundary, even for legacy/corrupt handles. */
function publicProviderHandle(handle: ProviderHandle): ProviderHandle {
  const { rawFinalOutput: _raw, ...publicHandle } = handle;
  return publicHandle;
}
