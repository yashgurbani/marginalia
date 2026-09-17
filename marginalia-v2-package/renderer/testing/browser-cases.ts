import { mountReply } from '../index.ts';
import { renderPlot } from '../plot.ts';
import { deriveSamplesBinding, type SampleGenerationRecord } from '../../contracts/sample-provenance.ts';
import type { CandidateReply, PlotBlock, SamplesBlock, TableBlock } from '../../contracts/reply.ts';
import type { HostFixture, BrowserResult } from './browser.ts';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(predicate: () => boolean) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await pause(); }
  throw new Error('Expected browser state did not arrive.');
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function root() { const node = document.createElement('div'); document.body.append(node); return node; }
function input(node: HTMLElement, name: string, value: string) {
  const field = node.querySelector<HTMLInputElement>(`input[type=number][id$="-input-${name}"]`)!;
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
}
function sampleReply(): CandidateReply {
  return {
    schema: 'marginalia.reply.v1', intent: 'simulate', status: 'complete', title: 'Recorded values', summary: 'An affine example.',
    sourceBindings: [], parameters: [{ name: 'x', label: 'Input', default: 0.5, min: 0, max: 1, unit: '' }], assumptions: [], limitations: [], checks: [], staticFallback: 'Authored example only.', requiredCapabilities: ['samples'],
    blocks: [
      { id: 'model', type: 'model', kind: 'map', state: ['z'], next: { z: 'z+1' }, initial: { z: '0' }, iterations: 2 },
      { id: 'data', type: 'table', columns: [{ key: 'x', label: 'x' }, { key: 'y', label: 'y' }], rows: Array.from({ length: 150 }, (_, i) => ({ x: i, y: i * 2 })) },
      { id: 'localPlot', type: 'plot', from: 'data', x: 'x', y: ['y'], labels: {} },
      { id: 'samples', type: 'samples', model: 'model', envelope: { axes: [{ name: 'x', min: 0, max: 1, count: 2 }], fixedInputs: {}, interpolation: 'linear', errorEvidence: 'Affine fixture: exact interpolation.', forbiddenRegions: [] }, samples: [{ at: { x: 0 }, values: { u: 0, v: 0 } }, { at: { x: 1 }, values: { u: 1, v: 2 } }] },
      { id: 'samplePlot', type: 'plot', from: 'samples', x: 'u', y: ['v'], labels: {} },
    ],
  };
}
async function sidecar(reply: CandidateReply): Promise<SampleGenerationRecord> {
  const block = reply.blocks.find(block => block.type === 'samples') as SamplesBlock;
  return { schema: 'marginalia.samples-generation.v1', origin: 'imported', blockId: block.id, ...await deriveSamplesBinding(reply, block) };
}

export async function runRendererRegressions(fixture: HostFixture): Promise<BrowserResult[]> {
  const results: BrowserResult[] = [];
  async function check(name: string, action: () => Promise<void> | void) {
    try { await action(); results.push({ name }); } catch (error) { results.push({ name, error: error instanceof Error ? error.stack ?? error.message : String(error) }); }
    document.body.replaceChildren();
  }
  await check('F1: unchecked result copy is inspectable but never the visible current headline', async () => {
    const node = root(); const original = JSON.stringify(fixture.reply);
    let report = fixture.reports[0], gate = deferred();
    const mounted = mountReply(node, fixture.reply, { sourceText: '', resolveHostReport: async () => { const captured = report, ready = gate; await ready.promise; return captured; } });
    try {
      assert(!node.innerText.includes(fixture.reply.title) && !node.innerText.includes(fixture.reply.summary), 'Unchecked authored result is visible while authority is withheld.');
      assert(node.textContent!.includes(fixture.reply.title) && node.textContent!.includes(fixture.reply.summary), 'Authored content was discarded.');
      assert(node.querySelector('.mr-conclusion')!.textContent!.includes('withheld'), 'Missing report did not withhold the conclusion.');
      gate.release(); await until(() => node.querySelector('.mr-conclusion')!.textContent === fixture.reports[0].results[0].headline);
      assert(!node.innerText.includes(fixture.reply.title), 'Unchecked title competes with the checked result.');
      gate = deferred(); input(node, 'f', '0.2');
      assert(node.querySelector('.mr-conclusion')!.textContent!.includes('withheld'), 'Old authority was not withdrawn synchronously.');
      gate.release(); await pause(); await pause();
      assert(node.querySelector('.mr-conclusion')!.textContent!.includes('withheld'), 'A stale report was accepted.');
      gate = deferred(); report = fixture.reports[1]; input(node, 'f', '0.21'); input(node, 'f', '0.2'); gate.release();
      await until(() => node.querySelector('.mr-conclusion')!.textContent === fixture.reports[1].results[0].headline);
      const made = Array.from(node.querySelectorAll('details')).find(d => d.firstElementChild?.textContent === 'How this was made')!;
      made.open = true; const authored = made.querySelector('details')!;
      assert(authored && /not a checked result/i.test(authored.firstElementChild!.textContent!), 'Original copy lacks an authority warning.');
      authored.open = true; assert(node.innerText.includes(fixture.reply.title), 'Original description cannot be inspected.');
      assert(JSON.stringify(fixture.reply) === original, 'Presentation mutated the immutable reply.');
    } finally { gate.release(); mounted.destroy(); }
  });
  await check('F11: late readiness keeps unrelated table focus, page and DOM identity', async () => {
    const reply = sampleReply(), record = await sidecar(reply), node = root(), gate = deferred();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<SubtleCrypto['digest']>) => { const value = await digest(...args); await gate.promise; return value; } });
    const mounted = mountReply(node, reply, { sourceText: '', capabilities: ['samples'], sampleGenerationRecords: { samples: record } });
    try {
      const plot = node.querySelector<HTMLElement>('[data-block=localPlot]')!, details = plot.querySelector('details')!;
      details.open = true; await pause();
      const next = Array.from(details.querySelectorAll('button')).find(b => b.textContent === 'Next data rows')!; next.click();
      const previous = Array.from(details.querySelectorAll('button')).find(b => b.textContent === 'Previous data rows')!; previous.focus();
      const table = details.querySelector('table');
      gate.release(); await until(() => !!node.querySelector('[data-block=samplePlot] svg'));
      assert(document.activeElement === previous && previous.isConnected, 'Sample readiness removed an unrelated focused control.');
      assert(plot.querySelector('details') === details && details.querySelector('table') === table, 'Unrelated plot DOM was rebuilt.');
      assert(/101.*150/.test(details.textContent!), 'Unrelated table page changed.');
      assert(/Current sampled values/.test(node.querySelector('[data-block=samples]')!.textContent!), 'The admitted sample did not update.');
    } finally { gate.release(); mounted.destroy(); if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor); else Reflect.deleteProperty(crypto.subtle, 'digest'); }
  });
  await check('F11: late readiness cannot refill the aggregate plot budget', async () => {
    const reply = sampleReply(); const plot = reply.blocks.find(b => b.id === 'localPlot') as PlotBlock;
    reply.blocks.splice(3, 0, ...Array.from({ length: 7 }, (_, i) => ({ ...plot, id: `repeat${i}`, y: [...plot.y], labels: {} })));
    const record = await sidecar(reply), node = root();
    const mounted = mountReply(node, reply, { sourceText: '', capabilities: ['samples'], sampleGenerationRecords: { samples: record } });
    try {
      await until(() => /Current sampled values/.test(node.querySelector('[data-block=samples]')!.textContent!));
      const samplePlot = node.querySelector('[data-block=samplePlot]')!;
      assert(!samplePlot.querySelector('svg') && /graphic is omitted/.test(samplePlot.textContent!), 'Readiness bypassed the per-reply drawing budget.');
      input(node, 'x', '0.75'); await until(() => /Current sampled values/.test(node.querySelector('[data-block=samples]')!.textContent!));
      assert(!samplePlot.querySelector('svg'), 'A later generation refilled the budget.');
    } finally { mounted.destroy(); }
  });
  await check('F11: stale, invalid-input and destroyed readiness never publish samples', async () => {
    const reply = sampleReply(), record = await sidecar(reply), node = root(); let gate = deferred();
    const first = gate; const digest = crypto.subtle.digest.bind(crypto.subtle);
    const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<SubtleCrypto['digest']>) => { const captured = gate, value = await digest(...args); await captured.promise; return value; } });
    const mounted = mountReply(node, reply, { sourceText: '', capabilities: ['samples'], sampleGenerationRecords: { samples: record } });
    try {
      gate = deferred(); input(node, 'x', '0.75'); gate.release();
      await until(() => /Current sampled values/.test(node.querySelector('[data-block=samples]')!.textContent!));
      const current = node.querySelector('[data-block=samples] [aria-live]')!;
      assert(current.textContent!.includes('1.5'), 'Latest generation did not interpolate current inputs.');
      const text = current.textContent; first.release(); await pause(); await pause(); assert(current.textContent === text, 'Old generation replaced current sampled values.');
      gate = deferred(); input(node, 'x', '0.25'); input(node, 'x', ''); gate.release(); await pause(); await pause();
      assert(!/Current sampled values/.test(current.textContent!), 'Invalid inputs retained current samples.');
      gate = deferred(); input(node, 'x', '0.25'); mounted.destroy(); gate.release(); await pause(); await pause();
      assert(!node.children.length, 'Destroyed renderer published a late result.');
    } finally { first.release(); gate.release(); mounted.destroy(); if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor); else Reflect.deleteProperty(crypto.subtle, 'digest'); }
  });
  await check('F12: extreme finite table data yields finite coordinates or an explicit readable fallback', async () => {
    const block: PlotBlock = { id: 'plot', type: 'plot', from: 'table', x: 'x', y: ['y'], labels: {} };
    const node = root();
    const draw = (rows: number[][], override: Partial<PlotBlock> = {}) => renderPlot(document, { ...block, ...override }, { columns: ['x', 'y'], rows, end: 'complete', steps: 0, origin: 'table' }, 'numeric');
    node.append(draw([[-1e308, -1e308], [0, 0], [1e308, 1e308]]));
    assert(!!node.querySelector('svg'), 'Representable huge data was not plotted.');
    for (const element of Array.from(node.querySelectorAll('svg *'))) for (const attribute of Array.from(element.attributes)) assert(!/NaN|Infinity/.test(attribute.value), 'Non-finite SVG attribute: ' + attribute.name + '=' + attribute.value);
    const path = node.querySelector('path.mr-curve')!.getAttribute('d')!;
    assert(path.includes('62,230') && path.includes('540,25'), 'Overflow-safe scaling lost endpoint geometry.');
    node.replaceChildren(draw([[Number.MAX_VALUE, 1], [Number.MAX_VALUE, 2]]));
    assert(!node.querySelector('svg') && /cannot be drawn safely/.test(node.textContent!), 'Unrepresentable range lacks an honest limitation.');
    assert(node.querySelectorAll('tbody tr').length === 2, 'Fallback lost supplied data rows.');
    node.replaceChildren(draw([[1e308, 1], [0, 2]], { xRange: [0, Number.MIN_VALUE] }));
    assert(!node.querySelector('svg') && node.querySelectorAll('tbody tr').length === 2, 'Extreme explicit range emitted invalid coordinates or lost the table.');
    const reply = sampleReply(); reply.requiredCapabilities = []; reply.parameters = []; reply.blocks = [{ id: 'table', type: 'table', columns: [{ key: 'x', label: 'x' }, { key: 'y', label: 'y' }], rows: [{ x: -1e308, y: 0 }, { x: 1e308, y: 1 }] } as TableBlock, block];
    node.replaceChildren(); const mounted = mountReply(node, reply, { sourceText: '' });
    try { assert(!!node.querySelector('svg') && !/NaN|Infinity/.test(node.querySelector('svg')!.outerHTML), 'Actual table-to-plot mount is not overflow-safe.'); } finally { mounted.destroy(); }
  });
  await check('F13: missing, mismatched and malformed records use plain copy and preserve the grid', async () => {
    const reply = sampleReply(), valid = await sidecar(reply);
    for (const record of [{ ...valid, schema: 'unsupported' }, { ...valid, replyDigest: 'broken' }, undefined, { ...valid, blockId: 'another' }]) {
      const node = root(); const mounted = mountReply(node, reply, { sourceText: '', capabilities: ['samples'], sampleGenerationRecords: record ? { samples: record as SampleGenerationRecord } : undefined });
      try {
        const current = node.querySelector('[data-block=samples] [aria-live]')!;
        await until(() => /recompute/i.test(current.textContent!) && !/being checked|Checking whether/.test(current.textContent!));
        assert(!/\b(schema|provenance|digest|binding|MCP|sandbox|ledger)\b/i.test(current.textContent!), 'Technical readiness diagnostics leaked into reader copy: ' + current.textContent);
        assert(/original grid is still available/i.test(current.textContent!), 'Failure did not explain that authored data remains available.');
        const grid = node.querySelector<HTMLDetailsElement>('[data-block=samples] details')!; grid.open = true; await pause();
        assert(grid.querySelectorAll('tbody tr').length === 2, 'Failure removed the historical grid.');
        assert(!/Current sampled values/.test(current.textContent!), 'Malformed evidence authorized interpolation.');
      } finally { mounted.destroy(); node.remove(); }
    }
  });
  return results;
}
