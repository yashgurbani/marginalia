import {
  state,
  getReadingState,
  getSectionText,
  upsertKnowledge,
  setDepth,
  addArtifact,
  logActivity,
} from "./state.js";

const annotationKinds = ["gloss", "expand", "eli5", "question", "caveat", "perspective", "link", "prerequisite", "connection", "reference"];
const stances = ["supports", "contradicts", "extends", "unclear"];

function refusal(detail, next_step, code = "validation_failed") {
  throw { code, detail, next_step };
}

function text(value, field, minimum = 1) {
  if (typeof value !== "string" || value.trim().length < minimum) {
    refusal(`${field} must contain at least ${minimum} characters.`, `provide a valid ${field}`);
  }
  return value.trim();
}

function sectionId(input) {
  return text(input.section_id ?? input.sectionId, "section id");
}

function reason(input) {
  return text(input.reason, "reason", 8);
}

function rangeFor(input, sectionText) {
  const range = input.range;
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > sectionText.length) {
    refusal("range must contain valid start and end offsets within the section.", "read the section text and provide valid character offsets");
  }
  return { start: range.start, end: range.end };
}

function schema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: true };
}

function sanitizeSvg(value) {
  let svg = text(value, "svg");
  if (!/^\s*<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    refusal("svg must have one SVG root element.", "provide a complete SVG element");
  }
  svg = svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<\/?script\b[^>]*>/gi, "")
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<\/?foreignObject\b[^>]*>/gi, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:xlink:)?href\s*=\s*(["'])(?!#)[\s\S]*?\1/gi, "");
  svg = svg.replace(/\sviewbox\s*=/i, " viewBox=");
  if (!/\sviewBox\s*=/i.test(svg)) {
    const width = Number(svg.match(/\swidth\s*=\s*["']([\d.]+)/i)?.[1]) || 640;
    const height = Number(svg.match(/\sheight\s*=\s*["']([\d.]+)/i)?.[1]) || 360;
    svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }
  return svg;
}

function summarize(input) {
  const id = input?.section_id ?? input?.sectionId;
  return id ? `section ${id}` : "completed";
}

function tool(name, description, inputSchema, operation) {
  return {
    name,
    description,
    inputSchema,
    async execute(input = {}) {
      try {
        logActivity(name, summarize(input));
        return await operation(input);
      } catch (error) {
        const shaped = error && typeof error === "object" ? error : {};
        return {
          ok: false,
          error: shaped.code || "validation_failed",
          detail: shaped.detail || shaped.message || String(error),
          next_step: shaped.next_step || "correct the input and try again",
        };
      }
    },
  };
}

const tools = [
  tool(
    "get_reading_state",
    "Reads structure, reader marks, cursor, and knowledge. Call before reshaping and cite knowledge in each reason. Never changes the source.",
    schema({ include_text: { type: "boolean", default: false } }),
    async ({ include_text = false }) => ({ ok: true, ...getReadingState({ include_text }) }),
  ),
  tool(
    "get_section_text",
    "Reads one immutable source section. Never changes source text or any reader mark.",
    schema({ section_id: { type: "string" } }, ["section_id"]),
    async (input) => {
      const id = sectionId(input);
      return { ok: true, section_id: id, text: getSectionText(id) };
    },
  ),
  tool(
    "get_knowledge",
    "Reads all knowledge entries and their reader-controlled status. Never confirms an entry for the reader.",
    schema({}),
    async () => ({ ok: true, knowledge: JSON.parse(JSON.stringify(state.knowledge)) }),
  ),
  tool(
    "upsert_knowledge",
    "Records one concept as proposed knowledge. Ask, do not assume; only the reader confirms it.",
    schema({ concept: { type: "string" }, level: { enum: ["none", "heard", "working", "solid"] }, evidence: { type: "string" }, source: { enum: ["interview", "inferred", "reader"] } }, ["concept", "level", "evidence", "source"]),
    async (input) => ({ ok: true, entry: upsertKnowledge(input) }),
  ),
  tool(
    "search_notes",
    "Searches the reader's local vault. Cite returned paths in connections and reasons. Never sends notes or changes source text.",
    schema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 5 } }, ["query"]),
    async ({ query, limit = 5 }) => {
      const cleanQuery = text(query, "query");
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) refusal("limit must be an integer from 1 through 50.", "provide a limit from 1 through 50");
      if (!globalThis.window?.marginaliaVault?.search) return { ok: true, results: [], detail: "no vault loaded" };
      const results = await globalThis.window.marginaliaVault.search(cleanQuery, limit);
      return { ok: true, results: Array.isArray(results) ? results.slice(0, limit) : [] };
    },
  ),
  tool(
    "set_section_depth",
    "Changes only the agent depth layer with a visible reason. Hiding needs confirmed knowledge, and current-section changes stay pending.",
    schema({ section_id: { type: "string" }, level: { enum: ["hidden", "stub", "summary", "full"] }, reason: { type: "string" }, knowledge_refs: { type: "array", items: { type: "string" }, default: [] }, apply: { enum: ["now", "pending", "when_reader_moves"], default: "now" } }, ["section_id", "level", "reason"]),
    async (input) => setDepth(sectionId(input), input.level, reason(input), input.knowledge_refs ?? input.knowledgeRefs ?? [], input.apply ?? "now"),
  ),
  tool(
    "annotate",
    "Adds a removable margin artifact with a reason. Never rewrites source text. Caveats and perspectives need sources and a calibrated stance.",
    schema({ section_id: { type: "string" }, kind: { enum: annotationKinds }, range: { type: "object" }, text: { type: "string" }, sources: { type: "array" }, stance: { enum: stances }, reason: { type: "string" } }, ["section_id", "kind", "reason"]),
    async (input) => {
      const id = sectionId(input);
      const kind = input.kind;
      if (!annotationKinds.includes(kind)) refusal(`kind must be one of: ${annotationKinds.join(", ")}.`, "choose a listed annotation kind");
      const artifact = { kind, reason: reason(input) };
      if (input.text !== undefined) artifact.text = text(input.text, "text");
      if (["gloss", "expand", "eli5", "question", "caveat", "perspective", "link"].includes(kind) && !artifact.text) {
        refusal(`${kind} annotations require text.`, "provide the margin annotation text");
      }
      if (input.range !== undefined) artifact.range = rangeFor(input, getSectionText(id));
      if (kind === "gloss" && !artifact.range) refusal("gloss annotations require a range.", "provide start and end offsets for the term");
      if (["caveat", "perspective"].includes(kind)) {
        if (!Array.isArray(input.sources) || input.sources.length < 1) refusal(`${kind} annotations require at least one source.`, "provide a source and calibrated stance");
        if (!stances.includes(input.stance)) refusal(`stance must be one of: ${stances.join(", ")}.`, "provide a calibrated stance");
      }
      if (kind === "prerequisite") {
        const body = text(input.text_md ?? input.text, "text_md");
        if (body.trim().split(/\s+/).length > 600) refusal("prerequisite text must contain 600 words or fewer.", "shorten the prerequisite text");
        artifact.text_md = body;
        if (!input.generated && (!Array.isArray(input.sources) || input.sources.length < 1)) refusal("A non-generated prerequisite requires at least one source.", "provide a source or mark generated as true");
      }
      if (kind === "connection" && (!input.target || !input.relation)) refusal("connection requires target and relation.", "provide a note path or knowledge id and its relation");
      if (kind === "reference" && (!input.url || !input.role || !input.why)) refusal("reference requires url, role, and why.", "provide all reference fields");
      for (const key of ["sources", "stance", "target", "relation", "title", "text_md", "url", "role", "why"]) {
        if (input[key] !== undefined) artifact[key] = input[key];
      }
      return { ok: true, artifact: addArtifact(id, artifact) };
    },
  ),
  tool(
    "highlight",
    "Adds a removable agent-layer highlight with a reason. The exact quote must occur in the immutable section text.",
    schema({ section_id: { type: "string" }, quote: { type: "string" }, reason: { type: "string" } }, ["section_id", "quote", "reason"]),
    async (input) => {
      const id = sectionId(input);
      const quote = text(input.quote, "quote");
      const source = getSectionText(id);
      const start = source.indexOf(quote);
      if (start < 0) refusal("quote does not occur in the specified section.", "copy an exact quote from get_section_text");
      const artifact = addArtifact(id, { kind: "highlight", quote, range: { start, end: start + quote.length }, reason: reason(input) });
      return { ok: true, artifact };
    },
  ),
  tool(
    "insert_figure",
    "Adds a sanitized SVG to the margin with a removable reason. Never writes into the source; use schematics over decoration.",
    schema({ section_id: { type: "string" }, svg: { type: "string" }, caption: { type: "string" }, reason: { type: "string" } }, ["section_id", "svg", "caption", "reason"]),
    async (input) => {
      const id = sectionId(input);
      const artifact = addArtifact(id, { kind: "figure", svg: sanitizeSvg(input.svg), text: text(input.caption, "caption"), reason: reason(input) });
      return { ok: true, artifact };
    },
  ),
];

const exposed = Object.fromEntries(tools.map((item) => [item.name, item]));
if (globalThis.window) globalThis.window.marginaliaTools = exposed;

let modelContext = null;
let hostName = null;
if (globalThis.navigator?.modelContext) {
  modelContext = globalThis.navigator.modelContext;
  hostName = "navigator.modelContext";
} else if (globalThis.document?.modelContext) {
  modelContext = globalThis.document.modelContext;
  hostName = "document.modelContext";
} else if (globalThis.window?.modelContext) {
  modelContext = globalThis.window.modelContext;
  hostName = "window.modelContext";
}

if (modelContext?.registerTool) {
  console.info(`[Marginalia] WebMCP host: ${hostName}`);
  for (const item of tools) modelContext.registerTool(item);
} else {
  console.warn("[Marginalia] No modelContext host found; test tools remain available on window.marginaliaTools.");
}

export { tools };
