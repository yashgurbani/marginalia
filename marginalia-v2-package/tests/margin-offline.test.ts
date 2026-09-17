import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Executes the shipped worker against controlled response and CacheStorage order.
// This does not claim browser storage conformance or a built-Vite deployment.
function worker() {
  const stores = new Map<string, Map<string, Response>>(), network = new Map<string, { body: string; type?: string }>();
  const handlers = new Map<string, (event: any) => void>(); let failPointer = false;
  const key = (v: string | Request) => new URL(typeof v === 'string' ? v : v.url, 'http://localhost:43120').pathname;
  const caches = { async open(name: string) {
    let store = stores.get(name); if (!store) { store = new Map(); stores.set(name, store); }
    return { async match(v: string | Request) { return store!.get(key(v))?.clone(); }, async put(v: string | Request, response: Response) {
      if (failPointer && key(v).includes('complete_generation')) throw Error('pointer quota'); store!.set(key(v), response.clone());
    } };
  }, async keys() { return [...stores.keys()]; }, async delete(name: string) { return stores.delete(name); } };
  runInNewContext(readFileSync(new URL('../webapp/public/sw.js', import.meta.url), 'utf8'), { URL, Request, Response, TextEncoder, crypto, caches,
    self: { location: { origin: 'http://localhost:43120' }, addEventListener: (name: string, action: (e:any)=>void) => handlers.set(name, action), skipWaiting: async()=>{}, clients:{claim:async()=>{}} },
    fetch: async(v: string | Request)=>{const file=network.get(key(v));if(!file)throw Error('offline '+key(v));return new Response(file.body,{headers:{'content-type':file.type??'text/javascript'}});},
  });
  return { stores, network, failPointer(value:boolean){failPointer=value}, async install(){let promise:Promise<unknown>|undefined;handlers.get('install')!({waitUntil(p:Promise<unknown>){promise=p}});await promise}, request(path:string,headers:Record<string,string>={}){let promise:Promise<Response>|undefined;handlers.get('fetch')!({request:new Request('http://localhost:43120'+path,{headers}),respondWith(p:Promise<Response>){promise=p}});return promise} };
}
function first(w:ReturnType<typeof worker>){w.network.set('/index.html',{body:'<script src="/assets/old.js"></script>',type:'text/html'});w.network.set('/assets/old.js',{body:'old app'});}
test('missing transitive assets cannot promote a new index or destroy the working generation',async()=>{
 const w=worker();first(w);await w.install();w.network.set('/index.html',{body:'<script src="/assets/new.js"></script>',type:'text/html'});w.network.set('/assets/new.js',{body:'import "./style.css"; const lazy=["assets/lazy.js"];'});w.network.set('/assets/style.css',{body:'a{background:url(./font.woff2)}',type:'text/css'});w.network.set('/assets/lazy.js',{body:'lazy code'});
 assert.match(await(await w.request('/')!).text(),/old.js/);assert.equal(w.stores.size,2);
 w.network.set('/assets/font.woff2',{body:'font fixture',type:'font/woff2'});assert.match(await(await w.request('/')!).text(),/new.js/);w.network.clear();assert.match(await(await w.request('/')!).text(),/new.js/);assert.equal(await(await w.request('/assets/font.woff2')!).text(),'font fixture');assert.equal(await(await w.request('/assets/old.js')!).text(),'old app');
});
test('failed pointer commit leaves the previous generation usable and a later explicit navigation can promote',async()=>{
 const w=worker();first(w);await w.install();w.network.set('/index.html',{body:'<script src="/assets/new.js"></script>',type:'text/html'});w.network.set('/assets/new.js',{body:'new app'});w.failPointer(true);assert.match(await(await w.request('/')!).text(),/old.js/);w.failPointer(false);assert.match(await(await w.request('/')!).text(),/new.js/);
});
test('same generation is reused; private routes, query requests and authorization never enter the cache handler',async()=>{
 const w=worker();first(w);await w.install();await w.request('/');await w.request('/');assert.equal(w.stores.size,2);
 for(const p of ['/pair','/health','/api/jobs','/api/threads','/api/helper-management/browsers','/assets/a.js?private=1'])assert.equal(w.request(p),undefined);
 assert.equal(w.request('/assets/old.js',{authorization:'Bearer private'}),undefined);
});
test('an HTML fallback response masquerading as a packaged script cannot replace the working index',async()=>{
 const w=worker();first(w);await w.install();w.network.set('/index.html',{body:'<script src="/assets/new.js"></script>',type:'text/html'});w.network.set('/assets/new.js',{body:'<html>not a script</html>',type:'text/html'});assert.match(await(await w.request('/')!).text(),/old.js/);assert.equal(w.stores.size,2);
});
