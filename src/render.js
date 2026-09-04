import * as defaultStateApi from "./state.js";

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
    const mark = el("mark", "agent-highlight", text.slice(range.start, range.end));
    container.append(mark);
    cursor = range.end;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function sourceBody(section, level, reason, artifacts, stateApi) {
  const wrap = el("div", "section-body");
  if (level === "hidden") {
    wrap.append(el("p", "folded-line", `folded: ${reason || "agent depth setting"}`));
  } else {
    const shown = level === "stub" ? firstSentence(section.text) : level === "summary" ? firstParagraph(section.text) : section.text;
    const p = el("p", "source-text");
    appendTextWithHighlights(p, shown, artifacts);
    wrap.append(p);
    if (level === "stub") wrap.append(el("p", "fold-reason", `Folded after the first sentence: ${reason || "agent depth setting"}`));
  }
  if (level === "hidden" || level === "stub") {
    const expand = el("button", "text-button expand-button", "Expand");
    expand.type = "button";
    expand.addEventListener("click", (event) => {
      event.stopPropagation();
      stateApi.setDepth(section.id, "full", "Reader expanded this section.", [], "now");
      if (stateApi.state.pendingQuestions?.some((item) => item.sectionId === section.id)) stateApi.applyPending(section.id);
    });
    wrap.append(expand);
  }
  return wrap;
}

function artifactCard(artifact, stateApi) {
  const card = el("article", "artifact-card");
  card.dataset.artifactId = artifact.id;
  const top = el("div", "artifact-top");
  top.append(el("span", "artifact-kind", artifact.kind || "annotation"));
  top.append(el("span", "agent-tag", "author:agent"));
  card.append(top);

  if (artifact.kind === "figure" && artifact.svg) {
    const figure = el("div", "artifact-figure");
    figure.innerHTML = artifact.svg;
    card.append(figure);
  }
  const content = artifact.text ?? artifact.text_md ?? artifact.summary ?? artifact.why;
  if (content) card.append(el("p", "artifact-text", content));
  if (artifact.stance) card.append(el("p", "artifact-stance", `Stance: ${artifact.stance}`));
  if (["caveat", "perspective"].includes(artifact.kind) && artifact.sources?.length) {
    const list = el("ul", "artifact-sources");
    for (const source of artifact.sources) {
      const item = el("li");
      if (typeof source === "string") item.textContent = source;
      else {
        const label = source.title || source.url || source.path || "Source";
        if (source.url) {
          const link = el("a", "", label);
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          item.append(link);
        } else item.textContent = label;
      }
      list.append(item);
    }
    card.append(list);
  }
  card.append(el("p", "artifact-reason", artifact.reason || "No reason supplied."));
  const remove = el("button", "text-button remove-artifact", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => stateApi.removeArtifact(artifact.id));
  card.append(remove);
  return card;
}

function selectedWord(container) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !container.contains(selection.anchorNode)) return "";
  return selection.toString().trim().match(/[\p{L}\p{N}'’-]+/u)?.[0] || "";
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
      row.dataset.sectionId = section.id;
      const article = el("section", "document-section");
      if (snapshot.cursorSection === section.id) article.classList.add("is-cursor");
      article.addEventListener("click", () => stateApi.setCursor(section.id));

      const heading = el("div", "section-heading");
      heading.append(el("h2", "", section.heading));
      const configured = LEVELS.has(snapshot.depth?.[section.id]?.level) ? snapshot.depth[section.id].level : "full";
      const level = snapshot.layers?.agent === false ? "full" : configured;
      heading.append(el("span", "depth-chip", level));
      article.append(heading);
      const oldLevel = previousDepth.get(section.id);
      if (oldLevel && oldLevel !== level && article.animate) {
        article.animate(
          [{ opacity: 0.45, transform: "translateY(-4px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 300, easing: "ease-out" },
        );
      }
      previousDepth.set(section.id, level);

      const sectionArtifacts = snapshot.layers?.agent === false ? [] : snapshot.artifacts.filter((item) => item.sectionId === section.id);
      if (snapshot.layers?.source !== false || snapshot.layers?.agent === false) {
        article.append(sourceBody(section, level, snapshot.depth?.[section.id]?.reason, sectionArtifacts, stateApi));
      }

      const pending = snapshot.pendingQuestions?.find((item) => item.type === "depth" && item.sectionId === section.id);
      if (pending && snapshot.layers?.agent !== false) {
        const badge = el("div", "pending-badge", `Pending: ${pending.level}`);
        const apply = el("button", "text-button", "Apply now");
        apply.type = "button";
        apply.addEventListener("click", (event) => {
          event.stopPropagation();
          stateApi.applyPending(section.id);
        });
        badge.append(apply);
        article.append(badge);
      }

      const controls = el("div", "reader-controls");
      const marks = snapshot.marks?.[section.id] || {};
      for (const [kind, label] of [["known", "I know this"], ["lost", "Lost me"]]) {
        const button = el("button", `mark-button${marks[kind] ? " is-active" : ""}`, label);
        button.type = "button";
        button.setAttribute("aria-pressed", String(Boolean(marks[kind])));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          stateApi.mark(section.id, kind, !marks[kind]);
        });
        controls.append(button);
      }
      article.append(controls);
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
