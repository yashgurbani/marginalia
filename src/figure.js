export const KATEX_VERSION = "0.16.22";
export const KATEX_JS_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`;
export const KATEX_CSS_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;

const MAX_SVG_CHARS = 120000;
const MAX_VIEWBOX_EDGE = 10000;
const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse",
  "text", "tspan", "title", "desc", "defs", "marker", "lineargradient", "radialgradient",
  "stop", "clippath", "mask",
]);
const URL_ATTRS = new Set(["href", "xlink:href", "src"]);
const PAINT_ATTRS = new Set(["fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"]);
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\\])+\$/g;
const MATH_TEST = /\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\\])+\$/;

let katexPromise = null;

function failure(detail, next_step = "provide a self-contained SVG diagram") {
  throw { code: "validation_failed", detail, next_step };
}

function numeric(value) {
  const match = String(value ?? "").trim().match(/^(-?\d+(?:\.\d+)?)(?:px)?$/i);
  return match ? Number(match[1]) : NaN;
}

function safeFragment(value) {
  const text = String(value ?? "").trim();
  return !text || /^#[A-Za-z_][\w:.-]*$/.test(text);
}

function scrubElement(node) {
  const name = node.localName?.toLowerCase();
  if (!name || !ALLOWED_TAGS.has(name)) {
    node.remove();
    return;
  }

  for (const attribute of [...node.attributes]) {
    const attrName = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (attrName.startsWith("on") || attrName === "style") {
      node.removeAttribute(attribute.name);
      continue;
    }
    if (URL_ATTRS.has(attrName) && !safeFragment(value)) {
      node.removeAttribute(attribute.name);
      continue;
    }
    if (PAINT_ATTRS.has(attrName) && /url\s*\(/i.test(value) && !/^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/i.test(value)) {
      node.removeAttribute(attribute.name);
      continue;
    }
    if (/javascript:|data:text\/html|@import|expression\s*\(/i.test(value)) node.removeAttribute(attribute.name);
  }
}

function normalizeRoot(root) {
  root.removeAttribute("xmlns:xlink");
  let viewBox = root.getAttribute("viewBox") || root.getAttribute("viewbox");
  root.removeAttribute("viewbox");
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (viewBox) {
    const values = viewBox.trim().split(/[\s,]+/).map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
      failure("svg viewBox must contain four finite numbers with positive width and height.");
    }
    if (values[2] > MAX_VIEWBOX_EDGE || values[3] > MAX_VIEWBOX_EDGE) {
      failure(`svg viewBox may not exceed ${MAX_VIEWBOX_EDGE} units on either edge.`, "provide a smaller, schematic SVG");
    }
    viewBox = values.join(" ");
  } else {
    const width = numeric(root.getAttribute("width"));
    const height = numeric(root.getAttribute("height"));
    const safeWidth = Number.isFinite(width) && width > 0 ? Math.min(width, 1200) : 640;
    const safeHeight = Number.isFinite(height) && height > 0 ? Math.min(height, 900) : 360;
    viewBox = `0 0 ${safeWidth} ${safeHeight}`;
  }

  root.setAttribute("viewBox", viewBox);
  root.setAttribute("width", "100%");
  root.setAttribute("height", "auto");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
}


function sanitizeSvgFallback(source) {
  if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(source)) {
    failure("svg must have one valid SVG root element.", "provide a complete, well-formed SVG element");
  }
  let svg = source
    .replace(/<(?:script|foreignObject|iframe|object|embed|audio|video|style|image)\b[^>]*>[\s\S]*?<\/(?:script|foreignObject|iframe|object|embed|audio|video|style|image)\s*>/gi, "")
    .replace(/<(?:script|foreignObject|iframe|object|embed|audio|video|style|image)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:xlink:)?href\s*=\s*(["'])(?!#)[\s\S]*?\1/gi, "")
    .replace(/\s+(?:fill|stroke|filter|clip-path|mask|marker-start|marker-mid|marker-end)\s*=\s*(["'])\s*url\((?!\s*#[A-Za-z_][\w:.-]*\s*\))[\s\S]*?\1/gi, "")
    .replace(/\sviewbox\s*=/i, " viewBox=");
  if (/javascript:|data:text\/html|@import|expression\s*\(/i.test(svg)) {
    svg = svg.replace(/\s+[\w:-]+\s*=\s*(["'])[\s\S]*?(?:javascript:|data:text\/html|@import|expression\s*\()[\s\S]*?\1/gi, "");
  }

  const rootOpen = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!rootOpen) failure("svg must have one valid SVG root element.");
  let replacement = rootOpen.replace(/\sviewbox\s*=/i, " viewBox=");
  const viewBoxMatch = replacement.match(/\sviewBox\s*=\s*(["'])(.*?)\1/i);
  let viewBox;
  if (viewBoxMatch) {
    const values = viewBoxMatch[2].trim().split(/[\s,]+/).map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
      failure("svg viewBox must contain four finite numbers with positive width and height.");
    }
    if (values[2] > MAX_VIEWBOX_EDGE || values[3] > MAX_VIEWBOX_EDGE) {
      failure(`svg viewBox may not exceed ${MAX_VIEWBOX_EDGE} units on either edge.`, "provide a smaller, schematic SVG");
    }
    viewBox = values.join(" ");
    replacement = replacement.replace(viewBoxMatch[0], ` viewBox="${viewBox}"`);
  } else {
    const width = numeric(replacement.match(/\swidth\s*=\s*["']([^"']+)/i)?.[1]);
    const height = numeric(replacement.match(/\sheight\s*=\s*["']([^"']+)/i)?.[1]);
    const safeWidth = Number.isFinite(width) && width > 0 ? Math.min(width, 1200) : 640;
    const safeHeight = Number.isFinite(height) && height > 0 ? Math.min(height, 900) : 360;
    viewBox = `0 0 ${safeWidth} ${safeHeight}`;
    replacement = replacement.replace(/<svg\b/i, `<svg viewBox="${viewBox}"`);
  }
  replacement = replacement
    .replace(/\swidth\s*=\s*(?:"[^"]*"|'[^']*')/i, "")
    .replace(/\sheight\s*=\s*(?:"[^"]*"|'[^']*')/i, "")
    .replace(/>$/, ' width="100%" height="auto" preserveAspectRatio="xMidYMid meet">');
  svg = svg.replace(rootOpen, replacement);
  if (/<(?:script|foreignObject|iframe|object|embed|audio|video|style|image)\b|\son\w+\s*=|(?:https?:|data:text\/html|javascript:)/i.test(svg)) {
    failure("svg still contains active or external content after sanitization.");
  }
  return svg;
}

function ensureKatexStyles() {
  if (typeof document === "undefined" || document.querySelector(`link[data-marginalia-katex="${KATEX_VERSION}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = KATEX_CSS_URL;
  link.crossOrigin = "anonymous";
  link.dataset.marginaliaKatex = KATEX_VERSION;
  document.head.append(link);
}

function loadKatex() {
  if (globalThis.katex?.render) return Promise.resolve(globalThis.katex);
  if (katexPromise) return katexPromise;
  if (typeof document === "undefined") return Promise.reject(new Error("KaTeX requires a browser document."));

  ensureKatexStyles();
  katexPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-marginalia-katex="${KATEX_VERSION}"]`);
    if (existing) {
      existing.addEventListener("load", () => globalThis.katex?.render ? resolve(globalThis.katex) : reject(new Error("KaTeX loaded without exposing its API.")), { once: true });
      existing.addEventListener("error", () => reject(new Error("KaTeX CDN was blocked.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = KATEX_JS_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.marginaliaKatex = KATEX_VERSION;
    script.addEventListener("load", () => globalThis.katex?.render ? resolve(globalThis.katex) : reject(new Error("KaTeX loaded without exposing its API.")), { once: true });
    script.addEventListener("error", () => reject(new Error("KaTeX CDN was blocked.")), { once: true });
    document.head.append(script);
  });
  return katexPromise;
}

function candidateTextNodes(container) {
  if (typeof document === "undefined" || !container) return [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue?.includes("$")) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".katex, svg, script, style, textarea, pre, code")) return NodeFilter.FILTER_REJECT;
      return MATH_TEST.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const result = [];
  while (walker.nextNode()) result.push(walker.currentNode);
  return result;
}

function typesetTextNode(node, katex) {
  const text = node.nodeValue || "";
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  MATH_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MATH_PATTERN)) {
    if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    const raw = match[0];
    const displayMode = raw.startsWith("$$");
    const expression = raw.slice(displayMode ? 2 : 1, displayMode ? -2 : -1);
    const holder = document.createElement(displayMode ? "div" : "span");
    holder.className = displayMode ? "marginalia-math marginalia-math-display" : "marginalia-math marginalia-math-inline";
    try {
      katex.render(expression, holder, {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml",
      });
    } catch {
      holder.textContent = raw;
      holder.dataset.mathFallback = "true";
    }
    fragment.append(holder);
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  node.replaceWith(fragment);
}

export async function renderMath(container) {
  if (!container || !container.textContent?.includes("$")) return { status: "empty", version: KATEX_VERSION };
  try {
    const katex = await loadKatex();
    for (const node of candidateTextNodes(container)) typesetTextNode(node, katex);
    container.dataset.mathRenderer = `katex-${KATEX_VERSION}`;
    return { status: "rendered", version: KATEX_VERSION };
  } catch (error) {
    container.dataset.mathRenderer = "raw-latex";
    container.dataset.mathFallback = error?.message || "KaTeX unavailable";
    return { status: "fallback", version: KATEX_VERSION, detail: container.dataset.mathFallback };
  }
}

export function sanitizeSvg(value) {
  const source = String(value ?? "").trim();
  if (!source || source.length > MAX_SVG_CHARS) {
    failure(`svg must contain between 1 and ${MAX_SVG_CHARS} characters.`, "provide a smaller SVG diagram");
  }
  if (typeof DOMParser !== "function" || typeof XMLSerializer !== "function") {
    return sanitizeSvgFallback(source);
  }

  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement?.localName?.toLowerCase() !== "svg") {
    failure("svg must have one valid SVG root element.", "provide a complete, well-formed SVG element");
  }

  const root = parsed.documentElement;
  for (const node of [...root.querySelectorAll("*")]) scrubElement(node);
  scrubElement(root);
  normalizeRoot(root);

  const serialized = new XMLSerializer().serializeToString(root);
  if (/<(?:script|foreignObject|iframe|object|embed|audio|video|style)\b|\son\w+\s*=|(?:https?:|data:text\/html|javascript:)/i.test(serialized)) {
    failure("svg still contains active or external content after sanitization.");
  }
  return serialized;
}

export function renderFigure(container, svg, { label = "Agent-generated diagram" } = {}) {
  if (!container) throw new TypeError("renderFigure requires a container element.");
  const safe = sanitizeSvg(svg);
  const template = document.createElement("template");
  template.innerHTML = safe;
  const root = template.content.firstElementChild;
  if (!root || root.localName.toLowerCase() !== "svg") failure("sanitized SVG could not be rendered.");
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", label);
  root.style.display = "block";
  root.style.width = "100%";
  root.style.maxHeight = "280px";
  root.style.overflow = "visible";
  container.replaceChildren(root);
  return root;
}
