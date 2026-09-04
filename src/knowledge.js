import * as defaultStateApi from "./state.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function textButton(label, className = "text-button") {
  const button = el("button", className, label);
  button.type = "button";
  return button;
}

export function initKnowledgePane({ root, stateApi = defaultStateApi } = {}) {
  if (!root) throw new Error("initKnowledgePane requires a root element.");
  let activeTab = "knowledge";

  const render = (snapshot = stateApi.state) => {
    root.replaceChildren();
    const header = el("div", "drawer-header");
    const tabs = el("div", "side-tabs");
    tabs.setAttribute("role", "tablist");
    for (const [name, label] of [["knowledge", "Knowledge"], ["activity", "Activity"]]) {
      const button = textButton(label, `tab-button${activeTab === name ? " is-active" : ""}`);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(activeTab === name));
      button.addEventListener("click", () => {
        activeTab = name;
        render(stateApi.state);
      });
      tabs.append(button);
    }
    const close = textButton("×", "drawer-close");
    close.setAttribute("aria-label", "Close notes");
    close.addEventListener("click", () => root.dispatchEvent(new CustomEvent("marginaliaclosenotes", { bubbles: true })));
    header.append(tabs, close);
    root.append(header);

    const content = el("div", "drawer-content");
    if (activeTab === "activity") {
      const list = el("ol", "activity-list");
      const recent = [...(snapshot.activity || [])].slice(-10).reverse();
      if (!recent.length) list.append(el("li", "empty-state", "No tool activity yet."));
      for (const entry of recent) {
        const item = el("li", "activity-row");
        const line = el("div", "activity-heading");
        line.append(el("strong", "", entry.toolName || entry.tool_name || "tool"));
        const time = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        line.append(el("time", "", time));
        item.append(line, el("span", "", entry.summary || "Completed"));
        list.append(item);
      }
      content.append(list);
    } else {
      content.append(el("p", "drawer-intro", "What the agent believes you know. Nothing folds on a proposed entry."));
      const proposed = (snapshot.knowledge || []).filter((entry) => entry.status === "proposed");
      const list = el("div", "knowledge-list");
      if (!snapshot.knowledge?.length) list.append(el("p", "empty-state", "The agent has not proposed knowledge yet."));
      for (const entry of snapshot.knowledge || []) {
        const row = el("article", `knowledge-row status-${entry.status}`);
        const heading = el("div", "knowledge-heading");
        heading.append(el("strong", "knowledge-concept", entry.concept), el("span", "knowledge-meta", `${entry.level} · ${entry.status}`));
        row.append(heading);
        if (entry.evidence) row.append(el("p", "knowledge-evidence", entry.evidence));
        if (entry.status === "proposed") {
          const actions = el("div", "knowledge-actions");
          for (const [status, label] of [["confirmed", "confirm"], ["rejected", "reject"]]) {
            const button = textButton(label);
            button.addEventListener("click", () => stateApi.setKnowledgeStatus(entry.id, status));
            actions.append(button);
          }
          row.append(actions);
        }
        list.append(row);
      }
      content.append(list);
      if (proposed.length) {
        const confirmAll = textButton("confirm all proposed", "confirm-all text-button");
        confirmAll.addEventListener("click", () => proposed.forEach((entry) => stateApi.setKnowledgeStatus(entry.id, "confirmed")));
        content.append(confirmAll);
      }
    }
    root.append(content);

    const footer = el("div", "drawer-footer");
    const vaultCount = Number(globalThis.window?.marginaliaVault?.count || 0);
    footer.append(el("div", "vault-line", `Vault: ${vaultCount} ${vaultCount === 1 ? "note" : "notes"}`));
    const footerActions = el("div", "drawer-footer-actions");
    const removeAll = textButton("remove all agent artifacts", "text-button remove-all");
    removeAll.id = "remove-all";
    removeAll.addEventListener("click", () => stateApi.removeAllArtifacts());
    const exportJson = textButton("export JSON", "text-button export-json");
    exportJson.id = "export-json";
    exportJson.addEventListener("click", () => root.dispatchEvent(new CustomEvent("marginaliaexport", { bubbles: true })));
    footerActions.append(removeAll, exportJson);
    footer.append(footerActions);
    root.append(footer);
  };

  const unsubscribe = stateApi.subscribe(render);
  render(stateApi.state);
  return { render, destroy: unsubscribe };
}
