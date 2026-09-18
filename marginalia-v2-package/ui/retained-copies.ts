export type RetainedCopy = {
  name: string;
  location: string;
  contents: string;
  remove: string;
  export: string;
};

/** Reader-facing inventory of distinct local copies. Keep this in step with
 * docs/RETAINED-LOCAL-COPIES.md and the storage/erasure tests. */
export const RETAINED_COPIES: readonly RetainedCopy[] = [
  { name: 'Source versions', location: 'Local helper database', contents: 'Captured page text and later captures used to reattach saved work.', remove: 'Removing a thread hides it but retains its source records. Its searchable text is removed when no active thread uses that source version.', export: 'A thread export includes the source versions linked to that thread.' },
  { name: 'Note versions', location: 'Local helper database', contents: 'The current note and each saved revision are separate records.', remove: 'Removing a note or its thread keeps the version history but removes that note from full-text search.', export: 'A thread export includes current notes and their saved revisions.' },
  { name: 'Reply versions and views', location: 'Local helper database', contents: 'Saved replies, earlier reply versions, current controls, and recorded execution history.', remove: 'Removing a reply or thread keeps its version records but removes that reply from full-text search.', export: 'A thread export includes its replies, views, and available recorded history.' },
  { name: 'Full-text search copies', location: 'Local helper database search index', contents: 'A second searchable copy of active source, note, and reply text.', remove: 'A logical remove deletes the applicable search rows. Restoring the item rebuilds them.', export: 'The index is not exported separately; exports contain the linked source, note, and reply records.' },
  { name: 'Pending work and conflicts', location: 'Browser storage; failed writes may remain only in this open page', contents: 'Note and question drafts, queued changes, conflicts, and stable retry identities.', remove: 'Retry or resolve pending work deliberately. There is no global erase control for this copy yet.', export: 'Export JSON from the margin before closing when work is still only in memory.' },
  { name: 'Saved-reply cache and recovery history', location: 'Browser storage', contents: 'Cached sources and replies, local control values, checks, rejected saves, and recovery snapshots.', remove: 'Removing helper records does not currently clear this browser cache. There is no cache-wide erase control yet.', export: 'Use “Export saved replies and views” for the selected thread.' },
  { name: 'Pre-upgrade backups', location: 'Local backup storage beside the helper database', contents: 'Verified database snapshots made before a storage upgrade; failed-upgrade recovery copies may also remain.', remove: 'Routine backups rotate automatically. Unresolved recovery copies are retained until recovery is explicitly resolved.', export: 'They are recovery material and are not included in a thread export.' },
  { name: 'Downloaded exports', location: 'A download location chosen by you', contents: 'Plain JSON copies created by an export action.', remove: 'Removing work in Marginalia does not remove files you downloaded.', export: 'The downloaded file is an additional copy that you manage.' },
] as const;

export function retainedCopiesSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'm-retained-copies';
  const title = document.createElement('h3'); title.textContent = 'Copies kept on this computer';
  const intro = document.createElement('p'); intro.className = 'm-retained-copies__intro';
  intro.textContent = 'Marginalia keeps several distinct local copies. “Remove” is an app-level action; it is not a promise that old bytes were securely overwritten on the storage device.';
  const list = document.createElement('dl');
  for (const item of RETAINED_COPIES) {
    const group = document.createElement('div'); group.className = 'm-retained-copies__item';
    const term = document.createElement('dt'); term.textContent = item.name;
    const location = document.createElement('dd'); location.className = 'm-retained-copies__location'; location.textContent = `Location: ${item.location}`;
    const contents = document.createElement('dd'); contents.textContent = item.contents;
    const remove = document.createElement('dd'); remove.textContent = `Remove: ${item.remove}`;
    const exportBehavior = document.createElement('dd'); exportBehavior.textContent = `Export: ${item.export}`;
    group.append(term, location, contents, remove, exportBehavior); list.append(group);
  }
  section.append(title, intro, list); return section;
}
