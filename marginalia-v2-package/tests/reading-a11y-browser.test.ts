import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { RealBrowserPage } from '../renderer/testing/real-browser.ts';

async function tabTo(page: RealBrowserPage, label: string) {
  for (let step = 0; step < 100; step++) {
    const current = await page.evaluate<string>("document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || ''");
    if (current === label) return;
    await page.key('Tab', 9);
  }
  throw new Error(`Keyboard target unavailable: ${label}; ` + JSON.stringify(await page.evaluate("Array.from(document.querySelectorAll('button')).filter(b=>b.getClientRects().length).map(b=>({label:b.getAttribute('aria-label')||b.textContent,disabled:b.disabled,tabIndex:b.tabIndex}))")));
}
async function focusReceipt(page: RealBrowserPage) {
  return page.evaluate<{ name: string; visible: boolean; focused: boolean; overflow: boolean }>(`(() => {
    const element = document.activeElement, r = element.getBoundingClientRect(), css = getComputedStyle(element);
    let unclipped = true;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < box.left - 1 || r.right > box.right + 1)) unclipped = false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < box.top - 1 || r.bottom > box.bottom + 1)) unclipped = false;
    }
    return { name: element.getAttribute('aria-label') || element.textContent.trim(),
      focused: element.matches(':focus-visible') && parseFloat(css.outlineWidth) > 0,
      visible: unclipped && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  })()`);
}
async function cancelledQuestionReceipt(page: RealBrowserPage) {
  return page.evaluate<{
    draftFormCount: number;
    visibleDraftFormCount: number;
    draftQuestion: { visible: boolean; interactable: boolean };
    draftSubmit: { visible: boolean; interactable: boolean };
    reviewFormCount: number;
    reviewForms: { hidden: boolean; rendered: boolean; focusWithin: boolean; focusableControls: number; interactableControls: number }[];
  }>(`(() => {
    const rendered = (element) => {
      const node = element, rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return !node.hidden && !node.closest('[hidden]') && !node.closest('[aria-hidden="true"]') &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' &&
        rect.width > 0 && rect.height > 0;
    };
    const interactable = (element) => {
      if (!element) return false;
      const node = element;
      return rendered(node) && !node.disabled && !node.readOnly && node.tabIndex >= 0;
    };
    const drafts = [...document.querySelectorAll('.m-question form.m-asking-draft')];
    const visibleDrafts = drafts.filter(form => {
      const question = form.querySelector('[aria-label="Your question"]');
      const submit = form.querySelector('button[type="submit"]');
      return rendered(form) && interactable(question) && interactable(submit);
    });
    const reviews = [...document.querySelectorAll('.m-question form:not(.m-asking-draft)')];
    const reviewForms = reviews.map(form => {
      const controls = [...form.querySelectorAll('textarea,button')];
      return {
        hidden: form.hidden,
        rendered: rendered(form),
        focusWithin: form.contains(document.activeElement),
        focusableControls: controls.filter(control => interactable(control)).length,
        interactableControls: controls.filter(control => rendered(control) && !control.disabled && !control.readOnly).length,
      };
    });
    const draft = drafts[0];
    const question = draft?.querySelector('[aria-label="Your question"]');
    const submit = draft?.querySelector('button[type="submit"]');
    return {
      draftFormCount: drafts.length,
      visibleDraftFormCount: visibleDrafts.length,
      draftQuestion: { visible: !!question && rendered(question), interactable: interactable(question) },
      draftSubmit: { visible: !!submit && rendered(submit), interactable: interactable(submit) },
      reviewFormCount: reviews.length,
      reviewForms,
    };
  })()`);
}
for (const scenario of [
  { name: 'desktop', width: 1000, height: 900, zoom: 1 as const, reduced: false },
  { name: 'zoom-200', width: 1000, height: 900, zoom: 2 as const, reduced: false },
  { name: 'narrow-360', width: 360, height: 800, zoom: 1 as const, reduced: false },
  { name: 'reduced-motion', width: 360, height: 800, zoom: 1 as const, reduced: true },
]) test(`P17 keyboard reading journey: ${scenario.name}`, {
  skip: process.env.T18_CHROMIUM ? false : 'Set T18_CHROMIUM for keyboard journey acceptance.', timeout: 90_000,
}, async () => {
  const { withRealBrowser } = await import('../renderer/testing/real-browser.ts');
  const directory = resolve(process.env.P17_SCREENSHOTS ?? '../.local/polish/shots/P17', scenario.name); await mkdir(directory, { recursive: true });
  const result = await withRealBrowser(process.env.T18_CHROMIUM!, async page => {
    if (scenario.reduced) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const viewport = await page.evaluate<{ width: number; dpr: number; scale: number }>('({width:innerWidth,dpr:devicePixelRatio,scale:visualViewport.scale})');
    assert.equal(viewport.width, scenario.width / scenario.zoom); assert.equal(viewport.dpr, scenario.zoom); assert.equal(viewport.scale, 1);
    await page.evaluate("import('/renderer/testing/a11y-journey.ts').then(m => m.mountKeyboardJourney())");
    const stops: Awaited<ReturnType<typeof focusReceipt>>[] = [];
    async function activate(label: string) {
      await tabTo(page, label); const receipt = await focusReceipt(page); stops.push(receipt);
      await page.screenshot(resolve(directory, `stop-${stops.length}.png`), false);
      if (scenario.reduced) {
        const motion = await page.evaluate<boolean>("matchMedia('(prefers-reduced-motion: reduce)').matches && document.getAnimations().every(a=>a.playState !== 'running') && Array.from(document.querySelectorAll('*')).filter(e=>e.getClientRects().length).every(e=>{const s=getComputedStyle(e);return s.animationName==='none' && s.transitionDuration.split(',').every(v=>parseFloat(v)===0) && s.scrollBehavior==='auto';})");
        assert.equal(motion, true, 'Reduced motion disables animations, transitions and smooth scroll in the mounted view');
      }
      assert.equal(receipt.focused, true, `${label} focus is visible`); assert.equal(receipt.visible, true, `${label} is inside the viewport`);
      assert.equal(receipt.overflow, false, `${label} has no page overflow`);
      await page.key('Enter', 13); await page.evaluate('p17Journey.drain()'); await delay(40);
    }
    // Focusing Write here opens the production editor and transfers focus to its textarea.
    await tabTo(page, 'Your note');
    const editor = await focusReceipt(page); stops.push(editor); assert.equal(editor.focused && editor.visible, true, 'Note editor focus is visible');
    assert.equal(await page.evaluate<string>("document.activeElement.getAttribute('aria-label')"), 'Your note');
    await page.send('Input.insertText', { text: 'Why does the flow change?' });
    await activate('Save note and review a question');
    if (!await page.evaluate("!!document.querySelector('input[aria-label=\"Your question\"]')")) throw new Error('Question did not open: ' + JSON.stringify(await page.evaluate("Array.from(document.querySelectorAll('[role=status]')).map(n=>n.textContent)")));
    await tabTo(page, 'Your question');
    await page.send('Input.insertText', { text: 'Explain the mechanism in my note.' });
    await activate('Ask');
    await page.evaluate("(async()=>{for(let i=0;i<80&&!document.querySelector('.m-consent');i++)await new Promise(r=>setTimeout(r,25));})()");
    assert.equal(await page.evaluate<boolean>("!!document.querySelector('.m-consent')"), true, 'Real asking flow produced the real consent sheet: ' + JSON.stringify(await page.evaluate("({requests:p17Journey.requests,refused:p17Journey.refused,status:Array.from(document.querySelectorAll('[role=status]')).map(n=>n.textContent)})")));
    await delay(40); const reviewFocus = await focusReceipt(page); stops.push(reviewFocus);
    assert.equal(reviewFocus.focused && reviewFocus.visible, true, 'Consent entry focus is visible without another Tab: '+JSON.stringify(reviewFocus));
    await page.screenshot(resolve(directory, 'journey-review.png'), false);
    await activate('Cancel');
    const cancelled = await focusReceipt(page); stops.push(cancelled); assert.equal(cancelled.focused && cancelled.visible, true, 'Cancel restores visible focus');
    const questionReceipt = await cancelledQuestionReceipt(page);
    assert.equal(questionReceipt.draftFormCount, 1, 'Cancel retains one draft form');
    assert.equal(questionReceipt.visibleDraftFormCount, 1, 'Cancel restores exactly one visible/interactable draft form');
    assert.deepEqual(questionReceipt.draftQuestion, { visible: true, interactable: true }, 'Retained draft question is visible and interactable');
    assert.deepEqual(questionReceipt.draftSubmit, { visible: true, interactable: true }, 'Retained draft submit control is visible and interactable');
    assert.equal(questionReceipt.reviewFormCount, 1, 'Cancel retains one hidden review form for the asking flow');
    assert.deepEqual(questionReceipt.reviewForms, [{ hidden: true, rendered: false, focusWithin: false, focusableControls: 0, interactableControls: 0 }], 'Hidden review form is not rendered or interactive');
    assert.match(await page.evaluate<string>("document.querySelector('.m-question input').value"), /Explain the mechanism in my note/);
    await activate('Library');
    const libraryEntry = await focusReceipt(page); stops.push(libraryEntry); assert.equal(libraryEntry.focused && libraryEntry.visible, true, 'Library opens with visible focus');
    await activate('Close Library');
    const returned = await focusReceipt(page); stops.push(returned); assert.equal(returned.focused && returned.visible, true, 'Library returns visible focus');
    assert.equal(await page.evaluate<boolean>('p17Journey.sourceUnchanged()'), true);
    const requests = await page.evaluate<string[]>('p17Journey.requests');
    assert.ok(requests.includes('POST /api/jobs/prepare'));
    assert.equal(requests.includes('POST /api/jobs'), false);
    assert.deepEqual(await page.evaluate<string[]>('p17Journey.refused'), []);
    await page.screenshot(resolve(directory, 'journey-return.png'), false);
    await page.evaluate('p17Journey.destroy()');
    return { viewport, stops, requests };
  }, scenario);
  await writeFile(resolve(directory, 'journey-receipt.json'), JSON.stringify(result, null, 2));
});


test('R1 selection has one action row at 360 px and Ask stays inside its card', {
  skip: process.env.T18_CHROMIUM ? false : 'Set T18_CHROMIUM for selection layout acceptance.', timeout: 90_000,
}, async () => {
  const { withRealBrowser } = await import('../renderer/testing/real-browser.ts');
  await withRealBrowser(process.env.T18_CHROMIUM!, async page => {
    await page.evaluate(`(async () => {
      await import('/ui/margin.css'); const { mountMargin } = await import('/ui/margin.ts');
      document.body.replaceChildren(); const source = document.createElement('article'), root = document.createElement('div'), opener = document.createElement('button');
      const text = 'Heat causes expansion because particles move faster. They collide more often. The pressure increases. This drives the piston. Its motion moves the wheel. The wheel turns the shaft.';
      source.textContent = text; opener.textContent = 'Source control'; document.body.append(source, opener, root);
      let requests = 0; const originalFetch = fetch; globalThis.fetch = async () => { requests++; throw Error('Unexpected request'); };
      const api = await mountMargin(root, { capture: { url: 'https://example.org/mechanism', title: 'Mechanism', pageType: 'article', text, capturedAt: new Date().toISOString(), extractionVersion: 'test' }, storageName: crypto.randomUUID(), allowHelper: false });
      opener.focus(); api.select({ start: 0, end: text.length, exact: text, prefix: '', suffix: '' }); await api.drain();
      globalThis.r1cSelection = { api, root, source, text, opener, requests: () => requests, cleanup: () => { api.destroy(); globalThis.fetch = originalFetch; } };
    })()`);
    // The panel opens through a 160 ms width transition. Geometry is read once it settles.
    await page.evaluate('new Promise(resolve=>setTimeout(resolve,250))');
    const receipt = await page.evaluate<{ labels: string[]; tops: number[]; heights: number[]; border: string; background: string; quoteHeight: number; lineHeight: number; quotePadding: number; focused: boolean; unchanged: boolean; requests: number }>(`(() => {
      const h = r1cSelection, card = h.root.querySelector('.m-selection'), buttons = [...card.querySelector('.m-selection-actions').children], quote = card.querySelector('blockquote'), css = getComputedStyle(card), q = getComputedStyle(quote);
      return { labels: buttons.map(b => b.textContent), tops: buttons.map(b => b.getBoundingClientRect().top), heights: buttons.map(b => b.getBoundingClientRect().height), border: css.borderInlineStartWidth, background: css.backgroundColor,
        quoteHeight: quote.getBoundingClientRect().height, lineHeight: parseFloat(q.lineHeight), quotePadding: parseFloat(q.paddingBottom), focused: document.activeElement === h.opener, unchanged: h.source.textContent === h.text, requests: h.requests() };
    })()`);
    assert.deepEqual(receipt.labels, ['Keep', 'Note', 'Ask', 'Simulate it']); assert.equal(new Set(receipt.tops).size, 1); assert.ok(receipt.heights.every(height => height >= 28));
    assert.equal(receipt.border, '0px'); assert.equal(receipt.background, 'rgba(0, 0, 0, 0)'); assert.ok(receipt.quoteHeight <= 3 * receipt.lineHeight + receipt.quotePadding + 1);
    assert.equal(receipt.focused, true); assert.equal(receipt.unchanged, true); assert.equal(receipt.requests, 0);
    await page.evaluate("r1cSelection.root.querySelector('#m-selection-ask').click(); r1cSelection.api.drain()");
    assert.equal(await page.evaluate<boolean>("!!r1cSelection.root.querySelector('.m-selection .m-asking-draft')"), true);
    assert.equal(await page.evaluate<number>("r1cSelection.root.querySelectorAll('.m-offers button').length"), 3);
    assert.equal(await page.evaluate<number>("r1cSelection.root.querySelectorAll('form').length"), 1);
    assert.equal(await page.evaluate<number>("r1cSelection.requests()"), 0);
    await page.evaluate('r1cSelection.cleanup()');
  }, { width: 360, height: 800 });
});
