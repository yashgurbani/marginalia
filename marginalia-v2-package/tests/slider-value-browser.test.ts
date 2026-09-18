import { test } from 'node:test';
import assert from 'node:assert/strict';

test('range controls preserve off-grid values through assumptions, number edits, keys and saved views', {
  skip: process.env.T18_CHROMIUM ? false : 'Set T18_CHROMIUM for native range value regression.', timeout: 60_000,
}, async () => {
  const { withRealBrowser } = await import('../renderer/testing/real-browser.ts');
  await withRealBrowser(process.env.T18_CHROMIUM!, async page => {
    await page.evaluate(`(async () => {
      const { mountReply } = await import('/renderer/index.ts');
      const { growthReply, growthSourceText } = await import('/fixtures/growth-reply.ts');
      const reply = structuredClone(growthReply);
      Object.assign(reply.parameters[0], { min: 0.4, max: 1, default: 0.5, sourceBinding: structuredClone(reply.sourceBindings[0]) });
      reply.assumptions[0].binding = { parameter: 'gamma', min: 0.4, max: 1 };
      const root = document.createElement('main'); document.body.append(root);
      const options = { sourceText: growthSourceText, onSourceHighlight: binding => window.sliderHighlight = binding?.name ?? null };
      window.sliderMount = mountReply(root, reply, options);
      window.sliderRemount = () => { const saved = structuredClone(sliderMount.getState()); sliderMount.destroy(); window.sliderMount = mountReply(root, reply, { ...options, initialState: saved }); };
    })()`);
    const values = () => page.evaluate<{ slider: number; number: number; assumption: number; model: number }>(`({
      slider: document.querySelector('input[id$="-slider-gamma"]').valueAsNumber,
      number: document.querySelector('input[id$="-input-gamma"]').valueAsNumber,
      assumption: document.querySelector('[data-assumption-id="constant-forcing"]').valueAsNumber,
      model: sliderMount.getState().parameters.gamma
    })`);
    assert.deepEqual(await values(), { slider: 0.5, number: 0.5, assumption: 0.5, model: 0.5 });
    await page.evaluate(`(() => {
      const field = document.querySelector('[data-assumption-id="constant-forcing"]');
      field.closest('details').open = true; field.focus(); field.value = '0.8';
      field.dispatchEvent(new Event('change', { bubbles: true })); field.blur();
    })()`);
    assert.deepEqual(await values(), { slider: 0.8, number: 0.8, assumption: 0.8, model: 0.8 });
    await page.evaluate(`(() => {
      document.querySelector('[aria-label="Edit damping (1/s)"]').click();
      const field = document.querySelector('input[id$="-input-gamma"]');
      field.value = '0.63'; field.dispatchEvent(new Event('change', { bubbles: true })); field.blur();
      document.querySelector('input[id$="-slider-gamma"]').focus();
    })()`);
    assert.deepEqual(await values(), { slider: 0.63, number: 0.63, assumption: 0.63, model: 0.63 });
    assert.equal(await page.evaluate('sliderHighlight'), 'gamma-source', 'the visible range control highlights its source on focus');
    await page.key('ArrowRight', 39);
    const keyed = await values();
    assert.ok(Math.abs(keyed.model - 0.6306) < 1e-12, 'Arrow keeps the existing one-thousandth-range increment');
    assert.equal(keyed.slider, keyed.model); assert.equal(keyed.number, keyed.model); assert.equal(keyed.assumption, keyed.model);
    await page.evaluate('sliderRemount()');
    assert.deepEqual(await values(), keyed, 'reopening does not quantize the saved model');
    await page.evaluate('document.querySelector(\'input[id$="-slider-gamma"]\').focus()');
    await page.key('Home', 36); assert.equal((await values()).model, 0.4);
    await page.key('End', 35); assert.equal((await values()).model, 1);
    const point = await page.evaluate<{ x: number; y: number }>(`(() => {
      const slider = document.querySelector('input[id$="-slider-gamma"]'); slider.scrollIntoView();
      const box = slider.getBoundingClientRect(); return { x: box.left + box.width / 3, y: box.top + box.height / 2 };
    })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    const pointed = await values();
    assert.ok(pointed.model > 0.4 && pointed.model < 1, 'native pointer interaction still changes the value');
    assert.equal(pointed.slider, pointed.model); assert.equal(pointed.number, pointed.model); assert.equal(pointed.assumption, pointed.model);
    await page.evaluate('sliderMount.destroy()');
  });
});
