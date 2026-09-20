import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { dom, replaceGlobals, settle } from './t05-dom.ts';

const boundary = globalThis as typeof globalThis & { __resumeContentTest?: { browser: unknown } };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'wxt/browser') return { url: 'resume-content:browser', shortCircuit: true };
    if (specifier === 'wxt/utils/define-content-script') return { url: 'resume-content:script', shortCircuit: true };
    if (context.parentURL?.includes('/extension/entrypoints/content.ts') && specifier === '../lib/capture.ts') return { url: 'resume-content:capture', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const source = url === 'resume-content:browser' ? 'export const browser=new Proxy({}, {get:(_,key)=>globalThis.__resumeContentTest.browser[key]});'
      : url === 'resume-content:script' ? 'export const defineContentScript=value=>value;'
      : url === 'resume-content:capture' ? 'export const captureSelection=()=>null; export const locate=()=>null; export const projectPage=()=>({ text:"", nodes:[] });'
      : undefined;
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});

const cases = [
  { name: 'legacy in-place cleanup', marker: 'thread-1', restored: '' },
  { name: 'empty hash', marker: 'v2:thread-1:', restored: '' },
  { name: 'ordinary hash', marker: 'v2:thread-1:%23section', restored: '#section' },
  { name: 'encoded hash', marker: 'v2:thread-1:%23part%2520two%252fthree', restored: '#part%20two%2fthree' },
  { name: 'hash router', marker: 'v2:thread-1:%23%2Fchapter%2F2%3Fmode%3Dread%3Awide', restored: '#/chapter/2?mode=read:wide' },
  { name: 'marker-looking original', marker: 'v2:thread-1:%23marginalia-resume%3Dold', restored: '#marginalia-resume=old' },
  { name: 'versioned marker-looking original', marker: 'v2:thread-1:%23marginalia-resume%3Dv2%3Aold%3A', restored: '#marginalia-resume=v2:old:' },
  { name: 'legacy intervening navigation', marker: 'thread-1', restored: '', navigated: 'https://source.example/article#new' },
  { name: 'intervening hash navigation', marker: 'v2:thread-1:%23original', restored: '#original', navigated: 'https://source.example/article#new' },
  { name: 'intervening document navigation', marker: 'v2:thread-1:%23original', restored: '#original', navigated: 'https://source.example/other#marginalia-resume=v2:thread-1:%23original' },
  { name: 'intervening marker change', marker: 'v2:thread-1:%23original', restored: '#original', navigated: 'https://source.example/article#marginalia-resume=v2:thread-1:%23new' },
  { name: 'unconsumed response', marker: 'v2:thread-1:%23original', restored: '#original', consumed: false },
  { name: 'failed response', marker: 'v2:thread-1:%23original', restored: '#original', failed: true },
];
for (const scenario of cases) test('content Resume: ' + scenario.name + ' preserves state and consumes once', async t => {
  const fixture = dom(t), sourceUrl = 'https://source.example/article#marginalia-resume=' + scenario.marker;
  const view = fixture.document.defaultView as any;
  view.top = view;
  (fixture.document as any).visibilityState = 'visible';
  const priorState = { router: 'keep', revision: 7 };
  const replacements: unknown[][] = [];
  const sent: Array<{ type?: string; version?: number; threadId?: string }> = [];
  const history: { state: unknown; replaceState(state: unknown, title: string, nextUrl: string): void } = {
    state: priorState,
    replaceState(state: unknown, _title: string, nextUrl: string) {
      replacements.push([state, _title, nextUrl]);
      history.state = state;
      (globalThis.location as Location).href = nextUrl;
    },
  };
  const browser = {
    runtime: {
      id: 'extension-test',
      sendMessage: async (message: typeof sent[number]) => {
        sent.push(message);
        if (message.type === 'resume') {
          await Promise.resolve();
          if (scenario.navigated) globalThis.location.href = scenario.navigated;
          if (scenario.failed) throw new Error('resume unavailable');
          return { ok: true, value: { consumed: scenario.consumed !== false, resumed: true } };
        }
        return { ok: true, value: { allowed: true } };
      },
      onMessage: { addListener() {} },
      getURL: (path: string) => 'chrome-extension://test' + path,
    },
  };
  boundary.__resumeContentTest = { browser };
  class MutationObserverMock { observe() {} disconnect() {} }
  replaceGlobals(t, {
    window: view,
    location: new URL(sourceUrl),
    history,
    MutationObserver: MutationObserverMock,
    crypto: { randomUUID: () => 'content-document' },
    CSS: {},
  });
  let invalidated: (() => void) | undefined;
  const content = (await import(new URL('../extension/entrypoints/content.ts?resume-content-test', import.meta.url).href)).default;
  try {
    (content as any).main({
      addEventListener() {},
      onInvalidated(callback: () => void) { invalidated = callback; },
    });
    await settle();
    assert.equal(sent.filter(message => message.type === 'resume').length, 1);
    assert.deepEqual(sent.find(message => message.type === 'resume'), { type: 'resume', version: 1, threadId: 'thread-1' });
    const cleaned = !scenario.navigated && scenario.consumed !== false && !scenario.failed;
    assert.equal(replacements.length, cleaned ? 1 : 0);
    if (cleaned) {
      assert.strictEqual(replacements[0][0], priorState);
      assert.equal(replacements[0][1], '');
      assert.equal(replacements[0][2], 'https://source.example/article' + scenario.restored);
    }
    assert.equal(globalThis.location.href, scenario.navigated ?? (cleaned ? 'https://source.example/article' + scenario.restored : sourceUrl));
    assert.strictEqual(history.state, priorState);
    await settle();
    assert.equal(sent.filter(message => message.type === 'resume').length, 1);
    assert.equal(replacements.length, cleaned ? 1 : 0);
  } finally {
    invalidated?.();
    delete boundary.__resumeContentTest;
  }
});
