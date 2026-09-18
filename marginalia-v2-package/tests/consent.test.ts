import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ConsentSessionService } from '../daemon/consent/service.ts';
import { mountConsentSheet } from '../ui/consent.ts';
import type { ConsentGrant, ConsentPreview, PrepareConsentInput } from '../contracts/consent.ts';
import type { JobSnapshot } from '../contracts/jobs.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function request(id: string, text = id): PrepareConsentInput {
  return { requestId: id, sourceUrl: 'https://papers.example.org/article', scope: 'cloud-inference', recipient: 'openai-codex', recipientLabel: 'OpenAI Codex', provider: 'app-server', policyKey: hash('policy'), bindingDigest: hash('envelope:' + text), outgoing: [{ label: 'Selected passage', text, sha256: hash(text) }] };
}
const principal = { surface: 'localhost-settings' as const, pairingId: 'test-pair', origin: 'http://127.0.0.1:43120' };
/** The immutable fields mirror a durable job; lifecycle fields can change during preparation. */
function job(prepared: PrepareConsentInput, grant: ConsentGrant, attempt = prepared.requestId + '-attempt'): JobSnapshot {
  return { id: prepared.requestId, threadId: 'thread', idempotencyKey: 'key-' + prepared.requestId,
    packetDigest: hash('packet:' + prepared.requestId), latestAttemptId: attempt, grantId: grant.id,
    provider: prepared.provider, model: 'model', mode: 'workspace-files', state: 'queued', cancelRequested: false,
    createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z', attempts: [],
    policyKey: prepared.policyKey, preparedPayloadDigest: prepared.bindingDigest, context: {
      threadId: 'thread', sourceVersionId: 'source-version', sourceUrl: prepared.sourceUrl,
      sourceTitle: 'Paper', sourcePageType: 'article', sourceCapturedAt: null, sourceHash: hash('source'),
      sourceText: 'passage', passage: { exact: 'passage', prefix: '', suffix: '', start: 0, end: 7 },
      question: prepared.requestId, intent: 'define', preparedPayloadDigest: prepared.bindingDigest,
      modelSettingsRevision: 1, modelCompatibilityKey: 'model-key', outgoing: {
        schema: 'marginalia.job-packet.v1', intent: 'define', question: prepared.requestId,
        source: { url: prepared.sourceUrl, title: 'Paper', pageType: 'article', capturedAt: null,
          sourceHash: hash('source'), sourceVersionId: 'source-version' },
        selection: { exact: 'passage', prefix: '', suffix: '', start: 0, end: 7, originalEnd: 7, omittedCharacters: 0 },
        adjacentContext: { before: '', after: '', basis: 'bounded-character-context' },
        availableCapabilities: [], omissions: [],
      },
    } };
}
async function rawDatabase(t: TestContext) {
  // Use the production SQLite driver, not an in-memory imitation of transactions.
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE grants(id TEXT PRIMARY KEY,site TEXT,scope TEXT,recipient TEXT,decision TEXT,createdAt TEXT,revokedAt TEXT);
    CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,payload TEXT,createdAt TEXT);`);
  t.after(() => db.close());
  return db;
}
async function database(t: TestContext) {
  const db = await rawDatabase(t);
  return { db, service: new ConsentSessionService({ db }) };
}
function grant(service: ConsentSessionService, prepared: PrepareConsentInput, choice: 'always-site' | 'this-time' = 'always-site') {
  const preview = service.prepare(prepared);
  return service.decide({ previewId: preview.id, expectedRevision: preview.revision, choice }, principal);
}
async function eligible(service: ConsentSessionService, current: JobSnapshot) {
  const decision = await service.revalidate(current, 'dispatch');
  assert.match(decision.eligibilityFingerprint ?? '', /^[a-f0-9]{64}$/);
  return decision;
}
function finalize(service: ConsentSessionService, db: Awaited<ReturnType<typeof rawDatabase>>, current: JobSnapshot, token: string) {
  return db.transaction(() => service.finalizeDispatch(current, current.latestAttemptId!, token))();
}
function counts(db: Awaited<ReturnType<typeof rawDatabase>>) {
  return {
    authorizations: (db.prepare('SELECT COUNT(*) n FROM consent_attempt_authorizations').get() as { n: number }).n,
    egress: (db.prepare('SELECT COUNT(*) n FROM egress_events').get() as { n: number }).n,
  };
}

test('database: eligibility is non-consuming and finalization records the current preview in the caller transaction', async t => {
  const { service, db } = await database(t), a = request('request-a', 'first passage'), permission = grant(service, a);
  const first = job(a, permission), firstDecision = await eligible(service, first);
  assert.deepEqual(counts(db), { authorizations: 0, egress: 0 });
  finalize(service, db, first, firstDecision.eligibilityFingerprint!);
  const b = request('request-b', 'different passage');
  b.outgoing.push({ label: 'Your note', text: 'current note', sha256: hash('current note') });
  service.prepare(b);
  const second = job(b, permission), secondDecision = await eligible(service, second);
  finalize(service, db, second, secondDecision.eligibilityFingerprint!);
  assert.deepEqual(service.egress(first.id)[0].contextHashes, a.outgoing.map(part => part.sha256));
  assert.deepEqual(service.egress(second.id)[0].contextHashes, b.outgoing.map(part => part.sha256));
  assert.throws(() => finalize(service, db, second, secondDecision.eligibilityFingerprint!), /already finalized/);
  assert.equal(service.egress(second.id).length, 1, 'uncertain handoff cannot be retried or refunded');
});

test('database: eligibility and preparation failures leave a one-shot grant unconsumed with no egress', async t => {
  const { service, db } = await database(t), a = request('request-a'), permission = grant(service, a);
  const once = request('once'), oncePermission = grant(service, once, 'this-time'), currentOnce = job(once, oncePermission);
  await eligible(service, currentOnce);
  assert.throws(() => { throw new Error('provider preparation failed'); }, /provider preparation failed/);
  assert.equal((db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(oncePermission.id) as { consumedAttemptId: string | null }).consumedAttemptId, null);
  assert.deepEqual(counts(db), { authorizations: 0, egress: 0 });

  const b = request('request-b'); service.prepare(b);
  const cases = [job(request('not-previewed'), permission), job({ ...b, bindingDigest: hash('wrong') }, permission), job({ ...b, requestId: 'other', bindingDigest: b.bindingDigest }, permission)];
  for (const current of cases) {
    await assert.rejects(service.revalidate(current, 'dispatch'), /current outgoing preview/);
    assert.equal(service.egress(current.id).length, 0);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM consent_attempt_authorizations').get() as { n: number }).n, 0);
});

test('database: preview authority metadata must match and failed checks do not consume a one-shot grant', async t => {
  const { service, db } = await database(t), prepared = request('once'), permission = grant(service, prepared, 'this-time'), current = job(prepared, permission);
  for (const [column, value] of [['site', 'https://other.example.org'], ['scope', 'open-session'], ['recipient', 'other-provider'], ['provider', 'mcp-server'], ['policyKey', hash('other-policy')], ['contextHashes', '[]']] as const) {
    const original = (db.prepare(`SELECT ${column} AS value FROM consent_previews WHERE requestId=?`).get(prepared.requestId) as { value: string }).value;
    db.prepare(`UPDATE consent_previews SET ${column}=? WHERE requestId=?`).run(value, prepared.requestId);
    await assert.rejects(service.revalidate(current, 'dispatch'), /current outgoing preview/);
    assert.equal((db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(permission.id) as { consumedAttemptId: string | null }).consumedAttemptId, null);
    assert.equal(service.egress().length, 0);
    db.prepare(`UPDATE consent_previews SET ${column}=? WHERE requestId=?`).run(original, prepared.requestId);
  }
  const decision = await eligible(service, current);
  finalize(service, db, current, decision.eligibilityFingerprint!);
  await assert.rejects(service.revalidate({ ...current, latestAttemptId: 'another-attempt' }, 'dispatch'), /already used/);
  service.revokeGrant(permission.id, permission.revision);
  assert.throws(() => service.currentAuthorization(current, current.latestAttemptId!, false), /revoked/);
});

test('database: caller transaction rollback restores consumption, authorization, egress and dispatch markers', async t => {
  const { service, db } = await database(t), prepared = request('rollback'), permission = grant(service, prepared, 'this-time');
  const current = job(prepared, permission), decision = await eligible(service, current);
  assert.throws(() => db.transaction(() => {
    service.finalizeDispatch(current, current.latestAttemptId!, decision.eligibilityFingerprint!);
    throw new Error('job callback failed');
  })(), /job callback failed/);
  assert.equal((db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(permission.id) as { consumedAttemptId: string | null }).consumedAttemptId, null);
  assert.deepEqual(counts(db), { authorizations: 0, egress: 0 });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM events WHERE kind IN ('egress-approved','egress-dispatched')").get() as { n: number }).n, 0);
});

test('database: competing attempts can both qualify but only one spends a one-shot grant', async t => {
  const { service, db } = await database(t), prepared = request('race'), permission = grant(service, prepared, 'this-time');
  const first = job(prepared, permission, 'attempt-one'), second = job(prepared, permission, 'attempt-two');
  const firstDecision = await eligible(service, first), secondDecision = await eligible(service, second);
  finalize(service, db, first, firstDecision.eligibilityFingerprint!);
  assert.throws(() => finalize(service, db, first, firstDecision.eligibilityFingerprint!), /already finalized/);
  assert.throws(() => finalize(service, db, second, secondDecision.eligibilityFingerprint!), /already used/);
  assert.equal((db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(permission.id) as { consumedAttemptId: string }).consumedAttemptId, 'attempt-one');
  assert.deepEqual(counts(db), { authorizations: 1, egress: 1 });
});

test('database: finalization rejects permission, exclusion, manifest and attempt drift after eligibility', async t => {
  {
    const { service, db } = await database(t), prepared = request('revoked'), permission = grant(service, prepared);
    const current = job(prepared, permission), decision = await eligible(service, current);
    service.revokeGrant(permission.id, permission.revision);
    assert.throws(() => finalize(service, db, current, decision.eligibilityFingerprint!), /authorize|revoked|replaced/);
  }
  {
    const { service, db } = await database(t), prepared = request('excluded'), permission = grant(service, prepared);
    const current = job(prepared, permission), decision = await eligible(service, current);
    service.setExclusion('https://papers.example.org', true);
    assert.throws(() => finalize(service, db, current, decision.eligibilityFingerprint!), /excluded/);
  }
  {
    const { service, db } = await database(t), prepared = request('manifest'), permission = grant(service, prepared);
    const current = job(prepared, permission), decision = await eligible(service, current);
    const changed = structuredClone(current); changed.context.outgoing.question = 'changed after eligibility';
    assert.throws(() => finalize(service, db, changed, decision.eligibilityFingerprint!), /eligibility changed/);
  }
  {
    const { service, db } = await database(t), prepared = request('attempt'), permission = grant(service, prepared);
    const current = job(prepared, permission, 'attempt-before'), decision = await eligible(service, current);
    const changed = { ...current, latestAttemptId: 'attempt-after' };
    assert.throws(() => finalize(service, db, changed, decision.eligibilityFingerprint!), /eligibility changed/);
  }
});

test('database: finalization requires the shared caller-owned transaction and post-finalization checks are read-only', async t => {
  const { service, db } = await database(t), other = await rawDatabase(t), prepared = request('boundary'), permission = grant(service, prepared);
  const current = job(prepared, permission), decision = await eligible(service, current);
  service.assertSharedDatabase(db);
  assert.throws(() => service.assertSharedDatabase(other), /exact database connection/);
  assert.throws(() => service.finalizeDispatch(current, current.latestAttemptId!, decision.eligibilityFingerprint!), /caller-owned job transaction/);
  const authorization = finalize(service, db, current, decision.eligibilityFingerprint!);
  assert.ok(authorization.dispatchedAt);
  const before = { ...counts(db), events: (db.prepare('SELECT COUNT(*) n FROM events').get() as { n: number }).n };
  const checked = await service.revalidate(current, 'dispatch');
  assert.equal(checked.auditScope, authorization.permissionFingerprint);
  assert.equal(checked.eligibilityFingerprint, undefined);
  const committed = await service.revalidate(current, 'commit');
  assert.equal(committed.auditScope, authorization.permissionFingerprint);
  assert.deepEqual({ ...counts(db), events: (db.prepare('SELECT COUNT(*) n FROM events').get() as { n: number }).n }, before);
  const changed = structuredClone(current); changed.context.outgoing.question = 'changed after dispatch';
  await assert.rejects(service.revalidate(changed, 'dispatch'), /manifest changed/);
  assert.throws(() => finalize(service, db, current, decision.eligibilityFingerprint!), /already finalized/);
  assert.deepEqual(counts(db), { authorizations: 1, egress: 1 });
});

test('database: same manifest token cannot cross jobs or immutable bindings', async t => {
  const { service, db } = await database(t), firstRequest = request('token-first', 'same'), permission = grant(service, firstRequest);
  const secondRequest = request('token-second', 'same'); service.prepare(secondRequest);
  const first = job(firstRequest, permission), second = job(secondRequest, permission, first.latestAttemptId);
  // Keep the context and outgoing manifest identical to isolate the job identifier.
  second.context = structuredClone(first.context);
  second.packetDigest = first.packetDigest;
  const firstToken = (await eligible(service, first)).eligibilityFingerprint!;
  const secondToken = (await eligible(service, second)).eligibilityFingerprint!;
  assert.notEqual(firstToken, secondToken);
  assert.throws(() => finalize(service, db, second, firstToken), /eligibility changed/);
  const mutations: Array<(value: JobSnapshot) => void> = [
    value => { value.threadId = 'other-thread'; },
    value => { value.packetDigest = hash('different-packet'); },
    value => { value.model = 'different-model'; },
    value => { value.mode = 'structured-final'; },
    value => { value.context.sourceText = 'changed frozen source'; },
    value => { value.context.outgoing.question = 'changed outgoing'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(first); mutate(changed);
    assert.throws(() => finalize(service, db, changed, firstToken), /eligibility changed/);
  }
  assert.deepEqual(counts(db), { authorizations: 0, egress: 0 });
});

test('database: postfinalization checks reject immutable drift but allow lifecycle progress', async t => {
  const { service, db } = await database(t), prepared = request('post-final'), permission = grant(service, prepared, 'this-time');
  const current = job(prepared, permission), token = (await eligible(service, current)).eligibilityFingerprint!;
  const progressing = structuredClone(current);
  progressing.state = 'preparing'; progressing.updatedAt = '2026-09-17T00:01:00Z';
  progressing.attempts = [{ id: current.latestAttemptId!, jobId: current.id, number: 1, state: 'preparing', revision: 0,
    dispatchClaimed: false, handoffMarked: false, workspacePrepared: true, authorizationFingerprint: hash('authorization'),
    predecessorAttemptId: 'predecessor' }];
  assert.equal((await eligible(service, progressing)).eligibilityFingerprint, token);
  finalize(service, db, progressing, token);
  progressing.state = 'sending'; progressing.attempts[0].handoffMarked = true;
  assert.equal((await service.revalidate(progressing, 'dispatch')).eligibilityFingerprint, undefined);
  service.currentAuthorization(progressing, progressing.latestAttemptId!);
  const changed = structuredClone(progressing); changed.context.sourceText = 'altered after dispatch';
  await assert.rejects(service.revalidate(changed, 'dispatch'), /manifest changed/);
  assert.throws(() => service.currentAuthorization(changed, changed.latestAttemptId!), /manifest changed/);
  assert.deepEqual(counts(db), { authorizations: 1, egress: 1 });
});

test('database: active deny-site row denies even without a grant-state sidecar', async t => {
  const { service, db } = await database(t), prepared = request('sidecar-denial'), permission = grant(service, prepared);
  db.prepare('INSERT INTO grants(id,site,scope,recipient,decision,createdAt,revokedAt) VALUES(?,?,?,?,?,?,NULL)')
    .run('legacy-deny-without-sidecar', permission.site, permission.scope, permission.recipient, 'deny-site', '2026-09-17T00:00:00Z');
  assert.equal(db.prepare('SELECT 1 FROM consent_grant_state WHERE grantId=?').get('legacy-deny-without-sidecar'), undefined);
  await assert.rejects(service.revalidate(job(prepared, permission), 'dispatch'), /denied/);
  assert.deepEqual(counts(db), { authorizations: 0, egress: 0 });
});

test('migration: legacy grants are backfilled once without inventing one-shot bindings or hiding denials', async t => {
  const db = await rawDatabase(t), now = '2026-09-17T00:00:00.000Z';
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run('legacy-denial', 'https://papers.example.org', 'cloud-inference', 'openai-codex', 'deny-site', now, null);
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run('legacy-once', 'https://papers.example.org', 'cloud-inference', 'openai-codex', 'allow-once', now, null);
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run('legacy-site', 'https://papers.example.org', 'cloud-inference', 'openai-codex', 'allow-site', now, null);
  const service = new ConsentSessionService({ db });
  assert.equal(service.grants().find(value => value.id === 'legacy-denial')!.decision, 'deny-site');
  const denied = service.prepare(request('legacy-preview'));
  assert.equal(denied.state, 'denied');
  assert.throws(() => service.decide({ previewId: denied.id, expectedRevision: denied.revision, choice: 'always-site' }, principal), /denied/);
  const legacySite = service.grants().find(value => value.id === 'legacy-site')!;
  await assert.rejects(service.revalidate(job(request('legacy-preview'), legacySite), 'dispatch'), /denied/);
  db.prepare('UPDATE grants SET revokedAt=? WHERE id=?').run(now, 'legacy-denial');
  const legacyOnce = service.grants().find(value => value.id === 'legacy-once')!;
  await assert.rejects(service.revalidate(job(request('legacy-preview'), legacyOnce), 'dispatch'), /bound to different outgoing content/);
  const siteDecision = await eligible(service, job(request('legacy-preview'), legacySite));
  assert.match(siteDecision.eligibilityFingerprint!, /^[a-f0-9]{64}$/);
  const wrongScope = job(request('legacy-preview'), legacySite);
  wrongScope.context.intent = 'evidence'; wrongScope.context.outgoing.intent = 'evidence';
  await assert.rejects(service.revalidate(wrongScope, 'dispatch'), /does not authorize/);
  await assert.rejects(service.revalidate(job(request('missing-preview'), legacySite), 'dispatch'), /current outgoing preview/);
  const state = db.prepare('SELECT * FROM consent_grant_state WHERE grantId=?').get('legacy-once') as Record<string, unknown>;
  assert.deepEqual({ revision: state.revision, requestId: state.requestId, bindingDigest: state.bindingDigest,
    previewId: state.previewId, consumedAttemptId: state.consumedAttemptId },
    { revision: 1, requestId: null, bindingDigest: null, previewId: null, consumedAttemptId: null });
  new ConsentSessionService({ db });
  assert.equal((db.prepare('SELECT COUNT(*) n FROM consent_grant_state').get() as { n: number }).n, 3);
});

test('migration: revoked legacy denial is inactive and existing grant state is preserved', async t => {
  const db = await rawDatabase(t), now = '2026-09-17T00:00:00.000Z';
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run('revoked-denial', 'https://papers.example.org', 'cloud-inference', 'openai-codex', 'deny-site', now, now);
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run('existing', 'https://papers.example.org', 'cloud-inference', 'openai-codex', 'allow-site', now, null);
  db.exec(`CREATE TABLE consent_grant_state(grantId TEXT PRIMARY KEY REFERENCES grants(id),revision INTEGER NOT NULL,
    requestId TEXT,bindingDigest TEXT,previewId TEXT,consumedAttemptId TEXT UNIQUE)`);
  db.prepare('INSERT INTO consent_grant_state VALUES(?,?,?,?,?,?)').run('existing', 7, 'kept-request', hash('kept'), null, 'spent-attempt');
  const service = new ConsentSessionService({ db }), preview = service.prepare(request('revoked-preview'));
  assert.equal(preview.state, 'ready');
  assert.equal(service.grants().find(value => value.id === 'revoked-denial')!.revokedAt, now);
  assert.equal(service.grants().find(value => value.id === 'existing')!.revision, 7);
  const row = db.prepare('SELECT * FROM consent_grant_state WHERE grantId=?').get('existing') as Record<string, unknown>;
  assert.equal(row.requestId, 'kept-request'); assert.equal(row.bindingDigest, hash('kept')); assert.equal(row.consumedAttemptId, 'spent-attempt');
});

test('migration: injected legacy backfill failure rolls the whole consent migration back', async t => {
  const db = await rawDatabase(t), now = '2026-09-17T00:00:00.000Z';
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?)').run('legacy-fail', 'https://papers.example.org', 'cloud-inference', 'openai-codex', 'allow-site', now, null);
  db.exec(`CREATE TABLE consent_grant_state(grantId TEXT PRIMARY KEY REFERENCES grants(id),revision INTEGER NOT NULL,
    requestId TEXT,bindingDigest TEXT,previewId TEXT,consumedAttemptId TEXT UNIQUE);
    CREATE TRIGGER fail_legacy_backfill BEFORE INSERT ON consent_grant_state
      WHEN NEW.grantId='legacy-fail' BEGIN SELECT RAISE(ABORT,'injected migration failure'); END;`);
  assert.throws(() => new ConsentSessionService({ db }), /injected migration failure/);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='consent_previews'").get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM migrations WHERE version=13').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM consent_grant_state').get() as { n: number }).n, 0);
});

/** Minimal DOM double for event/focus ownership. This is not a browser or accessibility audit. */
class ElementDouble extends EventTarget {
  children: ElementDouble[] = []; parentElement: ElementDouble | null = null;
  attributes = new Map<string, string>(); dataset: Record<string, string> = {};
  hidden = false; className = ''; id = ''; type = ''; value = '';
  private text = ''; private index: number; private explicitIndex = false; private isDisabled = false;
  readonly tagName: string; readonly doc: DocumentDouble;
  constructor(tagName: string, doc: DocumentDouble) { super(); this.tagName = tagName; this.doc = doc; this.index = ['button', 'input', 'select', 'textarea'].includes(tagName) ? 0 : -1; }
  get disabled() { return this.isDisabled; }
  set disabled(value: boolean) { this.isDisabled = value; if (value && this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  get tabIndex() { return this.index; } set tabIndex(value: number) { this.index = value; this.explicitIndex = true; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  get isConnected(): boolean { return this === this.doc.body || !!this.parentElement?.isConnected; }
  append(...children: ElementDouble[]) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children: ElementDouble[]) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...children); }
  remove() {
    if (this.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector: string): boolean {
    if (selector === ':disabled') return this.disabled;
    if (selector === '[tabindex]') return this.explicitIndex;
    if (selector === 'a[href]') return this.tagName === 'a' && this.attributes.has('href');
    if (selector === 'button:not([disabled])') return this.tagName === 'button' && !this.disabled;
    return this.tagName === selector;
  }
  closest(_selector: string): ElementDouble | null { return this.hidden || this.attributes.has('hidden') || this.attributes.has('inert') ? this : this.parentElement?.closest(_selector) ?? null; }
  querySelectorAll(selector: string): ElementDouble[] {
    const choices = selector.split(',').map(value => value.trim());
    return this.children.flatMap(child => [...(choices.some(choice => child.matches(choice)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  focus(_options?: unknown) { if (this.isConnected && !this.disabled && (this.index >= 0 || this.explicitIndex)) this.doc.activeElement = this; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
class DocumentDouble {
  body = new ElementDouble('body', this); activeElement = this.body;
  createElement(tag: string) { return new ElementDouble(tag, this); }
}
function dom(t: TestContext) {
  const doc = new DocumentDouble(), frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  const values = { document: doc, HTMLElement: ElementDouble,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); } };
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  const opener = doc.createElement('button'), host = doc.createElement('section'); doc.body.append(opener, host); opener.focus();
  return { doc, opener, host, element: host as unknown as HTMLElement, flush() { for (const [id, frame] of [...frames]) { frames.delete(id); frame(0); } } };
}
function preview(id = 'request-a'): ConsentPreview {
  const prepared = request(id, '<img src=x onerror=alert(1)>');
  return { ...prepared, id, revision: 1, site: 'https://papers.example.org', scopeLabel: 'Codex for this site', payloadDigest: hash('payload'), expiresAt: '2099-01-01T00:00:00Z', state: 'ready' };
}
const allowed: ConsentGrant = { id: 'grant', site: 'https://papers.example.org', scope: 'cloud-inference', recipient: 'openai-codex', decision: 'allow-once', revision: 1, createdAt: '2026-09-17T00:00:00Z' };
function key(root: ElementDouble, value: string, shiftKey = false) {
  const event = new Event('keydown', { cancelable: true, bubbles: true });
  Object.defineProperties(event, { key: { value }, shiftKey: { value: shiftKey } }); root.dispatchEvent(event); return event;
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('ui: Tab may leave the non-modal sheet; outgoing text is readable; Escape is not-now', t => {
  const d = dom(t); let decisions = 0, dismissed = 0;
  mountConsentSheet(d.element, { preview: preview(), canAuthorize: true, decide: async () => { decisions++; return allowed; }, onNotNow: () => dismissed++ });
  d.flush(); const root = d.host.children[0], buttons = root.querySelectorAll('button');
  assert.equal(root.getAttribute('aria-modal'), 'false', 'the reading page is not globally blocked');
  assert.equal(root.dataset.surface, 'native-panel'); assert.equal(d.doc.activeElement, buttons[0]);
  assert.deepEqual(buttons.slice(0, 3).map(button => button.className),
    ['m-consent__this-time', 'm-consent__always-site', 'm-consent__never-site']);
  const outgoing = root.querySelector('pre')!;
  assert.equal(outgoing.textContent, '<img src=x onerror=alert(1)>'); assert.equal(root.querySelector('img'), null);
  assert.equal(outgoing.tabIndex, 0); assert.match(outgoing.getAttribute('aria-labelledby') ?? '', /^m-consent-part-/);
  buttons.at(-1)!.focus(); assert.equal(key(root, 'Tab').defaultPrevented, false, 'the page owns focus traversal after the last control');
  assert.equal(key(root, 'Escape').defaultPrevented, true);
  assert.equal(dismissed, 1); assert.equal(decisions, 0); assert.equal(d.host.children.length, 0); assert.equal(d.doc.activeElement, d.opener);
});

test('ui: digest-bound solver plan says it can run the model locally before any consent decision', async t => {
  const d = dom(t), reviewed = preview(); let decisions = 0;
  mountConsentSheet(d.element, { preview: reviewed, canAuthorize: true,
    reviewedPlan: { previewId: reviewed.id, previewRevision: reviewed.revision,
      preparedPayloadDigest: reviewed.bindingDigest, capabilities: ['samples', 'solver'] },
    decide: async () => { decisions++; return allowed; } });
  d.flush(); const root = d.host.children[0];
  assert.match(root.textContent, /can run the model locally/);
  assert.equal(root.querySelector('pre')!.textContent, reviewed.outgoing[0].text);
  assert.equal(decisions, 0, 'mounting and inspecting the review do not decide or send');
  root.querySelector('button')!.click(); await tick(); assert.equal(decisions, 1);
});

test('ui: local solver disclosure fails closed for absent capability or stale preview binding', t => {
  const d = dom(t), reviewed = preview();
  for (const reviewedPlan of [
    { previewId: reviewed.id, previewRevision: reviewed.revision, preparedPayloadDigest: reviewed.bindingDigest, capabilities: ['samples'] as const },
    { previewId: reviewed.id, previewRevision: reviewed.revision, preparedPayloadDigest: hash('stale'), capabilities: ['solver'] as const },
  ]) {
    const sheet = mountConsentSheet(d.element, { preview: reviewed, reviewedPlan, canAuthorize: true, decide: async () => allowed });
    assert.doesNotMatch(d.host.children[0].textContent, /can run the model locally/); sheet.destroy();
  }
});

test('ui: network copy is honest and leaves reviewed outgoing bytes and recipient unchanged', async t => {
  const d = dom(t), exactBytes = '<question>Why?</question>\n\u0000Exact UTF-8: café';
  const cloud = { ...preview('cloud-copy'), outgoing: [{ label: 'Exact outgoing', text: exactBytes, sha256: hash(exactBytes) }] };
  const originalOutgoing = structuredClone(cloud.outgoing); let decided: ConsentPreview | undefined;
  const sheet = mountConsentSheet(d.element, { preview: cloud, canAuthorize: true,
    decide: async (_choice, value) => { decided = value; return allowed; } });
  d.flush(); let root = d.host.children[0];
  assert.deepEqual(root.querySelectorAll('pre').map(node => node.textContent), [exactBytes]);
  assert.match(root.textContent, /Your question is sent to Codex\. Other internet access has not been established as blocked on this device\./);
  assert.ok(root.textContent.includes(cloud.recipientLabel));
  assert.doesNotMatch(root.textContent, /network access stays closed/i);
  root.querySelector('button')!.click(); await tick();
  assert.deepEqual(decided?.outgoing, originalOutgoing); assert.equal(decided?.recipient, cloud.recipient);
  sheet.destroy();

  const open = { ...preview('open-copy'), scope: 'open-session' as const, scopeLabel: 'Codex and separate web access for this site', outgoing: originalOutgoing };
  const unavailable = mountConsentSheet(d.element, { preview: open, surface: 'floating', canAuthorize: true, decide: async () => { throw new Error('must not authorize'); } });
  d.flush(); root = d.host.children[0];
  assert.match(root.textContent, /Web checks are not available yet\. Nothing will be looked up\./);
  assert.match(root.textContent, /This action is unavailable here\. Nothing was sent\./);
  assert.deepEqual(root.querySelectorAll('pre').map(node => node.textContent), [exactBytes]);
  assert.doesNotMatch(root.textContent, /separate web access|Fetched pages are recorded/i);
  assert.deepEqual(root.querySelectorAll('button').map(node => node.textContent), ['Not now']);
  unavailable.destroy();
});

test('ui: not-now stays usable while saving; late approval cannot send after dismissal', async t => {
  const d = dom(t); let resolve!: (value: ConsentGrant) => void; let signal!: AbortSignal; let granted = 0, backed = 0;
  mountConsentSheet(d.element, { preview: preview(), canAuthorize: true,
    decide: (_choice, _preview, nextSignal) => { signal = nextSignal; return new Promise(done => { resolve = done; }); },
    onGranted: () => granted++, onBack: () => backed++ });
  d.flush(); const buttons = d.host.children[0].querySelectorAll('button'); buttons[0].click();
  assert.ok(buttons.slice(0, -1).every(button => button.disabled)); assert.equal(buttons.at(-1)!.disabled, false);
  assert.equal(d.doc.activeElement, buttons.at(-1), 'the sheet retains a usable focus target after the approving button is disabled');
  buttons.at(-1)!.click(); assert.equal(signal.aborted, true); assert.equal(backed, 1);
  resolve(allowed); await tick(); assert.equal(granted, 0); assert.equal(d.doc.activeElement, d.opener);
});

test('ui: preview replacement aborts the old decision and binds completion to the new preview', async t => {
  const d = dom(t); let resolve!: (value: ConsentGrant) => void; let oldSignal!: AbortSignal; const granted: string[] = [];
  const sheet = mountConsentSheet(d.element, { preview: preview('old'), canAuthorize: true,
    decide: (_choice, decided, signal) => decided.id === 'old' ? new Promise(done => { oldSignal = signal; resolve = done; }) : Promise.resolve(allowed),
    onGranted: (_grant, decided) => granted.push(decided.requestId) });
  d.flush(); d.host.children[0].querySelector('button')!.click(); sheet.update(preview('new'));
  assert.equal(oldSignal.aborted, true); resolve(allowed); await tick(); assert.deepEqual(granted, []);
  d.host.children[0].querySelector('button')!.click(); await tick(); assert.deepEqual(granted, ['new']); sheet.destroy();
});

test('ui: destruction cancels queued focus and background preview updates do not steal page focus', t => {
  const d = dom(t), sheet = mountConsentSheet(d.element, { preview: preview(), canAuthorize: true, decide: async () => allowed });
  sheet.destroy(); d.flush(); assert.equal(d.doc.activeElement, d.opener);
  const next = mountConsentSheet(d.element, { preview: preview(), canAuthorize: true, decide: async () => allowed }); d.flush();
  d.opener.focus(); next.update(preview('new')); assert.equal(d.doc.activeElement, d.opener);
  next.destroy(); assert.equal(d.doc.activeElement, d.opener);
});

test('ui: floating, denied and excluded surfaces offer dismissal but no authorization controls', t => {
  const d = dom(t);
  for (const options of [{ surface: 'floating' as const, state: 'ready' as const }, { surface: 'native-panel' as const, state: 'denied' as const }, { surface: 'localhost' as const, state: 'excluded' as const }]) {
    let settings = 0;
    const sheet = mountConsentSheet(d.element, { preview: { ...preview(), state: options.state }, surface: options.surface, canAuthorize: true, decide: async () => { throw new Error('must not authorize'); }, onOpenSettings: () => settings++ });
    d.flush(); const buttons = d.host.children[0].querySelectorAll('button');
    assert.deepEqual(buttons.map(button => button.textContent), options.state === 'denied' ? ['Settings', 'Not now'] : ['Not now']);
    if (options.state === 'denied') { buttons[0].click(); assert.equal(settings, 1); }
    assert.equal(d.host.children[0].dataset.surface, options.surface); sheet.destroy();
  }
  const css = readFileSync(new URL('../ui/consent.css', import.meta.url), 'utf8');
  assert.match(css, /\.m-consent\[data-surface="floating"\][^{]*\{[^}]*position: fixed/s);
  assert.doesNotMatch(css, /\.m-consent\s*\{[^}]*position: fixed/s);
  assert.doesNotMatch(css, /var\(--m-danger\)/);
});
