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
/** This unit fixture supplies only the durable job fields read by the consent authority. */
function job(prepared: PrepareConsentInput, grant: ConsentGrant, attempt = prepared.requestId + '-attempt'): JobSnapshot {
  return { id: prepared.requestId, latestAttemptId: attempt, grantId: grant.id, provider: prepared.provider, policyKey: prepared.policyKey, preparedPayloadDigest: prepared.bindingDigest, context: { sourceUrl: prepared.sourceUrl, intent: 'define' } } as JobSnapshot;
}
async function database(t: TestContext) {
  // Use the production SQLite driver, not an in-memory imitation of transactions.
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE grants(id TEXT PRIMARY KEY,site TEXT,scope TEXT,recipient TEXT,decision TEXT,createdAt TEXT,revokedAt TEXT);
    CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,payload TEXT,createdAt TEXT);`);
  t.after(() => db.close());
  return { db, service: new ConsentSessionService({ db }) };
}
function grant(service: ConsentSessionService, prepared: PrepareConsentInput, choice: 'always-site' | 'this-time' = 'always-site') {
  const preview = service.prepare(prepared);
  return service.decide({ previewId: preview.id, expectedRevision: preview.revision, choice }, principal);
}

test('database: reusable grant records each current prepared request, not its grant-creation preview', async t => {
  const { service } = await database(t), a = request('request-a', 'first passage'), permission = grant(service, a);
  const first = job(a, permission); service.authorizeAttempt(first, first.latestAttemptId!);
  const b = request('request-b', 'different passage');
  b.outgoing.push({ label: 'Your note', text: 'current note', sha256: hash('current note') });
  service.prepare(b);
  const second = job(b, permission); service.authorizeAttempt(second, second.latestAttemptId!);
  assert.deepEqual(service.egress(first.id)[0].contextHashes, a.outgoing.map(part => part.sha256));
  assert.deepEqual(service.egress(second.id)[0].contextHashes, b.outgoing.map(part => part.sha256));
  service.authorizeAttempt(second, second.latestAttemptId!);
  assert.equal(service.egress(second.id).length, 1, 'same-attempt authorization is idempotent');
});

test('database: both current request identity and digest are required; rejection rolls back authorization', async t => {
  const { service, db } = await database(t), a = request('request-a'), permission = grant(service, a);
  const b = request('request-b'); service.prepare(b);
  const cases = [job(request('not-previewed'), permission), job({ ...b, bindingDigest: hash('wrong') }, permission), job({ ...b, requestId: 'other', bindingDigest: b.bindingDigest }, permission)];
  for (const current of cases) {
    assert.throws(() => service.authorizeAttempt(current, current.latestAttemptId!), /current outgoing preview/);
    assert.equal(service.egress(current.id).length, 0);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM consent_attempt_authorizations').get() as { n: number }).n, 0);
});

test('database: preview authority metadata must match, and a failed one-shot bind does not consume it', async t => {
  const { service, db } = await database(t), prepared = request('once'), permission = grant(service, prepared, 'this-time'), current = job(prepared, permission);
  for (const [column, value] of [['site', 'https://other.example.org'], ['scope', 'open-session'], ['recipient', 'other-provider'], ['provider', 'mcp-server'], ['policyKey', hash('other-policy')], ['contextHashes', '[]']] as const) {
    const original = (db.prepare(`SELECT ${column} AS value FROM consent_previews WHERE requestId=?`).get(prepared.requestId) as { value: string }).value;
    db.prepare(`UPDATE consent_previews SET ${column}=? WHERE requestId=?`).run(value, prepared.requestId);
    assert.throws(() => service.authorizeAttempt(current, current.latestAttemptId!), /current outgoing preview/);
    assert.equal((db.prepare('SELECT consumedAttemptId FROM consent_grant_state WHERE grantId=?').get(permission.id) as { consumedAttemptId: string | null }).consumedAttemptId, null);
    assert.equal(service.egress().length, 0);
    db.prepare(`UPDATE consent_previews SET ${column}=? WHERE requestId=?`).run(original, prepared.requestId);
  }
  service.authorizeAttempt(current, current.latestAttemptId!);
  assert.throws(() => service.authorizeAttempt({ ...current, latestAttemptId: 'another-attempt' }, 'another-attempt'), /already used/);
  service.revokeGrant(permission.id, permission.revision);
  assert.throws(() => service.currentAuthorization(current, current.latestAttemptId!, false), /revoked/);
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

test('ui: Tab stays in the sheet; Escape is not-now and returns focus without a decision', t => {
  const d = dom(t); let decisions = 0, dismissed = 0;
  mountConsentSheet(d.element, { preview: preview(), canAuthorize: true, decide: async () => { decisions++; return allowed; }, onNotNow: () => dismissed++ });
  d.flush(); const root = d.host.children[0], buttons = root.querySelectorAll('button');
  assert.equal(root.getAttribute('aria-modal'), 'false', 'the reading page is not globally blocked');
  assert.equal(root.dataset.surface, 'native-panel'); assert.equal(d.doc.activeElement, buttons[0]);
  assert.equal(root.querySelector('pre')?.textContent, '<img src=x onerror=alert(1)>'); assert.equal(root.querySelector('img'), null);
  assert.equal(key(root, 'Tab', true).defaultPrevented, true); assert.equal(d.doc.activeElement, buttons.at(-1));
  key(root, 'Tab'); assert.equal(d.doc.activeElement, buttons[0]);
  assert.equal(key(root, 'Escape').defaultPrevented, true);
  assert.equal(dismissed, 1); assert.equal(decisions, 0); assert.equal(d.host.children.length, 0); assert.equal(d.doc.activeElement, d.opener);
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
    const sheet = mountConsentSheet(d.element, { preview: { ...preview(), state: options.state }, surface: options.surface, canAuthorize: true, decide: async () => { throw new Error('must not authorize'); } });
    d.flush(); const buttons = d.host.children[0].querySelectorAll('button'); assert.equal(buttons.length, 1); assert.equal(buttons[0].textContent, 'Not now');
    assert.equal(d.host.children[0].dataset.surface, options.surface); sheet.destroy();
  }
  const css = readFileSync(new URL('../ui/consent.css', import.meta.url), 'utf8');
  assert.match(css, /\.m-consent\[data-surface="floating"\][^{]*\{[^}]*position: fixed/s);
  assert.doesNotMatch(css, /\.m-consent\s*\{[^}]*position: fixed/s);
  assert.doesNotMatch(css, /var\(--m-danger\)/);
});
