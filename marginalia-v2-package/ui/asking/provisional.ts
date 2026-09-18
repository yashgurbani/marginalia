import type { CandidateReply, ModelBlock, PlotBlock } from '../../contracts/reply.ts';
import { calculateReply } from '../../renderer/state.ts';
import { renderPlot, type PlotData } from '../../renderer/plot.ts';

/** A bounded first frame from a structurally validated partial. No committed
 * renderer, result sentence, execution callback or authored markup is mounted. */
export function provisionalGraphic(doc: Document, candidate: CandidateReply): SVGSVGElement | undefined {
  const plots = candidate.blocks.filter((block): block is PlotBlock => block.type === 'plot');
  const supplied = plots.find(plot => candidate.blocks.some(block => block.id === plot.from && (block.type === 'model' || block.type === 'table')));
  const source = supplied ? candidate.blocks.find(block => block.id === supplied.from) : candidate.blocks.find(block => block.type === 'model');
  if (!source || source.type !== 'model' && source.type !== 'table') return;
  let plot: PlotBlock, data: PlotData;
  if (source.type === 'model') {
    const bounded: ModelBlock = source.kind === 'ode' ? { ...source, maxSteps: Math.min(source.maxSteps, 4000) }
      : { ...source, iterations: Math.min(source.iterations, 4000) };
    const parameters = Object.fromEntries(candidate.parameters.map(parameter => [parameter.name, parameter.default]));
    // Keep the packaged kernel's known-pole protection while withholding all
    // classification presentation. The preview uses one model and one graphic.
    const calculation = calculateReply({ ...candidate, blocks: [bounded, ...candidate.blocks.filter(block => block.type === 'classification')],
      checks: candidate.checks.filter(check => check.model === source.id) }, parameters);
    const result = calculation.models.get(source.id);
    if (!result?.ok) return;
    data = { ...result.value, origin: 'model' };
    plot = supplied ?? { id: `${source.id}-preview`, type: 'plot', from: source.id,
      x: source.kind === 'ode' ? 't' : 'n', y: source.state.slice(0, 6), labels: {} };
  } else {
    if (!supplied) return;
    plot = supplied;
    const columns = source.columns.map(column => column.key);
    data = { columns, rows: source.rows.map(row => columns.map(name => typeof row[name] === 'number' && Number.isFinite(row[name]) ? row[name] as number : null)),
      steps: 0, end: 'complete', origin: 'table' };
  }
  // Reuse the packaged plot's finite-range checks, pole-safe data, clipping and
  // accessible axis descriptions. Only its inert SVG enters the live surface.
  const drawing = renderPlot(doc, plot, data, `provisional-${crypto.randomUUID()}`,
    { open: false, page: 0, maxVertices: 600, onChange() {} });
  const graphic = drawing.querySelector('svg');
  if (!graphic) return;
  const description = graphic.querySelector('desc');
  const limited = data.end !== 'complete' || source.type === 'model' && source.kind === 'map' && source.iterations > 4000;
  if (description) description.textContent = `${graphic.querySelector('title')?.textContent ?? 'Plot'}. Provisional ${source.type === 'table' ? 'supplied values' : 'calculation at the starting inputs'}. `
    + (limited ? 'This frame covers a limited part of the declared calculation. ' : 'This frame shows the available interval. ')
    + 'The graphic uses at most 600 vertices. Final checks are pending.';
  return graphic;
}
