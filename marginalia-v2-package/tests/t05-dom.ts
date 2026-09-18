import type { TestContext } from 'node:test';

/** Connected-tree/event fixture. It intentionally does not model layout, native
 * accessibility, CSS, or browser trust. Those remain separate acceptance gates. */
export class TestElement {
  tagName: string; ownerDocument: TestDocument; parentElement: TestElement | null = null;
  childNodes: TestElement[] = []; dataset: Record<string, string> = {}; attributes = new Map<string, string>();
  style: Record<string, unknown> & { setProperty(key: string, value: string): void } = { setProperty(key, value) { this[key] = value; } };
  listeners = new Map<string, ((event: any) => void)[]>();
  value = ''; disabled = false; hidden = false; readOnly = false; id = ''; type = ''; tabIndex = 0; open = false;
  selectionStart = 0; selectionEnd = 0; scrollTop = 0; offsetTop = 0; clientHeight = 600; offsetHeight = 32;
  ownText = ''; scrollCalls = 0;
  constructor(tag: string, doc: TestDocument) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; }
  get children() { return this.childNodes.filter(node => node.tagName !== '#TEXT'); }
  get firstElementChild() { return this.children[0] ?? null; }
  get className() { return this.attributes.get('class') ?? ''; }
  set className(value: string) { this.attributes.set('class', value); }
  get classList(): { add(...v: string[]): void; remove(...v: string[]): void; contains(v: string): boolean; toggle(v: string, force?: boolean): boolean } {
    return { add: (...values) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...values])].join(' '); },
      remove: (...values) => { this.className = this.className.split(' ').filter(v => !values.includes(v)).join(' '); },
      contains: value => this.className.split(' ').includes(value), toggle: (value, force) => { const present = force ?? !this.classList.contains(value); if (present) this.classList.add(value); else this.classList.remove(value); return present; } };
  }
  get textContent(): string { return this.ownText + this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.ownText = value ?? ''; }
  get isConnected(): boolean { return this === this.ownerDocument.documentElement || !!this.parentElement?.isConnected; }
  contains(node: TestElement | null): boolean { return !!node && (node === this || this.childNodes.some(child => child.contains(node))); }
  remove() { if (!this.parentElement) return; if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body; this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this); this.parentElement = null; }
  append(...nodes: TestElement[]) { for (const node of nodes) this.insertBefore(node, null); }
  prepend(...nodes: TestElement[]) { for (const node of [...nodes].reverse()) this.insertBefore(node, this.childNodes[0] ?? null); }
  insertBefore(node: TestElement, before: TestElement | null) { if (node === before) return; node.remove(); node.parentElement = this; const i = before ? this.childNodes.indexOf(before) : -1; if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node); }
  replaceChildren(...nodes: TestElement[]) { for (const child of [...this.childNodes]) child.remove(); this.ownText = ''; this.append(...nodes); }
  replaceWith(node: TestElement) { const parent = this.parentElement; if (parent) { parent.insertBefore(node, this); this.remove(); } }
  private dataKey(name: string) { return name.slice(5).replace(/-([a-z])/g, (_all, char: string) => char.toUpperCase()); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); if (name.startsWith('data-')) this.dataset[this.dataKey(name)] = String(value); if (name === 'id') this.id = value; }
  getAttribute(name: string) { if (name === 'hidden') return this.hidden ? '' : null; return name.startsWith('data-') ? this.dataset[this.dataKey(name)] ?? null : this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (/^\.[\w-]+$/.test(selector)) return this.classList.contains(selector.slice(1));
    const attr = /^(\w+)?\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(selector);
    if (attr) return (!attr[1] || this.tagName === attr[1].toUpperCase()) && (attr[3] === undefined ? this.getAttribute(attr[2]) !== null : this.getAttribute(attr[2]) === attr[3]);
    const not = /^(\w+):not\((.+)\)$/.exec(selector); if (not) return this.matches(not[1]) && !this.matches(not[2]);
    if (selector.includes(' ')) {
      const parts = selector.split(/\s+/), last = parts.pop()!;
      if (!this.matches(last)) return false;
      let ancestor = this.parentElement;
      while (parts.length) { const part = parts.pop()!; while (ancestor && !ancestor.matches(part)) ancestor = ancestor.parentElement; if (!ancestor) return false; ancestor = ancestor.parentElement; }
      return true;
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector: string): TestElement[] { return this.childNodes.flatMap(node => [...(selector.split(',').some(part => node.matches(part.trim())) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): TestElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  addEventListener(type: string, callback: (event: any) => void, options?: { signal?: AbortSignal }) {
    if (options?.signal?.aborted) return;
    const list = this.listeners.get(type) ?? []; list.push(callback); this.listeners.set(type, list);
    options?.signal?.addEventListener('abort', () => { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(fn => fn !== callback)); }, { once: true });
  }
  removeEventListener(type: string, callback: (event: any) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(fn => fn !== callback)); }
  fire(type: string, properties: Record<string, unknown> = {}) {
    const event: any = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (let node: TestElement | null = this; node; node = node.parentElement) for (const fn of [...(node.listeners.get(type) ?? [])]) fn(event);
    return event;
  }
  click() { if (!this.disabled) this.fire('click'); }
  focus(_options?: unknown) { if (!this.isConnected || this.disabled || this.closest('[hidden]') || this.ownerDocument.activeElement === this) return; this.ownerDocument.activeElement = this; this.fire('focus'); this.fire('focusin'); }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  scrollIntoView() { this.scrollCalls++; }
  getBoundingClientRect() { return { top: this.offsetTop }; }
}
class Input extends TestElement {} class Textarea extends TestElement {}
export class TestDocument {
  documentElement: TestElement; body: TestElement; activeElement: TestElement;
  location = new URL('http://localhost:43120/'); defaultView: { top?: unknown } = {};
  constructor() { this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.append(this.body); this.activeElement = this.body; this.defaultView.top = this.defaultView; }
  createElement(tag: string) { return tag === 'input' ? new Input(tag, this) : tag === 'textarea' ? new Textarea(tag, this) : new TestElement(tag, this); }
  createTextNode(text: string) { const node = new TestElement('#text', this); node.textContent = text; return node; }
  querySelector(selector: string) { return this.documentElement.querySelector(selector); }
  getSelection() { return null; }
}
export function replaceGlobals(t: TestContext, values: Record<string, unknown>) {
  const old = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
}
export function dom(t: TestContext) {
  const document = new TestDocument(), root = document.createElement('div'); root.id = 'app'; document.body.append(root);
  const session = new Map<string, string>();
  replaceGlobals(t, { document, HTMLElement: TestElement, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
    window: new TestElement('window', document), location: document.location, CSS: {}, innerHeight: 900,
    matchMedia: () => ({ matches: false }), requestAnimationFrame: (callback: () => void) => setImmediate(callback),
    sessionStorage: { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key) },
  });
  return { document, root };
}
export const settle = () => new Promise<void>(resolve => setImmediate(resolve));
export function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export async function until(test: () => boolean) { for (let i = 0; i < 1000; i++) { if (test()) return; await settle(); } throw new Error('Controlled operation did not settle.'); }
export function button(root: TestElement, label: string) { const found = root.querySelectorAll('button').find(node => node.textContent === label); if (!found) throw new Error('Missing button: ' + label); return found; }
