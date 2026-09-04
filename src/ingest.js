export function parseMarkdown(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  let title = "Untitled document";
  const sections = [];
  let heading = "Introduction";
  let body = [];

  const pushSection = () => {
    const text = body.join("\n").trim();
    if (!text && heading === "Introduction") return;
    sections.push({ id: `s${sections.length + 1}`, heading, text });
    body = [];
  };

  for (const line of lines) {
    if (/^#\s+/.test(line) && title === "Untitled document" && sections.length === 0 && body.length === 0) {
      title = line.replace(/^#\s+/, "").trim() || title;
      continue;
    }
    if (/^##\s+/.test(line)) {
      pushSection();
      heading = line.replace(/^##\s+/, "").trim() || "Untitled section";
      continue;
    }
    body.push(line);
  }
  pushSection();

  if (sections.length === 0) {
    sections.push({ id: "s1", heading: title, text: "" });
  }
  return { title, sections };
}

export async function loadFixture(entry) {
  if (!entry?.path) throw new Error("Fixture entry has no path.");
  const response = await fetch(entry.path);
  if (!response.ok) throw new Error(`Fixture request failed (${response.status}): ${entry.path}`);
  const parsed = parseMarkdown(await response.text());
  return {
    sections: parsed.sections,
    meta: {
      id: entry.id || entry.path,
      title: entry.title || parsed.title,
      attribution: entry.attribution || "",
      license: entry.license || "",
      source_url: entry.source_url || "",
    },
  };
}
