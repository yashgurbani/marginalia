import dagre from '@dagrejs/dagre';
import type { DiagramBlock, SourceBinding } from '../contracts/reply.ts';
import { button, el } from './dom.ts';
import { svgNode } from './plot.ts';

export function renderDiagram(doc: Document, block: DiagramBlock, id: string, bindings: SourceBinding[], bind: (node: HTMLElement | SVGElement, binding: SourceBinding) => void): HTMLElement {
  const wrapper = el(doc, 'div', undefined, 'mr-diagram');
  const graph = new dagre.graphlib.Graph({ multigraph: true }).setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 65, marginx: 24, marginy: 24 }).setDefaultEdgeLabel(() => ({}));
  const lines = (text: string) => text.match(/.{1,24}(?:\s|$)|.{1,24}/g)?.map(s => s.trim()) ?? [text];
  for (const node of block.nodes) graph.setNode(node.id, { label: node.label, width: 210, height: 26 + lines(node.label).length * 18 });
  for (const edge of block.edges) graph.setEdge(edge.from, edge.to, { label: edge.label, width: edge.label ? 150 : 0, height: edge.label ? lines(edge.label).length * 16 : 0 }, edge.id);
  dagre.layout(graph);
  const width = graph.graph().width ?? 480; const height = graph.graph().height ?? 280;
  const canvas = el(doc, 'div', undefined, 'mr-diagram-canvas'); canvas.tabIndex = 0; canvas.setAttribute('role', 'region'); canvas.setAttribute('aria-label', 'Scrollable diagram; text description follows');
  const svg = svgNode(doc, 'svg', { viewBox: `0 0 ${width} ${height}`, width: String(width), height: String(height), role: 'img', 'aria-labelledby': `${id}-title` });
  svg.append(svgNode(doc, 'title', { id: `${id}-title` }, `Diagram with ${block.nodes.length} nodes and ${block.edges.length} connections. A complete text description follows.`));
  const defs = svgNode(doc, 'defs'); const arrow = svgNode(doc, 'marker', { id: `${id}-arrow`, markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient: 'auto' }); arrow.append(svgNode(doc, 'path', { d: 'M0,0 L8,4 L0,8 Z', class: 'mr-arrow' })); defs.append(arrow); svg.append(defs);
  for (const group of block.groups ?? []) {
    const members = group.nodes.map(name => graph.node(name));
    if (!members.length) continue;
    const left = Math.min(...members.map(n => n.x - n.width / 2)) - 12; const top = Math.min(...members.map(n => n.y - n.height / 2)) - 24;
    const right = Math.max(...members.map(n => n.x + n.width / 2)) + 12; const bottom = Math.max(...members.map(n => n.y + n.height / 2)) + 12;
    svg.append(svgNode(doc, 'rect', { x: String(left), y: String(top), width: String(right - left), height: String(bottom - top), rx: '6', class: 'mr-diagram-group' }));
    svg.append(svgNode(doc, 'text', { x: String(left + 8), y: String(top + 16) }, group.label));
  }
  for (const edge of graph.edges()) {
    const info = graph.edge(edge); const points: { x: number; y: number }[] = info.points ?? [];
    const group = svgNode(doc, 'g', { id: `${id}-edge-${edge.name}` });
    group.append(svgNode(doc, 'path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), class: 'mr-edge', 'marker-end': `url(#${id}-arrow)` }));
    if (info.label) { const label = svgNode(doc, 'text', { x: String(info.x), y: String(info.y), 'text-anchor': 'middle' }); for (const [i, line] of lines(String(info.label)).entries()) label.append(svgNode(doc, 'tspan', { x: String(info.x), dy: i ? '16' : '0' }, line)); group.append(label); }
    const source = bindings.find(b => b.name === block.edges.find(e => e.id === edge.name)?.binding);
    if (source) bind(group, source);
    svg.append(group);
  }
  for (const node of block.nodes) {
    const info = graph.node(node.id); const g = svgNode(doc, 'g', { id: `${id}-node-${node.id}` });
    g.append(svgNode(doc, 'rect', { x: String(info.x - info.width / 2), y: String(info.y - info.height / 2), width: String(info.width), height: String(info.height), rx: '4', class: 'mr-diagram-node' }));
    const text = svgNode(doc, 'text', { x: String(info.x), y: String(info.y - info.height / 2 + 23), 'text-anchor': 'middle' });
    for (const [i, line] of lines(node.label).entries()) text.append(svgNode(doc, 'tspan', { x: String(info.x), dy: i ? '18' : '0' }, line)); g.append(text);
    const source = bindings.find(b => b.name === node.binding);
    if (source) bind(g, source);
    svg.append(g);
  }
  canvas.append(svg); wrapper.append(canvas);
  const description = el(doc, 'details'); description.append(el(doc, 'summary', 'Diagram text description'));
  for (const group of block.groups ?? []) description.append(el(doc, 'p', `${group.label}: ${group.nodes.map(id => block.nodes.find(n => n.id === id)?.label ?? id).join(', ')}`));
  const list = el(doc, 'ul');
  for (const node of block.nodes) {
    const li = el(doc, 'li', node.label); const source = bindings.find(b => b.name === node.binding);
    if (source) { const control = button(doc, `Source for ${node.label}`, () => {}); bind(control, source); li.append(control); }
    list.append(li);
  }
  for (const edge of block.edges) {
    const li = el(doc, 'li', `${block.nodes.find(n => n.id === edge.from)?.label} → ${block.nodes.find(n => n.id === edge.to)?.label}${edge.label ? `: ${edge.label}` : ''}`);
    const source = bindings.find(b => b.name === edge.binding);
    if (source) { const control = button(doc, `Source for connection ${edge.label ?? edge.id}`, () => {}); bind(control, source); li.append(control); }
    list.append(li);
  }
  description.append(list); wrapper.append(description); return wrapper;
}
