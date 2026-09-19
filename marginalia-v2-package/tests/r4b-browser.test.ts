import test from 'node:test';
import assert from 'node:assert/strict';
import { withRealBrowser } from '../renderer/testing/real-browser.ts';

for (const zoom of [1, 2] as const) test(`R4b quiet margin at 360 px and ${zoom * 100}% zoom`, {
  skip: process.env.R4B_CHROMIUM ? false : 'Set R4B_CHROMIUM to run quiet-margin browser acceptance.', timeout: 90_000,
}, async () => {
  const result = await withRealBrowser(process.env.R4B_CHROMIUM!, async page => {
    await page.evaluate(`(async () => {
      await import('/ui/margin.css');
      const { mountMargin } = await import('/ui/margin.ts');
      const root = document.createElement('div'); document.body.append(root);
      const source = document.createElement('article'); source.textContent = 'First passage. Second passage. Third passage.';
      const capture = { url: 'https://example.org/quiet', title: 'A captured page with a real title', pageType: 'Article', text: source.textContent,
        capturedAt: '2026-09-18T00:00:00Z', extractionVersion: 'test', sections: [{title:'First',start:0,end:15},{title:'Second',start:15,end:31},{title:'Third',start:31,end:45}] };
      const spoken = []; let voices = [];
      const synth = Object.assign(new EventTarget(), {getVoices:()=>voices, speak:value=>spoken.push(value), cancel() {}});
      Object.defineProperty(window, 'speechSynthesis', {configurable:true,value:synth});
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable:true,value:class {constructor(text){this.text=text;}}});
      const requests = []; window.fetch = async (...args) => { requests.push(args); throw new Error('Unexpected request'); };
      const api = await mountMargin(root, {capture, allowHelper:false, storageName:crypto.randomUUID(), initialOpen:true, onLibrary() {}});
      await api.drain();
      window.r4b = {api, root, capture, source, spoken, requests, voices(value) {voices=value;synth.dispatchEvent(new Event('voiceschanged'));}};
    })()`);
    const measure = () => page.evaluate<{ controls: string[]; overflow: string[]; markers: number; live: boolean; notice: boolean; titleVisible: boolean; mapInPanel: boolean; mapInRail: boolean }>(`(() => {
      const panel = r4b.root.querySelector('.m-panel');
      // A closed details keeps its descendants' geometry, so rects alone overcount.
      const inClosedDetails = node => {
        for (let at = node; at; at = at.parentElement) {
          const parent = at.parentElement;
          if (parent && parent.tagName === 'DETAILS' && !parent.open && at !== parent.children[0]) return true;
        }
        return false;
      };
      const visible = node => typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
        : Boolean(node.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden' && !inClosedDetails(node);
      return { controls:[...panel.querySelectorAll('button,input,textarea,select,summary')].filter(visible).map(node=>node.textContent),
        overflow:[document.documentElement, ...panel.querySelectorAll('*')].filter(node=>visible(node) && getComputedStyle(node).position!=='absolute' && node.clientWidth && node.scrollWidth>node.clientWidth+1).map(node=>node.className||node.tagName),
        markers:panel.querySelectorAll('.m-section-marker').length, live:!!panel.querySelector('[aria-live="polite"]'),
        notice:!!visible(panel.querySelector('.m-notice')), titleVisible:panel.querySelector('.m-head').getBoundingClientRect().width>10,
        mapInPanel:!!panel.querySelector('.m-map'),mapInRail:!!r4b.root.querySelector('.m-rail .m-map') };
    })()`);
    const resting = await measure();
    assert.deepEqual(resting.controls, ['Collapse', 'Write here…', 'Read later', 'Library', 'More']);
    assert.deepEqual(resting.overflow, []); assert.equal(resting.markers, 0); assert.equal(resting.live, true);
    assert.equal(resting.notice, false); assert.equal(resting.titleVisible, true);
    assert.equal(resting.mapInPanel, false); assert.equal(resting.mapInRail, true);
    await page.evaluate("r4b.voices([{localService:true,voiceURI:'local',name:'Local',lang:'en'}])");
    assert.deepEqual((await measure()).controls, resting.controls);
    await page.evaluate("r4b.voices([]);r4b.api.setReadingPosition(r4b.capture.text.length)");
    assert.deepEqual(await page.evaluate("[...r4b.root.querySelector('.m-end-offers').children].map(n=>n.textContent)"), ['Think with it', 'Go further']);
    assert.deepEqual((await measure()).overflow, []);
    await page.evaluate(`(async () => {
      r4b.api.setReadingPosition(0);
      r4b.root.querySelector('.m-head button').focus();
      r4b.focus = document.activeElement;
      r4b.api.select({exact:'First passage.',prefix:'',suffix:' Second passage.',start:0,end:14});
      [...r4b.root.querySelectorAll('button')].find(n=>n.textContent==='Keep').click(); await r4b.api.drain();
    })()`);
    assert.equal(await page.evaluate("document.activeElement===r4b.focus"), true);
    assert.match(await page.evaluate<string>("r4b.root.querySelector('.m-status').textContent"), /Passage kept/);
    assert.deepEqual((await measure()).overflow, []);
    assert.equal(await page.evaluate("r4b.requests.length+r4b.spoken.length"), 0);
    const controls = resting.controls;
    await page.evaluate('r4b.api.destroy();r4b.api.drain()');
    return { controls, zoom, width: await page.evaluate('innerWidth') };
  }, {width:360, height:800, zoom});
  assert.equal(result.value.width, 360 / zoom);
});
