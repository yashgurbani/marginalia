import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

test('P07 real Dagre, KaTeX, CSS and source bindings in Chromium', {
  skip: process.env.T18_CHROMIUM ? false : 'Set T18_CHROMIUM to an installed Chromium executable for real browser acceptance.', timeout: 90_000,
}, async () => {
  const { runRealBrowserAcceptance } = await import('../renderer/testing/real-browser.ts');
  const directory = resolve(process.env.P07_SCREENSHOTS ?? '../.local/polish/shots/P07');
  const result = await runRealBrowserAcceptance(process.env.T18_CHROMIUM!, directory);
  assert.deepEqual(result.frames.map(frame => frame.theme), ['light', 'dark']);
  assert.notEqual(result.frames[0].background, result.frames[1].background);
  await writeFile(resolve(directory, 'receipt.json'), JSON.stringify({ executable: process.env.T18_CHROMIUM, ...result }, null, 2));
});
