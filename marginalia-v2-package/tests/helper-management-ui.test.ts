import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHelperManagement, isHelperPage } from '../ui/helper-management.ts';
class TestElement extends EventTarget {
  tagName: string;
  doc: TestDocument;
  children: TestElement[] = [];
  parentElement: TestElement | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  className = ''; id = ''; value = ''; type = ''; href = ''; download = '';
  hidden = false; disabled = false; readOnly = false;
  selectionStart = 0; selectionEnd = 0;
  private text = '';
  constructor(tag: string, doc: TestDocument) { super(); this.tagName = tag.toUpperCase(); this.doc = doc; }
  get firstElementChild() { return this.children[0] ?? null; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value ?? ''; }
  get isConnected(): boolean { return this === this.doc.body || !!this.parentElement?.isConnected; }
  get visible(): boolean { return !this.hidden && (!this.parentElement || this.parentElement.visible); }
  append(...nodes: TestElement[]) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes: TestElement[]) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...nodes); }
  remove() {
    if (!this.parentElement) return;
    if (this.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null;
  }
  contains(node: TestElement | null): boolean { return !!node && (node === this || this.children.some(child => child.contains(node))); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); if (name === 'class') this.className = value; if (name === 'id') this.id = value; }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  matches(selector: string): boolean {
    if (selector === '[data-ml-focus]') return this.dataset.mlFocus !== undefined;
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector: string): TestElement[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): TestElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  focus() { if (this.isConnected && this.visible && !this.disabled) this.doc.activeElement = this; }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  click() {
    if (this.disabled) return;
    const proceed = this.dispatchEvent(new Event('click', { cancelable: true }));
    if (proceed && this.type === 'submit') this.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }
}
class TestDocument {
  body: TestElement;
  activeElement: TestElement;
  created: TestElement[] = [];
  constructor() { this.body = new TestElement('body', this); this.activeElement = this.body; }
  createElement(tag: string) { const element = new TestElement(tag, this); this.created.push(element); return element; }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const entry = { id: '11111111-1111-4111-8111-111111111111', origin: 'chrome-extension://fixture', createdAt: '2026-09-17T00:00:00Z', revoked: false };
function control(root: TestElement, text: string) { const node = root.querySelectorAll('button').find(n => n.textContent === text); assert.ok(node, text); return node; }
function setup(t: import('node:test').TestContext) {
  const doc = new TestDocument(); const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const host = doc.createElement('div'); doc.body.append(host); const mount = mountHelperManagement(host as unknown as HTMLElement);
  t.after(() => { mount.destroy(); if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); });
  return { host, mount };
}
test('management admits only helper page location, excluding extension and external surfaces', () => {
  for (const protocol of ['chrome-extension:', 'moz-extension:', 'https:']) assert.equal(isHelperPage({ protocol, hostname: 'localhost', pathname: '/' }), false);
  assert.equal(isHelperPage({ protocol: 'http:', hostname: 'example.org', pathname: '/' }), false);
  assert.equal(isHelperPage({ protocol: 'http:', hostname: '127.0.0.1', pathname: '/' }), true);
});
test('no startup requests; explicit open/list and issue/renew use only relative safe POSTs', async t => {
  const calls: {path: string; init: RequestInit}[] = []; let fail = false;
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => { calls.push({path, init}); if(fail) throw new Error('secret'); return Response.json(path.endsWith('browsers') ? {browsers: [entry]} : {code:'012345', expiresInSeconds:300, singleUse:true}); });
  const {host,mount}=setup(t); assert.equal(calls.length,0); mount.open(); await settle();
  assert.equal(calls.length,1); assert.match(host.textContent,/chrome-extension/);
  control(host,'Show pairing code').click(); await settle(); assert.equal(host.querySelector('output')!.textContent,'012345');
  fail=true; control(host,'Renew pairing code').click(); assert.equal(host.querySelector('output')!.textContent,''); await settle(); assert.match(host.textContent,/previous code may have been replaced/);
  control(host,'Refresh browser list').click(); await settle(); assert.match(host.textContent,/last loaded entries/); assert.match(host.textContent,/chrome-extension/);
  for(const call of calls){assert.ok(call.path.startsWith('/api/helper-management/')); assert.equal(call.init.method,'POST'); assert.equal(call.init.body,'{}'); assert.equal(call.init.credentials,'omit'); assert.deepEqual(call.init.headers,{'Content-Type':'application/json'});}
});
test('Forget is deliberate, uses stable ID, preserves list on failure and records confirmed revocation', async t => {
  let fail=true; const bodies: string[]=[];
  t.mock.method(globalThis,'fetch',async(path:string,init:RequestInit)=>{if(path.endsWith('browsers'))return Response.json({browsers:[entry]}); bodies.push(init.body as string); if(fail)throw new Error('offline'); return Response.json({result:'revoked'});});
  const {host,mount}=setup(t); mount.open(); await settle(); control(host,'Forget').click(); assert.equal(bodies.length,0);
  control(host,'Forget this browser').click(); await settle(); assert.match(host.textContent,/could not be confirmed/); assert.doesNotMatch(host.textContent,/Browser forgotten/);
  fail=false; control(host,'Forget this browser').click(); await settle(); assert.match(host.textContent,/Browser forgotten/); assert.match(host.textContent,/Forgotten/);
  assert.deepEqual(bodies.map(value=>JSON.parse(value)),[{id:entry.id},{id:entry.id}]);
});
test('closing invalidates delayed code response and expiry clears displayed code', async t => {
  let resolve!: (value:Response)=>void; let delayed=true;
  t.mock.method(globalThis,'fetch',async(path:string)=>path.endsWith('browsers')?Response.json({browsers:[]}):delayed?new Promise<Response>(r=>{resolve=r}):Response.json({code:'123456',expiresInSeconds:300,singleUse:true}));
  const {host,mount}=setup(t); mount.open(); await settle(); control(host,'Show pairing code').click(); mount.close(); resolve(Response.json({code:'654321',expiresInSeconds:300,singleUse:true})); await settle(); assert.equal(host.querySelector('output')!.textContent,'');
  delayed=false; t.mock.timers.enable({apis:['setTimeout','Date']}); mount.open(); await settle(); control(host,'Renew pairing code').click(); await settle(); assert.equal(host.querySelector('output')!.textContent,'123456');
  t.mock.timers.tick(300000); assert.equal(host.querySelector('output')!.textContent,''); assert.match(host.textContent,/code has expired/);
});