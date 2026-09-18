export const AUTO_ASSIST_HIGHLIGHT = 'marginalia-auto-assist';
export const AUTO_ASSIST_CSS = '::highlight(marginalia-auto-assist) { text-decoration-line: underline; text-decoration-style: dotted; text-decoration-thickness: 1px; text-underline-offset: 3px; text-decoration-color: currentColor; }';
type Paint = { priority: number };
type Registry = { set(name: string, paint: Paint): unknown; delete(name: string): unknown; get?(name: string): Paint | undefined };
/** Paint only: never wraps, splits, edits source nodes, inserts focus targets, or changes selection. */
export function paintAutoAssistMarks(registry: Registry | undefined, makeHighlight: ((...ranges: Range[]) => Paint) | undefined, ranges: readonly Range[]): boolean {
  if (!registry) return false;
  registry.delete(AUTO_ASSIST_HIGHLIGHT);
  if (!makeHighlight || !ranges.length) return false;
  const paint = makeHighlight(...ranges.slice(0, 30)); paint.priority = 0;
  for (const [name, priority] of [['marginalia-kept', 10], ['marginalia-highlighted', 20], ['marginalia-selection', 30], ['marginalia-focus', 30]] as const) {
    const existing = registry.get?.(name); if (existing) existing.priority = priority;
  }
  registry.set(AUTO_ASSIST_HIGHLIGHT, paint); return true;
}
/** Shared by pointer and the keyboard-accessible margin list. Highlight paint itself is not focusable. */
export function candidateAtOffset<T extends { start: number; end: number }>(candidates: readonly T[], offset: number): T | undefined {
  return candidates.find(c => offset >= c.start && offset < c.end);
}
