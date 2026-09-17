import type { PlotBlock } from '../contracts/reply.ts';
import type { Trajectory } from '../kernel/integrate.ts';
import { button, el, pagedTable, table } from './dom.ts';
import { formatNumber } from './state.ts';

const NS = 'http://www.w3.org/2000/svg';
export type PlotData = Omit<Trajectory, 'rows'> & { rows: (number | null)[][]; origin?: 'model' | 'table' | 'samples' };
export function svgNode<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attributes: Record<string, string> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Both the graphic and paged table come from the same current numeric trajectory. */
export function renderPlot(doc: Document, block: PlotBlock, trajectory: PlotData, id: string, view?: { open: boolean; page: number; maxVertices?: number; onChange(open: boolean, page: number): void }): HTMLElement {
  const section = el(doc, 'div', undefined, 'mr-plot');
  const xIndex = trajectory.columns.indexOf(block.x);
  const yIndices = block.y.map(name => trajectory.columns.indexOf(name));
  if (xIndex < 0 || yIndices.some(i => i < 0)) { section.append(el(doc, 'p', 'This plot refers to a column that its data does not supply.')); return section; }
  const rows = trajectory.rows;
  const finitePair = (row: (number | null)[], index: number): row is number[] => [xIndex, index].every(i => typeof row[i] === 'number' && Number.isFinite(row[i]));
  let xMin = Infinity; let xMax = -Infinity; let yMin = Infinity; let yMax = -Infinity; let count = 0;
  const seriesCounts = yIndices.map(() => 0);
  for (const row of rows) {
    let valid = false;
    for (const [series, i] of yIndices.entries()) {
      if (!finitePair(row, i)) continue;
      valid = true; seriesCounts[series]++; xMin = Math.min(xMin, row[xIndex]); xMax = Math.max(xMax, row[xIndex]); yMin = Math.min(yMin, row[i]); yMax = Math.max(yMax, row[i]);
    }
    if (valid) count++;
  }
  if (!count) {
    section.append(el(doc, 'p', 'No finite plot data is available for these inputs.'), pagedTable(doc, [block.x, ...block.y].map(name => ({ key: name, label: block.labels[name] ?? name })), rows.map(row => Object.fromEntries([block.x, ...block.y].map(name => { const value = row[trajectory.columns.indexOf(name)]; return [name, typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : 'missing']; }))), 'Supplied rows, including missing values'));
    return section;
  }
  const range = (min: number, max: number): [number, number] => {
    if (min === max) { const padding = Math.max(1, Math.abs(min) * .1); return [min - padding, max + padding]; }
    return [min, max];
  };
  const xr = block.xRange ?? range(xMin, xMax);
  const yr = block.yRange ?? range(yMin, yMax);
  const x = (n: number) => 62 + (n - xr[0]) / (xr[1] - xr[0]) * 478;
  const y = (n: number) => 230 - (n - yr[0]) / (yr[1] - yr[0]) * 205;
  const labelX = block.labels[block.x] ?? (block.x === 't' ? 'time (model units)' : block.x === 'n' ? 'iteration' : block.x);
  const labelY = block.y.map(name => block.labels[name] ?? name).join(', ');
  const maxPerSeries = Math.max(0, Math.floor((view?.maxVertices ?? 3000) / yIndices.length));
  const stride = maxPerSeries > 1 ? Math.max(1, Math.ceil((rows.length - 1) / (maxPerSeries - 1))) : rows.length;
  const source = trajectory.origin === 'table' ? 'Supplied table values; missing rows break the plotted line.' : trajectory.origin === 'samples' ? 'Current interpolated sample values; this is not a computed trajectory.' : trajectory.end === 'complete' ? 'Calculation reached its declared interval.' : trajectory.message ?? 'Calculation stopped at its limit.';
  const drawing = maxPerSeries === 0 ? 'The graphic is omitted under the reply drawing budget.' : stride > 1 ? `The graphic uses at most ${maxPerSeries} points per series; the full data table is retained.` : 'Every finite point is represented in the graphic.';
  const description = `${labelY} against ${labelX}. ${count} of ${rows.length} rows contain finite plotted values. Shown x range ${formatNumber(xr[0])} to ${formatNumber(xr[1])}; y range ${formatNumber(yr[0])} to ${formatNumber(yr[1])}. ${source} ${drawing} The data table includes every row, including any outside the shown range.`;
  const svg = svgNode(doc, 'svg', { viewBox: '0 0 570 285', role: 'img', 'aria-labelledby': `${id}-title ${id}-desc` });
  svg.append(svgNode(doc, 'title', { id: `${id}-title` }, `${labelY} against ${labelX}`), svgNode(doc, 'desc', { id: `${id}-desc` }, description));
  const defs = svgNode(doc, 'defs'); const clip = svgNode(doc, 'clipPath', { id: `${id}-clip` }); clip.append(svgNode(doc, 'rect', { x: '62', y: '25', width: '478', height: '205' })); defs.append(clip); svg.append(defs);
  for (let i = 0; i <= 4; i++) {
    const xv = xr[0] + i / 4 * (xr[1] - xr[0]); const yv = yr[0] + i / 4 * (yr[1] - yr[0]);
    svg.append(svgNode(doc, 'line', { x1: '62', x2: '540', y1: String(y(yv)), y2: String(y(yv)), class: 'mr-gridline' }));
    svg.append(svgNode(doc, 'text', { x: String(x(xv)), y: '250', 'text-anchor': 'middle' }, formatNumber(xv)));
    svg.append(svgNode(doc, 'text', { x: '54', y: String(y(yv) + 4), 'text-anchor': 'end' }, formatNumber(yv)));
  }
  svg.append(svgNode(doc, 'text', { x: '300', y: '275', 'text-anchor': 'middle' }, labelX));
  const curves = svgNode(doc, 'g', { 'clip-path': `url(#${id}-clip)` });
  for (const [series, index] of yIndices.entries()) {
    // A finite clipped coordinate cap prevents giant SVG numbers for near singularities.
    const coord = (v: number) => String(Math.max(-1e6, Math.min(1e6, v)));
    const segments: string[] = []; let penDown = false; let vertices = 0;
    for (const [i, row] of rows.entries()) {
      if (!finitePair(row, index)) { penDown = false; continue; }
      if (vertices >= maxPerSeries || seriesCounts[series] !== 1 && i % stride !== 0 && i !== rows.length - 1) continue;
      segments.push(`${penDown ? 'L' : 'M'}${coord(x(row[xIndex]))},${coord(y(row[index]))}${penDown ? '' : 'l0,0'}`); penDown = true; vertices++;
      if (rows.length === 1) curves.append(svgNode(doc, 'circle', { cx: coord(x(row[xIndex])), cy: coord(y(row[index])), r: '3', class: 'mr-point' }));
    }
    if (segments.length) curves.append(svgNode(doc, 'path', { d: segments.join(' '), class: 'mr-curve', 'stroke-dasharray': ['', '7 4', '2 3', '9 3 2 3', '12 6', '1 4'][series], 'stroke-width': '2', 'stroke-linecap': 'round', fill: 'none' }));
  }
  svg.append(curves); if (maxPerSeries) section.append(svg); section.append(el(doc, 'p', description, 'mr-meta'));
  if (block.y.length > 1) section.append(el(doc, 'p', block.y.map((name, i) => `${block.labels[name] ?? name}: ${['solid', 'dashed', 'dotted', 'dash-dot', 'long dash', 'fine dots'][i]}, ${seriesCounts[i]} finite points`).join('; '), 'mr-meta'));
  const details = el(doc, 'details'); details.append(el(doc, 'summary', 'Plot data table')); details.open = view?.open ?? false;
  const holder = el(doc, 'div', undefined, 'mr-table-wrap'); let page = Math.max(0, Math.min(Math.ceil(rows.length / 100) - 1, Math.floor(view?.page ?? 0)));
  details.addEventListener('toggle', () => { if (details.open) drawTable(); else holder.replaceChildren(); if (details.isConnected) view?.onChange(details.open, page); });
  const status = el(doc, 'p', undefined, 'mr-meta'); status.setAttribute('aria-live', 'polite');
  const previous = button(doc, 'Previous data rows', () => { page--; drawTable(); view?.onChange(details.open, page); });
  const next = button(doc, 'Next data rows', () => { page++; drawTable(); view?.onChange(details.open, page); });
  function drawTable() {
    const start = page * 100; const end = Math.min(start + 100, rows.length);
    const data = rows.slice(start, end).map(row => Object.fromEntries([block.x, ...block.y].map(name => { const value = row[trajectory.columns.indexOf(name)]; return [name, typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : 'missing']; })));
    holder.replaceChildren(table(doc, [block.x, ...block.y].map(name => ({ key: name, label: block.labels[name] ?? name })), data, `Data rows ${start + 1}–${end} of ${rows.length}`));
    status.textContent = `Rows ${start + 1}–${end} of ${rows.length}.`; previous.disabled = page === 0; next.disabled = end >= rows.length;
  }
  if (details.open) drawTable(); details.append(holder, status, previous, next); section.append(details); return section;
}
