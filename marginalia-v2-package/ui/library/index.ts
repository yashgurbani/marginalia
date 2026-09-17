import type { ConsentGrant, SiteExclusion } from '../../contracts/consent.ts';
import type { ModelSettings, VocabularyEntry } from '../../contracts/library.ts';
import type { Thread, ThreadState } from '../../contracts/reader.ts';
import { mountConsentSettings } from '../consent.ts';

export type LibraryPermissions = {
  load(signal: AbortSignal): Promise<{ grants: ConsentGrant[]; exclusions: SiteExclusion[] }>;
  revoke(grant: ConsentGrant, signal: AbortSignal): Promise<ConsentGrant>;
  setExcluded(site: string, excluded: boolean, expectedRevision: number | undefined, signal: AbortSignal): Promise<SiteExclusion>;
};

export type MountLibraryOptions = {
  listThreads(): Promise<Thread[]>;
  exportThread(id: string): Promise<unknown>;
  onOpenThread(thread: Thread): void;
  onClose(): void;
  onManagePermissions?(): void;
  restoreThread?(thread: Thread): Promise<Thread>;
  loadModels?(): Promise<ModelSettings>;
  saveModels?(change: { fast: string; deep: string; expectedRevision: number }): Promise<ModelSettings>;
  listVocabulary?(): Promise<VocabularyEntry[]>;
  deleteVocabulary?(term: string): Promise<void>;
  permissions?: LibraryPermissions;
};

export type LibraryMount = { destroy(): void };
type View = 'library' | 'settings';
type Filter = ThreadState | 'removed';

export function mountLibrary(host: HTMLElement, options: MountLibraryOptions): LibraryMount {
  const abort = new AbortController();
  let destroyed = false, view: View = 'library', filter: Filter = 'open';
  let threads: Thread[] | undefined, models: ModelSettings | undefined, vocabulary: VocabularyEntry[] | undefined;
  let libraryError = '', modelError = '', vocabularyError = '', status = '';
  let permissions: { grants: ConsentGrant[]; exclusions: SiteExclusion[] } | undefined, permissionsError = '';
  let permissionsLoading = false;
  let exportPreview: { thread: Thread; json: string; page: number } | undefined;
  let modelLoad = 0, vocabularyLoad = 0, permissionLoad = 0;
  let permissionMount: ReturnType<typeof mountConsentSettings> | undefined;
  const restoringThreads = new Set<string>();

  const root = el('main', undefined, 'ml');
  root.setAttribute('aria-labelledby', 'ml-title');
  const live = el('p', undefined, 'ml__live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  const permissionsHost = el('div', undefined, 'ml__permissions');
  host.replaceChildren(root);

  const render = () => {
    const focusKey = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.mlFocus : undefined;
    if (view !== 'settings' && permissionMount) { permissionMount.destroy(); permissionMount = undefined; permissionsHost.replaceChildren(); }
    const heading = el('div', undefined, 'ml__heading');
    const titleWrap = el('div');
    const title = el('h1', 'Marginalia', 'ml__title'); title.id = 'ml-title';
    titleWrap.append(title, el('p', view === 'library' ? 'The work you kept beside what you read.' : 'Choices for help, privacy, and your words.', 'ml__lede'));
    const close = button('Close', options.onClose, 'ml__quiet'); close.setAttribute('aria-label', 'Close library');
    heading.append(titleWrap, close);
    const nav = el('nav', undefined, 'ml__nav'); nav.setAttribute('aria-label', 'Library pages');
    nav.append(viewButton('Library', 'library'), viewButton('Settings', 'settings'));
    root.replaceChildren(heading, nav, live, view === 'library' ? renderLibrary() : renderSettings());
    live.textContent = status;
    if (focusKey) [...root.querySelectorAll<HTMLElement>('[data-ml-focus]')].find(node => node.dataset.mlFocus === focusKey)?.focus();
  };

  const viewButton = (label: string, next: View) => {
    const control = button(label, () => { if (view === next) return; view = next; status = ''; if (next === 'settings') void loadSettings(); else render(); }, 'ml__nav-button', `view-${next}`);
    control.setAttribute('aria-current', view === next ? 'page' : 'false'); return control;
  };

  const renderLibrary = () => {
    const section = el('section', undefined, 'ml__section'); section.setAttribute('aria-labelledby', 'ml-library-title');
    const h2 = el('h2', 'Saved threads'); h2.id = 'ml-library-title';
    const filters = el('div', undefined, 'ml__filters'); filters.setAttribute('aria-label', 'Show threads');
    for (const value of ['open', 'parked', 'done', 'archived', 'removed'] as const) {
      const control = button(cap(value), () => { filter = value; render(); }, 'ml__filter', `filter-${value}`);
      control.setAttribute('aria-pressed', String(filter === value)); filters.append(control);
    }
    section.append(h2, filters);
    if (libraryError) section.append(calm(libraryError, () => void loadThreads(), 'Try again'));
    else if (!threads) section.append(skeleton('Opening your library'));
    else {
      const shown = threads.filter(thread => filter === 'removed' ? !!thread.deletedAt : !thread.deletedAt && thread.state === filter)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (!shown.length) section.append(el('p', emptyCopy(filter), 'ml__empty'));
      else {
        const list = el('ol', undefined, 'ml__thread-list');
        for (const thread of shown) list.append(threadRow(thread));
        section.append(list);
      }
    }
    if (exportPreview) section.append(exportPreviewSection());
    return section;
  };

  const threadRow = (thread: Thread) => {
    const item = el('li', undefined, 'ml-thread');
    const copy = el('div', undefined, 'ml-thread__copy');
    copy.append(el('h3', thread.sourceTitle || locationLabel(thread.sourceUrl)), el('p', locationLabel(thread.sourceUrl), 'ml-thread__location'));
    const excerpt = thread.notes.find(note => !note.deletedAt)?.text || thread.anchor.exact;
    if (excerpt) copy.append(el('p', excerpt, 'ml-thread__excerpt'));
    copy.append(el('p', `${cap(thread.deletedAt ? 'removed' : thread.state)} · ${dateLabel(thread.updatedAt)}`, 'ml-thread__meta'));
    const actions = el('div', undefined, 'ml-thread__actions');
    if (thread.deletedAt) {
      const restore = button('Restore and open', () => void restoreAndOpen(thread), '', `restore-${thread.id}`);
      if (!options.restoreThread) { restore.disabled = true; restore.title = 'Restore is unavailable until the local helper is updated.'; }
      actions.append(restore);
    } else actions.append(button('Open', () => options.onOpenThread(thread), '', `open-${thread.id}`));
    actions.append(button('Export JSON', () => void exportOne(thread), 'ml__quiet', `export-${thread.id}`));
    item.append(copy, actions); return item;
  };

  const renderSettings = () => {
    const section = el('section', undefined, 'ml__settings'); section.setAttribute('aria-labelledby', 'ml-settings-title');
    const h2 = el('h2', 'Settings'); h2.id = 'ml-settings-title'; section.append(h2);
    if (!options.loadModels) { const unavailable = settingSection('Model choices', 'Choose which installed models Marginalia asks for quick and deep help.'); unavailable.append(el('p', 'Model choices are unavailable until the local helper is updated.', 'ml__empty')); section.append(unavailable); }
    else if (modelError) { const failed = settingSection('Model choices', 'Choose which installed models Marginalia asks for quick and deep help.'); failed.append(calm(modelError, () => void loadSettings(), 'Try again')); section.append(failed); }
    else if (!models) { const loading = settingSection('Model choices', 'Choose which installed models Marginalia asks for quick and deep help.'); loading.append(skeleton('Opening model choices')); section.append(loading); }
    else section.append(modelsSection(models));
    section.append(permissionsSection(), vocabularySection(), exportSection());
    return section;
  };

  const modelsSection = (value: ModelSettings) => {
    const section = settingSection('Model choices', 'Quick help keeps definitions light. Deep help handles worked explanations.');
    const form = el('form', undefined, 'ml-models');
    const fast = field('Quick help', value.fast), deep = field('Deep help', value.deep);
    let revision = value.revision;
    const save = button('Save model choices', () => undefined, '', 'save-models'); save.type = 'submit';
    form.append(fast.row, deep.row, save);
    form.addEventListener('submit', event => { event.preventDefault(); if (!options.saveModels) return; modelLoad++; save.disabled = true; status = 'Saving model choices.'; live.textContent = status;
      void Promise.resolve().then(() => options.saveModels!({ fast: fast.input.value.trim(), deep: deep.input.value.trim(), expectedRevision: revision }))
        .then(next => { if (!destroyed) { models = next; revision = next.revision; fast.input.value = next.fast; deep.input.value = next.deep; status = 'Model choices saved.'; live.textContent = status; } })
        .catch(error => { if (!destroyed) { status = message(error, 'Model choices could not be saved.'); live.textContent = status; } })
        .finally(() => { if (!destroyed) save.disabled = false; });
    }, { signal: abort.signal });
    if (!options.saveModels) { fast.input.readOnly = true; deep.input.readOnly = true; save.disabled = true; form.append(el('p', 'Saving model choices is unavailable until the local helper is updated.', 'ml__empty')); }
    section.append(form); return section;
  };

  const permissionsSection = () => {
    const section = settingSection('Permissions and exclusions', 'Review where Codex may receive reading context. Web access is listed separately.');
    const slot = permissionsHost; section.append(slot);
    if (options.permissions && permissionsError) {
      permissionMount?.destroy(); permissionMount = undefined;
      slot.replaceChildren(calm(permissionsError, () => void loadSettings(), 'Try again'));
    } else if (options.permissions && permissionsLoading) {
      permissionMount?.destroy(); permissionMount = undefined;
      slot.replaceChildren(skeleton('Opening permissions'));
    } else if (options.permissions && permissions) {
      if (!permissionMount) {
        slot.replaceChildren();
        if (!permissions.grants.length && !permissions.exclusions.length) slot.append(el('p', 'No saved permissions or site exclusions.', 'ml__empty'));
        const controls = el('div'); slot.append(controls);
        permissionMount = mountConsentSettings(controls, {
          grants: permissions.grants,
          exclusions: permissions.exclusions,
          revoke: (grant, signal) => Promise.resolve().then(() => options.permissions!.revoke(grant, signal)),
          setExcluded: (site, excluded, revision, signal) => Promise.resolve().then(() => options.permissions!.setExcluded(site, excluded, revision, signal)),
        });
      }
    } else if (options.permissions) {
      if (!permissionMount) slot.replaceChildren(skeleton('Opening permissions'));
    } else if (options.onManagePermissions) slot.replaceChildren(button('Manage permissions', options.onManagePermissions));
    else slot.replaceChildren(el('p', 'Permissions are unavailable until the local helper is updated.', 'ml__empty'));
    return section;
  };

  const vocabularySection = () => {
    const section = settingSection('Vocabulary', 'Words currently stored in your vocabulary, with where each came from.');
    if (!options.listVocabulary) { section.append(el('p', 'Vocabulary is unavailable until the local helper is updated.', 'ml__empty')); return section; }
    if (vocabularyError) { section.append(calm(vocabularyError, () => void loadSettings(), 'Try again')); return section; }
    if (!vocabulary) { section.append(skeleton('Opening vocabulary')); return section; }
    if (!vocabulary.length) { section.append(el('p', 'No vocabulary entries are stored yet. Words from notes and lookups will appear once that part of Marginalia is ready.', 'ml__empty')); return section; }
    const list = el('ul', undefined, 'ml-vocabulary');
    for (const entry of vocabulary) {
      const item = el('li'); const copy = el('span');
      copy.append(el('strong', entry.term), el('span', `${originLabel(entry.origin)} · ${statusLabel(entry.status)}`, 'ml-vocabulary__meta'));
      const actions = el('span', undefined, 'ml-vocabulary__actions');
      vocabularyActions(entry, actions);
      item.append(copy, actions); list.append(item);
    }
    section.append(list); return section;
  };

  const exportSection = () => {
    const section = settingSection('Export', 'Download the complete saved JSON for any thread, including its notes, replies, and history.');
    section.append(button('Choose a thread to export', () => { view = 'library'; status = 'Choose Export JSON beside a saved thread.'; render(); }));
    return section;
  };

  const exportPreviewSection = () => {
    const preview = exportPreview!;
    const pageSize = 12000, pages = Math.max(1, Math.ceil(preview.json.length / pageSize));
    const page = Math.min(preview.page, pages - 1), start = page * pageSize;
    const section = el('section', undefined, 'ml-export'); section.setAttribute('aria-labelledby', 'ml-export-preview-title');
    const title = el('h3', `Export preview — ${preview.thread.sourceTitle || locationLabel(preview.thread.sourceUrl)}`); title.id = 'ml-export-preview-title';
    const meta = el('p', `Plain JSON · ${preview.json.length.toLocaleString()} characters · page ${page + 1} of ${pages}`, 'ml-thread__meta');
    const content = el('pre', preview.json.slice(start, start + pageSize), 'ml-export__content'); content.tabIndex = 0;
    const actions = el('div', undefined, 'ml-export__actions');
    const previous = button('Previous page', () => { if (exportPreview && exportPreview.page > 0) { exportPreview.page--; render(); } }, 'ml__quiet', 'export-previous'); previous.disabled = page === 0;
    const next = button('Next page', () => { if (exportPreview && exportPreview.page < pages - 1) { exportPreview.page++; render(); } }, 'ml__quiet', 'export-next'); next.disabled = page >= pages - 1;
    actions.append(previous, next, button('Download this JSON', downloadPreview, '', 'export-download'), button('Close preview', () => { exportPreview = undefined; render(); }, 'ml__quiet', 'export-close'));
    section.append(title, meta, content, actions); return section;
  };

  const loadThreads = async () => {
    libraryError = ''; threads = undefined; render();
    try { const next = await Promise.resolve().then(() => options.listThreads()); if (!destroyed) { threads = next; render(); } }
    catch (error) { if (!destroyed) { libraryError = message(error, 'Your saved threads are unavailable. Your work has not been changed.'); render(); } }
  };
  const loadSettings = async () => {
    if (destroyed) return;
    modelError = ''; vocabularyError = ''; permissionsError = '';
    permissionsLoading = !!options.permissions;
    const modelGeneration = ++modelLoad, vocabularyGeneration = ++vocabularyLoad, permissionGeneration = ++permissionLoad;
    render();
    const tasks = [
      options.loadModels ? Promise.resolve().then(() => options.loadModels!()).then(value => { if (modelGeneration === modelLoad) models = value; }).catch(error => { if (modelGeneration === modelLoad) modelError = message(error, 'Model choices are unavailable. Nothing has been changed.'); }) : undefined,
      options.listVocabulary ? Promise.resolve().then(() => options.listVocabulary!()).then(value => { if (vocabularyGeneration === vocabularyLoad) vocabulary = value; }).catch(error => { if (vocabularyGeneration === vocabularyLoad) vocabularyError = message(error, 'Vocabulary is unavailable. Nothing has been changed.'); }) : undefined,
      options.permissions ? Promise.resolve().then(() => options.permissions!.load(abort.signal)).then(value => { if (permissionGeneration === permissionLoad) permissions = value; }).catch(error => { if (permissionGeneration === permissionLoad) permissionsError = message(error, 'Permissions are unavailable. Nothing has been changed.'); }).finally(() => { if (permissionGeneration === permissionLoad) permissionsLoading = false; }) : undefined,
    ].filter((task): task is Promise<void> => !!task);
    await Promise.all(tasks);
    if (!destroyed && permissionGeneration === permissionLoad) { if (permissionMount && permissions && !permissionsError) permissionMount.update(permissions.grants, permissions.exclusions); render(); }
  };
  const restoreAndOpen = async (thread: Thread) => {
    if (!options.restoreThread || restoringThreads.has(thread.id)) return;
    restoringThreads.add(thread.id);
    status = 'Restoring this thread.'; live.textContent = status;
    try {
      const restored = await Promise.resolve().then(() => options.restoreThread!(thread));
      if (restored.id !== thread.id) throw new Error('The local helper returned a different thread. Nothing was opened.');
      if (restored.deletedAt) throw new Error('The local helper did not restore this thread.');
      if (!destroyed) { threads = threads?.map(value => value.id === restored.id ? restored : value); status = 'Thread restored.'; render();
        try { options.onOpenThread(restored); } catch (error) { status = message(error, 'The thread was restored but could not be opened.'); live.textContent = status; }
      }
    } catch (error) { if (!destroyed) { status = message(error, 'This thread could not be restored.'); live.textContent = status; } }
    finally { restoringThreads.delete(thread.id); }
  };
  const exportOne = async (thread: Thread) => {
    status = 'Preparing the export.'; live.textContent = status;
    try {
      const data = await Promise.resolve().then(() => options.exportThread(thread.id)); if (destroyed) return;
      const json = JSON.stringify(data, null, 2); if (json === undefined) throw new Error('The local helper returned no JSON to export.');
      exportPreview = { thread, json, page: 0 }; status = 'Review the JSON before downloading it.'; render();
    } catch (error) { if (!destroyed) { status = message(error, 'This thread could not be exported.'); live.textContent = status; } }
  };
  const downloadPreview = () => {
    if (!exportPreview) return;
    const blob = new Blob([exportPreview.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${safeFile(exportPreview.thread.sourceTitle || 'marginalia-thread')}.json`; link.click(); URL.revokeObjectURL(url);
    status = 'JSON export downloaded.'; live.textContent = status;
  };
  const deleteTerm = async (entry: VocabularyEntry, control: HTMLButtonElement) => {
    if (!options.deleteVocabulary || control.disabled) return;
    vocabularyLoad++;
    control.disabled = true; status = `Deleting ${entry.term}.`; live.textContent = status;
    try { await Promise.resolve().then(() => options.deleteVocabulary!(entry.term)); if (!destroyed) { vocabulary = vocabulary?.filter(value => value.term !== entry.term); status = `${entry.term} deleted.`; live.textContent = status;
      const item = control.closest('li'), list = item?.parentElement; item?.remove();
      if (!vocabulary?.length && list) list.replaceWith(el('p', 'No vocabulary entries are stored yet. Words from notes and lookups will appear once that part of Marginalia is ready.', 'ml__empty'));
    } }
    catch (error) { if (!destroyed) { status = message(error, 'This term could not be deleted.'); live.textContent = status; control.disabled = false; } }
  };

  const vocabularyActions = (entry: VocabularyEntry, actions: HTMLElement) => {
    const remove = button('Delete', () => {
      const confirm = button(`Delete ${entry.term}`, () => void deleteTerm(entry, confirm), 'ml__danger', `confirm-term-${entry.term}`);
      const keep = button('Keep', () => { vocabularyActions(entry, actions); actions.querySelector<HTMLButtonElement>('button')?.focus(); }, 'ml__quiet', `keep-term-${entry.term}`);
      actions.replaceChildren(confirm, keep); confirm.focus();
    }, 'ml__danger', `delete-term-${entry.term}`);
    if (!options.deleteVocabulary) remove.disabled = true;
    actions.replaceChildren(remove);
  };

  render(); void loadThreads();
  return { destroy() { if (destroyed) return; destroyed = true; permissionMount?.destroy(); abort.abort(); root.remove(); } };
}

function settingSection(title: string, description: string) { const section = el('section', undefined, 'ml-setting'); section.append(el('h3', title), el('p', description, 'ml-setting__description')); return section; }
function field(label: string, value: string) { const row = el('label', undefined, 'ml-models__field'), text = el('span', label), input = document.createElement('input'); input.value = value; input.required = true; input.maxLength = 100; input.autocomplete = 'off'; input.spellcheck = false; row.append(text, input); return { row, input }; }
function calm(text: string, retry?: () => void, retryLabel = 'Try again') { const box = el('div', undefined, 'ml__calm'); box.append(el('p', text)); if (retry) box.append(button(retryLabel, retry)); return box; }
function skeleton(label: string) { const box = el('div', undefined, 'ml__skeleton'); box.setAttribute('aria-label', label); box.append(el('span'), el('span'), el('span')); return box; }
function button(label: string, action: () => unknown, className = '', focusKey?: string) { const control = el('button', label, className); control.type = 'button'; if (focusKey) control.dataset.mlFocus = focusKey; control.addEventListener('click', () => { void action(); }); return control; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function cap(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function emptyCopy(filter: Filter) { return filter === 'removed' ? 'Removed threads stay here until you deliberately restore one.' : `No ${filter} threads. Work you mark ${filter} will appear here.`; }
function locationLabel(value: string) { try { const url = new URL(value); return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`; } catch { return value; } }
function dateLabel(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : 'Date unavailable'; }
function originLabel(value: string) { return value === 'lookup' || value === 'looked-up' ? 'Looked up' : value === 'note' || value === 'used' ? 'Used in your writing' : value === 'familiar' ? 'Marked familiar' : value; }
function statusLabel(value: string) { return value === 'familiar' ? 'Familiar' : value === 'active' ? 'Remembered' : cap(value); }
function safeFile(value: string) { return value.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'marginalia-thread'; }
function message(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
