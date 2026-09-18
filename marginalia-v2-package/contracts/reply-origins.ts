import type { CandidateReply } from './reply.ts';

/** Author declarations of origin, never host attestations of support. */
export type PartOrigin =
  | { kind: 'source-page'; binding: string }
  | { kind: 'reader-note'; noteId: string; revision: number }
  | { kind: 'computed'; description: string }
  | { kind: 'analogy'; description: string }
  | { kind: 'fetched'; url: string }
  | { kind: 'authored'; description: string };
export type ReplyOrigins = { version: 1; parts: Record<string, PartOrigin> };
export type OriginPart = { path: string; label: string };

/** JSON pointers into this immutable version. No implicit inheritance: mixed
 * collections identify each independently visible item. */
export function replyOriginParts(reply: CandidateReply): OriginPart[] {
  const parts: OriginPart[] = [];
  const add = (path: string, label: string) => parts.push({ path, label });
  const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
  add('/title', 'Title'); add('/summary', 'Summary'); add('/staticFallback', 'Saved text alternative');
  if (reply.illustration) add('/illustration', 'Illustration statement');
  reply.sourceBindings.forEach((_, i) => add(`/sourceBindings/${i}`, `Source passage ${i + 1}`));
  reply.parameters.forEach((_, i) => add(`/parameters/${i}`, `Input ${i + 1}`));
  reply.assumptions.forEach((_, i) => add(`/assumptions/${i}`, `Assumption ${i + 1}`));
  reply.limitations.forEach((_, i) => add(`/limitations/${i}`, `Limitation ${i + 1}`));
  reply.blocks.forEach((block, i) => {
    const path = `/blocks/${i}`, label = `Part ${i + 1} (${block.type})`;
    add(path, label);
    const item = (collection: string, n: number, name: string) => add(`${path}/${collection}/${n}`, `${label}: ${name} ${n + 1}`);
    switch (block.type) {
      case 'diagram':
        block.nodes.forEach((_, n) => item('nodes', n, 'node'));
        block.edges.forEach((_, n) => item('edges', n, 'connection'));
        block.groups?.forEach((_, n) => item('groups', n, 'group')); break;
      case 'steps': block.steps.forEach((_, n) => item('steps', n, 'step')); break;
      case 'compare': block.variants.forEach((_, n) => item('variants', n, 'comparison')); break;
      case 'question': block.answers.forEach((_, n) => item('answers', n, 'answer')); break;
      case 'table':
        block.columns.forEach((_, n) => item('columns', n, 'column'));
        block.rows.forEach((row, n) => Object.keys(row).forEach(key => add(`${path}/rows/${n}/${pointer(key)}`, `${label}: row ${n + 1}, column ${block.columns.findIndex(c => c.key === key) + 1}`))); break;
      case 'citations': block.entries.forEach((_, n) => {
        for (const field of ['claim', 'support', 'source'] as const) add(`${path}/entries/${n}/${field}`, `${label}: citation ${n + 1}, ${field === 'support' ? 'authored support assessment' : field}`);
      }); break;
      case 'shelf': block.items.forEach((_, n) => {
        add(`${path}/items/${n}/title`, `${label}: reading ${n + 1}`);
        add(`${path}/items/${n}/reason`, `${label}: reason ${n + 1}`);
      }); break;
      case 'samples':
        add(`${path}/envelope`, `${label}: sampling range and error statement`);
        block.samples.forEach((_, n) => item('samples', n, 'sample')); break;
      case 'media':
        if (block.alt) add(`${path}/alt`, `${label}: description`);
        if (block.transcript) add(`${path}/transcript`, `${label}: transcript`);
        block.timecodes?.forEach((_, n) => item('timecodes', n, 'time marker')); break;
    }
  });
  return parts;
}

export const LEGACY_ORIGIN_NOTICE = 'Origins unavailable for this older reply. Its saved explanation must not be treated as evidence.';
export function originReaderLabel(origin: PartOrigin): string {
  switch (origin.kind) {
    case 'source-page': return 'From this page';
    case 'reader-note': return `From your note, revision ${origin.revision}`;
    case 'computed': return 'Computed from an authored rule; a separate check is needed for a conclusion';
    case 'analogy': return 'An analogy, supplied to explain the idea';
    case 'fetched': return 'Fetched material; retrieval alone does not establish support';
    case 'authored': return 'Authored explanation; not evidence by itself';
  }
}

