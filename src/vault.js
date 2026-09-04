function tokens(value) {
  return String(value || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function noteTitle(path, text) {
  return text.match(/^#\s+(.+)$/m)?.[1].trim() || path.split(/[\\/]/).pop().replace(/\.(?:md|txt)$/i, "");
}

function noteSnippet(text, terms) {
  const clean = text.replace(/^#\s+.*$/m, "").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const position = terms.reduce((best, term) => {
    const found = lower.indexOf(term);
    return found >= 0 && (best < 0 || found < best) ? found : best;
  }, -1);
  const start = Math.max(0, (position < 0 ? 0 : position) - 60);
  const snippet = clean.slice(start, start + 180);
  return `${start > 0 ? "…" : ""}${snippet}${start + 180 < clean.length ? "…" : ""}`;
}

export function createVault(notes) {
  const indexed = notes.map((note) => {
    const counts = new Map();
    for (const token of tokens(note.text)) counts.set(token, (counts.get(token) || 0) + 1);
    return { ...note, title: note.title || noteTitle(note.path, note.text), counts };
  });
  return {
    search(query, limit = 5) {
      const terms = tokens(query);
      return indexed
        .map((note) => ({
          path: note.path,
          title: note.title,
          snippet: noteSnippet(note.text, terms),
          score: terms.reduce((score, term) => score + (note.counts.get(term) || 0), 0),
        }))
        .filter((note) => note.score > 0)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, limit);
    },
  };
}

async function readNotes(files) {
  const accepted = [...files].filter((file) => /\.(?:md|txt)$/i.test(file.name));
  return Promise.all(accepted.map(async (file) => ({
    path: file.webkitRelativePath || file.name,
    text: await file.text(),
  })));
}

export function initVault({ dropZone, input, status } = {}) {
  if (!dropZone || !input || !status) return;
  const load = async (files) => {
    const notes = await readNotes(files);
    if (!notes.length) {
      status.textContent = "Vault: no .md or .txt notes";
      return;
    }
    window.marginaliaVault = createVault(notes);
    status.textContent = `Vault: ${notes.length} ${notes.length === 1 ? "note" : "notes"}`;
  };
  input.addEventListener("change", () => load(input.files));
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  }
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    load(event.dataTransfer.files);
  });
}
