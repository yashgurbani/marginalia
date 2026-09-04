import * as defaultStateApi from "./state.js";
import { renderFigure, renderMath } from "./figure.js";
import { getVaultState, mountVaultControl, subscribeVault } from "./vault.js";
import { mountConnectionGraph } from "./graph.js";

const LEVELS = new Set(["hidden", "stub", "summary", "full"]);
const AUXILIARY_TABS = [["vault", "Vault"], ["connections", "Connections"]];

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
    const mark = el("mark", "agent-highlight", text.slice(range.start, range.end));
    container.append(mark);
    cursor = range.end;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function sourceBody(section, level, reason, artifacts, stateApi) {
  const wrap = el("div", "section-body");
  if (level === "hidden") {
    const folded = el("p", "folded-line", `folded: ${reason || "agent depth setting"}`);
    wrap.append(folded);
    enhanceMath(folded);
  } else {
    const shown = level === "stub" ? firstSentence(section.text) : level === "summary" ? firstParagraph(section.text) : section.text;
    const p = el("p", "source-text");
    appendTextWithHighlights(p, shown, artifacts);
    wrap.append(p);
    enhanceMath(p);
    if (level === "stub") {
      const foldReason = el("p", "fold-reason", `Folded after the first sentence: ${reason || "agent depth setting"}`);
      wrap.append(foldReason);
      enhanceMath(foldReason);
    }
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

function connectionTargetLabel(artifact, stateApi) {
  const knowledge = stateApi.state?.knowledge?.find((entry) => entry.id === artifact.target);
  return knowledge ? `${knowledge.concept} (${artifact.target})` : artifact.target;
}

function appendArtifactSources(card, sources) {
  if (!Array.isArray(sources) || !sources.length) return;
  const list = el("ul", "artifact-sources");
  for (const source of sources) {
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

function artifactCard(artifact, stateApi) {
  const card = el("article", `artifact-card artifact-kind-${artifact.kind || "annotation"}`);
  card.dataset.artifactId = artifact.id;
  const top = el("div", "artifact-top");
  top.append(el("span", "artifact-kind", artifact.kind || "annotation"));
  top.append(el("span", "agent-tag", "author:agent"));
  card.append(top);

  if (artifact.kind === "figure" && artifact.svg) {
    const figure = el("div", "artifact-figure");
    try {
      renderFigure(figure, artifact.svg, { label: artifact.text || "Agent-generated diagram" });
    } catch (error) {
      figure.append(el("p", "empty-state", `Figure unavailable: ${error.detail || error.message || String(error)}`));
    }
    card.append(figure);
  }

  if (artifact.kind === "connection") {
    const connection = el("div", "artifact-connection");
    Object.assign(connection.style, {
      margin: ".65rem 0",
      padding: ".55rem",
      border: "1px solid var(--line, #444)",
      borderRadius: "6px",
      background: "rgba(112,184,178,.08)",
    });
    const relation = el("span", "artifact-relation", artifact.relation || "bridge");
    Object.assign(relation.style, {
      display: "inline-block",
      marginBottom: ".35rem",
      color: "var(--reader, #70b8b2)",
      fontSize: ".7rem",
      fontWeight: "700",
      letterSpacing: ".06em",
      textTransform: "uppercase",
    });
    const target = el("code", "artifact-target", connectionTargetLabel(artifact, stateApi) || "Unknown target");
    Object.assign(target.style, { display: "block", overflowWrap: "anywhere", fontSize: ".78rem" });
    connection.append(relation, target);
    card.append(connection);
  }

  const content = artifact.text ?? artifact.text_md ?? artifact.summary ?? artifact.why;
  if (content) {
    const body = el("p", "artifact-text", content);
    card.append(body);
    enhanceMath(body);
  }
  if (artifact.stance) card.append(el("p", "artifact-stance", `Stance: ${artifact.stance}`));
  appendArtifactSources(card, artifact.sources);

  const reason = el("p", "artifact-reason", artifact.reason || "No reason supplied.");
  card.append(reason);
  enhanceMath(reason);

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

function mountAuxiliarySidebar({ stateApi }) {
  const pane = document.querySelector("#knowledge-pane");
  if (!pane || typeof MutationObserver !== "function") {
    return { refresh() {}, destroy() {} };
  }

  let activeAux = null;
  let scheduled = false;
  let vaultMount = null;
  let graphMount = null;
  let graphVaultUnsubscribe = null;
  let currentPanel = null;

  function cleanupMounts() {
    vaultMount?.destroy?.();
    graphMount?.destroy?.();
    graphVaultUnsubscribe?.();
    vaultMount = null;
    graphMount = null;
    graphVaultUnsubscribe = null;
    currentPanel = null;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhance();
    });
  }

  function setActive(name) {
    if (activeAux === name) {
      schedule();
      return;
    }
    activeAux = name;
    cleanupMounts();
    schedule();
  }

  function mountActivePanel(panel) {
    if (activeAux === "vault") {
      vaultMount = mountVaultControl({ root: panel });
      return;
    }
    if (activeAux === "connections") {
      graphMount = mountConnectionGraph({
        root: panel,
        getSnapshot: () => stateApi.state,
        getVaultState,
      });
      graphVaultUnsubscribe = subscribeVault(() => graphMount?.render());
      graphMount.activate();
    }
  }

  function enhance() {
    const tabs = pane.querySelector(".side-tabs");
    if (!tabs) return;

    tabs.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
    for (const button of tabs.querySelectorAll(".tab-button:not([data-marginalia-aux])")) {
      if (button.dataset.marginaliaObserved) continue;
      button.dataset.marginaliaObserved = "true";
      button.addEventListener("click", () => {
        activeAux = null;
        cleanupMounts();
        schedule();
      });
    }

    for (const [name, label] of AUXILIARY_TABS) {
      let button = tabs.querySelector(`[data-marginalia-aux="${name}"]`);
      if (!button) {
        button = el("button", "tab-button", label);
        button.type = "button";
        button.dataset.marginaliaAux = name;
        button.addEventListener("click", () => setActive(name));
        tabs.append(button);
      }
      const selected = activeAux === name;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    }

    if (!activeAux) {
      pane.querySelector("[data-marginalia-aux-panel]")?.remove();
      for (const child of [...pane.children]) {
        if (child !== tabs) child.style.removeProperty("display");
      }
      return;
    }

    for (const button of tabs.querySelectorAll(".tab-button:not([data-marginalia-aux])")) {
      button.classList.remove("is-active");
      button.setAttribute("aria-selected", "false");
    }
    for (const child of [...pane.children]) {
      if (child !== tabs && !child.hasAttribute("data-marginalia-aux-panel")) child.style.display = "none";
    }

    let panel = pane.querySelector(`[data-marginalia-aux-panel="${activeAux}"]`);
    if (!panel) {
      pane.querySelector("[data-marginalia-aux-panel]")?.remove();
      panel = el("section", "auxiliary-panel");
      panel.dataset.marginaliaAuxPanel = activeAux;
      Object.assign(panel.style, { padding: ".8rem" });
      pane.append(panel);
    }
    if (currentPanel !== panel) {
      cleanupMounts();
      currentPanel = panel;
      mountActivePanel(panel);
    } else if (activeAux === "connections") {
      graphMount?.render();
    }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(pane, { childList: true });
  schedule();

  return {
    refresh() {
      if (activeAux === "connections") graphMount?.render();
      schedule();
    },
    destroy() {
      observer.disconnect();
      cleanupMounts();
    },
  };
}

export function initRenderer({ root, stateApi = defaultStateApi } = {}) {
  if (!root) throw new Error("initRenderer requires a root element.");
  const previousDepth = new Map();
  const auxiliarySidebar = mountAuxiliarySidebar({ stateApi });

  const render = (snapshot = stateApi.state) => {
    root.replaceChildren();
    root.classList.toggle("agent-layer-off", snapshot.layers?.agent === false);
    root.classList.toggle("reader-layer-off", snapshot.layers?.reader === false);
    root.classList.toggle("source-layer-off", snapshot.layers?.source === false && snapshot.layers?.agent !== false);
    if (!snapshot.doc) {
      root.append(el("p", "empty-state", "Choose a document to begin."));
      auxiliarySidebar.refresh();
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

      const sectionArtifacts = snapshot.layers?.agent === false
        ? []
        : (snapshot.artifacts || []).filter((item) => item.sectionId === section.id);
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
    auxiliarySidebar.refresh();
  };

  const unsubscribe = stateApi.subscribe(render);
  render(stateApi.state);
  return {
    render,
    destroy() {
      unsubscribe();
      auxiliarySidebar.destroy();
    },
  };
}
