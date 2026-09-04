const CYTOSCAPE_VERSION = "3.30.3";
const CYTOSCAPE_URL = `https://cdn.jsdelivr.net/npm/cytoscape@${CYTOSCAPE_VERSION}/dist/cytoscape.min.js`;

let cytoscapePromise = null;

function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortLabel(value, limit = 52) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function targetMetadata(target, snapshot, vaultState) {
  const knowledge = (snapshot.knowledge || []).find((entry) => entry.id === target);
  if (knowledge) return { id: `knowledge:${target}`, label: knowledge.concept, kind: "knowledge", target };
  const note = (vaultState?.notes || []).find((entry) => entry.path === target);
  return { id: `note:${target}`, label: note?.title || target, kind: "note", target };
}

export function getConnectionGraphData(snapshot = {}, vaultState = {}) {
  const nodes = new Map();
  const edges = [];
  const sections = snapshot.doc?.sections || [];
  const artifacts = snapshot.artifacts || [];

  for (const artifact of artifacts.filter((item) => item.kind === "connection" && item.sectionId && item.target)) {
    const section = sections.find((item) => item.id === artifact.sectionId);
    const sourceId = `section:${artifact.sectionId}`;
    const target = targetMetadata(artifact.target, snapshot, vaultState);
    nodes.set(sourceId, {
      data: {
        id: sourceId,
        label: shortLabel(section?.heading || artifact.sectionId),
        kind: "section",
        sectionId: artifact.sectionId,
      },
    });
    nodes.set(target.id, { data: target });
    edges.push({
      data: {
        id: artifact.id || `connection:${edges.length + 1}`,
        source: sourceId,
        target: target.id,
        relation: artifact.relation || "bridge",
        reason: artifact.reason || "",
        sectionId: artifact.sectionId,
      },
    });
  }

  return { nodes: [...nodes.values()], edges };
}

function loadCytoscape() {
  if (globalThis.cytoscape) return Promise.resolve(globalThis.cytoscape);
  if (cytoscapePromise) return cytoscapePromise;
  if (typeof document === "undefined") return Promise.reject(new Error("Cytoscape requires a browser document."));

  cytoscapePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-marginalia-cytoscape="${CYTOSCAPE_VERSION}"]`);
    if (existing) {
      existing.addEventListener("load", () => globalThis.cytoscape ? resolve(globalThis.cytoscape) : reject(new Error("Cytoscape loaded without exposing its API.")), { once: true });
      existing.addEventListener("error", () => reject(new Error("Cytoscape CDN was blocked.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = CYTOSCAPE_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.marginaliaCytoscape = CYTOSCAPE_VERSION;
    script.addEventListener("load", () => globalThis.cytoscape ? resolve(globalThis.cytoscape) : reject(new Error("Cytoscape loaded without exposing its API.")), { once: true });
    script.addEventListener("error", () => reject(new Error("Cytoscape CDN was blocked.")), { once: true });
    document.head.append(script);
  });
  return cytoscapePromise;
}

function selectorEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function defaultScroll(sectionId) {
  const section = document.querySelector(`[data-section-id="${selectorEscape(sectionId)}"]`);
  section?.scrollIntoView({ behavior: "smooth", block: "center" });
  section?.animate?.([
    { outline: "2px solid transparent" },
    { outline: "2px solid currentColor" },
    { outline: "2px solid transparent" },
  ], { duration: 900, easing: "ease-out" });
}

export function mountConnectionGraph({ root, getSnapshot, getVaultState, onSection = defaultScroll } = {}) {
  if (!root) throw new Error("mountConnectionGraph requires a root element.");
  root.replaceChildren();

  const status = el("p", "Connections are derived from attributed margin artifacts.");
  Object.assign(status.style, { margin: "0 0 .55rem", color: "var(--muted, #aaa)", fontSize: ".76rem" });
  const canvas = el("div");
  canvas.setAttribute("aria-label", "Connections graph");
  Object.assign(canvas.style, {
    display: "none",
    width: "100%",
    height: "360px",
    background: "var(--panel-2)",
  });
  const list = el("div");
  root.append(status, canvas, list);

  let active = false;
  let cy = null;
  let lastData = { nodes: [], edges: [] };
  let destroyed = false;

  const renderFallback = (data) => {
    list.replaceChildren();
    if (!data.edges.length) {
      const empty = el("p", "No connection artifacts yet.");
      Object.assign(empty.style, { margin: ".5rem 0", color: "var(--muted, #aaa)", fontSize: ".8rem" });
      list.append(empty);
      return;
    }
    const nodeMap = new Map(data.nodes.map((node) => [node.data.id, node.data]));
    for (const edge of data.edges) {
      const card = el("button");
      card.type = "button";
      const source = nodeMap.get(edge.data.source);
      const target = nodeMap.get(edge.data.target);
      card.textContent = `${source?.label || edge.data.sectionId} → ${edge.data.relation} → ${target?.label || edge.data.target}`;
      Object.assign(card.style, {
        display: "block", width: "100%", margin: ".5rem 0", padding: "0",
        border: "0", background: "transparent", color: "var(--link)",
        textAlign: "left", fontSize: "var(--small-size)", cursor: "pointer",
      });
      card.title = edge.data.reason;
      card.addEventListener("click", () => onSection(edge.data.sectionId));
      list.append(card);
    }
  };

  const updateCytoscape = (data) => {
    if (!cy || destroyed) return;
    cy.elements().remove();
    cy.add([...data.nodes, ...data.edges]);
    if (data.nodes.length) cy.layout({ name: "breadthfirst", directed: true, animate: false, fit: true, padding: 32, spacingFactor: 1.4 }).run();
  };

  const render = () => {
    if (destroyed) return;
    lastData = getConnectionGraphData(getSnapshot?.() || {}, getVaultState?.() || {});
    renderFallback(lastData);
    updateCytoscape(lastData);
    if (cy) {
      status.textContent = `${lastData.edges.length} live connection${lastData.edges.length === 1 ? "" : "s"}. Click a section node to locate its passage.`;
    } else if (active) {
      status.textContent = "Loading the optional interactive graph; the connection list remains usable.";
    }
  };

  const activate = async () => {
    if (destroyed) return;
    if (active) {
      render();
      return;
    }
    active = true;
    render();
    try {
      const cytoscape = await loadCytoscape();
      if (destroyed) return;
      const tokens = getComputedStyle(document.documentElement);
      const color = (name, fallback) => tokens.getPropertyValue(name).trim() || fallback;
      cy = cytoscape({
        container: canvas,
        elements: [...lastData.nodes, ...lastData.edges],
        layout: { name: "breadthfirst", directed: true, animate: false, fit: true, padding: 32, spacingFactor: 1.4 },
        style: [
          { selector: "node", style: { "label": "data(label)", "font-size": 10, "text-wrap": "wrap", "text-max-width": 90, "background-color": color("--agent", "#7a5fc9"), "color": color("--ink", "#1d1d1f"), "text-outline-color": color("--surface", "#fff"), "text-outline-width": 3 } },
          { selector: "node[kind = 'note']", style: { "shape": "round-rectangle", "background-color": color("--reader", "#2f8f89") } },
          { selector: "node[kind = 'knowledge']", style: { "shape": "diamond", "background-color": color("--warning", "#8a6234") } },
          { selector: "edge", style: { "label": "data(relation)", "font-size": 9, "curve-style": "bezier", "target-arrow-shape": "triangle", "line-color": color("--quiet-2", "#8a8a90"), "target-arrow-color": color("--quiet-2", "#8a8a90"), "text-background-color": color("--surface", "#fff"), "text-background-opacity": 1, "color": color("--ink-2", "#3a3a3f") } },
        ],
      });
      cy.on("tap", "node[kind = 'section']", (event) => onSection(event.target.data("sectionId")));
      canvas.style.display = "block";
      list.style.marginTop = ".55rem";
      render();
    } catch (error) {
      if (destroyed) return;
      canvas.style.display = "none";
      status.textContent = `Interactive graph unavailable: ${error.message} The connection list remains available.`;
    }
  };

  render();
  return {
    activate,
    render,
    destroy() {
      destroyed = true;
      cy?.destroy();
      cy = null;
    },
    getData: () => lastData,
  };
}

export { CYTOSCAPE_VERSION, CYTOSCAPE_URL };
