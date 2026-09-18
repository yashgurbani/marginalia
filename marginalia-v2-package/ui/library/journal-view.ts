import type { JournalDay, JournalItem, JournalSource, ReadingJournal } from '../../contracts/journal.ts';
import { mountJourneys, type JourneyDraft } from './journeys.ts';
import type { JourneyEditChange } from '../../contracts/journeys.ts';

export function exportJournalDay(day: JournalDay): { json: string; markdown: string } {
  const escape = (text: string) => text.replace(/[\\`*_{}\[\]()#+.!<>|~-]/g, '\\$&');
  const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n');
  const lines = [`# Saved work: ${day.date}`, '', `Time zone: ${escape(day.timeZone)}`, '', 'Coverage: saved activity.', ''];
  if (day.journeys) for (const journey of [...day.journeys.journeys, ...day.journeys.suggested]) {
    lines.push(`## Journey: ${escape(journey.name)}`, '', `Origin: ${'origin' in journey ? 'local suggestion' : 'reader grouping'}`, '');
    for (const member of journey.members) lines.push(`Thread: ${escape(member.threadId)}; source version: ${escape(member.sourceVersionId)}`);
    const suggested = day.journeys.suggested.find(value => value === journey);
    if (suggested) lines.push('', ...suggested.reasons.map(reason => escape(JSON.stringify(reason))));
    lines.push('');
  }
  for (const source of day.sources) {
    lines.push(`## ${escape(source.title || source.url)}`, '', escape(source.url), '', `Source version: ${escape(source.id)}`, `Source hash: ${escape(source.hash)}`, '');
    for (const item of source.items) {
      lines.push(`### ${itemLabel(item)}`, '', `Saved: ${escape(item.at)}`, `Thread: ${escape(item.threadId)}`, '');
      if (item.anchor.exact) lines.push(quote(item.anchor.exact), '');
      if (item.note) lines.push(quote(item.note.text), '', `Note revision: ${item.note.revision}; current revision: ${item.currentNoteRevision}`, '');
      if (item.reply) {
        lines.push(escape(item.reply.reply.title), '', 'Origin: saved agent reply.', '');
        const json = JSON.stringify(item.reply, null, 2), fence = '`'.repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map(match => match[0].length + 1)));
        lines.push(`${fence}json`, json, fence, '');
      }
    }
  }
  return { json: JSON.stringify({ schema: 'marginalia.journal-day.v1', coverage: 'saved-activity', ...day }, null, 2), markdown: lines.join('\n') };
}

export function mountJournal(host: HTMLElement, options: {
  read(timeZone: string): Promise<ReadingJournal>;
  saveJourneys?(change: JourneyEditChange): Promise<void>;
  open(source: JournalSource, item: JournalItem, current: () => boolean): Promise<void>;
  mode?: 'journal' | 'journeys';
}) {
  let destroyed = false, generation = 0, snapshot: ReadingJournal | undefined, date = '', exporting = false;
  let exportControl: HTMLButtonElement | undefined;
  let journeysMount: ReturnType<typeof mountJourneys> | undefined;
  let mountedDay = '';
  const journeyDrafts = new Map<string, JourneyDraft>();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const root = el('section', undefined, 'ml-journal'), content = el('div'), live = el('p');
  root.setAttribute('aria-label', options.mode === 'journeys' ? 'Journeys by day' : 'Activity by day'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  host.replaceChildren(root);
  root.append(el('h2', options.mode === 'journeys' ? 'Journeys' : 'Activity'));
  root.append(el('p', options.mode === 'journeys' ? 'Accepted and proposed groups from your saved work.' : 'Saved passages, notes and replies, grouped by day.'));
  if (options.mode !== 'journeys') root.append(el('p', 'PDF reading is planned.'));
  root.append(live, content);
  const current = () => !destroyed && root.parentElement === host;
  const render = () => {
    if (!current() || !snapshot) return;
    const focused = content.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.journalFocus : undefined;
    const draft = journeysMount?.draft(); if (draft && mountedDay) journeyDrafts.set(mountedDay, draft);
    journeysMount?.destroy(); journeysMount = undefined; content.replaceChildren();
    if (!snapshot.days.length) { content.append(el('p', 'Your saved work will appear here.')); return; }
    const selected = snapshot.days.find(value => value.date === date) ?? snapshot.days[0]; date = selected.date;
    const picker = el('select'), label = el('label', 'Day '); picker.setAttribute('aria-label', 'Activity day');
    picker.dataset.journalFocus = 'day';
    for (const day of snapshot.days) { const option = el('option', day.date); option.value = day.date; picker.append(option); }
    picker.value = date;
    picker.addEventListener('change', () => { date = picker.value; generation++; exporting = false; live.textContent = ''; render(); content.querySelector<HTMLSelectElement>('select')?.focus(); });
    label.append(picker);
    const download = button(exporting ? 'Preparing day' : 'Export day', () => void exportDay()); download.disabled = exporting;
    download.dataset.journalFocus = 'export'; exportControl = download;
    content.append(label, el('p', `Dates use ${snapshot.timeZone}.`));
    if (options.mode !== 'journeys') content.append(download);
    const journeysHost = el('div', undefined, 'ml-journal__journeys'); content.append(journeysHost);
    mountedDay = selected.date;
    journeysMount = mountJourneys(journeysHost, selected, options.saveJourneys ? async change => {
      const work = ++generation; exporting = false;
      if (exportControl) { exportControl.disabled = false; exportControl.textContent = 'Export day'; }
      await options.saveJourneys!(change);
      if (!current()) return;
      // Persistence settles even when a later display action changed generation.
      // Preserve newer local edits, advancing only their known preceding base.
      const cached = journeyDrafts.get(change.date);
      if (!cached || cached.revision === change.expectedRevision) journeyDrafts.set(change.date, {
        journeys: structuredClone(cached?.journeys ?? change.journeys), revision: change.expectedRevision + 1,
        operationId: cached && cached.operationId !== change.operationId ? cached.operationId : crypto.randomUUID(),
        dismissed: cached?.dismissed,
      });
      if (mountedDay === change.date) journeysMount?.settled(change);
      const fresh = await options.read(zone);
      if (!current() || work !== generation) return;
      const focus = (document.activeElement as HTMLElement)?.dataset.journalFocus;
      journeyDrafts.delete(change.date); journeysMount?.destroy(); journeysMount = undefined;
      snapshot = fresh; render(); live.textContent = 'Journeys saved.';
      if (focus) [...content.querySelectorAll<HTMLElement>('[data-journal-focus]')].find(node => node.dataset.journalFocus === focus)?.focus();
    } : undefined, journeyDrafts.get(selected.date), options.open);
    if (options.mode !== 'journeys') for (const source of selected.sources) {
      const section = el('section', undefined, 'ml-journal__source'); section.append(el('h3', source.title || source.url), el('p', source.url, 'ml-journal__meta'));
      // Reader work stays above agent replies within each anchored thread.
      const threads = [...new Set(source.items.map(item => item.threadId))];
      for (const threadId of threads) {
        const items = source.items.filter(item => item.threadId === threadId);
        for (const item of [...items.filter(item => item.kind !== 'reply'), ...items.filter(item => item.kind === 'reply')]) {
          const row = el('article', undefined, item.kind === 'reply' ? 'ml-journal__reply' : 'ml-journal__item');
          row.append(el('h4', itemLabel(item)), el('p', item.at, 'ml-journal__meta'));
          if (item.anchor.exact) row.append(el('blockquote', item.anchor.exact));
          if (item.note) { row.append(el('p', item.note.text, 'ml-journal__note')); if (item.note.revision !== item.currentNoteRevision) row.append(el('p', `Earlier note revision ${item.note.revision}. Current revision ${item.currentNoteRevision}.`, 'ml-journal__meta')); }
          if (item.reply) {
            row.append(el('p', item.reply.reply.title), el('p', 'Saved agent reply', 'ml-journal__meta'));
            if (item.reply.corrections?.length) row.append(el('p', 'A reply this depends on has a correction. Open the saved passage to review it.'));
          }
          const passage = button('Open saved passage', () => void open(source, item)); passage.dataset.journalFocus = item.id;
          row.append(passage); section.append(row);
        }
      }
      content.append(section);
    }
    if (focused) Array.from(content.querySelectorAll<HTMLElement>('[data-journal-focus]')).find(node => node.dataset.journalFocus === focused)?.focus();
  };
  const load = async () => {
    const work = ++generation; live.textContent = 'Opening saved days.';
    try { const next = await options.read(zone); if (!current() || work !== generation) return; snapshot = next; live.textContent = ''; render(); }
    catch { if (current() && work === generation) { live.textContent = 'Activity is unavailable. Try opening it again.'; content.replaceChildren(button('Try again', () => void load())); } }
  };
  const open = async (source: JournalSource, item: JournalItem) => {
    const work = ++generation; exporting = false; live.textContent = 'Opening saved passage.';
    if (exportControl) { exportControl.disabled = false; exportControl.textContent = 'Export day'; }
    try { await options.open(source, item, () => current() && work === generation); if (current() && work === generation) live.textContent = ''; }
    catch { if (current() && work === generation) live.textContent = 'This saved passage is unavailable. Refresh Activity to review current work.'; }
  };
  const exportDay = async () => {
    if (!current() || exporting || !date) return;
    const work = ++generation, selectedDate = date; exporting = true; live.textContent = 'Preparing this day.'; render();
    try {
      // Re-read before export so a removed item does not return through an old view.
      const fresh = await options.read(zone);
      if (!current() || work !== generation) return;
      snapshot = fresh;
      const selected = fresh.days.find(day => day.date === selectedDate);
      if (!selected) { live.textContent = 'Saved work for this day has changed. Review the current Activity page.'; return; }
      const output = exportJournalDay(selected);
      for (const [extension, type, data] of [['json', 'application/json', output.json], ['md', 'text/markdown', output.markdown]]) {
        const url = URL.createObjectURL(new Blob([data], { type: `${type};charset=utf-8` }));
        try { const link = el('a'); link.href = url; link.download = `marginalia-journal-${selectedDate}.${extension}`; link.click(); }
        finally { URL.revokeObjectURL(url); }
      }
      live.textContent = 'JSON and Markdown downloads requested for this day.';
    } catch { if (current() && work === generation) live.textContent = 'This day could not be exported. Try again.'; }
    finally { if (current() && work === generation) { exporting = false; render(); } }
  };
  void load();
  return { destroy() { destroyed = true; generation++; journeysMount?.destroy(); root.remove(); } };
}

function itemLabel(item: JournalItem) { return ({ bookmark: 'Saved page', passage: 'Saved passage', highlight: 'Your highlight', note: 'Your note', reply: 'Saved reply' })[item.kind]; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function button(label: string, action: () => void) { const node = el('button', label); node.type = 'button'; node.addEventListener('click', action); return node; }
