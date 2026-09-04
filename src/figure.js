export const KATEX_VERSION = "0.16.22";

const MAX_SVG_CHARS = 120000;
const MAX_VIEWBOX_EDGE = 10000;
const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse",
  "text", "tspan", "title", "desc", "defs", "marker", "lineargradient", "radialgradient",
  "stop", "clippath", "mask",
]);
const URL_ATTRS = new Set(["href", "xlink:href", "src"]);
const PAINT_ATTRS = new Set(["fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"]);

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
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  let viewBox = root.getAttribute("viewBox") || root.getAttribute("viewbox");
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

export function sanitizeSvg(value) {
  const source = String(value ?? "").trim();
  if (!source || source.length > MAX_SVG_CHARS) {
    failure(`svg must contain between 1 and ${MAX_SVG_CHARS} characters.`, "provide a smaller SVG diagram");
  }
  if (typeof DOMParser !== "function" || typeof XMLSerializer !== "function") {
    failure("SVG parsing is unavailable in this browser.", "use a browser with DOMParser support");
  }

  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement?.localName?.toLowerCase() !== "svg") {
    failure("svg must have one valid SVG root element.", "provide a complete, well-formed SVG element");
  }

  const root = document.documentElement;
  for (const node of [...root.querySelectorAll("*")]) scrubElement(node);
  scrubElement(root);
  normalizeRoot(root);

  const serialized = new XMLSerializer().serializeToString(root);
  if (/<(?:script|foreignObject|iframe|object|embed|audio|video|style)\b|\son\w+\s*=|(?:https?:|data:text\/html|javascript:)/i.test(serialized)) {
    failure("svg still contains active or external content after sanitization.");
  }
  return serialized;
}

export function renderFigure(container, svg) {
  if (!container) throw new TypeError("renderFigure requires a container element.");
  const safe = sanitizeSvg(svg);
  const template = document.createElement("template");
  template.innerHTML = safe;
  const root = template.content.firstElementChild;
  if (!root || root.localName.toLowerCase() !== "svg") failure("sanitized SVG could not be rendered.");
  root.setAttribute("role", "img");
  root.style.display = "block";
  root.style.width = "100%";
  root.style.maxHeight = "280px";
  root.style.overflow = "visible";
  container.replaceChildren(root);
  return root;
}
