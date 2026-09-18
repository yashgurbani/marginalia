import test from 'node:test';
import assert from 'node:assert/strict';
import { dom, button, replaceGlobals, TestElement } from './t05-dom.ts';
import { asHost, storage } from './t05-harness.ts';
import { mountHearIt } from '../ui/hear-it.ts';
import { mountMargin } from '../ui/margin.ts';
import type { SourceCapture } from '../contracts/reader.ts';

function setup(t: import('node:test').TestContext) {
  const e = dom(t); let cancels = 0;
  const local = { name: 'Local', lang: 'en', voiceURI: 'local', localService: true, default: false } as SpeechSynthesisVoice;
  const remote = { name: 'Remote', lang: 'en', voiceURI: 'remote', localService: false, default: true } as SpeechSynthesisVoice;
  let voices = [remote, local]; const spoken: FakeUtterance[] = [];
  class FakeUtterance { text: string; voice: SpeechSynthesisVoice | null = null; lang = ''; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text; } }
  const synth = Object.assign(new EventTarget(), { getVoices: () => voices.map(v => ({ ...v })), speak: (u: FakeUtterance) => spoken.push(u), cancel: () => { cancels++; } });
  replaceGlobals(t, { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
  return { ...e, synth, spoken, local, remote, voices: (v: SpeechSynthesisVoice[]) => { voices = v; synth.dispatchEvent(new Event('voiceschanged')); }, cancels: () => cancels };
}

test('Hear it uses only explicit local voice playback, stops by Escape and fences late events', t => {
  const e = setup(t), mounted = mountHearIt(asHost(e.root), () => 'Selected passage.');
  assert.equal(e.spoken.length, 0); button(e.root, 'Hear it').click();
  assert.equal(e.spoken.length, 1); assert.equal(e.spoken[0].voice?.localService, true); assert.equal(e.spoken[0].text, 'Selected passage.');
  const late = e.spoken[0].onend!;
  (window as unknown as TestElement).fire('keydown', { key: 'Escape' });
  assert.equal(e.cancels(), 1); assert.equal(button(e.root, 'Stop reading').hidden, true);
  late(); assert.equal(e.spoken.length, 1); mounted.destroy(); assert.equal(e.cancels(), 1);
});

test('remote-only and absent speech remain unavailable; voices arriving never start playback', t => {
  const e = setup(t); e.voices([e.remote]); const mounted = mountHearIt(asHost(e.root), () => 'Private source.');
  assert.equal(e.root.children.length, 0);
  e.voices([e.remote, e.local]); assert.equal(button(e.root, 'Hear it').disabled, false); assert.equal(e.spoken.length, 0);
  button(e.root, 'Hear it').click(); e.voices([e.remote]); assert.equal(e.cancels(), 1); assert.equal(e.root.children.length, 0);
  mounted.destroy(); replaceGlobals(t, { speechSynthesis: undefined });
  mountHearIt(asHost(e.root), () => 'Private source.'); assert.equal(e.root.children.length, 0);
});

test('long local reading preserves all text, announces once and stops on destroy', t => {
  const e = setup(t), text = 'A local sentence. '.repeat(200).trim(); const mounted = mountHearIt(asHost(e.root), () => text);
  button(e.root, 'Hear it').click();
  const status = e.root.querySelector('[role="status"]')!;
  const firstStatus = status.textContent; e.spoken[0].onend!(); assert.equal(status.textContent, firstStatus);
  for (let i = 1; i < e.spoken.length; i++) e.spoken[i].onend!();
  assert.equal(e.spoken.map(u => u.text).join(''), text); assert.equal(status.textContent, 'Reading finished.');
  button(e.root, 'Hear it').click(); const late = e.spoken.at(-1)!.onend!; const count = e.spoken.length;
  mounted.destroy(); late(); assert.equal(e.spoken.length, count);
});

test('speech failure is recoverable and empty passages never speak', t => {
  const e = setup(t); let text = ''; const mounted = mountHearIt(asHost(e.root), () => text);
  button(e.root, 'Hear it').click(); assert.equal(e.spoken.length, 0); text = 'A passage.';
  button(e.root, 'Hear it').click(); e.spoken[0].onerror!(); assert.equal(button(e.root, 'Hear it').disabled, false);
  button(e.root, 'Hear it').click(); assert.equal(e.spoken.length, 2); mounted.destroy();
});

test('margin Hear it reads selection or current reading position without source mutation or implicit playback', async t => {
  const e = setup(t); storage(t);
  const capture: SourceCapture = { url: 'https://example.org', text: 'First sentence. Second sentence.', title: 'Source', pageType: 'article', extractionVersion: 'test', capturedAt: '2026-09-18T00:00:00Z' };
  const source = e.document.createElement('article'); source.textContent = capture.text; e.document.body.append(source);
  const api = await mountMargin(asHost(e.root), { capture, sourceRoot: asHost(source), allowHelper: false, storageName: crypto.randomUUID(), readPosition: async () => undefined });
  await api.drain(); api.setReadingPosition(16); button(e.root, 'Hear it').click(); assert.equal(e.spoken[0].text, 'Second sentence.');
  button(e.root, 'Stop reading').click(); api.select({ exact: 'First sentence.', prefix: '', suffix: ' Second sentence.', start: 0, end: 15 });
  assert.equal(e.spoken.length, 1); button(e.root, 'Hear it').click(); assert.equal(e.spoken[1].text, 'First sentence.');
  api.suspend(); api.resume(); assert.equal(e.spoken.length, 2); assert.equal(source.textContent, capture.text);
  api.destroy(); await api.drain();
});

test('voice disappearing between explicit press and utterance creation restores controls without speaking', t => {
  const e = setup(t), mounted = mountHearIt(asHost(e.root), () => 'Private text.');
  let calls = 0; e.synth.getVoices = () => ++calls === 1 ? [e.local] : [];
  button(e.root, 'Hear it').click(); assert.equal(e.spoken.length, 0); assert.equal(button(e.root, 'Stop reading').hidden, true);
  assert.equal(button(e.root, 'Hear it').disabled, true); assert.match(e.root.textContent, /local voice is unavailable/); mounted.destroy();
});

test('voice change between chunks refuses continuation and preserves the selected local voice boundary', t => {
  const e = setup(t), mounted = mountHearIt(asHost(e.root), () => 'Long passage. '.repeat(200));
  button(e.root, 'Hear it').click(); e.synth.getVoices = () => [e.remote]; e.spoken[0].onend!();
  assert.equal(e.spoken.length, 1); assert.equal(button(e.root, 'Stop reading').hidden, true); mounted.destroy();
});
