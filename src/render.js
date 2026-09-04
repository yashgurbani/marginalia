import * as defaultStateApi from "./state.js";
import { renderFigure, renderMath } from "./figure.js";

const LEVELS = new Set(["hidden", "stub", "summary", "full"]);

function firstSentence(text) {
  const clean = String(text || "").trim();
  return clean.match(/^.*?[.!?](?:\s|$)/s)?.[0].trim() || clean.split("\n")[0] || "";
}

function firstParagraph(text) {
  return String(text || "").trim().split(/\n\s*\n/)[0] || "";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function enhanceMath(node) {
  renderMath(node).catch(() => {
    node.dataset.mathRenderer = "raw-latex";
  });
}

function appendTextWithHighlights(container, text, artifacts) {
  const ranges = artifacts
    .filter((item) => item.kind === "highlight")
    .map((item) => {
      if (item.range && Number.isInteger(item.range.start) && Number.isInteger(item.range.end)) return item.range;
      const start = item.quote ? text.indexOf(item.quote) : -1;
      return start >= 0 ? { start, end: start + item.quote.length } : null;
    })
    .filter(Boolean)
    .map(({ start, end }) => ({ start: Math.max(0, start), end: Math.min(text.length, end) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    container.append(document.createTextNode(text.slice(cursor, range.start)));
    container.append(el("mark", "agent-highlight", text.slice(range.start, range.end)));
    cursor = range.end;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function expandControl(section, stateApi) {
  const expand = el("button", "text-button expand-button", "expand");
  expand.type = "button";
  expand.addEventListener("click", (event) => {
    event.stopPropagation();
    stateApi.setDepth(section.id, "full", "Reader expanded this section.", [], "now");
    if (stateApi.state.pendingQuestions?.some((item) => item.sectionId === section.id)) stateApi.applyPending(section.id);
  });
  return expand;
}

function sourceBody(section, level, reason, artifacts, stateApi) {
  const wrap = el("div", "section-body");
  if (level === "hidden") {
    const line = el("p", "folded-line");
    line.append(document.createTextNode(`Folded: ${reason || "agent depth setting"} `), expandControl(section, stateApi));
    wrap.append(line);
    enhanceMath(line);
    return wrap;
  }

  const shown = level === "stub" ? firstSentence(section.text) : level === "summary" ? firstParagraph(section.text) : section.text;
  const source = el("p", "source-text");
  appendTextWithHighlights(source, shown, artifacts);
  wrap.append(source);
  enhanceMath(source);

  if (level === "stub" || level === "summary") {
    const line = el("p", "fold-reason");
    line.append(document.createTextNode(`Shortened: ${reason || "agent depth setting"} `), expandControl(section, stateApi));
    wrap.append(line);
    enhanceMath(line);
  }
  return wrap;
}

function appendSourceLine(card, source) {
  const label = typeof source === "string" ? source : source.title || source.url || source.path || "Source";
  const url = typeof source === "object" ? source.url : "";
  if (url) {
    const link = el("a", "artifact-source", label);
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    card.append(link);
  } else card.append(el("span", "artifact-source", label));
}

function connectionTargetLabel(artifact, stateApi) {
  const knowledge = stateApi.state?.knowledge?.find((entry) => entry.id === artifact.target);
  return knowledge ? `${knowledge.concept} (${artifact.target})` : artifact.target;
}

function artifactCard(artifact, stateApi) {
  const card = el("article", `artifact-card artifact-kind-${artifact.kind || "annotation"}`);
  card.dataset.artifactId = artifact.id;
  const kind = [artifact.kind || "annotation", artifact.stance].filter(Boolean).join(" · ");
  card.append(el("div", "artifact-kind", kind));

  if (artifact.kind === "figure" && artifact.svg) {
    const figure = el("div", "artifact-figure");
    try {
      renderFigure(figure, artifact.svg, { label: artifact.text || "Agent-generated diagram" });
    } catch (error) {
      figure.append(el("p", "empty-state", `Figure unavailable: ${error.detail || error.message || String(error)}`));
    }
    card.append(figure);
  }

  if (artifact.kind === "connection" && artifact.target) {
    const connection = el("div", "artifact-connection");
    connection.append(el("span", "artifact-relation", artifact.relation || "bridge"));
    const target = el("a", "connection-target artifact-target", connectionTargetLabel(artifact, stateApi));
    target.href = String(artifact.target).startsWith("s") ? `#section-${artifact.target}` : "#";
    connection.append(target);
    card.append(connection);
  }

  const content = artifact.text ?? artifact.text_md ?? artifact.summary ?? artifact.why;
  if (content) {
    const body = el("div", "artifact-text", content);
    card.append(body);
    enhanceMath(body);
  }
  for (const source of artifact.sources || []) appendSourceLine(card, source);

  const reason = el("div", "artifact-reason");
  reason.append(document.createTextNode(`${artifact.reason || "No reason supplied."} `));
  const remove = el("button", "text-button remove-artifact", "remove");
  remove.type = "button";
  remove.addEventListener("click", () => stateApi.removeArtifact(artifact.id));
  reason.append(remove);
  card.append(reason);
  enhanceMath(reason);
  return card;
}

function selectedWord(container) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !container.contains(selection.anchorNode)) return "";
  return selection.toString().trim().match(/[\p{L}\p{N}'’-]+/u)?.[0] || "";
}

function pendingLine(pending, stateApi) {
  const verbs = { hidden: "fold", stub: "shorten", summary: "shorten", full: "expand" };
  const line = el("div", "pending-change");
  line.append(document.createTextNode(`Will ${verbs[pending.level] || "change"} when you move on. `));
  const apply = el("button", "text-button", "apply now");
  apply.type = "button";
  apply.addEventListener("click", (event) => {
    event.stopPropagation();
    stateApi.applyPending(pending.sectionId);
  });
  line.append(apply);
  return line;
}

export function initRenderer({ root, stateApi = defaultStateApi } = {}) {
  if (!root) throw new Error("initRenderer requires a root element.");
  const previousDepth = new Map();

  const render = (snapshot = stateApi.state) => {
    root.replaceChildren();
    root.classList.toggle("agent-layer-off", snapshot.layers?.agent === false);
    root.classList.toggle("reader-layer-off", snapshot.layers?.reader === false);
    root.classList.toggle("source-layer-off", snapshot.layers?.source === false && snapshot.layers?.agent !== false);
    if (!snapshot.doc) {
      root.append(el("p", "empty-state", "Choose a document to begin."));
      return;
    }

    for (const section of snapshot.doc.sections) {
      const row = el("div", "section-row");
      row.id = `section-${section.id}`;
      row.dataset.sectionId = section.id;
      const article = el("section", "document-section");
      if (snapshot.cursorSection === section.id) article.classList.add("is-cursor");
      article.addEventListener("click", () => stateApi.setCursor(section.id));

      const configured = LEVELS.has(snapshot.depth?.[section.id]?.level) ? snapshot.depth[section.id].level : "full";
      const level = snapshot.layers?.agent === false ? "full" : configured;
      const heading = el("div", "section-heading");
      const headingMeta = el("div", "section-heading-meta");
      headingMeta.append(el("h2", "", section.heading), el("span", "depth-chip", level));
      heading.append(headingMeta);

      const controls = el("div", "reader-controls");
      const marks = snapshot.marks?.[section.id] || {};
      for (const [markKind, label] of [["known", "I know this"], ["lost", "Lost me"]]) {
        const button = el("button", `mark-button${marks[markKind] ? " is-active" : ""}`, label);
        button.type = "button";
        button.setAttribute("aria-pressed", String(Boolean(marks[markKind])));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          stateApi.mark(section.id, markKind, !marks[markKind]);
        });
        controls.append(button);
      }
      heading.append(controls);
      article.append(heading);

      const oldLevel = previousDepth.get(section.id);
      if (oldLevel && oldLevel !== level && article.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        article.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      }
      previousDepth.set(section.id, level);

      const sectionArtifacts = snapshot.layers?.agent === false
        ? []
        : (snapshot.artifacts || []).filter((item) => item.sectionId === section.id);
      const highlights = snapshot.layers?.reader === false ? [] : sectionArtifacts;
      if (snapshot.layers?.source !== false || snapshot.layers?.agent === false) {
        article.append(sourceBody(section, level, snapshot.depth?.[section.id]?.reason, highlights, stateApi));
      }

      const pending = snapshot.pendingQuestions?.find((item) => item.type === "depth" && item.sectionId === section.id);
      if (pending && snapshot.layers?.agent !== false) article.append(pendingLine(pending, stateApi));

      article.addEventListener("dblclick", () => {
        const term = selectedWord(article);
        if (term) stateApi.tapTerm(section.id, term);
      });

      const gutter = el("aside", "margin-gutter");
      gutter.setAttribute("aria-label", `Agent artifacts for ${section.heading}`);
      for (const artifact of sectionArtifacts.filter((item) => item.kind !== "highlight")) gutter.append(artifactCard(artifact, stateApi));
      row.append(article, gutter);
      root.append(row);
    }
  };

  const unsubscribe = stateApi.subscribe(render);
  render(stateApi.state);
  return { render, destroy: unsubscribe };
}
