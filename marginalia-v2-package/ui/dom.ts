export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(label: string, action: () => unknown) {
  const node = el('button', label); node.type = 'button';
  node.addEventListener('click', () => { void action(); }); return node;
}
