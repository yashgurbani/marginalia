import type { ConsentGrant, SiteExclusion } from '../../contracts/consent.ts';
import { vocabularyOriginLabels, type LibrarySearchResult, type ModelSettings, type VocabularyEntry, type VocabularyOriginKind } from '../../contracts/library.ts';
import { providerCapabilities } from '../../contracts/provider-capabilities.ts';
import type { Thread, ThreadState } from '../../contracts/reader.ts';
import { mountConsentSettings } from '../consent.ts';
import { retainedCopiesSection } from '../retained-copies.ts';
import { wholeLibraryExport, bibtexLibraryExport, type LibraryThreadExport } from './export.ts';
import { mountLibrarySearch } from './search.ts';
import { mountJournal } from './journal-view.ts';
import type { ReadingJournal } from '../../contracts/journal.ts';
import { mountInstantSettings } from '../instant/settings.ts';
import type { InstantTransport } from '../instant/transport.ts';
import { mountAutoAssistSettings } from '../auto-assist/settings.ts';
import type { AutoAssistTransport } from '../auto-assist/transport.ts';
import { mountPosture } from '../posture/posture.ts';
import { mountLibraryImport } from '../import/panel.ts';
import type { LibraryImportTransport } from '../import/transport.ts';
import { mountJournalRecap } from '../journal-recap/recap.ts';
import type { JournalRecapTransport } from '../journal-recap/transport.ts';
import { mountLibraryAnswer } from '../answer/answer.ts';
import type { LibraryAnswerTransport } from '../answer/transport.ts';
import { mountShare } from '../share/share.ts';
import type { ShareFile } from '../../contracts/share.ts';
import type { ShareTransport } from '../share/transport.ts';
import { mountWhitelist } from '../whitelist/whitelist.ts';
import type { WhitelistTransport } from '../whitelist/transport.ts';
import { mountOnboarding } from '../onboarding/index.ts';
import type { OnboardingDeps } from '../onboarding/index.ts';

export type LibraryPermissions = {
  load(signal: AbortSignal): Promise<{ grants: ConsentGrant[]; exclusions: SiteExclusion[] }>;
  revoke(grant: ConsentGrant, signal: AbortSignal): Promise<ConsentGrant>;
  setExcluded(site: string, excluded: boolean, expectedRevision: number | undefined, signal: AbortSignal): Promise<SiteExclusion>;
};

export type LibraryFeatureOptions = {
  importer?: LibraryImportTransport;
  journalRecap?: JournalRecapTransport;
  answer?: LibraryAnswerTransport;
  share?: ShareTransport;
  shareDownload?(file: ShareFile): void;
  whitelist?: WhitelistTransport;
  onboarding?: OnboardingDeps;
};

export type MountLibraryOptions = {
  listThreads(): Promise<Thread[]>;
  exportThread(id: string): Promise<unknown>;
  onOpenThread(thread: Thread): void | Promise<void>;
  onResumePage?(thread: Thread): void | Promise<void>;
  search?(query: string): Promise<LibrarySearchResult[]>;
  related?(threadId: string): Promise<LibrarySearchResult[]>;
  readJournal?(timeZone: string): Promise<ReadingJournal>;
  saveJourneys?(change: import('../../contracts/journeys.ts').JourneyEditChange): Promise<void>;
  onOpenPassage?(thread: Thread, result: LibrarySearchResult, current: () => boolean): void | Promise<void>;
  onClose(): void | Promise<void>;
  onManagePermissions?(): void | Promise<void>;
  restoreThread?(thread: Thread): Promise<Thread>;
  loadModels?(): Promise<ModelSettings>;
  saveModels?(change: { fast: string; deep: string; expectedRevision: number }): Promise<ModelSettings>;
  listVocabulary?(): Promise<VocabularyEntry[]>;
  deleteVocabulary?(term: string): Promise<void>;
  permissions?: LibraryPermissions;
  instantHelp?: InstantTransport;
  autoAssist?: AutoAssistTransport;
  libraryFeatures?: LibraryFeatureOptions;
};

export type LibraryMount = { destroy(): void };
type View = 'library' | 'journeys' | 'settings' | 'journal';
type Filter = ThreadState | 'removed';

const mounts = new WeakMap<HTMLElement, LibraryMount>();

export function mountLibrary(host: HTMLElement, options: MountLibraryOptions): LibraryMount {
  mounts.get(host)?.destroy();
  const abort = new AbortController();
  let destroyed = false, view: View = 'library', filter: Filter = 'open';
  let threads: Thread[] | undefined, models: ModelSettings | undefined, vocabulary: VocabularyEntry[] | undefined;
  let libraryError = '', modelError = '', vocabularyError = '', status = '', modelSaveError = '';
  let permissions: { grants: ConsentGrant[]; exclusions: SiteExclusion[] } | undefined, permissionsError = '';
  let permissionsLoading = false, permissionWork = 0;
  let wholeExporting = false;
  let exportPreview: { thread: Thread; json: string; page: number } | undefined;
  let threadLoad = 0, modelLoad = 0, vocabularyLoad = 0, permissionLoad = 0, exportLoad = 0, navigation = 0, statusRevision = 0;
  let modelSave: number | undefined;
  let modelDraft: { fast: string; deep: string; revision: number; edit: number } | undefined;
  let modelEditor: { section: HTMLElement; fast: HTMLInputElement; deep: HTMLInputElement; save: HTMLButtonElement; error: HTMLElement } | undefined;
  let permissionMount: ReturnType<typeof mountConsentSettings> | undefined;
  let instantMount: ReturnType<typeof mountInstantSettings> | undefined;
  let autoAssistMount: ReturnType<typeof mountAutoAssistSettings> | undefined;
  let postureMount: ReturnType<typeof mountPosture> | undefined;
  let journalMount: ReturnType<typeof mountJournal> | undefined;
  let journeysMount: ReturnType<typeof mountJournal> | undefined;
  let importMount: ReturnType<typeof mountLibraryImport> | undefined;
  let journalRecapMount: ReturnType<typeof mountJournalRecap> | undefined;
  let answerMount: ReturnType<typeof mountLibraryAnswer> | undefined;
  let shareMount: ReturnType<typeof mountShare> | undefined;
  let whitelistMount: ReturnType<typeof mountWhitelist> | undefined;
  let onboardingMount: ReturnType<typeof mountOnboarding> | undefined;
  let shareSelect: HTMLSelectElement | undefined, shareHost: HTMLElement | undefined, selectedShareThreadId: string | undefined, mountedShareThreadId: string | undefined;
  let recapDate: HTMLInputElement | undefined, recapHost: HTMLElement | undefined;
  const restoringThreads = new Set<string>(), deletingTerms = new Map<string, symbol>();

  const root = el('main', undefined, 'ml');
  root.setAttribute('aria-labelledby', 'ml-title');
  const live = el('p', undefined, 'ml__live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  const permissionsHost = el('div', undefined, 'ml__permissions');
  const libraryHost = el('div'), libraryToolsHost = el('div'), settingsHost = el('div'), settingsToolsHost = el('div'), onboardingHost = el('div'), autoAssistHost = el('div'), postureHost = el('div'), instantHost = el('div'), providersHost = el('div'), modelsHost = el('div'), vocabularyHost = el('div');
  const searchHost = el('div');
  const journeysHost = el('div'), journalHost = el('div'), journalToolsHost = el('div');
  const searchMount = options.search && options.onOpenPassage ? mountLibrarySearch(searchHost, {
    search: options.search, related: options.related,
    open: async (result, isCurrentSearch) => {
      const latest = await owned(() => options.listThreads());
      if (!current() || !isCurrentSearch()) return;
      const thread = latest.find(value => value.id === result.threadId);
      if (!thread || thread.deletedAt || thread.sourceVersionId !== result.sourceVersionId) throw new Error('This search result is no longer available. Search again.');
      await options.onOpenPassage!(thread, result, isCurrentSearch);
    },
  }) : undefined;
  const lede = el('p', undefined, 'ml__lede');
  const viewControls: Array<[View, HTMLButtonElement]> = [];
  host.replaceChildren(root);
  const current = () => !destroyed && root.parentElement === host;
  const owned = <T>(work: () => T | Promise<T>): Promise<T> => Promise.resolve().then(() => {
    if (!current()) throw new DOMException('Library closed.', 'AbortError');
    return work();
  });
  const announce = (text: string) => { const revision = ++statusRevision; if (current()) { status = text; live.textContent = text; } return revision; };
  const finishStatus = (revision: number, text: string) => { if (current() && revision === statusRevision) { status = text; live.textContent = text; } };
  const replaceFocused = (slot: HTMLElement, child: HTMLElement) => {
    if (!current() || slot.firstElementChild === child) return;
    const active = slot.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    const key = active?.dataset.mlFocus;
    slot.replaceChildren(child);
    if (key) Array.from(slot.querySelectorAll<HTMLElement>('[data-ml-focus]')).find(node => node.dataset.mlFocus === key)?.focus();
  };
  const openJournalItem = async (source: import('../../contracts/journal.ts').JournalSource, item: import('../../contracts/journal.ts').JournalItem, isCurrent: () => boolean) => {
    const listed = await owned(() => options.listThreads());
    if (!current() || !isCurrent()) return;
    const thread = listed.find(value => value.id === item.threadId && !value.deletedAt && value.sourceVersionId === source.id);
    if (!thread || JSON.stringify(thread.anchor) !== JSON.stringify(item.anchor)) throw new Error('The saved passage is unavailable.');
    if (options.onOpenPassage && item.anchor.exact) await options.onOpenPassage(thread, {
      threadId: thread.id, sourceVersionId: source.id, sourceTitle: source.title, sourceUrl: source.url, kind: 'source',
      passage: item.anchor.exact, start: item.anchor.start, end: item.anchor.end, matchExcerpt: item.anchor.exact,
      matchedTerms: [], explanation: 'Saved passage.', evidenceLabel: 'source passage',
    }, isCurrent);
    else await options.onOpenThread(thread);
  };

  // Keep settings sections mounted. Library results and sibling settings work must
  // not detach an editor, move its focus, or abort T13's in-flight permission work.
  const render = () => {
    if (!current()) return;
    lede.textContent = view === 'library' ? 'The work you kept beside what you read.' : view === 'journeys' ? 'Groups from saved work that you can shape.' : view === 'journal' ? 'Your saved work across days.' : 'Choices for help, privacy, and your words.';
    for (const [page, control] of viewControls) control.setAttribute('aria-current', view === page ? 'page' : 'false');
    libraryHost.hidden = view !== 'library'; searchHost.hidden = view !== 'library'; settingsHost.hidden = view !== 'settings';
    journeysHost.hidden = view !== 'journeys'; journalHost.hidden = view !== 'journal'; libraryToolsHost.hidden = view !== 'library'; journalToolsHost.hidden = view !== 'journal';
    if (view === 'library') replaceFocused(libraryHost, renderLibrary());
    live.textContent = status;
  };
  const changeView = (next: View, text = '') => {
    if (!current() || view === next) return;
    navigation++; exportLoad++; exportPreview = undefined;
    searchMount?.cancel();
    view = next; announce(text); render();
    if (next === 'settings') loadSettings();
    if (next === 'journeys' && options.readJournal && !journeysMount) journeysMount = mountJournal(journeysHost, {
      mode: 'journeys',
      read: zone => owned(() => options.readJournal!(zone)),
      saveJourneys: options.saveJourneys ? change => owned(() => options.saveJourneys!(change)) : undefined,
      open: openJournalItem,
    });
    if (next === 'journal' && options.readJournal && !journalMount) journalMount = mountJournal(journalHost, {
      read: zone => owned(() => options.readJournal!(zone)),
      saveJourneys: options.saveJourneys ? change => owned(() => options.saveJourneys!(change)) : undefined,
      open: openJournalItem,
    });
    if (next === 'journal' && journalRecapMount && recapDate) void journalRecapMount.show(recapDate.value, timeZone());
  };
  const viewButton = (label: string, next: View) => {
    const control = button(label, () => changeView(next), 'ml__nav-button', `view-${next}`);
    viewControls.push([next, control]); return control;
  };

  const renderLibrary = () => {
    const section = el('section', undefined, 'ml__section'); section.setAttribute('aria-labelledby', 'ml-library-title');
    const h2 = el('h2', 'Saved threads'); h2.id = 'ml-library-title';
    const filters = el('div', undefined, 'ml__filters'); filters.setAttribute('aria-label', 'Show threads');
    for (const value of ['open', 'parked', 'done', 'archived', 'removed'] as const) {
      const control = button(value === 'parked' ? 'Read later' : cap(value), () => { filter = value; render(); }, 'ml__filter', `filter-${value}`);
      control.setAttribute('aria-pressed', String(filter === value)); filters.append(control);
    }
    const exportEverything = button(wholeExporting ? 'Preparing everything…' : 'Export everything', () => void exportAll(), 'ml__quiet', 'export-everything');
    exportEverything.disabled = wholeExporting;
    const exportCitations = button('Export BibTeX', () => void exportAll(true), 'ml__quiet', 'export-bibtex');
    exportCitations.disabled = wholeExporting;
    section.append(h2, filters, exportEverything, exportCitations);
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
    const savedKind = thread.anchor.kind === 'whole-page' ? 'Saved page' : 'Saved passage';
    copy.append(el('p', `${savedKind}. ${thread.deletedAt ? 'Removed' : thread.state === 'parked' ? 'Read later' : cap(thread.state)}. ${dateLabel(thread.updatedAt)}.`, 'ml-thread__meta'));
    if (thread.state === 'parked' && !thread.deletedAt) copy.append(el('p', thread.anchor.kind === 'whole-page' ? 'Your reading position can return on this browser.' : 'The saved passage can reopen on this browser.', 'ml-thread__meta'));
    const actions = el('div', undefined, 'ml-thread__actions');
    if (thread.deletedAt) {
      const restore = button('Restore and open', () => void restoreAndOpen(thread), '', `restore-${thread.id}`);
      if (!options.restoreThread) { restore.disabled = true; restore.title = 'Restore is unavailable until the local helper is updated.'; }
      actions.append(restore);
    } else {
      actions.append(button('Open', () => void openThread(thread), '', `open-${thread.id}`));
      if (thread.state === 'parked') {
        const resume = button('Resume page', () => void resumePage(thread), '', `resume-${thread.id}`); resume.disabled = !options.onResumePage; actions.append(resume);
      }
      if (searchMount && options.related) actions.append(button('Related saved passages', () => searchMount.related(thread.id, thread.sourceTitle), 'ml__quiet'));
    }
    actions.append(button('Export JSON', () => void exportOne(thread), 'ml__quiet', `export-${thread.id}`));
    item.append(copy, actions); return item;
  };

  const renderSettings = () => {
    const section = el('section', undefined, 'ml__settings'); section.setAttribute('aria-labelledby', 'ml-settings-title');
    const h2 = el('h2', 'Settings'); h2.id = 'ml-settings-title'; section.append(h2);
    const permissionSection = settingSection('Permissions and exclusions', 'Review where Codex may receive reading context. Web access is listed separately.');
    permissionSection.append(permissionsHost);
    section.append(onboardingHost, autoAssistHost, postureHost, instantHost, providersHost, modelsHost, permissionSection, vocabularyHost, settingsToolsHost, exportSection(), retainedCopiesSection());
    return section;
  };
  const renderProviders = () => {
    const section = settingSection('Provider availability', 'Provider support is separate from the model names below. Credentials stay in the local helper and are never entered here.');
    const list = el('ul', undefined, 'ml-vocabulary');
    for (const provider of providerCapabilities) {
      const state = provider.support === 'implemented' ? 'Connection implemented; readiness not established' : 'Unavailable';
      const item = el('li');
      item.append(el('strong', provider.label), el('span', `${state} · ${provider.detail}`, 'ml-vocabulary__meta'));
      list.append(item);
    }
    section.append(list);
    replaceFocused(providersHost, section);
  };
  const syncModelDraft = () => {
    if (!modelEditor || !modelDraft) return;
    if (modelEditor.fast.value !== modelDraft.fast) modelEditor.fast.value = modelDraft.fast;
    if (modelEditor.deep.value !== modelDraft.deep) modelEditor.deep.value = modelDraft.deep;
  };
  const modelsSection = () => {
    const section = settingSection('Model choices', 'Quick help keeps definitions light. Deep help handles worked explanations. Model names are sent through the configured Codex connection; changing a name does not add another provider or verify model availability.');
    const form = el('form', undefined, 'ml-models');
    const fast = field('Quick help', modelDraft!.fast), deep = field('Deep help', modelDraft!.deep);
    fast.input.dataset.mlFocus = 'model-fast'; deep.input.dataset.mlFocus = 'model-deep';
    const save = button('Save model choices', () => undefined, '', 'save-models'); save.type = 'submit';
    const error = el('div');
    const recordDraft = () => {
      if (current() && modelDraft) modelDraft = { fast: fast.input.value, deep: deep.input.value, revision: modelDraft.revision, edit: modelDraft.edit + 1 };
    };
    fast.input.addEventListener('input', recordDraft, { signal: abort.signal });
    deep.input.addEventListener('input', recordDraft, { signal: abort.signal });
    form.append(fast.row, deep.row, save);
    form.addEventListener('submit', event => { event.preventDefault(); if (!current() || modelSave !== undefined) return; recordDraft(); void saveModelChoices(); }, { signal: abort.signal });
    if (!options.saveModels) { fast.input.readOnly = true; deep.input.readOnly = true; form.append(el('p', 'Saving model choices is unavailable until the local helper is updated.', 'ml__empty')); }
    section.append(form, error);
    return { section, fast: fast.input, deep: deep.input, save, error };
  };
  const renderModels = () => {
    if (!current()) return;
    if (!options.loadModels || modelError || !models) {
      const section = settingSection('Model choices', 'Choose which models Marginalia asks for quick and deep help.');
      if (!options.loadModels) section.append(el('p', 'Model choices are unavailable until the local helper is updated.', 'ml__empty'));
      else if (modelError) section.append(calm(modelError, () => void loadModels(), 'Try again'));
      else section.append(skeleton('Opening model choices'));
      replaceFocused(modelsHost, section); return;
    }
    modelEditor ??= modelsSection();
    syncModelDraft();
    modelEditor.save.disabled = !options.saveModels || modelSave !== undefined;
    const conflict = modelDraft!.revision !== models.revision;
    modelEditor.error.replaceChildren();
    if (modelSaveError || conflict) {
      const retry = calm(modelSaveError || 'Saved choices changed elsewhere. Your edits are kept.', () => {
        if (!current() || modelSave !== undefined) return;
        modelDraft = undefined; modelEditor = undefined; models = undefined; modelSaveError = ''; void loadModels();
      }, 'Discard edits and reload');
      modelEditor.error.append(retry);
    }
    replaceFocused(modelsHost, modelEditor.section);
  };
  const renderPermissions = () => {
    if (!current()) return;
    if (options.permissions && (permissionsError || permissionsLoading)) {
      permissionMount?.destroy(); permissionMount = undefined;
      permissionsHost.replaceChildren(permissionsError ? calm(permissionsError, () => void loadPermissions(), 'Try again') : skeleton('Opening permissions'));
    } else if (options.permissions && permissions) {
      if (!permissionMount) {
        permissionsHost.replaceChildren();
        const empty = !permissions.grants.length && !permissions.exclusions.length ? el('p', 'No saved permissions or site exclusions.', 'ml__empty') : undefined;
        if (empty) permissionsHost.append(empty);
        const controls = el('div'); permissionsHost.append(controls);
        permissionMount = mountConsentSettings(controls, {
          grants: permissions.grants, exclusions: permissions.exclusions,
          revoke: (grant, signal) => permissionMutation(() => options.permissions!.revoke(grant, signal), next => {
            permissions!.grants = permissions!.grants.map(value => value.id === next.id ? next : value);
          }),
          setExcluded: (site, excluded, revision, signal) => permissionMutation(() => options.permissions!.setExcluded(site, excluded, revision, signal), next => {
            permissions!.exclusions = [...permissions!.exclusions.filter(value => value.site !== next.site), next]; empty?.remove();
          }),
        });
      }
    } else if (options.permissions) permissionsHost.replaceChildren(skeleton('Opening permissions'));
    else if (options.onManagePermissions) permissionsHost.replaceChildren(button('Manage permissions', () => void managePermissions()));
    else permissionsHost.replaceChildren(el('p', 'Permissions are unavailable until the local helper is updated.', 'ml__empty'));
  };
  const permissionMutation = async <T>(work: () => Promise<T>, apply: (value: T) => void) => {
    if (!current()) throw new DOMException('Library closed.', 'AbortError');
    permissionWork++;
    try { const next = await owned(work); if (current()) apply(next); return next; }
    finally { permissionWork--; }
  };
  const renderVocabulary = () => { if (current()) replaceFocused(vocabularyHost, vocabularySection()); };

  const vocabularySection = () => {
    const section = settingSection('Vocabulary', 'Words currently stored in your vocabulary, with where each came from.');
    if (!options.listVocabulary) { section.append(el('p', 'Vocabulary is unavailable until the local helper is updated.', 'ml__empty')); return section; }
    if (vocabularyError) { section.append(calm(vocabularyError, () => void loadVocabulary(), 'Try again')); return section; }
    if (!vocabulary) { section.append(skeleton('Opening vocabulary')); return section; }
    if (!vocabulary.length) { section.append(el('p', 'No vocabulary entries are stored yet. Words from notes and lookups will appear once that part of Marginalia is ready.', 'ml__empty')); return section; }
    const list = el('ul', undefined, 'ml-vocabulary');
    for (const entry of vocabulary) {
      const item = el('li'); const copy = el('span');
      const visibleOrigins = entry.origins?.length ? entry.origins : [{ origin: legacyOrigin(entry.origin), observedAt: entry.firstSeen }];
      copy.append(el('strong', entry.term), el('span', statusLabel(entry.status), 'ml-vocabulary__meta'));
      for (const origin of visibleOrigins) copy.append(el('span', `${originLabel(origin.origin)} · ${dateLabel(origin.observedAt)}`, 'ml-vocabulary__meta'));
      const actions = el('span', undefined, 'ml-vocabulary__actions');
      vocabularyActions(entry, actions);
      item.append(copy, actions); list.append(item);
    }
    section.append(list); return section;
  };

  const exportSection = () => {
    const section = settingSection('Export', 'Download the complete saved JSON for any thread, including its notes, replies, and history.');
    section.append(button('Choose a thread to export', () => changeView('library', 'Choose Export JSON beside a saved thread.')));
    return section;
  };

  const exportPreviewSection = () => {
    const preview = exportPreview!;
    const pageSize = 12000, pages = Math.max(1, Math.ceil(preview.json.length / pageSize));
    const page = Math.min(preview.page, pages - 1), start = page * pageSize;
    const section = el('section', undefined, 'ml-export'); section.setAttribute('aria-labelledby', 'ml-export-preview-title');
    const title = el('h3', `Export preview: ${preview.thread.sourceTitle || locationLabel(preview.thread.sourceUrl)}`); title.id = 'ml-export-preview-title';
    const meta = el('p', `Plain JSON · ${preview.json.length.toLocaleString()} characters · page ${page + 1} of ${pages}`, 'ml-thread__meta');
    const content = el('pre', preview.json.slice(start, start + pageSize), 'ml-export__content'); content.tabIndex = 0;
    const actions = el('div', undefined, 'ml-export__actions');
    const previous = button('Previous page', () => { if (exportPreview && exportPreview.page > 0) { exportPreview.page--; render(); } }, 'ml__quiet', 'export-previous'); previous.disabled = page === 0;
    const next = button('Next page', () => { if (exportPreview && exportPreview.page < pages - 1) { exportPreview.page++; render(); } }, 'ml__quiet', 'export-next'); next.disabled = page >= pages - 1;
    actions.append(previous, next, button('Download this JSON', downloadPreview, '', 'export-download'), button('Close preview', closePreview, 'ml__quiet', 'export-close'));
    section.append(title, meta, content, actions); return section;
  };

  const loadThreads = async () => {
    if (!current()) return;
    const generation = ++threadLoad;
    libraryError = ''; threads = undefined; syncShare(); if (view === 'library') render();
    try { const next = await owned(() => options.listThreads()); if (current() && generation === threadLoad) { threads = next; if (view === 'library') render(); } }
    catch (error) { if (current() && generation === threadLoad) { libraryError = message(error, 'Your saved threads are unavailable. Your work has not been changed.'); syncShare(); if (view === 'library') render(); } }
    finally { if (current() && generation === threadLoad) syncShare(); }
  };

  const mountFeatures = () => {
    const features = options.libraryFeatures;
    if (!features) return;

    const libraryTools: HTMLElement[] = [];
    if (features.importer) {
      const host = el('div'); libraryTools.push(host);
      importMount = mountLibraryImport(host, features.importer, { onImported: () => loadThreads() });
    }
    if (features.answer) {
      const host = el('div'), form = el('form', undefined, 'ml-feature-form'), label = el('label');
      const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Ask about saved work'; input.required = true; input.autocomplete = 'off';
      label.append(el('span', 'Question'), input);
      const submit = el('button', 'Search saved work'); submit.type = 'submit';
      form.append(label, submit); const result = el('div'); host.append(form, result); libraryTools.push(host);
      form.addEventListener('submit', event => { event.preventDefault(); const query = input.value.trim(); if (query) void answerMount?.ask(query); else input.focus(); }, { signal: abort.signal });
      answerMount = mountLibraryAnswer(result, features.answer);
    }
    if (features.share) {
      const host = el('div'), label = el('label'); shareSelect = document.createElement('select'); shareSelect.disabled = true;
      label.append(el('span', 'Saved thread'), shareSelect); host.append(label); shareHost = el('div'); host.append(shareHost); libraryTools.push(host);
      shareSelect.addEventListener('change', () => { selectedShareThreadId = shareSelect?.value || undefined; mountSelectedShare(); }, { signal: abort.signal });
    }
    if (libraryTools.length) {
      const section = settingSection('Library tools', 'Import, search, and download the work you kept while reading.');
      section.append(...libraryTools); libraryToolsHost.replaceChildren(section);
    }

    if (features.journalRecap) {
      const section = settingSection('Daily recap', 'Review a local summary for one saved-activity date.');
      const form = el('form', undefined, 'ml-feature-form'), label = el('label'); recapDate = document.createElement('input'); recapDate.type = 'date'; recapDate.value = today();
      label.append(el('span', 'Recap date'), recapDate); const submit = el('button', 'Show recap'); submit.type = 'submit';
      form.append(label, submit); recapHost = el('div'); section.append(form, recapHost); journalToolsHost.replaceChildren(section);
      form.addEventListener('submit', event => { event.preventDefault(); if (recapDate?.value) void journalRecapMount?.show(recapDate.value, timeZone()); }, { signal: abort.signal });
      journalRecapMount = mountJournalRecap(recapHost, features.journalRecap);
    }

    if (features.whitelist) {
      const section = settingSection('Auto assist sites', 'Choose the sites where auto assist may prepare reading help.');
      const host = el('div'); section.append(host); settingsToolsHost.replaceChildren(section);
      whitelistMount = mountWhitelist(host, { transport: features.whitelist });
    }
    if (features.onboarding) onboardingMount = mountOnboarding(onboardingHost, features.onboarding);
    syncShare();
  };

  const mountSelectedShare = () => {
    if (!options.libraryFeatures?.share || !shareHost || !shareSelect) return;
    shareMount?.destroy(); shareMount = undefined; mountedShareThreadId = undefined;
    if (!selectedShareThreadId) { shareHost.replaceChildren(el('p', 'Choose a saved thread to download a copy.', 'ml__empty')); return; }
    shareMount = mountShare(shareHost, { threadId: selectedShareThreadId, transport: options.libraryFeatures.share, download: options.libraryFeatures.shareDownload });
    mountedShareThreadId = selectedShareThreadId;
  };

  function syncShare() {
    if (!options.libraryFeatures?.share || !shareSelect || !shareHost) return;
    const choices = (threads ?? []).filter(thread => !thread.deletedAt);
    shareSelect.replaceChildren(...choices.map(thread => { const option = el('option', thread.sourceTitle || locationLabel(thread.sourceUrl)); option.value = thread.id; return option; }));
    if (!choices.length) {
      selectedShareThreadId = undefined; shareSelect.disabled = true; shareMount?.destroy(); shareMount = undefined; mountedShareThreadId = undefined;
      shareHost.replaceChildren(el('p', threads ? 'No saved thread is ready for download.' : 'Saved threads are loading.', 'ml__empty')); return;
    }
    shareSelect.disabled = false;
    if (!choices.some(thread => thread.id === selectedShareThreadId)) selectedShareThreadId = choices[0].id;
    const selected = selectedShareThreadId;
    if (!selected) return;
    shareSelect.value = selected;
    if (mountedShareThreadId !== selected) mountSelectedShare();
  }
  const loadModels = async () => {
    if (!current() || !options.loadModels) return;
    const generation = ++modelLoad;
    modelError = ''; renderModels();
    try {
      const next = await owned(() => options.loadModels!());
      if (!current() || generation !== modelLoad) return;
      const clean = !modelDraft || (models && modelDraft.revision === models.revision && modelDraft.fast === models.fast && modelDraft.deep === models.deep);
      if (!models || next.revision >= models.revision) {
        models = next;
        if (clean) modelDraft = { fast: next.fast, deep: next.deep, revision: next.revision, edit: (modelDraft?.edit ?? 0) + 1 };
      }
    } catch (error) { if (current() && generation === modelLoad) modelError = message(error, 'Model choices are unavailable. Nothing has been changed.'); }
    finally { if (current() && generation === modelLoad) renderModels(); }
  };
  const loadVocabulary = async () => {
    if (!current() || !options.listVocabulary) return;
    const generation = ++vocabularyLoad;
    vocabularyError = ''; vocabulary = undefined; renderVocabulary();
    try { const next = await owned(() => options.listVocabulary!()); if (current() && generation === vocabularyLoad) vocabulary = next; }
    catch (error) { if (current() && generation === vocabularyLoad) vocabularyError = message(error, 'Vocabulary is unavailable. Nothing has been changed.'); }
    finally { if (current() && generation === vocabularyLoad) renderVocabulary(); }
  };
  const loadPermissions = async () => {
    // A settings visit may refresh idle authority, never tear down a mutation.
    if (!current() || !options.permissions || permissionWork) return;
    const generation = ++permissionLoad;
    permissionsError = ''; permissionsLoading = true; renderPermissions();
    try { const next = await owned(() => options.permissions!.load(abort.signal)); if (current() && generation === permissionLoad) permissions = next; }
    catch (error) { if (current() && generation === permissionLoad) permissionsError = message(error, 'Permissions are unavailable. Nothing has been changed.'); }
    finally { if (current() && generation === permissionLoad) { permissionsLoading = false; renderPermissions(); } }
  };
  const loadSettings = () => {
    if (options.autoAssist && !autoAssistMount) autoAssistMount = mountAutoAssistSettings(autoAssistHost, options.autoAssist);
    if (options.autoAssist && !postureMount) postureMount = mountPosture(postureHost, options.autoAssist);
    if (options.instantHelp && !instantMount) instantMount = mountInstantSettings(instantHost, options.instantHelp);
    renderProviders(); void loadModels(); void loadVocabulary(); void loadPermissions();
  };
  const saveModelChoices = async () => {
    if (!current() || !options.saveModels || !modelDraft || modelSave !== undefined) return;
    const draft = { ...modelDraft }, generation = ++modelLoad, ticket = announce('Saving model choices.');
    modelSave = generation; modelSaveError = ''; renderModels();
    try {
      const next = await owned(() => options.saveModels!({ fast: draft.fast.trim(), deep: draft.deep.trim(), expectedRevision: draft.revision }));
      if (!current() || generation !== modelLoad) return;
      models = next;
      // Editing during a save is allowed. Only the submitted draft is normalized.
      if (modelDraft.edit === draft.edit) modelDraft = { fast: next.fast, deep: next.deep, revision: next.revision, edit: draft.edit };
      else modelDraft = { ...modelDraft, revision: next.revision };
      finishStatus(ticket, 'Model choices saved.');
    } catch (error) {
      if (current() && generation === modelLoad) { modelSaveError = message(error, 'Model choices could not be saved.'); finishStatus(ticket, modelSaveError); }
    } finally {
      if (modelSave === generation) { modelSave = undefined; if (current()) renderModels(); }
    }
  };
  const navigate = async (operation: number, work: () => void | Promise<void>, fallback: string, ticket: number) => {
    try {
      await owned(() => { if (operation === navigation) return work(); });
      return current() && operation === navigation;
    } catch (error) {
      if (current() && operation === navigation) finishStatus(ticket, `${fallback}${error instanceof Error && error.message ? ` ${error.message}` : ''}`);
      return false;
    }
  };
  const openThread = (thread: Thread) => {
    if (!current()) return;
    return navigate(++navigation, () => options.onOpenThread(thread), 'This thread could not be opened.', announce('Opening this thread.'));
  };
  const resumePage = (thread: Thread) => {
    if (!current() || !options.onResumePage) return;
    return navigate(++navigation, () => options.onResumePage!(thread), 'This page could not be resumed.', announce('Opening this page.'));
  };
  const managePermissions = () => {
    if (!current() || !options.onManagePermissions) return;
    return navigate(++navigation, () => options.onManagePermissions!(), 'Permissions could not be opened.', announce('Opening permissions.'));
  };
  const closeLibrary = async () => {
    if (!current()) return;
    exportLoad++; exportPreview = undefined; render();
    if (await navigate(++navigation, () => options.onClose(), 'The library could not be closed.', announce('Closing library.'))) mount.destroy();
  };
  const restoreAndOpen = async (thread: Thread) => {
    if (!current() || !options.restoreThread || restoringThreads.has(thread.id)) return;
    restoringThreads.add(thread.id);
    const operation = ++navigation, ticket = announce('Restoring this thread.');
    try {
      const restored = await owned(() => options.restoreThread!(thread));
      if (restored.id !== thread.id) throw new Error('The local helper returned a different thread. Nothing was opened.');
      if (restored.deletedAt) throw new Error('The local helper did not restore this thread.');
      if (!current()) return;
      threads = threads?.map(value => value.id === restored.id ? restored : value); syncShare();
      if (view === 'library') render();
      if (operation === navigation) {
        finishStatus(ticket, 'Thread restored.');
        await navigate(operation, () => options.onOpenThread(restored), 'The thread was restored but could not be opened.', ticket);
      }
    } catch (error) { if (current() && operation === navigation) finishStatus(ticket, message(error, 'This thread could not be restored.')); }
    finally { restoringThreads.delete(thread.id); }
  };
  const exportOne = async (thread: Thread) => {
    if (!current()) return;
    const generation = ++exportLoad, ticket = announce('Preparing the export.');
    try {
      const data = await owned(() => options.exportThread(thread.id));
      if (!current() || generation !== exportLoad) return;
      const json = JSON.stringify(data, null, 2); if (json === undefined) throw new Error('The local helper returned no JSON to export.');
      exportPreview = { thread, json, page: 0 }; finishStatus(ticket, 'Review the JSON before downloading it.'); render();
    } catch (error) { if (current() && generation === exportLoad) finishStatus(ticket, message(error, 'This thread could not be exported.')); }
  };
  const exportAll = async (citations = false) => {
    if (!current() || wholeExporting) return;
    const generation = ++exportLoad, ticket = announce(citations ? 'Preparing saved citations.' : 'Preparing Markdown and Web Annotation exports.');
    wholeExporting = true; render();
    try {
      const listed = await owned(() => options.listThreads());
      const records = await Promise.all(listed.map(async thread => {
        const record = await owned(() => options.exportThread(thread.id)) as LibraryThreadExport;
        if (record?.thread?.id !== thread.id) throw new Error(`The export for ${thread.id} returned a different thread.`);
        return record;
      }));
      if (!current() || generation !== exportLoad) return;
      if (citations) {
        download(bibtexLibraryExport(records), 'application/x-bibtex;charset=utf-8', 'marginalia-library.bib');
        finishStatus(ticket, 'BibTeX download requested for saved source captures.');
        return;
      }
      const output = wholeLibraryExport(records);
      download(output.markdown, 'text/markdown;charset=utf-8', 'marginalia-library.md');
      download(output.jsonLd, 'application/ld+json;charset=utf-8', 'marginalia-library.jsonld');
      finishStatus(ticket, `Markdown and Web Annotation downloads requested for ${records.length} ${records.length === 1 ? 'thread' : 'threads'}.`);
    } catch (error) {
      if (current() && generation === exportLoad) finishStatus(ticket, message(error, 'The library could not be exported.'));
    } finally {
      wholeExporting = false; if (current()) render();
    }
  };
  const closePreview = () => {
    if (!current()) return;
    exportLoad++; exportPreview = undefined; announce('Export preview closed.'); render();
  };
  const downloadPreview = () => {
    if (!current() || !exportPreview) return;
    const blob = new Blob([exportPreview.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${safeFile(exportPreview.thread.sourceTitle || 'marginalia-thread')}.json`; link.click(); URL.revokeObjectURL(url);
    announce('JSON export download requested.');
  };
  const deleteTerm = async (entry: VocabularyEntry) => {
    if (!current() || !options.deleteVocabulary || deletingTerms.has(entry.term)) return;
    const operation = Symbol(entry.term), ticket = announce(`Deleting ${entry.term}.`);
    deletingTerms.set(entry.term, operation); vocabularyLoad++; renderVocabulary();
    try {
      await owned(() => options.deleteVocabulary!(entry.term));
      if (!current() || deletingTerms.get(entry.term) !== operation) return;
      deletingTerms.delete(entry.term); finishStatus(ticket, `${entry.term} deleted.`);
      // A deletion response has no snapshot revision. Re-read current rows rather
      // than deleting a captured DOM node or overwriting a newer list response.
      await loadVocabulary();
    } catch (error) {
      if (current() && deletingTerms.get(entry.term) === operation) {
        deletingTerms.delete(entry.term); finishStatus(ticket, message(error, 'This term could not be deleted.')); renderVocabulary();
      }
    }
  };
  const vocabularyActions = (entry: VocabularyEntry, actions: HTMLElement) => {
    const pending = deletingTerms.has(entry.term);
    const remove = button(pending ? 'Deleting...' : 'Delete', () => {
      if (!current() || deletingTerms.has(entry.term)) return;
      const confirm = button(`Delete ${entry.term}`, () => void deleteTerm(entry), 'ml__danger', `confirm-term-${entry.term}`);
      const keep = button('Keep', () => { vocabularyActions(entry, actions); actions.querySelector<HTMLButtonElement>('button')?.focus(); }, 'ml__quiet', `keep-term-${entry.term}`);
      actions.replaceChildren(confirm, keep); confirm.focus();
    }, 'ml__danger', `delete-term-${entry.term}`);
    remove.disabled = !options.deleteVocabulary || pending;
    actions.replaceChildren(remove);
  };

  const heading = el('div', undefined, 'ml__heading'), titleWrap = el('div');
  const title = el('h1', 'Marginalia', 'ml__title'); title.id = 'ml-title'; titleWrap.append(title, lede);
  const close = button('Close', () => void closeLibrary(), 'ml__quiet'); close.setAttribute('aria-label', 'Close library');
  heading.append(titleWrap, close);
  const nav = el('nav', undefined, 'ml__nav'); nav.setAttribute('aria-label', 'Library pages');
  nav.append(viewButton('Library', 'library'));
  if (options.readJournal) nav.append(viewButton('Journeys', 'journeys'));
  nav.append(viewButton('Settings', 'settings'));
  if (options.readJournal || options.libraryFeatures?.journalRecap) nav.append(viewButton('Activity', 'journal'));
  settingsHost.append(renderSettings()); root.append(heading, nav, live, searchHost, libraryHost, libraryToolsHost, journeysHost, settingsHost, journalHost, journalToolsHost);
  const mount: LibraryMount = { destroy() {
    if (destroyed) return;
    destroyed = true; searchMount?.destroy(); permissionMount?.destroy(); autoAssistMount?.destroy(); postureMount?.destroy(); instantMount?.destroy(); journalMount?.destroy(); journeysMount?.destroy(); importMount?.destroy(); journalRecapMount?.destroy(); answerMount?.destroy(); shareMount?.destroy(); whitelistMount?.destroy(); onboardingMount?.destroy(); abort.abort(); deletingTerms.clear(); root.remove();
    if (mounts.get(host) === mount) mounts.delete(host);
  } };
  mounts.set(host, mount);
  mountFeatures(); renderModels(); renderPermissions(); renderVocabulary(); render(); void loadThreads();
  return mount;
}

function settingSection(title: string, description: string) { const section = el('section', undefined, 'ml-setting'); section.append(el('h3', title), el('p', description, 'ml-setting__description')); return section; }
function field(label: string, value: string) { const row = el('label', undefined, 'ml-models__field'), text = el('span', label), input = document.createElement('input'); input.value = value; input.required = true; input.maxLength = 100; input.autocomplete = 'off'; input.spellcheck = false; row.append(text, input); return { row, input }; }
function calm(text: string, retry?: () => void, retryLabel = 'Try again') { const box = el('div', undefined, 'ml__calm'); box.append(el('p', text)); if (retry) box.append(button(retryLabel, retry)); return box; }
function skeleton(label: string) { const box = el('div', undefined, 'ml__skeleton'); box.setAttribute('aria-label', label); box.append(el('span'), el('span'), el('span')); return box; }
function button(label: string, action: () => unknown, className = '', focusKey?: string) { const control = el('button', label, className); control.type = 'button'; if (focusKey) control.dataset.mlFocus = focusKey; control.addEventListener('click', () => { void action(); }); return control; }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function cap(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function emptyCopy(filter: Filter) { return filter === 'removed' ? 'Removed threads stay here until you deliberately restore one.' : filter === 'parked' ? 'No pages or passages are saved for later.' : `No ${filter} threads. Work you mark ${filter} will appear here.`; }
function locationLabel(value: string) { try { const url = new URL(value); return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`; } catch { return value; } }
function dateLabel(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : 'Date unavailable'; }
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function timeZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
function legacyOrigin(value: string | undefined): VocabularyOriginKind { return value === 'lookup' || value === 'looked-up' ? 'looked-up' : value === 'note' || value === 'used' ? 'used' : value === 'stated' ? 'stated' : 'legacy'; }
function originLabel(value: string) { return vocabularyOriginLabels[value as VocabularyOriginKind] ?? vocabularyOriginLabels.legacy; }
function statusLabel(value: string) { return value === 'active' ? 'Remembered' : 'Saved entry'; }
function safeFile(value: string) { return value.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'marginalia-thread'; }
function message(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback; }
function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
