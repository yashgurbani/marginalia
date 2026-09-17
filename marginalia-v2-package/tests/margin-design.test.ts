import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/tokens.css', import.meta.url), 'utf8');
function luminance(l: number, c: number, h: number) {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const x = (l + .3963377774 * a + .2158037573 * b) ** 3;
  const y = (l - .1055613458 * a - .0638541728 * b) ** 3;
  const z = (l - .0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * x - 3.3077115913 * y + .2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - .3413193965 * z, -.0041960863 * x - .7034186147 * y + 1.707614701 * z];
  return rgb.map(v => Math.max(0, Math.min(1, v))).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
for (const theme of ['light', 'dark']) test(`${theme} note, metadata, and control contrast meet the design gate`, () => {
  const block = theme === 'light' ? css.split('@media')[0] : css.split(':root[data-theme="dark"]')[1];
  const values = new Map(Array.from(block.matchAll(/--m-([\w-]+): oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)).map(m => [m[1], luminance(+m[2], +m[3], +m[4])]));
  for (const [ink, background, minimum] of [['ink', 'margin', 4.5], ['ink-2', 'surface', 4.5], ['ink-3', 'margin', 4.5], ['edge', 'margin', 3]] as const) {
    const a = values.get(ink)!, b = values.get(background)!;
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    assert.ok(ratio >= minimum, `${ink}/${background}: ${ratio.toFixed(2)} needs ${minimum}`);
  }
});
