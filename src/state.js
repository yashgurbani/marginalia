const listeners = new Set();
let sequence = 0;

export const state = {
  doc: null,
  cursorSection: null,
  marks: {},
  knowledge: [],
  artifacts: [],
  depth: {},
  layers: { source: true, reader: true, agent: true },
  activity: [],
  pendingQuestions: [],
};

function fail(code, detail, next_step) {
  throw { code, detail, next_step };
}

function notify() {
  for (const listener of [...listeners]) listener(state);
}

function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function requireSection(sectionId) {
  const section = state.doc?.sections.find((item) => item.id === sectionId);
  if (!section) {
    fail("not_found", `Section '${sectionId}' was not found.`, "read the document structure and use a listed section id");
  }
  return section;
}

function requireText(value, name, minimum = 1) {
  if (typeof value !== "string" || value.trim().length < minimum) {
    fail("validation_failed", `${name} must contain at least ${minimum} characters.`, `provide a valid ${name}`);
  }
  return value.trim();
}

export function loadDoc(sections, meta) {
  if (!Array.isArray(sections) || sections.length === 0 || !meta || typeof meta !== "object") {
    fail("validation_failed", "A document needs metadata and at least one section.", "provide metadata and one or more sections");
  }
  const ids = new Set();
  const cleanSections = sections.map((section) => {
    const id = requireText(section?.id, "section id");
    if (ids.has(id)) fail("validation_failed", `Duplicate section id '${id}'.`, "use a unique id for every section");
    ids.add(id);
    return { id, heading: requireText(section.heading, "heading"), text: String(section.text ?? "") };
  });
  const source = {
    id: requireText(meta.id, "document id"),
    title: requireText(meta.title, "document title"),
    attribution: String(meta.attribution ?? ""),
    license: String(meta.license ?? ""),
    sections: cleanSections,
  };
  state.doc = deepFreeze(source);
  state.cursorSection = cleanSections[0].id;
  state.marks = Object.fromEntries(cleanSections.map(({ id }) => [id, { known: false, lost: false, tappedTerms: [] }]));
  state.knowledge = [];
  state.artifacts = [];
  state.depth = Object.fromEntries(cleanSections.map(({ id }) => [id, { level: "full", reason: "", knowledgeRefs: [] }]));
  state.layers = { source: true, reader: true, agent: true };
  state.activity = [];
  state.pendingQuestions = [];
  notify();
  return state.doc;
}

export function getReadingState({ include_text = false } = {}) {
  if (!state.doc) return {
    doc: null,
    cursor: null,
    cursor_section: null,
    sections: [],
    knowledge_counts: { confirmed: 0, proposed: 0, rejected: 0, total: 0 },
    knowledge_summary: { confirmed: [], proposed: [] },
    layers: clone(state.layers),
    pending: [],
    pending_questions: [],
  };
  const sections = state.doc.sections.map((section) => {
    const result = {
      id: section.id,
      heading: section.heading,
      depth: state.depth[section.id]?.level ?? "full",
      word_count: section.text.trim() ? section.text.trim().split(/\s+/).length : 0,
      reader_marks: {
        known: state.marks[section.id].known,
        lost: state.marks[section.id].lost,
        tapped_terms: [...state.marks[section.id].tappedTerms],
      },
      agent_artifacts: state.artifacts.filter((item) => item.sectionId === section.id).map(clone),
    };
    result.marks = clone(result.reader_marks);
    result.artifact_count = result.agent_artifacts.length;
    if (include_text || result.depth === "full") result.text = section.text;
    return result;
  });
  const confirmed = state.knowledge.filter((item) => item.status === "confirmed").map(clone);
  const proposed = state.knowledge.filter((item) => item.status === "proposed").map(clone);
  const rejectedCount = state.knowledge.filter((item) => item.status === "rejected").length;
  return {
    doc: { ...clone(state.doc), sections },
    cursor: state.cursorSection,
    cursor_section: state.cursorSection,
    sections: clone(sections),
    knowledge_counts: { confirmed: confirmed.length, proposed: proposed.length, rejected: rejectedCount, total: state.knowledge.length },
    knowledge_summary: {
      confirmed,
      proposed,
    },
    layers: clone(state.layers),
    pending: clone(state.pendingQuestions),
    pending_questions: clone(state.pendingQuestions),
  };
}

export function getSectionText(id) {
  return requireSection(id).text;
}

export function setCursor(sectionId) {
  requireSection(sectionId);
  state.cursorSection = sectionId;
  notify();
}

export function mark(sectionId, kind, on) {
  requireSection(sectionId);
  if (!["known", "lost"].includes(kind) || typeof on !== "boolean") {
    fail("validation_failed", "A mark needs kind known or lost and a boolean value.", "provide a valid reader mark");
  }
  state.marks[sectionId][kind] = on;
  notify();
}

export function tapTerm(sectionId, term) {
  requireSection(sectionId);
  const cleanTerm = requireText(term, "term");
  const terms = state.marks[sectionId].tappedTerms;
  if (!terms.some((item) => item.toLocaleLowerCase() === cleanTerm.toLocaleLowerCase())) terms.push(cleanTerm);
  notify();
}

export function upsertKnowledge({ concept, level, evidence, source }) {
  const cleanConcept = requireText(concept, "concept");
  const cleanEvidence = requireText(evidence, "evidence", 10);
  if (!["none", "heard", "working", "solid"].includes(level)) {
    fail("validation_failed", "Knowledge level must be none, heard, working, or solid.", "choose one listed knowledge level");
  }
  if (!["interview", "inferred", "reader"].includes(source)) {
    fail("validation_failed", "Knowledge source must be interview, inferred, or reader.", "choose one listed knowledge source");
  }
  let entry = state.knowledge.find((item) => item.concept.toLocaleLowerCase() === cleanConcept.toLocaleLowerCase());
  if (entry) {
    const levelChanged = entry.level !== level;
    Object.assign(entry, { concept: cleanConcept, level, evidence: cleanEvidence, source, ts: new Date().toISOString() });
    if (levelChanged) entry.status = "proposed";
  } else {
    entry = { id: nextId("K"), concept: cleanConcept, level, evidence: cleanEvidence, source, status: "proposed", ts: new Date().toISOString() };
    state.knowledge.push(entry);
  }
  notify();
  return clone(entry);
}

export function setKnowledgeStatus(id, status) {
  if (!["confirmed", "rejected"].includes(status)) {
    fail("validation_failed", "Knowledge status must be confirmed or rejected.", "choose a listed knowledge status");
  }
  const entry = state.knowledge.find((item) => item.id === id);
  if (!entry) fail("not_found", `Knowledge entry '${id}' was not found.`, "read the knowledge list and use a listed id");
  entry.status = status;
  entry.ts = new Date().toISOString();
  notify();
  return clone(entry);
}

export function setDepth(sectionId, level, reason, knowledgeRefs = [], apply = "now") {
  requireSection(sectionId);
  if (!["hidden", "stub", "summary", "full"].includes(level)) {
    fail("validation_failed", "Depth must be hidden, stub, summary, or full.", "choose a listed depth");
  }
  const cleanReason = requireText(reason, "reason", 8);
  if (!Array.isArray(knowledgeRefs)) {
    fail("validation_failed", "knowledgeRefs must be an array.", "provide an array of knowledge entry ids");
  }
  if (level === "hidden" && !knowledgeRefs.some((id) => state.knowledge.some((item) => item.id === id && item.status === "confirmed"))) {
    fail("precondition_failed", "Hidden depth requires a confirmed knowledge reference.", "ask the reader to confirm knowledge first, or use stub");
  }
  if (!["now", "pending", "when_reader_moves"].includes(apply)) {
    fail("validation_failed", "Apply must be now, pending, or when_reader_moves.", "choose a listed apply mode");
  }
  const change = { type: "depth", sectionId, level, reason: cleanReason, knowledgeRefs: [...knowledgeRefs] };
  if (sectionId === state.cursorSection || apply !== "now") {
    state.pendingQuestions = state.pendingQuestions.filter((item) => !(item.type === "depth" && item.sectionId === sectionId));
    state.pendingQuestions.push(change);
  } else {
    state.depth[sectionId] = { level, reason: cleanReason, knowledgeRefs: [...knowledgeRefs] };
  }
  notify();
  return { ok: true, pending: sectionId === state.cursorSection || apply !== "now", ...clone(change) };
}

export function applyPending(sectionId) {
  requireSection(sectionId);
  const pending = state.pendingQuestions.filter((item) => item.type === "depth" && item.sectionId === sectionId);
  for (const item of pending) state.depth[sectionId] = { level: item.level, reason: item.reason, knowledgeRefs: [...item.knowledgeRefs] };
  state.pendingQuestions = state.pendingQuestions.filter((item) => !(item.type === "depth" && item.sectionId === sectionId));
  notify();
  return pending.length;
}

export function addArtifact(sectionId, artifact) {
  requireSection(sectionId);
  if (!artifact || typeof artifact !== "object") fail("validation_failed", "An artifact object is required.", "provide the artifact fields");
  const reason = requireText(artifact.reason, "reason", 8);
  const entry = { ...clone(artifact), id: nextId("A"), author: "agent", reason, ts: new Date().toISOString(), kind: requireText(artifact.kind, "kind"), sectionId };
  state.artifacts.push(entry);
  notify();
  return clone(entry);
}

export function removeArtifact(id) {
  const index = state.artifacts.findIndex((item) => item.id === id);
  if (index < 0) fail("not_found", `Artifact '${id}' was not found.`, "read the section artifacts and use a listed id");
  const [removed] = state.artifacts.splice(index, 1);
  notify();
  return clone(removed);
}

export function removeAllArtifacts() {
  const count = state.artifacts.length;
  state.artifacts = [];
  notify();
  return count;
}

export function toggleLayer(name, on) {
  if (!["source", "reader", "agent"].includes(name) || typeof on !== "boolean") {
    fail("validation_failed", "A layer needs name source, reader, or agent and a boolean value.", "provide a valid layer and value");
  }
  state.layers[name] = on;
  notify();
}

export function logActivity(toolName, summary) {
  state.activity.push({ toolName: requireText(toolName, "tool name"), summary: String(summary ?? ""), ts: new Date().toISOString() });
  if (state.activity.length > 100) state.activity.splice(0, state.activity.length - 100);
  notify();
}

export function subscribe(fn) {
  if (typeof fn !== "function") fail("validation_failed", "A subscriber must be a function.", "provide a callback function");
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportJSON() {
  return clone({
    source: state.doc,
    reader: { cursorSection: state.cursorSection, marks: state.marks, knowledge: state.knowledge },
    agent: { artifacts: state.artifacts, depth: state.depth, pendingQuestions: state.pendingQuestions },
    layers: state.layers,
    activity: state.activity,
  });
}
