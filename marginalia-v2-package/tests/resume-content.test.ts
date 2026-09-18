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
    const source = url === 'resume-content:browser' ? 'export const browser=globalThis.__resumeContentTest.browser;'
      : url === 'resume-content:script' ? 'export const defineContentScript=value=>value;'
      : url === 'resume-content:capture' ? 'export const captureSelection=()=>null; export const locate=()=>null; export const projectPage=()=>({ text:"", nodes:[] });'
      : undefined;
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});

test('content Resume consumes the marker once and preserves pre-existing history state', async t => {
  const fixture = dom(t), sourceUrl = 'https://source.example/article#marginalia-resume=thread-1';
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
        return { ok: true, value: message.type === 'resume' ? { consumed: true, resumed: true } : { allowed: true } };
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
    assert.equal(replacements.length, 1);
    assert.strictEqual(replacements[0][0], priorState);
    assert.equal(replacements[0][2], 'https://source.example/article');
    assert.equal((globalThis.location as Location).href, 'https://source.example/article');
    assert.strictEqual(history.state, priorState);
    await settle();
    assert.equal(sent.filter(message => message.type === 'resume').length, 1);
    assert.equal(replacements.length, 1);
  } finally {
    invalidated?.();
    delete boundary.__resumeContentTest;
  }
});
