import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ReaderJournal, type JournalState, type Persistence } from '../ui/journal.ts';
import { wholePageAnchor, type ReaderMutation, type SourceCapture, type Thread } from '../contracts/reader.ts';
import { HelperClient, HelperTransportError, forgetPairingIfCurrent, pairingCode, pairingIdentity } from '../ui/helper.ts';
import type { AskingSelection } from '../ui/asking-host.ts';
import { storage, asHost } from './t05-harness.ts';
import { dom, button, replaceGlobals } from './t05-dom.ts';

// Isolate the scientific-contract boundary; no test here validates or authorizes
// a scientific reply. Journal, persistence lifecycle and transport are the actual modules.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '../contracts/reply.ts') return { url: 't05:canonical', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 't05:canonical') return { format: 'module', shortCircuit: true, source: `export function canonicalReplyData(v) { return Array.isArray(v) ? '['+v.map(canonicalReplyData).join(',')+']' : v && typeof v==='object' ? '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalReplyData(v)).join(',')+'}' : JSON.stringify(v); } export const capabilitiesForIntent = intent => intent === 'simulate' ? ['samples', 'solver'] : intent === 'evidence' ? ['samples', 'network.citations'] : intent === 'explore' ? ['samples', 'network.shelf'] : ['samples']; export const validateReply = () => ({ok:false,errors:['Scientific validation outside this fixture']}); export function computeIndependentChecks() { throw new Error('Scientific calculation outside this recovery fixture'); }` };
  return next(url, context);
} });
const { applyIntendedNote, retryDraftMutation, draftAfterResolution, keepDeviceConflict, resolveHelperConflict, replySaveLifecycle,
  documentJournal, documentDraft, documentQuestion, unsavedDrafts, unsavedQuestions, sourceBoundJournal, localPersistence } = await import('../ui/persistence.ts');
const { mountMargin, marginItemSize, composerOffset, sectionMapState, threadContentKey } = await import('../ui/margin.ts');
function deferred<T = void>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const capture: SourceCapture = { url: 'https://example.test/a', title: 'Original', text: 'alpha beta gamma', pageType: 'article', capturedAt: '2026-09-17T00:00:00Z', extractionVersion: 'test-v1' };
const keep = (id = 'keep', c = capture): Extract<ReaderMutation, { kind:'keep' }> => ({ id, threadId: id+'-thread', kind: 'keep', capture: c, anchor: { exact:'alpha',prefix:'',suffix:' beta gamma',start:0,end:5 }, note: 'Reader words' });
const view = (x: number) => ({ parameters: { x }, view: {} });
function memory() {
  let durable: JournalState | undefined, failing = false;
  const backend: Persistence = { load: async () => structuredClone(durable), save: async value => { if (failing) throw new Error('quota fixture'); durable = structuredClone(value); } };
  return { backend, journal: new ReaderJournal(backend), fail(value: boolean) { failing = value; }, state: () => structuredClone(durable), seed(value: JournalState) { durable = structuredClone(value); } };
}
const lock = async (action: () => Promise<void>) => action();

test('A -> pending B -> A close enqueues final A and fences late renderer callbacks', async () => {
  const gate = deferred(), writes: number[] = [];
  const life = replySaveLifecycle(view(1), async state => { writes.push(state.parameters.x); if (writes.length === 1) await gate.promise; });
  const b = life.save(view(2)); await tick(); const close = life.close(view(1)); await life.save(view(999));
  assert.deepEqual(writes, [2]); assert.equal(life.status().pending, 2); gate.resolve(); await Promise.all([b, close]); assert.deepEqual(writes, [2,1]);
});
test('flush orders final snapshot after older saves; an untouched normalized mount never writes', async () => {
  const gate = deferred(), writes: number[] = []; const life = replySaveLifecycle(view(1), async state => { if (state.parameters.x === 2) await gate.promise; writes.push(state.parameters.x); });
  await life.flush(view(1)); assert.deepEqual(writes, []); const b = life.save(view(2)), a = life.flush(view(1)); gate.resolve(); await Promise.all([a,b]); assert.deepEqual(writes,[2,1]); await life.close(view(1)); assert.equal(writes.length,2);
});
test('failed save remains retryable; competing recovery is preserved, not active completion', async () => {
  let failure: Error | undefined = new Error('quota'); const life = replySaveLifecycle(view(1), async () => { if (failure) throw failure; });
  await assert.rejects(life.flush(view(2)),/quota/); const before = life.status().completed;
  failure = Object.assign(new Error('recovery retained'), {name:'RecoveredViewConflict'}); await life.flush(view(2));
  assert.equal(life.status().completed,before); assert.notEqual(life.status().preserved,before); failure = undefined; await life.flush(view(3)); assert.equal(life.status().completed,life.status().preserved);
});
test('note retry persists unrelated earlier work then applies THAT exact note once', async () => {
  const m=memory(); await m.journal.load(); m.fail(true); await assert.rejects(m.journal.change(keep('earlier'))); m.fail(false);
  await applyIntendedNote(m.journal,keep('intended')); await applyIntendedNote(m.journal,keep('intended'));
  assert.deepEqual(m.state()!.pending.map(change=>change.id),['earlier','intended']); assert.equal(m.state()!.threads.length,2);
});
test('a durable conflict cannot clear a draft; a durable keep-device choice unlocks but does not apply it', async () => {
  const m=memory(), original=keep(); await m.journal.change(original);
  const mutation: ReaderMutation={kind:'note',id:'stale',threadId:original.threadId,noteId:'keep-note',text:'Unapplied',expectedRevision:0};
  const draft={text:'Unapplied',anchor:original.anchor,source:capture,mutation,threadId:original.threadId,noteId:'keep-note',revision:0};
  await assert.rejects(retryDraftMutation(m.journal,draft),/changed/); assert.equal(m.journal.unsaved,false); assert.equal(draftAfterResolution(m.journal,draft),undefined);
  await keepDeviceConflict(m.journal,lock,'stale'); const result=await retryDraftMutation(m.journal,draft);
  assert.equal(result.kind,'resolved'); if(result.kind==='resolved'){assert.equal(result.draft.text,'Unapplied');assert.equal(result.draft.mutation,undefined);assert.equal(result.draft.revision,1);}
  assert.equal(m.journal.state.threads[0].notes[0].text,'Reader words');
});
test('keep-device save failure stays unsaved; retry recovers the choice without pretending the note applied',async()=>{
  const m=memory(); await m.journal.change(keep()); const mutation:ReaderMutation={id:'stale',kind:'note',threadId:'keep-thread',noteId:'keep-note',text:'Draft',expectedRevision:0};
  await assert.rejects(m.journal.change(mutation)); const draft={text:'Draft',anchor:keep().anchor,source:capture,mutation}; m.fail(true);
  await assert.rejects(keepDeviceConflict(m.journal,lock,'stale'),/quota/); assert.equal(m.journal.unsaved,true); assert.equal(draftAfterResolution(m.journal,draft),undefined);
  m.fail(false); const result=await retryDraftMutation(m.journal,draft); assert.equal(result.kind,'resolved'); assert.equal(m.journal.unsaved,false);
  const reloaded=new ReaderJournal(m.backend); await reloaded.load(); assert.equal(reloaded.state.resolutions?.at(-1)?.resolution,'kept-device');
});
test('actual T07 kept version survives helper lists/reload without creating an upload',async()=>{
  const m=memory();await m.journal.change(keep());const thread=structuredClone(m.journal.state.threads[0]);await m.journal.sync(async()=>{},async()=>[thread]);
  await assert.rejects(m.journal.change({kind:'note',id:'bad',threadId:thread.id,noteId:'keep-note',text:'Draft',expectedRevision:0}));
  await keepDeviceConflict(m.journal,lock,'bad');let sends=0;
  const remote=structuredClone(thread);remote.notes[0].text='Remote different';remote.revision=9;
  await m.journal.sync(async()=>{sends++;},async()=>[remote]);const reloaded=new ReaderJournal(m.backend);await reloaded.load();
  assert.equal(reloaded.state.threads[0].notes[0].text,'Reader words');assert.equal(sends,0);assert.equal(reloaded.state.resolutions?.at(-1)?.deviceVersion?.id,thread.id);
});
test('actual T07 deliberate absence survives later helper resurrection',async()=>{
  const m=memory();await m.journal.load();const mutation:ReaderMutation={id:'missing-note',kind:'note',threadId:'gone',noteId:'n',text:'Draft',expectedRevision:0};await assert.rejects(m.journal.change(mutation));
  await keepDeviceConflict(m.journal,lock,mutation.id);assert.equal(m.journal.state.resolutions?.at(-1)?.deviceVersion,null);
  const foreign=memory();await foreign.journal.change({...keep('x'),threadId:'gone'});await m.journal.sync(async()=>assert.fail('must not send'),async()=>foreign.journal.state.threads);await m.journal.load();assert.equal(m.journal.state.threads.length,0);
});
test('helper conflict fetch begins only inside the lock after loading current durable state',async()=>{
  const m=memory();await m.journal.change(keep());await assert.rejects(m.journal.change({id:'stale',kind:'note',threadId:'keep-thread',noteId:'keep-note',text:'draft',expectedRevision:0}));
  const gate=deferred(),order:string[]=[];const work=resolveHelperConflict(m.journal,async action=>{await gate.promise;order.push('lock');await action();},'stale',async()=>{order.push('read');assert.equal(m.journal.state.threads[0].revision,7);return m.state()!.threads;});
  await tick();assert.deepEqual(order,[]);const next=m.state()!;next.threads[0].revision=7;m.seed(next);gate.resolve();await work;assert.deepEqual(order,['lock','read']);
});
test('same-document journal retains its private durable baseline when another tab changed storage',async()=>{
  const m=memory(),ns=crypto.randomUUID();const first=documentJournal(ns,m.backend);await first.load();m.fail(true);await assert.rejects(first.change(keep()));m.fail(false);
  const other=new ReaderJournal(m.backend);await other.change(keep('other'));
  const second=documentJournal(ns,m.backend);assert.equal(second,first);await assert.rejects(second.retryPersistence(),/changed elsewhere/);assert.equal(m.state()!.threads[0].id,'other-thread');assert.equal(second.state.threads[0].id,'keep-thread');
});
test('draft hydration never overwrites interim typing and failed original-source draft survives remount',async()=>{
  const gate=deferred<undefined>(),ns=crypto.randomUUID();let fail=true;
  const io={read:()=>gate.promise,write:async()=>{if(fail)throw new Error('quota');}};
  const first=documentDraft(ns,'draft',capture,io);const loading=first.load();await assert.rejects(first.save({text:'Typed',source:capture,anchor:wholePageAnchor()}));gate.resolve(undefined);assert.equal((await loading)?.text,'Typed');
  const second=documentDraft(ns,'draft',{...capture,text:'Different page'},io);assert.equal(second,first);assert.equal(unsavedDrafts(ns,capture.url)[0].source.text,capture.text);assert.deepEqual(unsavedDrafts(ns,'https://other.test'),[]);
  fail=false;await second.flush();assert.equal(second.unsaved(),false);
});
test('question hydration and cleanup failure retain exact draft or explicit unsaved tombstone',async()=>{
  const gate=deferred<undefined>(),ns=crypto.randomUUID();let fail=true;const io={read:()=>gate.promise,write:async()=>{if(fail)throw new Error('quota');}};
  const buffer=documentQuestion(ns,'q',capture.url,io),loading=buffer.load();await assert.rejects(buffer.save({capture,anchor:wholePageAnchor(),question:'Why?',context:'Reader context'}));gate.resolve(undefined);assert.equal((await loading)?.question,'Why?');
  fail=false;await buffer.save(buffer.get());fail=true;await assert.rejects(buffer.save(undefined));assert.equal(unsavedQuestions(ns,capture.url)[0].draft,null);
});
test('orphan export includes source-bound resolution snapshots and exact retained draft, never unrelated page work',()=>{
  const a=keep('a'),b=keep('b',{...capture,url:'https://other.test/private'});const state:JournalState={threads:[],pending:[],conflicts:[{change:a,message:'own'},{change:b,message:'other'}],resolutions:[]};
  const own=sourceBoundJournal(state,capture.url);assert.deepEqual(own.conflicts.map(x=>x.change.id),['a']);assert.ok(!JSON.stringify(own).includes('other.test'));
  const mutation:ReaderMutation={id:'orphan',kind:'note',threadId:'missing',noteId:'n',text:'Bound draft',expectedRevision:0};state.conflicts.push({change:mutation,message:'retained'});
  assert.equal(sourceBoundJournal(state,capture.url,{text:'Bound draft',anchor:wholePageAnchor(),source:capture,mutation}).conflicts.length,2);
  state.pending.push({...b,threadId:'a-thread'});assert.equal(sourceBoundJournal(state,capture.url).conflicts.length,0,'ambiguous association stays excluded');
});
test('reading-position and map data preserve individual marks/counts and content changes at equal revision',async()=>{
  const m=memory();await m.journal.change(keep());const sections=[{title:'A',start:0,end:6},{title:'B',start:6,end:10},{title:'C',start:10,end:16}];const result=sectionMapState(sections,m.journal.state.threads,capture,1);
  assert.deepEqual(result.map(x=>x.length),[6,4,6]);assert.equal(result[0].notes,1);assert.deepEqual(result[0].markPositions,[0]);assert.equal(result[1].current,true);
  assert.equal(composerOffset({anchor:wholePageAnchor(),position:4,text:'Draft'},12),4);assert.deepEqual([0,1,2].map(i=>marginItemSize(i,0,false,false)),['full','line','tick']);assert.equal(marginItemSize(2,0,false,true),'full');
  const thread=m.journal.state.threads[0];assert.notEqual(threadContentKey(thread),threadContentKey({...thread,sourceVersionId:'canonical'}));
});
test('offline Disconnect clears durable credential before remote revoke and retains new pairing',async t=>{
  const client=new HelperClient('http://localhost:43120');client.token='old';let stored: {origin:string;token:string}|undefined={origin:client.origin,token:'old'};const order:string[]=[];
  t.mock.method(globalThis,'fetch',async()=>{order.push('revoke');assert.equal(stored,undefined);throw new Error('raw secret');});
  assert.equal(await client.disconnect(async()=>{stored=undefined;order.push('delete');}),'unconfirmed');assert.deepEqual(order,['delete','revoke']);assert.equal(client.token,'');
});
test('failed local credential deletion neither revokes remotely nor claims success',async t=>{
  const client=new HelperClient('http://localhost:43120');client.token='old';let sends=0;t.mock.method(globalThis,'fetch',async()=>{sends++;return Response.json({revoked:true});});
  await assert.rejects(client.disconnect(async()=>{throw new Error('quota');}),/quota/);assert.equal(client.token,'old');assert.equal(sends,0);
});
test('older Disconnect preserves newer durable pairing and fences late authenticated response',async t=>{
  const gate=deferred<Response>(),client=new HelperClient('http://localhost:43120');client.token='old';
  let stored={origin:client.origin,token:'new'};t.mock.method(globalThis,'fetch',async (url:string)=>url.endsWith('revoke')?Response.json({revoked:true}):gate.promise);
  const outstanding=client.list(),rejected=assert.rejects(outstanding,/connection changed/);
  const result=await client.disconnect(async()=>{client.token='new';assert.equal(await forgetPairingIfCurrent({read:async<T>()=>stored as T,write:async()=>assert.fail('new token must not be deleted')},client.origin,'old'),false);});
  gate.resolve(Response.json({threads:[]}));await rejected;assert.equal(result,'replaced');assert.equal(client.token,'new');
});
test('pairing leading zeros and authenticated POST reads remain exact; transport errors remain unknown',async t=>{
  assert.equal(pairingCode('001 234'),'001234');const calls:Array<{url:string;init:RequestInit}>=[];const client=new HelperClient('http://localhost:43120');client.token='paired';
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return Response.json({threads:[]});});await client.list();
  assert.equal(calls[0].url,client.origin+'/api/read/threads?removed=true');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.body,'{}');assert.equal(new Headers(calls[0].init.headers).has('origin'),false);
  await assert.rejects(client.read('/api/jobs'),/no supported/);assert.equal(calls.length,1);assert.notEqual(await pairingIdentity(client.origin,'a'),await pairingIdentity(client.origin,'b'));
});
test('typed reattach rejects invalid states, oversized ranges, and mismatched response identities', async t => {
  const request = { threadId: 'reattach-thread', text: capture.text, tabCapture: 'document-1', capture };
  const responses: unknown[] = [
    { state: 'unknown', candidates: [] },
    { state: 'moved' },
    { state: 'moved', candidates: [{ start: -1, end: 2 }] },
    { state: 'moved', candidates: [{ start: 0, end: capture.text.length + 1 }] },
    { state: 'moved', candidates: Array.from({ length: 101 }, () => ({ start: 0, end: 1 })) },
    { state: 'moved', candidates: [], threadId: 'another-thread' },
    { state: 'moved', candidates: [], sourceGeneration: 'document-2' },
  ];
  const client = new HelperClient('http://localhost:43120'); client.token = 'x'.repeat(43);
  let response: unknown;
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  for (const next of responses) { response = next; await assert.rejects(client.reattach(request), error => error instanceof HelperTransportError && error.kind === 'response-unknown'); }
  response = { state: 'moved', candidates: [{ start: 1, end: 6 }] };
  assert.deepEqual(await client.reattach(request), { state: 'moved', candidates: [{ start: 1, end: 6 }], threadId: request.threadId, sourceGeneration: request.tabCapture, sourceUrl: request.capture.url });
});
test('reattach binds a pending response to its private request snapshot', async t => {
  const request = { threadId: 'original', text: capture.text, tabCapture: 'original-generation', capture: structuredClone(capture) };
  const original = structuredClone(request), pending = deferred<Response>();
  let sent: unknown;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return pending.promise; });
  const client = new HelperClient('http://localhost:43120');
  const result = client.reattach(request);
  request.threadId = 'changed'; request.tabCapture = 'changed-generation'; request.capture.url = 'https://example.test/changed'; request.text = '';
  pending.resolve(Response.json({ state: 'moved', candidates: [{ start: 0, end: 5 }] }));
  assert.deepEqual(sent, original);
  assert.deepEqual(await result, { state: 'moved', candidates: [{ start: 0, end: 5 }], threadId: original.threadId, sourceGeneration: original.tabCapture, sourceUrl: original.capture.url });
});
test('network, timeout and unreadable success never become definitive application success',async t=>{
  let mode=0;t.mock.method(globalThis,'fetch',async()=>{if(mode===0)throw new Error('secret');if(mode===1)throw new DOMException('raw','TimeoutError');return new Response('bad json');});const client=new HelperClient('http://localhost:43120');
  for(const kind of ['network','timeout','response-unknown']) {await assert.rejects(client.request('/api/change',{}),e=>e instanceof HelperTransportError&&e.kind===kind&&!e.message.includes('secret')&&e.message.includes('unconfirmed'));mode++;}
});
test('EOF stays in the last section rather than jumping to the page head',async()=>{
 const {sectionIndexAt}=await import('../ui/margin.ts');const sections=[{title:'A',start:0,end:10},{title:'B',start:15,end:20}];
 assert.equal(sectionIndexAt(sections,20),1);assert.equal(sectionIndexAt(sections,12),0);assert.equal(sectionIndexAt(sections,-1),0);
});

test('a retained unknown request reappears after remount and opens by reads only',async t=>{
 const e={...dom(t),...storage(t),namespace:crypto.randomUUID()};sessionStorage.setItem('marginalia-draft-tab','recovery-tab');
 const persistence=localPersistence(e.namespace),journal=documentJournal(e.namespace,persistence.journal);
 await journal.change(keep('saved'));const remote=structuredClone(journal.state.threads[0]);remote.sourceVersionId='source';await journal.sync(async()=>{},async()=>[remote]);
 e.data(e.namespace).set('pairing',{origin:e.document.location.origin,token:'x'.repeat(43)});
 const draftKey='draft:recovery-tab:'+capture.url,jobId='unknown-job';
 const retained={jobId,selection:{capture,anchor:remote.anchor,threadId:remote.id,sourceVersionId:'source',question:'Was this accepted?',context:'',resumeJobId:jobId}};
 const first=await mountMargin(asHost(e.root),{capture,storageName:e.namespace,asking:()=>({open(){},setVisible(){},destroy(){}})});
 await persistence.write('asking:'+draftKey+':request:'+jobId,retained);first.destroy();await first.drain();
 const requests:Array<{url:string;method:string}>=[];replaceGlobals(t,{fetch:async(url:string,init:RequestInit={})=>{requests.push({url,method:init.method??'GET'});return Response.json({state:'outcome_unknown'})}});
 let opened:AskingSelection|undefined;
 const second=await mountMargin(asHost(e.root),{capture,storageName:e.namespace,asking:(_root,_context)=>({async open(selection){opened=structuredClone(selection);await fetch('/api/jobs/'+selection.resumeJobId,{method:'GET'})},setVisible(){},destroy(){}})});
 button(e.root,'Check saved request').click();await second.drain();
 assert.equal(opened?.resumeJobId,jobId);assert.deepEqual(requests,[{url:e.document.location.origin+'/api/position',method:'POST'},{url:'/api/jobs/'+jobId,method:'GET'}]);assert.equal(requests.some(request=>request.method==='POST'&&request.url==='/api/jobs'),false);
 second.destroy();await second.drain();
});

for (const outcome of ['exact', 'moved', 'lost', 'unsure', 'error'] as const) test(`Look again explicitly records the full current capture: ${outcome}`, async t => {
  const e = { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
  const persistence = localPersistence(e.namespace), journal = documentJournal(e.namespace, persistence.journal);
  await journal.change(keep('missing'));
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  const missing = { ...capture, text: 'A changed page without the saved passage.' };
  const fresh = { ...capture, text: 'New introduction. ' + capture.text };
  const requests: Array<{ url: string; body: unknown }> = [];
  let captures = 0;
  replaceGlobals(t, { fetch: async (url: string, init: RequestInit = {}) => {
    requests.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
    if (outcome === 'error') throw new Error('offline');
    return Response.json({ state: outcome, candidates: [] });
  } });
  const mounted = await mountMargin(asHost(e.root), { capture: missing, storageName: e.namespace,
    captureCurrentPage: async () => { captures++; return { capture: fresh, tabCapture: 'current-tab-capture' }; },
  });
  assert.match(e.root.textContent, /You were here/);
  assert.match(e.root.textContent, /Reader words/);
  assert.deepEqual(requests, [{ url: e.document.location.origin + '/api/position', body: { url: missing.url } }], 'load performs only the position read');
  assert.equal(captures, 0);
  button(e.root, 'Look again').click();
  await mounted.drain();
  assert.equal(captures, 1);
  assert.deepEqual(requests, [{ url: e.document.location.origin + '/api/position', body: { url: missing.url } }, { url: e.document.location.origin + '/api/reattach', body: {
    threadId: 'missing-thread', text: fresh.text, tabCapture: 'current-tab-capture', capture: fresh,
  } }]);
  assert.match(e.root.textContent, outcome === 'error' ? /unconfirmed/ : outcome === 'exact' || outcome === 'moved' ? /Found again/ : /Still not here/);
  assert.match(e.root.textContent, /Reader words/);
  mounted.destroy(); await mounted.drain();
});

test('reopen renders moved reader language and preserves the original quotation without dispatch or capture', async t => {
  const e = { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
  await documentJournal(e.namespace, localPersistence(e.namespace).journal).change(keep('moved'));
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  const requests: Array<{ url: string; body: unknown }> = []; let captures = 0;
  replaceGlobals(t, { fetch: async (url: string, init: RequestInit = {}) => {
    requests.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
    return Response.json(url.endsWith('/api/reattach') ? { state: 'moved', candidates: [{ start: 18, end: 23 }] } : { anchor: null });
  } });
  const mounted = await mountMargin(asHost(e.root), { capture: { ...capture, text: 'New introduction. ' + capture.text }, storageName: e.namespace,
    captureCurrentPage: async () => { captures++; return { capture, tabCapture: 'moved-tab' }; },
  });
  assert.match(e.root.textContent, /This passage moved/);
  assert.match(e.root.textContent, /The original quotation is still here/);
  assert.equal(mounted.getThread('moved-thread')?.anchor.exact, 'alpha');
  assert.equal(captures, 0);
  assert.deepEqual(requests, [{ url: e.document.location.origin + '/api/position', body: { url: capture.url } }]);
  assert.equal(requests.some(request => /prepare|start|retry|follow-up|retriev|solver|reattach/.test(request.url)), false);
  button(e.root, 'Remember this attachment').click(); await mounted.drain();
  assert.equal(captures, 1);
  assert.deepEqual(requests.slice(1), [{ url: e.document.location.origin + '/api/reattach', body: {
    threadId: 'moved-thread', text: capture.text, tabCapture: 'moved-tab', capture,
  } }]);
  assert.equal(requests.filter(request => request.url.endsWith('/api/reattach')).length, 1);
  assert.equal(requests.some(request => /prepare|start|retry|follow-up|retriev|solver/.test(request.url)), false);
  mounted.destroy(); await mounted.drain();
});

test('reopen renders not-found reader language and preserves the original quotation without dispatch or capture', async t => {
  const e = { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
  await documentJournal(e.namespace, localPersistence(e.namespace).journal).change(keep('lost'));
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  const requests: Array<{ url: string; body: unknown }> = []; let captures = 0;
  replaceGlobals(t, { fetch: async (url: string, init: RequestInit = {}) => {
    requests.push({ url, body: JSON.parse(String(init.body ?? '{}')) }); return Response.json({ anchor: null });
  } });
  const mounted = await mountMargin(asHost(e.root), { capture: { ...capture, text: 'A replacement page.' }, storageName: e.namespace,
    captureCurrentPage: async () => { captures++; return { capture, tabCapture: 'lost-tab' }; },
  });
  assert.match(e.root.textContent, /This passage could not be found/);
  assert.match(e.root.textContent, /The original quotation is still here/);
  assert.equal(mounted.getThread('lost-thread')?.anchor.exact, 'alpha');
  assert.equal(captures, 0);
  assert.deepEqual(requests, [{ url: e.document.location.origin + '/api/position', body: { url: capture.url } }]);
  assert.equal(requests.some(request => /prepare|start|retry|follow-up|retriev|solver|reattach/.test(request.url)), false);
  mounted.destroy(); await mounted.drain();
});

test('a stale reattach response after the margin is replaced is rejected and not cached', async t => {
  const e = { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
  const moved = { ...capture, text: 'New introduction. ' + capture.text };
  await documentJournal(e.namespace, localPersistence(e.namespace).journal).change(keep('stale'));
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  const pending = deferred<Response>();
  replaceGlobals(t, { fetch: async (url: string) => url.endsWith('/api/reattach') ? pending.promise : Response.json({ anchor: null }) });
  const mounted = await mountMargin(asHost(e.root), { capture: moved, storageName: e.namespace,
    captureCurrentPage: async () => ({ capture: moved, tabCapture: 'stale-document' }),
  });
  button(e.root, 'Remember this attachment').click();
  await tick();
  mounted.destroy();
  pending.resolve(Response.json({ state: 'moved', candidates: [{ start: 18, end: 23 }] }));
  await mounted.drain();
  assert.deepEqual(await localPersistence(e.namespace).values('attachment-observation:'), []);
});

for (const invalidate of ['destroy', 'helper'] as const) test(`reattach cannot persist when ${invalidate} changes during digest`, async t => {
  const e = { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
  const moved = { ...capture, text: 'New introduction. ' + capture.text };
  await documentJournal(e.namespace, localPersistence(e.namespace).journal).change(keep('digest'));
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  replaceGlobals(t, { fetch: async (url: string) => Response.json(url.endsWith('/api/reattach') ? { state: 'moved', candidates: [{ start: 18, end: 23 }] } : { anchor: null }) });
  const mounted = await mountMargin(asHost(e.root), { capture: moved, storageName: e.namespace, captureCurrentPage: async () => ({ capture: moved, tabCapture: 'digest-document' }) });
  const pending = deferred<ArrayBuffer>(), entered = deferred();
  t.mock.method(crypto.subtle, 'digest', async () => { entered.resolve(); return pending.promise; });
  button(e.root, 'Remember this attachment').click();
  await entered.promise;
  if (invalidate === 'destroy') mounted.destroy(); else mounted.connection().token = 'y'.repeat(43);
  pending.resolve(new ArrayBuffer(32));
  await mounted.drain();
  assert.deepEqual(await localPersistence(e.namespace).values('attachment-observation:'), []);
  mounted.destroy(); await mounted.drain();
});

test('an identical moved observation is read from local persistence and does not offer Remember after remount', async t => {
  const e = { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
  const moved = { ...capture, text: 'New introduction. ' + capture.text };
  await documentJournal(e.namespace, localPersistence(e.namespace).journal).change(keep('persisted'));
  e.data(e.namespace).set('pairing', { origin: e.document.location.origin, token: 'x'.repeat(43) });
  const requests: string[] = [];
  replaceGlobals(t, { fetch: async (url: string) => {
    requests.push(url);
    return Response.json(url.endsWith('/api/reattach') ? { state: 'moved', candidates: [{ start: 18, end: 23 }] } : { anchor: null });
  } });
  const options = { capture: moved, storageName: e.namespace, captureCurrentPage: async () => ({ capture: moved, tabCapture: 'same-document' }) };
  const first = await mountMargin(asHost(e.root), options);
  const remember = button(e.root, 'Remember this attachment');
  remember.click(); await first.drain();
  assert.doesNotMatch(e.root.textContent, /Remember this attachment/);
  remember.click(); await first.drain();
  assert.equal(requests.filter(url => url.endsWith('/api/reattach')).length, 1);
  first.destroy(); await first.drain();
  const second = await mountMargin(asHost(e.root), options);
  assert.match(e.root.textContent, /This passage moved/);
  assert.doesNotMatch(e.root.textContent, /Remember this attachment/);
  assert.equal(requests.filter(url => url.endsWith('/api/reattach')).length, 1);
  second.destroy(); await second.drain();
});

test('exact quote has no attachment-state marker', async t => {
  const e = { ...dom(t), ...storage(t), namespace: crypto.randomUUID() };
  await documentJournal(e.namespace, localPersistence(e.namespace).journal).change(keep('found'));
  const mounted = await mountMargin(asHost(e.root), { capture, storageName: e.namespace });
  assert.doesNotMatch(e.root.textContent, /You were here|Look again|Remember this attachment/);
  assert.match(e.root.textContent, /Reader words/);
  mounted.destroy(); await mounted.drain();
});
