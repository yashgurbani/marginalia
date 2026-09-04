const MAX_FILES = 750;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 24_000_000;
const DEFAULT_LIMIT = 5;

const listeners = new Set();
const returnedPaths = new Set();
let notes = [];
let totalBytes = 0;
let loadedAt = null;
let lastQuery = "";
let lastResults = [];
let message = "No vault loaded.";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanPath(value, fallback = "note.md") {
  const raw = String(value || fallback).replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = raw.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.join("/") || fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function tokenize(value) {
  return String(value)
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 1) || [];
}

function counts(tokens) {
  const result = new Map();
  for (const token of tokens) result.set(token, (result.get(token) || 0) + 1);
  return result;
}

function titleFrom(path, body) {
  const markdownTitle = body.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.replace(/\s+#+\s*$/, "").trim();
  if (markdownTitle) return markdownTitle.slice(0, 240);
  const filename = path.split("/").pop() || path;
  return filename.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled note";
}

function makeNote(entry) {
  const path = cleanPath(entry.path || entry.webkitRelativePath || entry.name);
  const body = cleanText(entry.text ?? entry.body ?? "");
  const title = titleFrom(path, body);
  const titleTokens = tokenize(title);
  const bodyTokens = tokenize(body);
  return {
    path,
    title,
    body,
    size: Number(entry.size) || byteLength(body),
    titleTokens,
    bodyTokens,
    titleCounts: counts(titleTokens),
    bodyCounts: counts(bodyTokens),
  };
}

function publicNote(note) {
  return { path: note.path, title: note.title, word_count: note.bodyTokens.length, bytes: note.size };
}

function emit() {
  const snapshot = getVaultState();
  for (const listener of [...listeners]) listener(snapshot);
  if (globalThis.window) {
    globalThis.window.dispatchEvent(new CustomEvent("marginaliavaultchange", { detail: snapshot }));
  }
}

function normalizeLimit(value) {
  const number = Number(value ?? DEFAULT_LIMIT);
  return Number.isInteger(number) ? Math.min(50, Math.max(1, number)) : DEFAULT_LIMIT;
}

function snippetFor(note, terms) {
  const compact = note.body
    .replace(/^\s*#.*$/gm, " ")
    .replace(/[`*_>#\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return note.title;
  const lower = compact.toLocaleLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
  const hit = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, hit - 72);
  const end = Math.min(compact.length, Math.max(hit + 144, start + 210));
  return `${start > 0 ? "…" : ""}${compact.slice(start, end).trim()}${end < compact.length ? "…" : ""}`;
}

function scoreNotes(query) {
  const phrase = query.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !notes.length) return [];

  const averageLength = notes.reduce((sum, note) => sum + note.bodyTokens.length, 0) / notes.length || 1;
  const frequencies = new Map(terms.map((term) => [
    term,
    notes.filter((note) => note.titleCounts.has(term) || note.bodyCounts.has(term)).length,
  ]));
  const k1 = 1.2;
  const b = 0.75;

  return notes.map((note) => {
    let score = 0;
    for (const term of terms) {
      const df = frequencies.get(term) || 0;
      const idf = Math.log(1 + (notes.length - df + 0.5) / (df + 0.5));
      const titleFrequency = note.titleCounts.get(term) || 0;
      const bodyFrequency = note.bodyCounts.get(term) || 0;
      const normalizedBody = bodyFrequency
        ? (bodyFrequency * (k1 + 1)) / (bodyFrequency + k1 * (1 - b + b * (note.bodyTokens.length / averageLength)))
        : 0;
      score += idf * (titleFrequency * 3.5 + normalizedBody);
    }
    const lowerTitle = note.title.toLocaleLowerCase();
    const lowerBody = note.body.toLocaleLowerCase();
    if (phrase && lowerTitle.includes(phrase)) score += 5;
    if (phrase && lowerBody.includes(phrase)) score += 2;
    if (terms.every((term) => lowerTitle.includes(term) || lowerBody.includes(term))) score += 0.75;
    return {
      path: note.path,
      title: note.title,
      snippet: snippetFor(note, terms),
      score: Number(score.toFixed(6)),
    };
  }).filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

export function getVaultState() {
  return {
    loaded: notes.length > 0,
    file_count: notes.length,
    total_bytes: totalBytes,
    loaded_at: loadedAt,
    last_query: lastQuery,
    last_results: clone(lastResults),
    message,
    notes: notes.map(publicNote),
    local_only: true,
  };
}

export function subscribeVault(listener) {
  if (typeof listener !== "function") throw new TypeError("Vault subscriber must be a function.");
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isVaultLoaded() {
  return notes.length > 0;
}

export function resolveReturnedPath(path) {
  const normalized = cleanPath(path, "");
  return returnedPaths.has(normalized) ? normalized : null;
}

export function hasReturnedPath(path) {
  return Boolean(resolveReturnedPath(path));
}

export function searchNotes(query, limit = DEFAULT_LIMIT) {
  const cleanQuery = String(query ?? "").trim();
  if (!cleanQuery) return [];
  const results = scoreNotes(cleanQuery).slice(0, normalizeLimit(limit));
  for (const result of results) returnedPaths.add(result.path);
  lastQuery = cleanQuery;
  lastResults = results;
  message = notes.length
    ? results.length
      ? `${results.length} local result${results.length === 1 ? "" : "s"}.`
      : "No local matches."
    : "No vault loaded.";
  emit();
  return clone(results);
}

export function indexMarkdownEntries(entries, inheritedSkipped = []) {
  if (!Array.isArray(entries)) throw new TypeError("Markdown entries must be an array.");
  const accepted = [];
  const skipped = [...inheritedSkipped];
  let bytes = 0;

  for (const entry of entries.slice(0, MAX_FILES)) {
    const path = cleanPath(entry?.path || entry?.webkitRelativePath || entry?.name);
    if (!/\.md$/i.test(path)) {
      skipped.push({ path, reason: "not markdown" });
      continue;
    }
    const body = cleanText(entry?.text ?? entry?.body ?? "");
    const size = Number(entry?.size) || byteLength(body);
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: "file exceeds 2 MB" });
      continue;
    }
    if (bytes + size > MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: "vault exceeds 24 MB" });
      continue;
    }
    accepted.push(makeNote({ ...entry, path, text: body, size }));
    bytes += size;
  }
  if (entries.length > MAX_FILES) skipped.push({ path: "…", reason: `file limit is ${MAX_FILES}` });

  const unique = new Map(accepted.map((note) => [note.path, note]));
  notes = [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
  totalBytes = notes.reduce((sum, note) => sum + note.size, 0);
  loadedAt = notes.length ? new Date().toISOString() : null;
  lastQuery = "";
  lastResults = [];
  returnedPaths.clear();
  message = notes.length
    ? `Indexed ${notes.length} Markdown file${notes.length === 1 ? "" : "s"} locally${skipped.length ? `; skipped ${skipped.length}` : ""}.`
    : skipped.length
      ? `No Markdown files were indexed; skipped ${skipped.length}.`
      : "No Markdown files were indexed.";
  emit();
  return { ok: notes.length > 0, file_count: notes.length, skipped, total_bytes: totalBytes };
}

export async function indexMarkdownFiles(fileList) {
  const files = Array.from(fileList || []).slice(0, MAX_FILES);
  const entries = [];
  const skipped = [];
  let projectedBytes = 0;

  for (const file of files) {
    const path = cleanPath(file.webkitRelativePath || file.relativePath || file.name);
    if (!/\.md$/i.test(path)) {
      skipped.push({ path, reason: "not markdown" });
      continue;
    }
    if (Number(file.size) > MAX_FILE_BYTES) {
      skipped.push({ path, reason: "file exceeds 2 MB" });
      continue;
    }
    if (projectedBytes + Number(file.size || 0) > MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: "vault exceeds 24 MB" });
      continue;
    }
    try {
      entries.push({ path, text: await file.text(), size: Number(file.size) || undefined });
      projectedBytes += Number(file.size || 0);
    } catch {
      skipped.push({ path, reason: "unreadable" });
    }
  }

  return indexMarkdownEntries(entries, skipped);
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walkEntry(entry, prefix = "") {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const path = cleanPath(`${prefix}${file.name}`);
    return [{
      name: file.name,
      size: file.size,
      type: file.type,
      webkitRelativePath: path,
      text: () => file.text(),
    }];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await readDirectoryEntries(reader);
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => walkEntry(child, `${prefix}${entry.name}/`)));
  return nested.flat();
}

async function filesFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer?.items || [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length) return (await Promise.all(entries.map((entry) => walkEntry(entry)))).flat();
  return Array.from(dataTransfer?.files || []);
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountVaultControl({ root } = {}) {
  if (!root) throw new Error("mountVaultControl requires a root element.");
  root.replaceChildren();

  const heading = element("h3", "Local vault");
  Object.assign(heading.style, { margin: "0 0 .25rem", fontSize: ".95rem" });
  const privacy = element("p", "Markdown stays in this browser. Indexing and search make no network request.");
  Object.assign(privacy.style, { margin: "0 0 .65rem", color: "var(--muted, #aaa)", fontSize: ".76rem" });

  const drop = element("label");
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");
  drop.setAttribute("aria-label", "Choose or drop a folder of Markdown notes");
  Object.assign(drop.style, {
    display: "block",
    padding: ".75rem",
    border: "1px dashed var(--line, #555)",
    borderRadius: "6px",
    textAlign: "center",
    cursor: "pointer",
  });
  const prompt = element("span", "Drop a notes folder, or choose one");
  const input = element("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".md,text/markdown";
  input.setAttribute("webkitdirectory", "");
  input.webkitdirectory = true;
  input.hidden = true;
  drop.append(prompt, input);

  const status = element("p");
  status.setAttribute("role", "status");
  Object.assign(status.style, { margin: ".55rem 0 .25rem", fontSize: ".78rem" });
  const query = element("p");
  Object.assign(query.style, { margin: ".2rem 0", color: "var(--muted, #aaa)", fontSize: ".75rem" });
  const results = element("ol");
  Object.assign(results.style, { margin: ".35rem 0 0", paddingLeft: "1.2rem", fontSize: ".75rem" });
  root.append(heading, privacy, drop, status, query, results);

  let busy = false;
  const load = async (files) => {
    if (busy) return;
    busy = true;
    prompt.textContent = "Indexing locally…";
    try {
      await indexMarkdownFiles(files);
    } finally {
      busy = false;
      prompt.textContent = "Drop a notes folder, or choose one";
      input.value = "";
    }
  };

  input.addEventListener("change", () => load(input.files));
  for (const eventName of ["dragenter", "dragover"]) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.style.borderColor = "var(--accent, #e7b76d)";
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.style.borderColor = "var(--line, #555)";
    });
  }
  drop.addEventListener("drop", async (event) => {
    try {
      await load(await filesFromDrop(event.dataTransfer));
    } catch (error) {
      message = `Could not read the dropped folder: ${error?.message || String(error)}`;
      emit();
    }
  });
  drop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  const render = (snapshot = getVaultState()) => {
    status.textContent = snapshot.loaded
      ? `${snapshot.file_count} Markdown file${snapshot.file_count === 1 ? "" : "s"} indexed locally.`
      : snapshot.message;
    query.textContent = snapshot.last_query ? `Last search: “${snapshot.last_query}”` : "No note search yet.";
    results.replaceChildren();
    for (const result of snapshot.last_results.slice(0, 5)) {
      const item = element("li");
      const path = element("code", result.path);
      const score = element("span", ` · ${result.score.toFixed(2)}`);
      score.style.color = "var(--muted, #aaa)";
      item.append(path, score);
      results.append(item);
    }
  };

  const unsubscribe = subscribeVault(render);
  render();
  return { render, destroy: unsubscribe, input };
}

const localBridge = Object.freeze({
  search: searchNotes,
  hasReturnedPath,
  resolveReturnedPath,
  getState: getVaultState,
  indexEntries: indexMarkdownEntries,
  localOnly: true,
});

if (globalThis.window) globalThis.window.marginaliaVault = localBridge;

export { localBridge as marginaliaVault };
