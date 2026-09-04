import * as defaultStateApi from "./state.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initKnowledgePane({ root, stateApi = defaultStateApi } = {}) {
  if (!root) throw new Error("initKnowledgePane requires a root element.");
  let activeTab = "knowledge";

  const render = (snapshot = stateApi.state) => {
    root.replaceChildren();
    const tabs = el("div", "side-tabs");
    for (const [name, label] of [["knowledge", "Knowledge"], ["activity", "Activity"]]) {
      const button = el("button", `tab-button${activeTab === name ? " is-active" : ""}`, label);
      button.type = "button";
      button.setAttribute("aria-selected", String(activeTab === name));
      button.addEventListener("click", () => {
        activeTab = name;
        render(stateApi.state);
      });
      tabs.append(button);
    }
    root.append(tabs);

    if (activeTab === "activity") {
      const list = el("ol", "activity-list");
      const recent = [...(snapshot.activity || [])].slice(-10).reverse();
      if (!recent.length) list.append(el("li", "empty-state", "No tool activity yet."));
      for (const entry of recent) {
        const item = el("li", "activity-row");
        item.append(el("strong", "", entry.toolName || entry.tool_name || "tool"));
        item.append(el("span", "", entry.summary || "Completed"));
        const time = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        item.append(el("time", "", time));
        list.append(item);
      }
      root.append(list);
      return;
    }

    const proposed = (snapshot.knowledge || []).filter((entry) => entry.status === "proposed");
    if (proposed.length) {
      const confirmAll = el("button", "confirm-all", `Confirm all proposed (${proposed.length})`);
      confirmAll.type = "button";
      confirmAll.addEventListener("click", () => proposed.forEach((entry) => stateApi.setKnowledgeStatus(entry.id, "confirmed")));
      root.append(confirmAll);
    }
    const list = el("div", "knowledge-list");
    if (!snapshot.knowledge?.length) list.append(el("p", "empty-state", "The agent has not proposed knowledge yet."));
    for (const entry of snapshot.knowledge || []) {
      const row = el("article", `knowledge-row status-${entry.status}`);
      row.append(el("strong", "knowledge-concept", entry.concept));
      row.append(el("span", "knowledge-meta", `${entry.level} · ${entry.status}`));
      if (entry.evidence) row.append(el("p", "knowledge-evidence", entry.evidence));
      if (entry.status === "proposed") {
        const actions = el("div", "knowledge-actions");
        for (const [status, label] of [["confirmed", "Confirm"], ["rejected", "Reject"]]) {
          const button = el("button", "text-button", label);
          button.type = "button";
          button.addEventListener("click", () => stateApi.setKnowledgeStatus(entry.id, status));
          actions.append(button);
        }
        row.append(actions);
      }
      list.append(row);
    }
    root.append(list);
  };

  const unsubscribe = stateApi.subscribe(render);
  render(stateApi.state);
  return { render, destroy: unsubscribe };
}
