import type { JournalDay, JournalItem, JournalSource } from '../../contracts/journal.ts';
import type { JourneyEditChange, JourneyMember, ReaderJourney, SuggestedJourney } from '../../contracts/journeys.ts';

export type JourneyDraft = { journeys: ReaderJourney[]; operationId: string; revision: number; dismissed?: string[] };
export type JourneyOpen = (source: JournalSource, item: JournalItem, current: () => boolean) => Promise<void>;

/** Draft controls alter reader overlays only after an explicit Save. */
export function mountJourneys(host: HTMLElement, day: JournalDay, save?: (change: JourneyEditChange) => Promise<void>, initial?: JourneyDraft, open?: JourneyOpen) {
  const snapshot = day.journeys;
  if (!snapshot) return { destroy() {}, draft: (): JourneyDraft | undefined => undefined, settled(_change: JourneyEditChange) {} };
  let destroyed = false, busy = false, dirty = !!initial, operationId = initial?.operationId ?? crypto.randomUUID();
  let revision = initial?.revision ?? snapshot.revision, detailId: string | undefined, opening = 0;
  let draft: ReaderJourney[] = structuredClone(initial?.journeys ?? snapshot.journeys);
  const dismissed = new Set(initial?.dismissed ?? []), handled = new Set<string>(), picked = new Map<string, Set<number>>(), mergeTargets = new Set<string>();
  const proposalNames = new Map(snapshot.suggested.map(value => [value.id, value.name]));
  const root = el('section'), status = el('p'), list = el('div');
  root.setAttribute('aria-label', 'Journeys'); status.setAttribute('role', 'status');
  const current = () => !destroyed && root.parentElement === host;
  const changed = () => { dirty = true; operationId = crypto.randomUUID(); status.textContent = 'Journey edits are ready to save.'; };
  const memberItem = (member: JourneyMember) => {
    const source = day.sources.find(value => value.id === member.sourceVersionId);
    const items = source?.items.filter(value => value.threadId === member.threadId) ?? [];
    const item = items.find(value => value.kind === 'bookmark' || value.kind === 'passage') ?? items[0];
    return source && item ? { source, item } : undefined;
  };
  const renderMember = (section: HTMLElement, journey: ReaderJourney | SuggestedJourney, member: JourneyMember, index: number, editable: boolean) => {
    const found = memberItem(member), row = el('div');
    if (editable) {
      const splitLabel = el('label', ' Select passage to split '), check = el('input'); check.type = 'checkbox'; check.disabled = busy || !save;
      check.checked = picked.get(journey.id)?.has(index) ?? false;
      check.addEventListener('change', () => { const set = picked.get(journey.id) ?? new Set<number>(); if (check.checked) set.add(index); else set.delete(index); picked.set(journey.id, set); });
      splitLabel.prepend(check); row.append(splitLabel);
    }
    if (!found) row.append(el('p', 'This saved member is unavailable.'));
    else {
      const wholePage = found.item.anchor.kind === 'whole-page' || found.item.kind === 'bookmark';
      const excerpt = found.item.anchor.exact ? `: ${found.item.anchor.exact.slice(0, 120)}` : '';
      row.append(el('span', `${found.source.title || 'Saved passage'}${excerpt} `));
      const action = button(wholePage ? 'Open page' : 'Open passage', () => void openMember(found.source, found.item));
      action.disabled = !open; action.dataset.journalFocus = `journey-member:${journey.id}:${member.threadId}`; row.append(action);
    }
    section.append(row);
  };
  const renderReasons = (section: HTMLElement, suggestion: SuggestedJourney) => {
    if (!suggestion.reasons.length) { section.append(el('p', 'One saved thread.')); return; }
    const descriptions = suggestion.reasons.map(reason => [reason.sameAddress ? 'Same captured page address' : '', reason.sharedTerms.length ? `Shared literal vocabulary: ${reason.sharedTerms.join(', ')}` : '', reason.nearbySavedActivity ? 'Saved activity within 30 minutes' : ''].filter(Boolean).join('. '));
    for (const text of [...new Set(descriptions)]) section.append(el('p', text));
  };
  const renderSummary = () => {
    list.append(el('h3', 'Accepted journeys'));
    if (!draft.length) list.append(el('p', 'No accepted journeys for this day.'));
    for (const journey of draft) {
      const row = el('section'); row.append(el('h4', journey.name), el('p', `${journey.members.length} saved ${journey.members.length === 1 ? 'member' : 'members'}.`));
      const detail = button('Open journey', () => { detailId = journey.id; render(); }); detail.dataset.journalFocus = `journey-open:${journey.id}`; row.append(detail); list.append(row);
    }
    list.append(el('h3', 'Proposed journeys'));
    const proposed = snapshot.suggested.filter(value => !dismissed.has(value.id) && !handled.has(value.id) && !draft.some(journey => journey.id === value.id));
    if (!proposed.length) list.append(el('p', 'No proposed journeys for this day.'));
    for (const suggestion of proposed) {
      const row = el('section'); row.append(el('h4', suggestion.name), el('p', 'Local suggestion from saved activity.'));
      const detail = button('Open proposal', () => { detailId = suggestion.id; render(); }); detail.dataset.journalFocus = `journey-open:${suggestion.id}`; row.append(detail); list.append(row);
    }
  };
  const renderAccepted = (journey: ReaderJourney) => {
    const section = el('section'), back = button('Back to journeys', () => { detailId = undefined; mergeTargets.clear(); render(); });
    back.dataset.journalFocus = 'journey-back'; section.append(back, el('p', 'Accepted journey.'));
    const label = el('label', 'Journey name '), name = el('input'); name.value = journey.name; name.maxLength = 300; name.disabled = busy || !save;
    name.setAttribute('aria-label', `Journey name: ${journey.name}`); name.dataset.journalFocus = `journey-name:${journey.id}`;
    name.addEventListener('input', () => { journey.name = name.value; changed(); }); label.append(name); section.append(label);
    for (const [index, member] of journey.members.entries()) renderMember(section, journey, member, index, true);
    if (!journey.members.length) section.append(el('p', 'Saved name. Available passages: 0.'));
    const split = button('Split selected passages', () => {
      const indices = picked.get(journey.id);
      if (!indices?.size || indices.size >= journey.members.length) { status.textContent = 'Select some passages and leave at least one in this journey.'; return; }
      const members = journey.members.filter((_, index) => indices.has(index));
      journey.members = journey.members.filter((_, index) => !indices.has(index));
      const next = { id: crypto.randomUUID(), name: `${journey.name.slice(0, 280)}: selected passages`, members };
      draft.push(next); picked.clear(); changed(); detailId = next.id; render();
    }); split.disabled = busy || !save; split.dataset.journalFocus = `journey-split:${journey.id}`; section.append(split);
    if (draft.length > 1) {
      section.append(el('h4', 'Merge journeys'));
      for (const other of draft.filter(value => value.id !== journey.id)) {
        const mergeLabel = el('label', ` Merge with ${other.name}`), merge = el('input'); merge.type = 'checkbox'; merge.checked = mergeTargets.has(other.id); merge.disabled = busy || !save;
        merge.addEventListener('change', () => { if (merge.checked) mergeTargets.add(other.id); else mergeTargets.delete(other.id); }); mergeLabel.prepend(merge); section.append(mergeLabel);
      }
      const merge = button('Merge selected journeys', () => {
        const groups = draft.filter(value => value.id === journey.id || mergeTargets.has(value.id));
        if (groups.length < 2) { status.textContent = 'Select at least one journey to merge.'; return; }
        journey.members = groups.flatMap(value => value.members); draft = draft.filter(value => value.id === journey.id || !mergeTargets.has(value.id));
        mergeTargets.clear(); picked.clear(); changed(); render();
      }); merge.disabled = busy || !save; merge.dataset.journalFocus = 'journey-merge'; section.append(merge);
    }
    const commit = button(busy ? 'Saving journeys' : 'Save journeys', () => void persist()); commit.disabled = busy || !save; commit.dataset.journalFocus = 'journey-save'; section.append(commit); list.append(section);
  };
  const renderProposal = (suggestion: SuggestedJourney) => {
    const section = el('section'), back = button('Back to journeys', () => { detailId = undefined; render(); }); back.dataset.journalFocus = 'journey-back';
    section.append(back, el('h3', suggestion.name), el('p', 'Proposed journey from saved activity.')); renderReasons(section, suggestion);
    for (const [index, member] of suggestion.members.entries()) renderMember(section, suggestion, member, index, false);
    const renameLabel = el('label', 'New journey name '), rename = el('input'); rename.value = proposalNames.get(suggestion.id) ?? suggestion.name; rename.maxLength = 300;
    rename.dataset.journalFocus = `proposal-name:${suggestion.id}`; rename.addEventListener('input', () => proposalNames.set(suggestion.id, rename.value)); renameLabel.append(rename); section.append(renameLabel);
    const accept = button('Accept', () => void acceptProposal(suggestion, suggestion.name));
    const renameAccept = button('Rename and accept', () => void acceptProposal(suggestion, rename.value));
    const dismiss = button('Dismiss', () => { dismissed.add(suggestion.id); dirty = true; detailId = undefined; status.textContent = 'Proposal dismissed for this session.'; render(); });
    accept.disabled = busy || !save; renameAccept.disabled = busy || !save; dismiss.disabled = busy;
    accept.dataset.journalFocus = `proposal-accept:${suggestion.id}`; renameAccept.dataset.journalFocus = `proposal-rename:${suggestion.id}`; dismiss.dataset.journalFocus = `proposal-dismiss:${suggestion.id}`;
    section.append(accept, renameAccept, dismiss); list.append(section);
  };
  const render = () => {
    const focus = list.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.journalFocus : undefined;
    list.replaceChildren();
    const accepted = draft.find(value => value.id === detailId), proposed = snapshot.suggested.find(value => value.id === detailId && !dismissed.has(value.id) && !handled.has(value.id) && !draft.some(journey => journey.id === value.id));
    if (accepted) renderAccepted(accepted); else if (proposed) renderProposal(proposed); else { detailId = undefined; renderSummary(); }
    if (focus) [...list.querySelectorAll<HTMLElement>('[data-journal-focus]')].find(node => node.dataset.journalFocus === focus)?.focus();
  };
  const acceptProposal = async (suggestion: SuggestedJourney, name: string) => {
    if (!name.trim()) { status.textContent = 'Give this journey a name.'; return; }
    const accepted = { id: suggestion.id, name: name.trim(), members: structuredClone(suggestion.members) };
    draft.push(accepted); handled.add(suggestion.id); detailId = accepted.id; changed(); render(); await persist();
  };
  const openMember = async (source: JournalSource, item: JournalItem) => {
    if (!open) return;
    const work = ++opening; status.textContent = item.anchor.kind === 'whole-page' || item.kind === 'bookmark' ? 'Opening page.' : 'Opening passage.';
    try { await open(source, item, () => current() && work === opening); if (current() && work === opening) status.textContent = ''; }
    catch { if (current() && work === opening) status.textContent = 'This saved member is unavailable. Refresh journeys to review current work.'; }
  };
  const persist = async () => {
    if (!save || busy || !current()) return;
    if (draft.some(journey => !journey.name.trim())) { status.textContent = 'Give each journey a name.'; return; }
    busy = true; render(); status.textContent = 'Saving your journey edits.';
    try {
      await save({ operationId, date: day.date, timeZone: day.timeZone, expectedRevision: revision, journeys: structuredClone(draft) });
      if (current()) status.textContent = 'Journeys saved.';
    } catch { if (current()) status.textContent = 'Journey edits need review. Retry or reopen Activity to load the current day.'; }
    finally { if (current()) { busy = false; render(); } }
  };
  root.append(el('h3', 'Journeys'), el('p', 'Review groups, then open one to manage its saved members.'), status, list); host.append(root); render();
  return {
    draft: (): JourneyDraft | undefined => dirty ? { journeys: structuredClone(draft), operationId, revision, dismissed: [...dismissed] } : undefined,
    settled(change: JourneyEditChange) {
      if (revision !== change.expectedRevision) return;
      revision = change.expectedRevision + 1; dirty = true;
      if (operationId === change.operationId) operationId = crypto.randomUUID();
    },
    destroy() { destroyed = true; opening++; root.remove(); },
  };
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
function button(text: string, action: () => void) { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; }
