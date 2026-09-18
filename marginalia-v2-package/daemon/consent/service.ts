import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { preparationAuthorization, type PreparationAuthorization } from '../providers/preparation-authority.ts';
import type Database from 'better-sqlite3';
import type {
  ConsentAuthorization, ConsentChoice, ConsentDecisionRequest, ConsentGrant, ConsentPreview,
  ConsentPrincipal, ConsentScope, EgressRecord, FetchedResourceRecord, GrantDecision,
  PrepareConsentInput, SiteExclusion,
} from '../../contracts/consent.ts';
import type { JobConsentAuthority, JobConsentDecision, JobConsentStage, JobSnapshot } from '../../contracts/jobs.ts';
import { isDigest } from '../../contracts/digest.ts';
import type { ReaderStore } from '../store.ts';

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const PREVIEW_TTL_MS = 10 * 60 * 1000;

type PreviewRow = {
  id: string; revision: number; requestId: string; site: string; scope: ConsentScope; recipient: string;
  recipientLabel: string; provider: 'app-server' | 'mcp-server'; policyKey: string; payloadDigest: string;
  bindingDigest: string; contextHashes: string; createdAt: string; expiresAt: string; decidedAt: string | null;
};
type GrantRow = {
  id: string; site: string; scope: ConsentScope; recipient: string; decision: GrantDecision;
  createdAt: string; revokedAt: string | null; revision: number; requestId: string | null;
  bindingDigest: string | null; previewId: string | null; consumedAttemptId: string | null;
};
type AuthorizationRow = {
  id: string; jobId: string; attemptId: string; grantId: string; grantRevision: number; sitePermissionEpoch: number; site: string;
  scope: ConsentScope; recipient: string; provider: 'app-server' | 'mcp-server'; policyKey: string;
  bindingDigest: string; permissionFingerprint: string; eligibilityFingerprint: string | null; egressEventId: string; createdAt: string;
  dispatchedAt: string | null; acceptedAt: string | null; outcome: string | null;
};

/**
 * Durable consent authority on ReaderStore.db. It never opens another database and never accepts
 * grants, sites, scopes or recipients from page/model/skill content during dispatch.
 */
export class ConsentSessionService implements JobConsentAuthority {
  private readonly db: Database.Database;
  private readonly preparation = new AsyncLocalStorage<{ jobId: string; attemptId: string; fingerprint: string; active: boolean }>();

  constructor(reader: Pick<ReaderStore, 'db'>) {
    this.db = reader.db;
    this.migrate();
  }

  private migrate() {
    this.db.transaction(() => {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS consent_previews(
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, requestId TEXT NOT NULL UNIQUE,
        site TEXT NOT NULL, scope TEXT NOT NULL, recipient TEXT NOT NULL, recipientLabel TEXT NOT NULL,
        provider TEXT NOT NULL, policyKey TEXT NOT NULL, payloadDigest TEXT NOT NULL,
        bindingDigest TEXT NOT NULL, contextHashes TEXT NOT NULL,
        createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL, decidedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS consent_grant_state(
        grantId TEXT PRIMARY KEY REFERENCES grants(id), revision INTEGER NOT NULL,
        requestId TEXT, bindingDigest TEXT, previewId TEXT REFERENCES consent_previews(id),
        consumedAttemptId TEXT UNIQUE
      );
      CREATE TABLE IF NOT EXISTS consent_exclusions(
        site TEXT PRIMARY KEY, revision INTEGER NOT NULL, excluded INTEGER NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS consent_attempt_authorizations(
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, attemptId TEXT NOT NULL UNIQUE,
        grantId TEXT NOT NULL REFERENCES grants(id), grantRevision INTEGER NOT NULL,
        sitePermissionEpoch INTEGER NOT NULL DEFAULT 0,
        site TEXT NOT NULL, scope TEXT NOT NULL, recipient TEXT NOT NULL, provider TEXT NOT NULL,
        policyKey TEXT NOT NULL, bindingDigest TEXT NOT NULL, permissionFingerprint TEXT NOT NULL,
        eligibilityFingerprint TEXT,
        egressEventId TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL, dispatchedAt TEXT,
        acceptedAt TEXT, outcome TEXT
      );
      CREATE TABLE IF NOT EXISTS egress_events(
        id TEXT PRIMARY KEY, jobId TEXT NOT NULL, attemptId TEXT NOT NULL UNIQUE,
        grantId TEXT NOT NULL, grantRevision INTEGER NOT NULL, recipient TEXT NOT NULL,
        scope TEXT NOT NULL, provider TEXT NOT NULL, policyKey TEXT NOT NULL,
        contextHashes TEXT NOT NULL, permissionFingerprint TEXT NOT NULL,
        approvedAt TEXT NOT NULL, dispatchedAt TEXT, outcome TEXT,
        fetched TEXT NOT NULL DEFAULT '[]', complete INTEGER NOT NULL DEFAULT 0,
        updatedAt TEXT NOT NULL
      );
      INSERT OR IGNORE INTO migrations(version) VALUES(13);
      `);
      const authorizationColumns = this.db.prepare('PRAGMA table_info(consent_attempt_authorizations)').all() as Array<{ name: string }>;
      if (!authorizationColumns.some(column => column.name === 'sitePermissionEpoch')) {
        this.db.exec('ALTER TABLE consent_attempt_authorizations ADD COLUMN sitePermissionEpoch INTEGER NOT NULL DEFAULT 0');
      }
      if (!authorizationColumns.some(column => column.name === 'eligibilityFingerprint')) {
        this.db.exec('ALTER TABLE consent_attempt_authorizations ADD COLUMN eligibilityFingerprint TEXT');
      }
      this.db.prepare(`INSERT OR IGNORE INTO consent_grant_state
        (grantId,revision,requestId,bindingDigest,previewId,consumedAttemptId)
        SELECT id,1,NULL,NULL,NULL,NULL FROM grants`).run();
    })();
  }

  /** Keeps exact outgoing text only in the returned value; the durable preview stores hashes. */
  prepare(input: PrepareConsentInput): ConsentPreview {
    validatePrepare(input);
    const site = siteFor(input.sourceUrl);
    const payloadDigest = hash(canonical({
      site, scope: input.scope, recipient: input.recipient, provider: input.provider,
      policyKey: input.policyKey, outgoing: input.outgoing.map(part => ({ label: part.label, sha256: part.sha256 })),
    }));
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM consent_previews WHERE requestId=?').get(input.requestId) as PreviewRow | undefined;
      let row = previous;
      if (previous) {
        if (previous.decidedAt) throw new ConsentConflictError('This request already has a consent decision. Prepare a new request for another attempt.');
        if (previous.site !== site || previous.scope !== input.scope || previous.recipient !== input.recipient ||
            previous.provider !== input.provider || previous.policyKey !== input.policyKey ||
            previous.payloadDigest !== payloadDigest || previous.bindingDigest !== input.bindingDigest) {
          throw new ConsentConflictError('This request identifier was already previewed with different outgoing content.');
        }
      } else {
        const now = new Date();
        row = {
          id: randomUUID(), revision: 1, requestId: input.requestId, site, scope: input.scope,
          recipient: input.recipient, recipientLabel: input.recipientLabel, provider: input.provider,
          policyKey: input.policyKey, payloadDigest, bindingDigest: input.bindingDigest,
          contextHashes: JSON.stringify(input.outgoing.map(part => part.sha256)), createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(), decidedAt: null,
        };
        this.db.prepare(`INSERT INTO consent_previews
          (id,revision,requestId,site,scope,recipient,recipientLabel,provider,policyKey,payloadDigest,bindingDigest,contextHashes,createdAt,expiresAt,decidedAt)
          VALUES(@id,@revision,@requestId,@site,@scope,@recipient,@recipientLabel,@provider,@policyKey,@payloadDigest,@bindingDigest,@contextHashes,@createdAt,@expiresAt,@decidedAt)`).run(row);
        this.event('consent-previewed', { previewId: row.id, requestId: row.requestId, site, scope: row.scope, recipient: row.recipient, contextHashes: JSON.parse(row.contextHashes) });
      }
      return previewFrom(row!, input.outgoing, this.previewState(row!));
    })();
  }

  decide(request: ConsentDecisionRequest, principal: ConsentPrincipal): ConsentGrant {
    validatePrincipal(principal);
    if (!ID.test(request.previewId) && !/^[0-9a-f-]{36}$/i.test(request.previewId)) throw new Error('Invalid consent preview identifier.');
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) throw new Error('Invalid consent revision.');
    if (!['this-time', 'always-site', 'never-site'].includes(request.choice)) throw new Error('Invalid consent choice.');
    return this.db.transaction(() => {
      const preview = this.db.prepare('SELECT * FROM consent_previews WHERE id=?').get(request.previewId) as PreviewRow | undefined;
      if (!preview || preview.revision !== request.expectedRevision || preview.decidedAt) throw new ConsentConflictError('This consent preview changed. Review it again.');
      if (Date.parse(preview.expiresAt) <= Date.now()) throw new ConsentConflictError('This consent preview expired. Review the current outgoing text again.');
      if (this.excluded(preview.site)) throw new ConsentDeniedError('This site is excluded. Change the exclusion in Settings first.');
      const denial = this.activeDenial(preview.site, preview.scope, preview.recipient);
      if (denial && request.choice !== 'never-site') throw new ConsentDeniedError('Sending is denied for this site. Edit the denial in Settings first.');

      const now = new Date().toISOString();
      const decision: GrantDecision = request.choice === 'this-time' ? 'allow-once' : request.choice === 'always-site' ? 'allow-site' : 'deny-site';
      if (decision === 'deny-site') {
        this.db.prepare(`UPDATE grants SET revokedAt=? WHERE site=? AND scope=? AND recipient=? AND revokedAt IS NULL`).run(now, preview.site, preview.scope, preview.recipient);
      }
      const grantId = randomUUID();
      this.db.prepare('INSERT INTO grants(id,site,scope,recipient,decision,createdAt,revokedAt) VALUES(?,?,?,?,?,?,NULL)')
        .run(grantId, preview.site, preview.scope, preview.recipient, decision, now);
      this.db.prepare('INSERT INTO consent_grant_state(grantId,revision,requestId,bindingDigest,previewId,consumedAttemptId) VALUES(?,?,?,?,?,NULL)')
        .run(grantId, 1, decision === 'allow-once' ? preview.requestId : null, decision === 'allow-once' ? preview.bindingDigest : null, preview.id);
      this.db.prepare('UPDATE consent_previews SET revision=revision+1,decidedAt=? WHERE id=? AND revision=?').run(now, preview.id, preview.revision);
      this.event('consent-decided', { previewId: preview.id, grantId, decision, site: preview.site, scope: preview.scope, recipient: preview.recipient, principal: principal.surface });
      return this.grant(grantId)!;
    })();
  }

  grants(includeRevoked = true): ConsentGrant[] {
    const rows = this.db.prepare(`SELECT g.*,s.revision,s.requestId,s.bindingDigest,s.previewId,s.consumedAttemptId
      FROM grants g JOIN consent_grant_state s ON s.grantId=g.id ORDER BY g.createdAt,g.id`).all() as GrantRow[];
    return rows.filter(row => includeRevoked || !row.revokedAt).map(grantFrom);
  }

  revokeGrant(grantId: string, expectedRevision: number): ConsentGrant {
    return this.db.transaction(() => {
      const row = this.grantRow(grantId);
      if (!row || row.revision !== expectedRevision) throw new ConsentConflictError('This permission changed. Reload Settings.');
      if (!row.revokedAt) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE grants SET revokedAt=? WHERE id=?').run(now, grantId);
        this.db.prepare('UPDATE consent_grant_state SET revision=revision+1 WHERE grantId=?').run(grantId);
        this.event('consent-grant-revoked', { grantId, revision: row.revision + 1, site: row.site, scope: row.scope, recipient: row.recipient });
      }
      return this.grant(grantId)!;
    })();
  }

  exclusions(): SiteExclusion[] {
    return (this.db.prepare('SELECT site,revision,excluded,updatedAt FROM consent_exclusions ORDER BY site').all() as Array<Omit<SiteExclusion, 'excluded'> & { excluded: number }>)
      .map(row => ({ ...row, excluded: !!row.excluded }));
  }

  setExclusion(rawSite: string, excluded: boolean, expectedRevision?: number): SiteExclusion {
    const site = siteFor(rawSite);
    if (typeof excluded !== 'boolean') throw new Error('Invalid exclusion state.');
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM consent_exclusions WHERE site=?').get(site) as { site: string; revision: number; excluded: number; updatedAt: string } | undefined;
      if (current ? expectedRevision === undefined || current.revision !== expectedRevision : expectedRevision !== undefined) {
        throw new ConsentConflictError('This exclusion changed. Reload Settings.');
      }
      const revision = (current?.revision ?? 0) + 1, now = new Date().toISOString();
      this.db.prepare(`INSERT INTO consent_exclusions(site,revision,excluded,updatedAt) VALUES(?,?,?,?)
        ON CONFLICT(site) DO UPDATE SET revision=excluded.revision,excluded=excluded.excluded,updatedAt=excluded.updatedAt`)
        .run(site, revision, excluded ? 1 : 0, now);
      this.event('consent-exclusion-changed', { site, revision, excluded });
      return { site, revision, excluded, updatedAt: now };
    })();
  }

  async revalidate(job: Readonly<JobSnapshot>, stage: JobConsentStage): Promise<JobConsentDecision & { eligibilityFingerprint?: string }> {
    const attemptId = job.latestAttemptId;
    if (!attemptId) throw new ConsentDeniedError('A unique attempt is required before consent can be checked.');
    const existing = this.authorizationRow(attemptId);
    if (stage === 'commit' || existing) {
      const authorization = this.requireCurrent(job, attemptId, true);
      return { grantId: authorization.grantId, policyKey: authorization.policyKey, auditScope: authorization.permissionFingerprint };
    }
    const eligibility = this.dispatchEligibility(job, attemptId);
    return { grantId: eligibility.grant.id, policyKey: job.policyKey, auditScope: eligibility.auditScope,
      eligibilityFingerprint: eligibility.eligibilityFingerprint };
  }

  assertSharedDatabase(database: unknown): void {
    if (database !== this.db) throw new ConsentDeniedError('Consent and job dispatch must share the exact database connection.');
  }

  /** Caller-owned JobStore transaction atomically finalizes consent and provider handoff markers. */
  finalizeDispatch(job: Readonly<JobSnapshot>, attemptId: string, expectedEligibilityFingerprint: string): ConsentAuthorization {
    if (!this.db.inTransaction) throw new ConsentDeniedError('Dispatch consent must be finalized inside the caller-owned job transaction.');
    if (!isDigest(expectedEligibilityFingerprint)) throw new ConsentDeniedError('Dispatch eligibility is missing or invalid.');
    if (this.authorizationRow(attemptId)) throw new ConsentDeniedError('This attempt was already finalized for dispatch.');
    const eligibility = this.dispatchEligibility(job, attemptId);
    if (eligibility.eligibilityFingerprint !== expectedEligibilityFingerprint) {
      throw new ConsentDeniedError('Dispatch eligibility changed; start a new attempt.');
    }
    const { grant, site, scope, sitePermissionEpoch, auditScope, contextHashes } = eligibility;
    if (grant.decision === 'allow-once') {
      const update = this.db.prepare(`UPDATE consent_grant_state SET consumedAttemptId=?
        WHERE grantId=? AND revision=? AND consumedAttemptId IS NULL`).run(attemptId, grant.id, grant.revision);
      if (update.changes !== 1) throw new ConsentDeniedError('This-time permission was already used by another attempt.');
    }
    const now = new Date().toISOString(), authorizationId = randomUUID(), egressEventId = randomUUID();
    this.db.prepare(`INSERT INTO consent_attempt_authorizations
      (id,jobId,attemptId,grantId,grantRevision,sitePermissionEpoch,site,scope,recipient,provider,policyKey,bindingDigest,permissionFingerprint,eligibilityFingerprint,egressEventId,createdAt,dispatchedAt,acceptedAt,outcome)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`)
      .run(authorizationId, job.id, attemptId, grant.id, grant.revision, sitePermissionEpoch, site, scope, grant.recipient,
        job.provider, job.policyKey, job.preparedPayloadDigest, auditScope, expectedEligibilityFingerprint, egressEventId, now, now, 'dispatched');
    this.db.prepare(`INSERT INTO egress_events
      (id,jobId,attemptId,grantId,grantRevision,recipient,scope,provider,policyKey,contextHashes,permissionFingerprint,approvedAt,dispatchedAt,outcome,fetched,complete,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',0,?)`)
      .run(egressEventId, job.id, attemptId, grant.id, grant.revision, grant.recipient, scope, job.provider, job.policyKey,
        JSON.stringify(contextHashes), auditScope, now, now, 'dispatched', now);
    this.event('egress-approved', { egressEventId, jobId: job.id, attemptId, grantId: grant.id, grantRevision: grant.revision,
      sitePermissionEpoch, recipient: grant.recipient, scope, provider: job.provider, contextHashes });
    this.event('egress-dispatched', { egressEventId, jobId: job.id, attemptId });
    return this.authorization(attemptId)!;
  }

  /** Isolate parallel attempts and revoke escaped asynchronous preparation callbacks on exit. */
  async withProviderPreparation<T>(job: Readonly<JobSnapshot>, attemptId: string, observe: () => Promise<T>): Promise<T> {
    const eligibility = this.dispatchEligibility(job, attemptId);
    const scope = { jobId: job.id, attemptId, fingerprint: eligibility.eligibilityFingerprint, active: true };
    try { return await this.preparation.run(scope, observe); }
    finally { scope.active = false; }
  }

  /** Evidence preparation is explicitly non-dispatched. Outside its host-only scope, the
   * existing recovery and acceptance paths still require a real durable authorization. */
  currentAuthorization(job: Readonly<JobSnapshot>, attemptId: string, requireDispatched = true): ConsentAuthorization | PreparationAuthorization {
    const scope = this.preparation.getStore();
    if (scope?.active && scope.jobId === job.id && scope.attemptId === attemptId && !this.authorizationRow(attemptId)) {
      const current = this.dispatchEligibility(job, attemptId);
      if (current.eligibilityFingerprint !== scope.fingerprint) throw new ConsentDeniedError('Provider preparation permission changed.');
      return preparationAuthorization({ jobId: job.id, attemptId, grantId: current.grant.id, grantRevision: current.grant.revision,
        sitePermissionEpoch: current.sitePermissionEpoch, site: current.site, scope: current.scope, recipient: current.grant.recipient,
        provider: job.provider, policyKey: job.policyKey, bindingDigest: job.preparedPayloadDigest,
        permissionFingerprint: current.auditScope, eligibilityFingerprint: current.eligibilityFingerprint });
    }
    return this.db.transaction(() => this.requireCurrent(job, attemptId, requireDispatched))();
  }

  /** T06 passes JobStore.succeed as commit; both fences then share the same SQLite transaction. */
  withResultAcceptance<T>(job: Readonly<JobSnapshot>, attemptId: string, commit: () => T): T {
    return this.db.transaction(() => {
      const authorization = this.requireCurrent(job, attemptId, true);
      const result = commit();
      const now = new Date().toISOString();
      this.db.prepare('UPDATE consent_attempt_authorizations SET acceptedAt=?,outcome=? WHERE attemptId=?').run(now, 'accepted', attemptId);
      this.db.prepare('UPDATE egress_events SET outcome=?,updatedAt=? WHERE id=?').run('accepted', now, authorization.egressEventId);
      this.event('egress-outcome', { egressEventId: authorization.egressEventId, jobId: job.id, attemptId, outcome: 'accepted' });
      return result;
    })();
  }

  recordOutcome(attemptId: string, outcome: string) {
    if (!outcome || outcome.length > 100) throw new Error('Invalid egress outcome.');
    this.db.transaction(() => {
      const authorization = this.authorizationRow(attemptId);
      if (!authorization) return;
      if (authorization.outcome === 'accepted') return;
      const now = new Date().toISOString();
      this.db.prepare('UPDATE consent_attempt_authorizations SET outcome=? WHERE attemptId=?').run(outcome, attemptId);
      this.db.prepare('UPDATE egress_events SET outcome=?,updatedAt=? WHERE id=?').run(outcome, now, authorization.egressEventId);
      this.event('egress-outcome', { egressEventId: authorization.egressEventId, jobId: authorization.jobId, attemptId, outcome });
    })();
  }

  recordFetchedResources(attemptId: string, fetched: readonly FetchedResourceRecord[], complete: boolean) {
    if (!Array.isArray(fetched) || fetched.length > 100 || typeof complete !== 'boolean') throw new Error('Invalid fetched-resource record.');
    const safe = structuredClone(fetched);
    for (const item of safe) if ((item.outcome === 'fetched' ? !item.sha256 || !isDigest(item.sha256) : item.sha256 !== null) || item.bytes < 0 || !Number.isSafeInteger(item.bytes)) throw new Error('Invalid fetched-resource record.');
    this.db.transaction(() => {
      const authorization = this.authorizationRow(attemptId);
      if (!authorization) throw new Error('No authorized egress attempt exists.');
      const now = new Date().toISOString();
      this.db.prepare('UPDATE egress_events SET fetched=?,complete=?,updatedAt=? WHERE id=?').run(JSON.stringify(safe), complete ? 1 : 0, now, authorization.egressEventId);
      this.event('egress-fetches-recorded', { egressEventId: authorization.egressEventId, attemptId, count: safe.length, complete });
    })();
  }

  egress(jobId?: string): EgressRecord[] {
    const rows = this.db.prepare(`SELECT * FROM egress_events ${jobId ? 'WHERE jobId=?' : ''} ORDER BY approvedAt,id`).all(...(jobId ? [jobId] : [])) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.id), jobId: String(row.jobId), attemptId: String(row.attemptId), grantId: String(row.grantId),
      grantRevision: Number(row.grantRevision), recipient: String(row.recipient), scope: row.scope as ConsentScope,
      provider: row.provider as 'app-server' | 'mcp-server', policyKey: String(row.policyKey),
      contextHashes: JSON.parse(String(row.contextHashes)) as string[], permissionFingerprint: String(row.permissionFingerprint),
      approvedAt: String(row.approvedAt), ...(row.dispatchedAt ? { dispatchedAt: String(row.dispatchedAt) } : {}),
      ...(row.outcome ? { outcome: String(row.outcome) } : {}), fetched: JSON.parse(String(row.fetched)) as FetchedResourceRecord[],
      retrievalComplete: !!row.complete,
    }));
  }

  private requireCurrent(job: Readonly<JobSnapshot>, attemptId: string, requireDispatched: boolean): ConsentAuthorization {
    validateJobBinding(job, attemptId);
    const row = this.authorizationRow(attemptId);
    if (!row || row.jobId !== job.id || row.grantId !== job.grantId || row.policyKey !== job.policyKey || row.provider !== job.provider || row.bindingDigest !== job.preparedPayloadDigest) {
      throw new ConsentDeniedError('Attempt authorization does not match the current request.');
    }
    if (requireDispatched && !row.dispatchedAt) throw new ConsentDeniedError('This attempt was never marked as dispatched.');
    if (this.excluded(row.site)) throw new ConsentDeniedError('This site is now excluded.');
    if (row.sitePermissionEpoch !== this.sitePermissionEpoch(row.site)) throw new ConsentDeniedError('The site permission changed; review and start a new attempt.');
    const grant = this.grantRow(row.grantId);
    if (!grant || grant.revokedAt || grant.revision !== row.grantRevision || grant.decision === 'deny-site' || this.activeDenial(row.site, row.scope, row.recipient)) {
      throw new ConsentDeniedError('Permission was revoked or replaced.');
    }
    const fingerprint = hash(canonical([grant.id, grant.revision, row.sitePermissionEpoch, job.provider, job.policyKey, row.scope, row.recipient]));
    if (fingerprint !== row.permissionFingerprint) throw new ConsentDeniedError('The provider or permission changed; start a new provider session.');
    const eligibilityFingerprint = this.eligibilityFingerprint(job, attemptId, grant, row.site, row.scope, row.sitePermissionEpoch);
    if (!row.eligibilityFingerprint || eligibilityFingerprint !== row.eligibilityFingerprint) {
      throw new ConsentDeniedError('The dispatched request manifest changed; start a new attempt.');
    }
    this.contextHashes(job, row.site, row.scope, row.recipient);
    return authorizationFrom(row);
  }

  private dispatchEligibility(job: Readonly<JobSnapshot>, attemptId: string) {
    validateJobBinding(job, attemptId);
    const site = siteFor(job.context.sourceUrl), scope = scopeForIntent(job.context.intent);
    if (this.excluded(site)) throw new ConsentDeniedError('This site is excluded. Nothing was sent.');
    const grant = this.grantRow(job.grantId);
    if (!grant || grant.revokedAt || grant.site !== site || grant.scope !== scope || grant.decision === 'deny-site') {
      throw new ConsentDeniedError('Current permission does not authorize this request.');
    }
    if (this.activeDenial(site, scope, grant.recipient)) throw new ConsentDeniedError('Sending is denied for this site.');
    if (grant.decision === 'allow-once') {
      if (!grant.requestId || !grant.bindingDigest || grant.requestId !== job.id || grant.bindingDigest !== job.preparedPayloadDigest) {
        throw new ConsentDeniedError('This-time permission is bound to different outgoing content.');
      }
      if (grant.consumedAttemptId) throw new ConsentDeniedError('This-time permission was already used by another attempt.');
    }
    const sitePermissionEpoch = this.sitePermissionEpoch(site);
    const contextHashes = this.contextHashes(job, site, scope, grant.recipient);
    const auditScope = hash(canonical([grant.id, grant.revision, sitePermissionEpoch, job.provider, job.policyKey, scope, grant.recipient]));
    return { grant, site, scope, sitePermissionEpoch, contextHashes, auditScope,
      eligibilityFingerprint: this.eligibilityFingerprint(job, attemptId, grant, site, scope, sitePermissionEpoch) };
  }

  private eligibilityFingerprint(job: Readonly<JobSnapshot>, attemptId: string, grant: GrantRow, site: string,
      scope: ConsentScope, sitePermissionEpoch: number): string {
    // Match the JSON form persisted by JobStore: absent optional context fields are omitted.
    const immutable = JSON.parse(JSON.stringify({ jobId: job.id, threadId: job.threadId, packetDigest: job.packetDigest,
      model: job.model, mode: job.mode, context: job.context })) as unknown;
    return hash(canonical({ version: 'marginalia.dispatch-eligibility.v2', grantId: grant.id, grantRevision: grant.revision,
      sitePermissionEpoch, site, scope, recipient: grant.recipient, provider: job.provider, policyKey: job.policyKey,
      preparedPayloadDigest: job.preparedPayloadDigest, immutable, attemptId }));
  }

  private previewState(preview: PreviewRow): ConsentPreview['state'] {
    if (this.excluded(preview.site)) return 'excluded';
    return this.activeDenial(preview.site, preview.scope, preview.recipient) ? 'denied' : 'ready';
  }
  private excluded(site: string) {
    return !!(this.db.prepare('SELECT excluded FROM consent_exclusions WHERE site=?').get(site) as { excluded: number } | undefined)?.excluded;
  }
  private sitePermissionEpoch(site: string): number {
    return (this.db.prepare('SELECT revision FROM consent_exclusions WHERE site=?').get(site) as { revision: number } | undefined)?.revision ?? 0;
  }
  private activeDenial(site: string, scope: ConsentScope, recipient: string) {
    return this.db.prepare(`SELECT id FROM grants
      WHERE site=? AND scope=? AND recipient=? AND decision='deny-site' AND revokedAt IS NULL
      ORDER BY createdAt DESC,id DESC LIMIT 1`).get(site, scope, recipient) as { id: string } | undefined;
  }
  private grantRow(id: string) {
    return this.db.prepare(`SELECT g.*,s.revision,s.requestId,s.bindingDigest,s.previewId,s.consumedAttemptId
      FROM grants g JOIN consent_grant_state s ON s.grantId=g.id WHERE g.id=?`).get(id) as GrantRow | undefined;
  }
  private grant(id: string) { const row = this.grantRow(id); return row ? grantFrom(row) : undefined; }
  private authorizationRow(attemptId: string) {
    return this.db.prepare('SELECT * FROM consent_attempt_authorizations WHERE attemptId=?').get(attemptId) as AuthorizationRow | undefined;
  }
  private authorization(attemptId: string) { const row = this.authorizationRow(attemptId); return row ? authorizationFrom(row) : undefined; }
  private contextHashes(job: Readonly<JobSnapshot>, site: string, scope: ConsentScope, recipient: string): string[] {
    // An allow-site grant outlives the preview that created it. Audit the current
    // prepared request, never that original preview or a digest from another job.
    const row = this.db.prepare('SELECT * FROM consent_previews WHERE requestId=? AND bindingDigest=?')
      .get(job.id, job.preparedPayloadDigest) as PreviewRow | undefined;
    if (!row || row.site !== site || row.scope !== scope || row.recipient !== recipient ||
        row.provider !== job.provider || row.policyKey !== job.policyKey) {
      throw new ConsentDeniedError('The current outgoing preview does not match this request. Review it again.');
    }
    const hashes: unknown = JSON.parse(row.contextHashes);
    if (!Array.isArray(hashes) || hashes.length < 1 || hashes.length > 16 ||
        hashes.some(value => typeof value !== 'string' || !isDigest(value))) {
      throw new ConsentDeniedError('The current outgoing preview hashes are unavailable. Review it again.');
    }
    return hashes;
  }
  private event(kind: string, value: unknown) {
    this.db.prepare('INSERT INTO events(kind,payload,createdAt) VALUES(?,?,?)').run(kind, JSON.stringify(value), new Date().toISOString());
  }
}

export class ConsentDeniedError extends Error { override name = 'ConsentDenied'; }
export class ConsentConflictError extends Error { override name = 'ConsentConflict'; }

function validatePrepare(input: PrepareConsentInput) {
  if (!input || typeof input !== 'object' || !ID.test(input.requestId) || !isDigest(input.bindingDigest) || !isDigest(input.policyKey)) throw new Error('Invalid consent request binding.');
  siteFor(input.sourceUrl);
  if (!['cloud-inference', 'open-session'].includes(input.scope) || !['app-server', 'mcp-server'].includes(input.provider)) throw new Error('Invalid consent scope or provider.');
  if (!input.recipient || input.recipient.length > 200 || !input.recipientLabel || input.recipientLabel.length > 200) throw new Error('Invalid consent recipient.');
  if (!Array.isArray(input.outgoing) || input.outgoing.length < 1 || input.outgoing.length > 16) throw new Error('Invalid outgoing preview.');
  let bytes = 0;
  for (const part of input.outgoing) {
    if (!part || !part.label || part.label.length > 100 || typeof part.text !== 'string' || !isDigest(part.sha256) || hash(part.text) !== part.sha256) throw new Error('Outgoing preview text and hash do not match.');
    bytes += Buffer.byteLength(part.text);
  }
  if (bytes > 64 * 1024) throw new Error('Outgoing preview is too large.');
}
function validatePrincipal(principal: ConsentPrincipal) {
  if (!principal || !['browser-owned-margin', 'localhost-settings'].includes(principal.surface) || !ID.test(principal.pairingId)) throw new ConsentDeniedError('Consent decisions require an authenticated browser-owned surface.');
  const origin = new URL(principal.origin);
  const browserOwned = principal.surface === 'browser-owned-margin' && ['chrome-extension:', 'moz-extension:'].includes(origin.protocol);
  const settings = principal.surface === 'localhost-settings' && origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  if (!browserOwned && !settings) throw new ConsentDeniedError('This surface cannot grant permission.');
}
function validateJobBinding(job: Readonly<JobSnapshot>, attemptId: string) {
  if (!job || !ID.test(job.id) || !ID.test(attemptId) || job.latestAttemptId !== attemptId || !isDigest(job.preparedPayloadDigest) || !isDigest(job.policyKey)) throw new ConsentDeniedError('Consent requires the current persisted attempt and policy.');
}
function previewFrom(row: PreviewRow, outgoing: PrepareConsentInput['outgoing'], state: ConsentPreview['state']): ConsentPreview {
  return { id: row.id, revision: row.revision, requestId: row.requestId, site: row.site, scope: row.scope,
    scopeLabel: row.scope === 'open-session' ? 'Codex and separate web access for this site' : 'Codex for this site',
    recipient: row.recipient, recipientLabel: row.recipientLabel, provider: row.provider, policyKey: row.policyKey,
    outgoing: structuredClone(outgoing), payloadDigest: row.payloadDigest, bindingDigest: row.bindingDigest,
    expiresAt: row.expiresAt, state };
}
function grantFrom(row: GrantRow): ConsentGrant {
  return { id: row.id, site: row.site, scope: row.scope, recipient: row.recipient, decision: row.decision,
    revision: row.revision, ...(row.requestId ? { requestId: row.requestId } : {}),
    ...(row.bindingDigest ? { bindingDigest: row.bindingDigest } : {}), createdAt: row.createdAt,
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}) };
}
function authorizationFrom(row: AuthorizationRow): ConsentAuthorization {
  return { id: row.id, jobId: row.jobId, attemptId: row.attemptId, grantId: row.grantId,
    grantRevision: row.grantRevision, sitePermissionEpoch: row.sitePermissionEpoch, site: row.site, scope: row.scope, recipient: row.recipient,
    provider: row.provider, policyKey: row.policyKey, bindingDigest: row.bindingDigest,
    permissionFingerprint: row.permissionFingerprint, egressEventId: row.egressEventId,
    ...(row.dispatchedAt ? { dispatchedAt: row.dispatchedAt } : {}) };
}
function scopeForIntent(intent: string): ConsentScope { return intent === 'evidence' || intent === 'explore' ? 'open-session' : 'cloud-inference'; }
function siteFor(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('A valid source URL is required.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only ordinary HTTP(S) reading sites can receive grants.');
  return url.origin;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
