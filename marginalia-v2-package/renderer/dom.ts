import katex from 'katex';

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(doc: Document, text: string, action: () => void): HTMLButtonElement {
  const node = el(doc, 'button', text); node.type = 'button'; node.addEventListener('click', action); return node;
}
export function link(doc: Document, text: string, url: string): HTMLElement {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return el(doc, 'span', text);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === '::1' || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.includes(':') && /^(?:fc|fd|fe[89ab])/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return el(doc, 'span', text);
    const node = el(doc, 'a', text); node.href = parsed.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.referrerPolicy = 'no-referrer'; return node;
  } catch { return el(doc, 'span', text); }
}

/** Deliberately small formatting vocabulary; authored text never reaches an HTML sink. */
export function formattedText(doc: Document, source: string): HTMLElement {
  const wrapper = el(doc, 'div', undefined, 'mr-prose');
  const inline = (parent: HTMLElement, text: string) => {
    const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\))/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(doc.createTextNode(text.slice(start, match.index)));
      parent.append(match[2] ? el(doc, 'strong', match[2]) : match[3] ? el(doc, 'em', match[3]) : match[4] ? el(doc, 'code', match[4]) : link(doc, match[5], match[6]));
      start = match.index! + match[0].length;
    }
    parent.append(doc.createTextNode(text.slice(start)));
  };
  let list: HTMLUListElement | HTMLOListElement | undefined;
  for (const line of source.split('\n')) {
    const item = /^(?:[-*] |\d+\. )(.*)$/.exec(line);
    if (item) {
      const ordered = /^\d/.test(line);
      if (!list || (list.tagName === 'OL') !== ordered) { list = el(doc, ordered ? 'ol' : 'ul'); wrapper.append(list); }
      const li = el(doc, 'li'); inline(li, item[1]); list.append(li);
    } else {
      list = undefined;
      if (!line.trim()) continue;
      const heading = /^#{1,3} (.*)$/.exec(line);
      const node = el(doc, heading ? 'h4' : 'p'); inline(node, heading ? heading[1] : line); wrapper.append(node);
    }
  }
  return wrapper;
}

export function equation(doc: Document, tex: string): HTMLElement {
  const node = el(doc, 'div', undefined, 'mr-equation');
  // Only the installed renderer emits markup. trust:false disables URL/HTML commands.
  try { katex.render(tex, node, { trust: false, strict: 'error', throwOnError: true, displayMode: true, output: 'htmlAndMathml', maxExpand: 100, maxSize: 20 }); }
  catch { node.append(el(doc, 'code', tex), el(doc, 'p', 'This equation could not be typeset. Its source is shown above.', 'mr-meta')); }
  return node;
}

export function table(doc: Document, columns: { key: string; label: string; unit?: string }[], rows: Record<string, unknown>[], caption: string): HTMLTableElement {
  const result = el(doc, 'table'); result.append(el(doc, 'caption', caption));
  const head = el(doc, 'thead'); const tr = el(doc, 'tr');
  for (const column of columns) { const th = el(doc, 'th', column.label + (column.unit ? ` (${column.unit})` : '')); th.scope = 'col'; tr.append(th); }
  head.append(tr); result.append(head); const body = el(doc, 'tbody');
  for (const row of rows) { const line = el(doc, 'tr'); for (const column of columns) line.append(el(doc, 'td', row[column.key] === null || row[column.key] === undefined ? '—' : String(row[column.key]))); body.append(line); }
  result.append(body); return result;
}

/** Bounds one visible table page while preserving every supplied row and column. */
export function pagedTable(doc: Document, columns: { key: string; label: string; unit?: string }[], rows: Record<string, unknown>[], caption: string, view?: { page?: number; columnPage?: number; onChange(page: number, columnPage: number): void }): HTMLElement {
  const wrapper = el(doc, 'div', undefined, 'mr-table-wrap'); const holder = el(doc, 'div');
  let page = Math.max(0, Math.min(Math.max(0, Math.ceil(rows.length / 25) - 1), Math.floor(view?.page ?? 0)));
  let columnPage = Math.max(0, Math.min(Math.max(0, Math.ceil(columns.length / 8) - 1), Math.floor(view?.columnPage ?? 0)));
  const status = el(doc, 'p', '', 'mr-meta'); status.setAttribute('aria-live', 'polite');
  const change = () => { draw(); view?.onChange(page, columnPage); };
  const previous = button(doc, 'Previous rows', () => { page--; change(); }); const next = button(doc, 'Next rows', () => { page++; change(); });
  const previousColumns = button(doc, 'Previous columns', () => { columnPage--; change(); }); const nextColumns = button(doc, 'Next columns', () => { columnPage++; change(); });
  function draw() {
    const first = page * 25; const column = columnPage * 8;
    const label = `Rows ${rows.length ? first + 1 : 0}–${Math.min(first + 25, rows.length)} of ${rows.length}; columns ${columns.length ? column + 1 : 0}–${Math.min(column + 8, columns.length)} of ${columns.length}`;
    holder.replaceChildren(table(doc, columns.slice(column, column + 8), rows.slice(first, first + 25), caption)); status.textContent = label;
    previous.disabled = page === 0; next.disabled = first + 25 >= rows.length; previousColumns.disabled = columnPage === 0; nextColumns.disabled = column + 8 >= columns.length;
  }
  draw(); wrapper.append(holder, status); if (rows.length > 25) wrapper.append(previous, next); if (columns.length > 8) wrapper.append(previousColumns, nextColumns); return wrapper;
}
