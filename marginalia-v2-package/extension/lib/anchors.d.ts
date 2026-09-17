declare module 'dom-anchor-text-position' {
  export function fromRange(root: Node, range: Range): { start: number; end: number };
  export function toRange(root: Node, position: { start: number; end: number }): Range;
}
declare module 'dom-anchor-text-quote' {
  export function fromTextPosition(root: Node, position: { start: number; end: number }): { exact: string; prefix: string; suffix: string };
}
