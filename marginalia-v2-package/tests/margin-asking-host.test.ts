import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { AskingContext, AskingSelection } from '../ui/asking-host.ts';
import type { Thread, SourceVersion } from '../contracts/reader.ts';
import { startServer } from '../daemon/server.ts';

// Test the T05 adapter, not T08/provider internals. All network/renderer boundaries
// are injected. The peer subset follows the inspected public T08 interface.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '../contracts/reply.ts') return { url:'t05:canonical',shortCircuit:true };
  if (context.parentURL?.endsWith('/ui/asking-host.ts') && specifier === './consent.ts') return {url:'t05:consent',shortCircuit:true};
  if (context.parentURL?.endsWith('/ui/asking-host.ts') && specifier === '../renderer/index.ts') return {url:'t05:renderer',shortCircuit:true};
  return next(specifier,context);
}, load(url,context,next) {
  if(url==='t05:canonical') return {format:'module',shortCircuit:true,source:`export function canonicalReplyData(v){return Array.isArray(v)?'['+v.map(canonicalReplyData).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalReplyData(v)).join(',')+'}':JSON.stringify(v)};export const validateReply=()=>({ok:false,errors:['fixture']});`};
  if(url==='t05:consent')return{format:'module',shortCircuit:true,source:'export const mountConsentSheet=()=>{throw Error("not exercised")};'};
  if(url==='t05:renderer')return{format:'module',shortCircuit:true,source:'export const mountReply=()=>{throw Error("not exercised")};'};
  return next(url,context);
}});
const {createT08Mount}=await import('../ui/asking-host.ts');
const source:SourceVersion={id:'source',sourceId:'s',hash:'a'.repeat(64),text:'alpha beta',capturedAt:'2026-09-17T00:00:00Z',extractionVersion:'fixture',title:'Source',pageType:'article',metadataStatus:'provided'};
const thread:Thread={id:'thread',anchorId:'anchor',sourceVersionId:source.id,sourceUrl:'https://source.test/',sourceTitle:'Source',anchor:{exact:'alpha',prefix:'',suffix:' beta',start:0,end:5},notes:[],revision:1,state:'open',highlighted:true,createdAt:source.capturedAt!,updatedAt:source.capturedAt!,deletedAt:null};
const selection:AskingSelection={threadId:thread.id,sourceVersionId:source.id,capture:{url:thread.sourceUrl,title:'Source',text:source.text,capturedAt:source.capturedAt!,extractionVersion:'fixture',pageType:'article'},anchor:thread.anchor,question:'',context:''};
const tick=()=>new Promise<void>(r=>setImmediate(r));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
function harness(t:import('node:test').TestContext, access: { surface?: 'localhost'|'native-panel'|'floating'; excluded?: boolean; supported?: boolean; resumeJobId?: string } = {}){
  const descriptors=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({location:{origin:'http://localhost:43120'},document:{activeElement:null},HTMLElement:class{}})){
    descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  t.after(()=>{for(const[key,value]of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
  const abort=new AbortController(), writes=new Map<string,unknown>(), calls:string[]=[], reads:string[]=[], posts:string[]=[], events:string[]=[];
  let state:any={phase:'local',submitted:false,canCheck:false};let listener:((s:any)=>void)|undefined;
  let beforeWrite:((key:string)=>Promise<void>)|undefined,authorize:(()=>Promise<void>)|undefined;
  let transport:any, flowOptions:any, closed=0;
  const question={value:''},contextField={value:''};
  const host={hidden:false,addEventListener(){},querySelector:()=>question,querySelectorAll:()=>[question,contextField]} as unknown as HTMLElement;
  const client={origin:'http://localhost:43120',token:'fixture-token',connectionVersion:1,permissionVersion:0,exportThread:async()=>({thread:structuredClone(thread),source:structuredClone(source),replies:[],replyViews:[]}),request:async(path:string,body?:unknown)=>{calls.push(path);(body===undefined?reads:posts).push(path);return{}},replies:async()=>({replies:[],source,views:[]})};
  const flow={getState:()=>structuredClone(state),openAsk(){state.phase='suggestions';},ask:async()=>{events.push('ask');const a=flowOptions.currentAccess();if(a.excluded){state={...state,phase:'excluded',blocker:'excluded'};return;}if(!a.supported){state={...state,phase:'unavailable',blocker:'unsupported'};return;}if(!a.canAuthorize||a.surface==='floating'){state={...state,phase:'unavailable',blocker:'browser-owned-required'};return;}await transport.get('/api/jobs');},reopen:async({jobId}:{jobId?:string})=>{events.push('reopen');await transport.get('/api/jobs');await transport.get('/api/jobs/'+jobId)},refresh:async()=>{events.push('refresh')},close(){state.phase='closed'},invalidate(){state.phase='stale';listener?.(state)},reconcile(){},subscribe(fn:(s:any)=>void){listener=fn;fn(state);return()=>{listener=undefined}}};
  const peer={createAskingHost(t:any){transport=t;return{readReply:async()=>{throw Error('not used')}}},bindAskingThread(t:Thread,s:SourceVersion,id:string){return{threadId:t.id,anchorId:t.anchorId,captureId:id,sourceVersionId:s.id,sourceHash:s.hash,sourceUrl:t.sourceUrl,sourceTitle:t.sourceTitle,sourcePageType:s.pageType,sourceCapturedAt:s.capturedAt,sourceText:s.text,anchor:t.anchor}},createAskingFlow:(options:any)=>{flowOptions=options;return flow},mountAskingCard:()=>({destroy(){}})};
  const context={helper:()=>client,signal:abort.signal,surface:access.surface??'localhost',access:()=>({excluded:access.excluded??false,supported:access.supported??true}),authorize:async()=>{await authorize?.()},currentThread:()=>thread,ensureContextSaved:async()=>{},read:async(key:string)=>access.resumeJobId&&key==='request:'+access.resumeJobId?{jobId:access.resumeJobId,binding:structuredClone(flowOptions.binding)}:writes.get(key),write:async(key:string,value:unknown)=>{await beforeWrite?.(key);writes.set(key,structuredClone(value));},persistence:{},track:<T>(work:Promise<T>)=>work,highlight(){},navigate(){},onCommitted(){},onClosed(){closed++}} as unknown as AskingContext;
  const mount=createT08Mount(async()=>peer as any)(host,context);t.after(()=>mount.destroy());
  return{mount,calls,reads,posts,events,writes,client,abort,host,question,access:()=>flowOptions?.currentAccess(),state:()=>structuredClone(state),closed:()=>closed,setWrite(fn:typeof beforeWrite){beforeWrite=fn},setAuthorize(fn:typeof authorize){authorize=fn},setState(value:any){state={...state,...value};listener?.(state)},send:(path:string,body:unknown)=>transport.request(path,body)};
}
test('mounting and reopening a blank question perform no model call or implicit preparation',async t=>{
 const h=harness(t);assert.deepEqual(h.calls,[]);await h.mount.open(selection);assert.deepEqual(h.calls,[]);assert.deepEqual(h.events,[]);h.mount.setVisible(false);h.mount.setVisible(true);assert.equal(h.closed(),1,'invalidated hidden review returns to retained draft');assert.deepEqual(h.calls,[]);
});
test('cancel while exact request history awaits durability fences the later POST',async t=>{
 const h=harness(t);await h.mount.open(selection);h.setState({phase:'submitting',submitted:true,requestId:'attempt-one'});
 const gate=deferred();h.setWrite(async key=>{if(key==='request:attempt-one')await gate.promise});
 const sending=h.send('/api/jobs',{id:'attempt-one'}),rejected=assert.rejects(sending,/cancelled|no longer|changed/);await tick();h.setState({phase:'cancel_requested'});gate.resolve();await rejected;
 assert.ok(h.writes.has('request:attempt-one'));assert.deepEqual(h.calls,[]);
});
test('connection replacement during request durability never sends with the replacement token',async t=>{
 const h=harness(t);await h.mount.open(selection);h.setState({phase:'submitting',submitted:true,requestId:'attempt-two'});
 const gate=deferred();h.setWrite(async key=>{if(key==='request:attempt-two')await gate.promise});const sending=h.send('/api/jobs',{id:'attempt-two'}),rejected=assert.rejects(sending,/connection changed/);await tick();h.client.connectionVersion++;gate.resolve();await rejected;assert.deepEqual(h.calls,[]);
});
test('explicit current submission writes immutable history and resume pointer before one POST',async t=>{
 const h=harness(t);await h.mount.open(selection);h.setState({phase:'submitting',submitted:true,requestId:'attempt-three'});const order:string[]=[];
 h.setWrite(async key=>{order.push(key);assert.equal(h.calls.length,0)});await h.send('/api/jobs',{id:'attempt-three'});
 assert.deepEqual(order,['request:attempt-three','request']);assert.deepEqual(h.calls,['/api/jobs']);assert.equal((h.writes.get('request')as any).jobId,'attempt-three');
});
test('closing during authorization prevents any request and retains previously saved history',async t=>{
 const h=harness(t);await h.mount.open(selection);h.setState({phase:'submitting',submitted:true,requestId:'attempt-four'});const gate=deferred();h.setAuthorize(()=>gate.promise);
 const sending=h.send('/api/jobs',{id:'attempt-four'}),rejected=assert.rejects(sending,/closed|changed/);await tick();h.mount.destroy();gate.resolve();await rejected;assert.deepEqual(h.calls,[]);
});
test('hidden submitted work is not cancelled or resent merely by visibility changes',async t=>{
 const h=harness(t);await h.mount.open(selection);h.setState({phase:'working',submitted:true,canCheck:true,requestId:'existing'});h.mount.setVisible(false);h.mount.setVisible(true);assert.equal(h.closed(),0);assert.deepEqual(h.calls,[]);assert.deepEqual(h.events,[]);
});

test('native panel reaches availability and saved-job inspection by reads only',async t=>{
 const h=harness(t,{surface:'native-panel',resumeJobId:'saved-job'});h.client.origin='http://127.0.0.1:43120';
 await h.mount.open({...selection,resumeJobId:'saved-job'});
 assert.match(h.access().epoch,/./);assert.equal(h.access().surface,'native-panel');assert.equal(h.access().canAuthorize,true);
 assert.deepEqual(h.reads,['/api/jobs','/api/jobs/saved-job']);assert.deepEqual(h.posts,[]);
});

test('floating mount reports browser-owned-required without probing or posting',async t=>{
 const h=harness(t,{surface:'floating'});h.client.origin='http://127.0.0.1:43120';await h.mount.open({...selection,question:'Why?'});
 assert.equal(h.access().surface,'floating');assert.equal(h.access().canAuthorize,false);assert.equal(h.state().blocker,'browser-owned-required');assert.deepEqual(h.calls,[]);
});

test('excluded mount reports excluded without probing or posting',async t=>{
 const h=harness(t,{surface:'native-panel',excluded:true});h.client.origin='http://127.0.0.1:43120';await h.mount.open({...selection,question:'Why?'});
 assert.equal(h.state().blocker,'excluded');assert.deepEqual(h.calls,[]);
});

test('real helper admits a well-formed extension origin on preflight and answers an unpaired GET with 401, never 403',async t=>{
 const helper=await startServer({database:':memory:',port:0,diagnostics:()=>({status:'unavailable'})});t.after(()=>helper.close());
 const origin='chrome-extension://'+'abcdefghijklmnop'.repeat(2),authorization='Bearer '+ 'a'.repeat(43);
 const preflight=await fetch(helper.origin+'/api/jobs',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
 const get=await fetch(helper.origin+'/api/jobs',{headers:{origin,authorization}});
 assert.equal(preflight.status,204);assert.equal(get.status,401);
 assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.equal(get.headers.get('access-control-allow-origin'),origin);
 assert.match((await get.json()).error,/Pair with the local helper/);
});
