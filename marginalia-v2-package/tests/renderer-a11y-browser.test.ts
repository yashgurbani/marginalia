import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

test('P17 real keyboard slider coalesces live status until its value settles', {
  skip: process.env.T18_CHROMIUM ? false : 'Set T18_CHROMIUM for real keyboard acceptance.', timeout: 60_000,
}, async () => {
  const { withRealBrowser } = await import('../renderer/testing/real-browser.ts');
  await withRealBrowser(process.env.T18_CHROMIUM!, async page => {
    await page.evaluate("import('/renderer/testing/a11y-slider.ts').then(m => m.mountSliderProbe())");
    let reached = false;
    for (let step = 0; step < 20; step++) {
      await page.key('Tab', 9);
      if (await page.evaluate<boolean>("document.activeElement?.matches('input[type=range]')")) { reached = true; break; }
    }
    assert.equal(reached, true, 'Slider is reachable using Tab only.');
    assert.equal(await page.evaluate<boolean>("document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth) > 0"), true);
    for (let step = 0; step < 5; step++) await page.key('ArrowRight', 39);
    assert.equal(await page.evaluate<number>('p17Slider.value()'), 0.505, 'Every key updates locally without waiting for an announcement.');
    await delay(450);
    const announcements = await page.evaluate<string[]>('p17Slider.announcements');
    assert.equal(announcements.length, 1, 'One live-region update for a rapid burst ending at one settled value.');
    await page.evaluate('p17Slider.reset()');
    await page.key('ArrowRight', 39); await delay(450);
    assert.equal(await page.evaluate<number>('p17Slider.announcements.length'), 1, 'A later settled value has its own update.');
    await page.evaluate('p17Slider.destroy()');
  });
});


test('R2 delayed authority announces its final result once and disposal fences updates', {
  skip: process.env.T18_CHROMIUM ? false : 'Set T18_CHROMIUM for real keyboard acceptance.', timeout: 60_000,
}, async () => {
  const { withRealBrowser } = await import('../renderer/testing/real-browser.ts');
  await withRealBrowser(process.env.T18_CHROMIUM!, async page => {
    await page.evaluate("import('/renderer/testing/a11y-slider.ts').then(m => m.mountSliderProbe(true))");
    let reached = false;
    for (let step = 0; step < 20; step++) {
      await page.key('Tab', 9);
      if (await page.evaluate<boolean>("document.activeElement?.matches('input[type=range]')")) { reached = true; break; }
    }
    assert.equal(reached, true);
    for (let step = 0; step < 5; step++) await page.key('ArrowRight', 39);
    await delay(800);
    assert.ok(await page.evaluate<number>('p17Slider.authorityCalls()') > 0, 'The real authority callback path was exercised.');
    assert.equal(await page.evaluate<number>('p17Slider.announcements.length'), 1, 'Only the final authority result is announced after settling.');
    assert.match(await page.evaluate<string>("document.querySelector('.mr-status').textContent"), /host check is unavailable/);
    await page.evaluate('p17Slider.reset()');
    await page.key('ArrowRight', 39);
    await page.evaluate('p17Slider.unmount()');
    await delay(800);
    assert.equal(await page.evaluate<number>('p17Slider.announcements.length'), 0, 'Unmount fences pending timer and authority response.');
    await page.evaluate('p17Slider.destroy()');
  });
});


test('P17 explicit validation status interrupts a pending slider announcement', {
  skip: process.env.T18_CHROMIUM ? false : 'Set T18_CHROMIUM for real browser acceptance.', timeout: 60_000,
}, async () => {
  const { withRealBrowser } = await import('../renderer/testing/real-browser.ts');
  await withRealBrowser(process.env.T18_CHROMIUM!, async page => {
    await page.evaluate("import('/renderer/testing/a11y-slider.ts').then(m => m.mountSliderProbe())");
    const before = await page.evaluate<string>(`(() => {
      const slider = document.querySelector('input[type=range]'); slider.value = '0.6'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      const field = document.querySelector('input[aria-label="Change assumption: Input range"]');
      if (!field) throw new Error('Bound assumption field missing');
      field.value = '2'; field.dispatchEvent(new Event('change', { bubbles: true }));
      return document.querySelector('.mr-status').textContent;
    })()`);
    assert.match(before, /range|invalid|correct/i);
    await delay(450);
    assert.equal(await page.evaluate<string>("document.querySelector('.mr-status').textContent"), before, 'Pending slider status cannot overwrite the newer validation error.');
    await page.evaluate('p17Slider.destroy()');
  });
});
