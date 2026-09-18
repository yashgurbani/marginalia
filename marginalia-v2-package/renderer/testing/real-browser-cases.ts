/// <reference lib="dom.iterable" />
/** Browser-only acceptance: real packaged renderer, Dagre, KaTeX and CSS. */
import { mountReply } from '../index.ts';
import '../../ui/tokens.css';
import type { CandidateReply } from '../../contracts/reply.ts';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function checkRealRenderer(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  document.body.replaceChildren();
  document.body.style.cssText = 'margin:24px;background:var(--m-page);color:var(--m-ink);font-family:system-ui';
  const source = document.createElement('p');
  source.textContent = 'Water enters the tank. Water leaves the tank.';
  const sourceSnapshot = source.innerHTML;
  const root = document.createElement('main'); root.style.maxWidth = '720px';
  document.body.append(source, root);
  const reply: CandidateReply = {
    schema: 'marginalia.reply.v1', intent: 'diagram', status: 'complete', title: 'Tank flow', summary: 'A synthetic rendering fixture.',
    sourceBindings: [{ name: 'inlet', meaning: 'Incoming water', relation: 'quoted', selector: { exact: 'Water enters the tank.' } }],
    parameters: [], assumptions: [], limitations: [], checks: [], requiredCapabilities: [], staticFallback: 'Inlet flows to outlet within Tank. Q = A v.',
    blocks: [
      { id: 'flow', type: 'diagram', nodes: [{ id: 'in', label: 'Inlet', binding: 'inlet' }, { id: 'out', label: 'Outlet' }], edges: [{ id: 'pipe', from: 'in', to: 'out', label: 'flows to' }], groups: [{ id: 'tank', label: 'Tank', nodes: ['in', 'out'] }] },
      { id: 'equation', type: 'equation', tex: 'Q = A \\cdot v' },
    ],
  };
  // CSS Highlight uses a Range and leaves the source DOM immutable.
  const style = document.createElement('style'); style.textContent = '::highlight(p07-source) { background: gold; color: black; }'; document.head.append(style);
  const mounted = mountReply(root, reply, { sourceText: source.textContent, onSourceHighlight(binding) {
    CSS.highlights.delete('p07-source');
    if (!binding) return;
    const start = source.textContent!.indexOf(binding.selector.exact);
    assert(start >= 0 && source.firstChild, 'Binding must resolve in source text.');
    const range = new Range(); range.setStart(source.firstChild, start); range.setEnd(source.firstChild, start + binding.selector.exact.length);
    CSS.highlights.set('p07-source', new Highlight(range));
  } });
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const visible = (node: Element | null, label: string) => {
    assert(node, `${label} exists`); const rect = node.getBoundingClientRect(); const css = getComputedStyle(node);
    assert(rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden' && css.opacity !== '0', `${label} is visible with nonzero bounds`);
    return { width: rect.width, height: rect.height };
  };
  const article = root.querySelector('article')!;
  const title = article.querySelector('h3')!;
  const answer = title.nextElementSibling!;
  assert(answer?.classList.contains('mr-blocks') && answer.querySelector('[data-block="flow"]'), 'The requested diagram must lead immediately after the title.');
  const summary = answer.nextElementSibling;
  assert(summary?.textContent === reply.summary, 'The authored summary must remain after the answer blocks.');
  visible(answer.querySelector('[data-block="flow"]'), 'Primary diagram answer');
  assert(answer.getBoundingClientRect().bottom <= summary.getBoundingClientRect().top, 'The answer must also appear before the summary in the visible layout.');
  assert(!root.textContent!.includes('(0)'), 'An empty disclosure was mounted.');
  const made = Array.from(root.querySelectorAll('details')).find(node => node.firstElementChild?.textContent === 'How this was made')!;
  const blocks = root.querySelector('.mr-blocks')!;
  assert(!!(blocks.compareDocumentPosition(made) & Node.DOCUMENT_POSITION_FOLLOWING), 'Construction disclosure precedes the answer blocks.');
  const visibleCopy = article.cloneNode(true) as HTMLElement;
  Array.from(visibleCopy.querySelectorAll('details')).find(node => node.firstElementChild?.textContent === 'How this was made')!.remove();
  assert(!/criterion|schema|job|digest/i.test(visibleCopy.textContent!), 'Internal vocabulary appears outside construction details.');
  assert(getComputedStyle(root.querySelector('.mr-diagram-canvas')!).borderTopWidth === '0px', 'Diagram canvas adds a nested frame.');
  assert(getComputedStyle(root.querySelector('.mr-diagram-group')!).stroke === 'none', 'Diagram group adds another frame.');
  assert(getComputedStyle(article).color === getComputedStyle(source).color, 'Reply body does not use primary ink.');
  const nodes = Array.from(root.querySelectorAll('.mr-diagram-node'));
  assert(nodes.length === 2, 'Both real Dagre nodes must render.');
  const nodeBounds = nodes.map(node => visible(node, 'Diagram node'));
  const edge = root.querySelector<SVGPathElement>('.mr-edge');
  visible(edge?.parentElement ?? null, 'Labeled edge group');
  assert(edge && edge.getTotalLength() > 0 && Number.parseFloat(getComputedStyle(edge).strokeWidth) > 0 && getComputedStyle(edge).stroke !== 'none', 'Dagre edge has a nonzero visible stroke, including vertical paths with zero geometric width.');
  const marker = root.querySelector('marker'); assert(marker && marker.querySelector('path'), 'Arrow marker path exists.');
  assert(edge!.getAttribute('marker-end') === `url(#${marker.id})`, 'Edge references the actual arrow marker.');
  visible(root.querySelector('.mr-diagram-group'), 'Diagram group');
  const equation = root.querySelector('.katex-html'); visible(equation, 'Real KaTeX HTML');
  assert(root.querySelector('.katex-mathml math'), 'KaTeX accessible MathML exists.');
  assert(getComputedStyle(root.querySelector('.katex')!).fontFamily.includes('KaTeX'), 'Packaged KaTeX CSS is active.');
  const description = root.querySelector<HTMLDetailsElement>('.mr-diagram details')!; description.open = true;
  assert(description.innerText.includes('Tank: Inlet, Outlet') && description.innerText.includes('Inlet → Outlet: flows to'), 'Text fallback contains the same group, nodes and labeled edge.');
  const focus = root.querySelector<SVGElement>('[id$="-node-in"]')!;
  focus.focus(); assert(document.activeElement === focus && CSS.highlights.has('p07-source'), 'Node focus highlights source.');
  const highlighted = CSS.highlights.get('p07-source')!;
  assert(Array.from(highlighted)[0].toString() === 'Water enters the tank.', 'Highlight covers the exact source span.');
  focus.blur(); assert(!CSS.highlights.has('p07-source'), 'Node blur clears source highlight.');
  const textControl = description.querySelector<HTMLButtonElement>('button')!;
  textControl.focus(); assert(document.activeElement === textControl && CSS.highlights.has('p07-source'), 'Equivalent text control highlights source.');
  textControl.blur(); assert(!CSS.highlights.has('p07-source'), 'Text control blur clears source highlight.');
  assert(source.innerHTML === sourceSnapshot, 'Source DOM remains unchanged.');
  // Keep the rendered frame mounted for the harness screenshot; the next theme replaces it.
  (globalThis as typeof globalThis & { p07Dispose?: () => void }).p07Dispose?.();
  (globalThis as typeof globalThis & { p07Dispose?: () => void }).p07Dispose = () => { mounted.destroy(); style.remove(); };
  return { theme, nodeBounds, edgeLength: edge!.getTotalLength(), background: getComputedStyle(document.body).backgroundColor, sourceUnchanged: true };
}
