import { prepareOpen, type OpenShelfItemRequest, type ReturnContext } from '../contracts/explore.ts';
import 'katex/dist/katex.min.css';
import './reply.css';
import { canonicalReplyData, validateReply, type CandidateReply, type ReplyBlock, type ReplyCapability, type SourceBinding, type SolverBlock } from '../contracts/reply.ts';
import { button, el, equation, formattedText, link, pagedTable, table } from './dom.ts';
import { renderPlot } from './plot.ts';
import { renderDiagram } from './diagram.ts';
import { assumptionDetails } from './assumptions.ts';
import { calculateReply, formatNumber, initialRendererState, type RendererState } from './state.ts';
import { classificationsFromHost, citationQuotesFromHost, citationReceiptKey, shelfFromHost } from './host-authority.ts';
import type { ClassificationView, HostCheckReport } from '../contracts/host-checks.ts';
import { validateSamplesInterpolationReadiness, type SampleGenerationRecord } from '../contracts/sample-provenance.ts';
import { interpolateSamples } from '../kernel/samples.ts';
import { sampleReadinessMessage } from './sample-copy.ts';
import { LEGACY_ORIGIN_NOTICE, originReaderLabel, replyOriginParts, type OriginPart } from '../contracts/reply-origins.ts';

export type { RendererState } from './state.ts';
export type RecomputeRequest = RendererState & { blockId: string; solverId: string; reason: string; requestId: string; stateKey: string };
export type FollowupContext = RendererState & { text: string; questionId?: string; answer?: string };
export type ReplyOptions = {
  sourceText: string;
  initialState?: Partial<RendererState>;
  capabilities?: readonly ReplyCapability[];
  /** Must come from the authenticated host, never from candidate reply data. */
  hostReport?: HostCheckReport;
  /** Existing host checks only: no model turn, retrieval, or saved-solver execution. */
  resolveHostReport?: (parameters: Readonly<Record<string, number>>, context: { requestId: string; stateKey: string }) => Promise<HostCheckReport | undefined>;
  /** Trusted host-owned sidecars keyed by samples block ID. Candidate data must never populate this map. */
  sampleGenerationRecords?: Readonly<Record<string, SampleGenerationRecord>>;
  onShelfOpen?: (item: { blockId: string; itemId: string }) => Promise<OpenShelfItemRequest>;
  onShelfReturn?: (origin: ReturnContext) => void;
  onStateChange?: (state: RendererState) => void | Promise<void>;
  onSourceHighlight?: (binding: SourceBinding | null) => void;
  onSourceNavigate?: (binding: SourceBinding) => void;
  onRecompute?: (request: RecomputeRequest) => void | Promise<void>;
  onFollowup?: (context: FollowupContext) => void | Promise<void>;
};
export type MountedReply = { getState(): RendererState; destroy(): void };

let instance = 0;
let highlightSequence = 0;
const highlightStates = new WeakMap<NonNullable<ReplyOptions['onSourceHighlight']>, Map<string, { binding: SourceBinding; order: number }>>();
function emitHighlight(callback: NonNullable<ReplyOptions['onSourceHighlight']>, states: Map<string, { binding: SourceBinding; order: number }>) {
  const latest = [...states.values()].sort((a, b) => b.order - a.order)[0];
  callback(latest ? structuredClone(latest.binding) : null);
}
/** Mount only committed replies. Revalidation is defensive, not a commit or host attestation. */
export function mountReply(root: HTMLElement, validatedReply: CandidateReply, options: ReplyOptions): MountedReply {
  const doc = root.ownerDocument;
  const prefix = `mr-${globalThis.crypto.randomUUID()}-${++instance}`;
  const article = el(doc, 'article', undefined, 'mr-reply'); article.id = prefix;
  let destroyed = false;
  let reply: CandidateReply;
  try {
    const check = validateReply(validatedReply, { sourceText: options.sourceText });
    if (!check.ok) throw new Error(check.errors.join(' '));
    reply = structuredClone(check.value);
  } catch (error) {
    article.append(el(doc, 'p', error instanceof Error && error.message.includes('This model needs an illustration statement') ? 'This model needs an illustration statement explaining what it represents.' : 'This reply could not be safely displayed. Ask again to create a new version.'));
    root.append(article);
    return { getState: () => ({ parameters: {}, view: {} }), destroy: () => article.remove() };
  }
  const state = initialRendererState(reply, options.initialState);
  const rejectedSavedInputs = options.initialState?.parameters && Object.entries(options.initialState.parameters).some(([name, value]) => !reply.parameters.some(p => p.name === name && typeof value === 'number' && Number.isFinite(value) && value >= p.min && value <= p.max));
  let calculation = calculateReply(reply, state.parameters);
  const updates: (() => void)[] = [];
  const sampleUpdates = new Map<string, (() => void)[]>();
  const authorityUpdates: (() => void)[] = [];
  let hostViews: ClassificationView[] = [];
  let authorityGeneration = 0;
  let samplesGeneration = 0;
  let remainingPlotVertices = 24_000;
  const invalidInputs = new Set<string>();
  const lastCheckedConclusions = new Map<string, string>();
  let sliderRecomputing = false;
  let sliderSettlement: ReturnType<typeof setTimeout> | undefined;
  const settleSlider = () => {
    clearTimeout(sliderSettlement); sliderSettlement = undefined;
    if (destroyed || !sliderRecomputing) return;
    sliderRecomputing = false;
    for (const update of authorityUpdates) update();
  };
  const parameterControls = new Map<string, (() => void)[]>();
  const registerParameterControl = (name: string, update: () => void) => {
    const controls = parameterControls.get(name) ?? [];
    controls.push(update); parameterControls.set(name, controls); update();
  };
  const syncParameterControls = (name: string) => {
    for (const update of parameterControls.get(name) ?? []) update();
  };
  let injectedReport: HostCheckReport | undefined;
  try { injectedReport = options.hostReport ? structuredClone(options.hostReport) : undefined; } catch { /* An invalid injection is never authority. */ }
  let citationQuotePromise: ReturnType<typeof citationQuotesFromHost> | undefined;
  let shelfPromise: ReturnType<typeof shelfFromHost> | undefined;
  const shelfWindows = new Set<Window>();
  let recentReport = injectedReport;
  let sampleGenerationRecords: Readonly<Record<string, SampleGenerationRecord>> = Object.freeze({});
  try { sampleGenerationRecords = Object.freeze(structuredClone(options.sampleGenerationRecords ?? {})); } catch { /* Unreadable sidecars confer no sample authority. */ }
  const getState = () => structuredClone(state);
  const status = el(doc, 'p', '', 'mr-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const saveStatus = el(doc, 'div', undefined, 'mr-save-status'); saveStatus.setAttribute('role', 'status');
  let returnFocusToMargin = true;
  let sliderAnnouncement: { message: string; announced: boolean; awaitingCheck: boolean } | undefined;
  let sliderAnnouncementTimer: ReturnType<typeof setTimeout> | undefined;
  const announce = (text: string) => {
    clearTimeout(sliderAnnouncementTimer); sliderAnnouncementTimer = undefined;
    // Explicit feedback supersedes the pending input message and any late check
    // for that input. A new parameter change starts a fresh settlement.
    if (sliderAnnouncement) sliderAnnouncement.announced = true;
    if (!destroyed) status.textContent = text;
  };
  const announceCalculation = (text: string, final = false) => {
    if (sliderAnnouncement) {
      if (sliderAnnouncement.announced) return;
      sliderAnnouncement.message = text;
      if (final) {
        sliderAnnouncement.awaitingCheck = false;
        if (!sliderAnnouncementTimer) announce(text);
      }
    } else announce(text);
  };
  const startCalculationAnnouncement = (slider: boolean) => {
    clearTimeout(sliderAnnouncementTimer); sliderAnnouncementTimer = undefined;
    sliderAnnouncement = slider ? { message: '', announced: false, awaitingCheck: reply.status === 'complete' && reply.blocks.some(block => block.type === 'classification' && block.headline && block.check) } : undefined;
    if (!sliderAnnouncement) return;
    const pending = sliderAnnouncement;
    sliderAnnouncementTimer = setTimeout(() => {
      if (destroyed || sliderAnnouncement !== pending) return;
      sliderAnnouncementTimer = undefined;
      if (!pending.awaitingCheck && pending.message) announce(pending.message);
    }, 300);
  };

  // Callbacks are the only execution/inference boundary. They run only on explicit actions,
  // except local persistence and optional zero-inference host check resealing.
  const invoke = async (action: (() => void | Promise<void>) | undefined, unavailable: string) => {
    if (destroyed) return;
    if (!action) { announce(unavailable); return; }
    try { await action(); } catch { announce('That action could not finish. Your current inputs remain here.'); }
  };
  let pendingSave: RendererState | undefined;
  let saving = false;
  const persist = () => {
    if (!options.onStateChange || destroyed) return;
    pendingSave = getState();
    if (saving) return;
    saving = true;
    void (async () => {
      try {
        // Already requested persistence finishes after unmount. Destruction fences UI
        // updates and new requests, not a reader's latest unsent view snapshot.
        while (pendingSave) {
          const snapshot = pendingSave; pendingSave = undefined;
          try { await options.onStateChange!(snapshot); if (!destroyed) saveStatus.replaceChildren(); }
          catch {
            if (pendingSave) continue; // A newer snapshot is a distinct save, not a retry.
            if (!destroyed) {
              saveStatus.replaceChildren(el(doc, 'p', 'The latest view could not be saved. Your current inputs remain here.'), button(doc, 'Retry saving view', persist));
            }
          }
        }
      }
      finally { saving = false; }
    })();
  };
  const requestAuthority = async () => {
    if (destroyed) return;
    const generation = ++authorityGeneration;
    hostViews = []; for (const update of authorityUpdates) update();
    if (invalidInputs.size) return;
    if (reply.status !== 'complete' || !reply.blocks.some(block => block.type === 'classification' && block.headline && block.check)) return;
    const parameters = { ...state.parameters };
    const localChecks = structuredClone(calculation.checks);
    const stateKey = canonicalReplyData({ reply, parameters });
    const current = () => !destroyed && generation === authorityGeneration && canonicalReplyData({ reply, parameters: state.parameters }) === stateKey;
    const apply = (views: ClassificationView[]) => {
      hostViews = views;
      sliderRecomputing = false;
      for (const update of authorityUpdates) update();
      const sentences = views.filter(view => view.state === 'verified').map(view => view.label).join(' ');
      announceCalculation(sentences || 'The current host check could not verify these inputs.', true);
    };
    try {
      for (const report of new Set([recentReport, injectedReport])) {
        if (!report) continue;
        const views = await classificationsFromHost(reply, parameters, localChecks, report);
        if (!current()) return;
        if (views.some(view => view.state === 'verified')) { apply(views); return; }
      }
      if (!current()) return;
      const eligible = localChecks.some(check => check.status === 'pass' && reply.blocks.some(block => block.id === check.classification && block.type === 'classification' && block.headline));
      const source = eligible ? await options.resolveHostReport?.(Object.freeze({ ...parameters }), { requestId: globalThis.crypto.randomUUID(), stateKey }) : undefined;
      if (!current()) return;
      // The host callback owns the transport; detach so it cannot mutate a report
      // while WebCrypto checks the current immutable snapshots.
      const report = source ? structuredClone(source) : undefined;
      const views = await classificationsFromHost(reply, parameters, localChecks, report);
      if (!current()) return;
      if (views.some(view => view.state === 'verified')) recentReport = report;
      apply(views);
    } catch {
      if (!destroyed && generation === authorityGeneration) {
        sliderRecomputing = false; for (const update of authorityUpdates) update();
        announceCalculation('The current host check is unavailable. The headline stays withheld; local calculations remain available.', true);
      }
    }
  };
  const requestSamples = async () => {
    if (destroyed || !capability('samples')) return;
    const generation = ++samplesGeneration;
    const parameters = structuredClone(state.parameters);
    const stateKey = canonicalReplyData({ reply, parameters });
    const blocks = reply.blocks.filter(block => block.type === 'samples');
    const current = () => !destroyed && invalidInputs.size === 0 && generation === samplesGeneration && canonicalReplyData({ reply, parameters: state.parameters }) === stateKey;
    await Promise.all(blocks.map(async block => {
      let result: ReturnType<typeof interpolateSamples>;
      try {
        const readiness = await validateSamplesInterpolationReadiness(reply, block, parameters, sampleGenerationRecords[block.id]);
        result = readiness.ok ? interpolateSamples(readiness.block, readiness.parameters) : {
          ok: false, reason: sampleReadinessMessage(readiness.state),
        };
      } catch {
        result = { ok: false, reason: sampleReadinessMessage('invalid') };
      }
      if (!current()) return;
      calculation.samples.set(block.id, result);
      // Readiness changes this grid and its plots, not unrelated interactive DOM.
      for (const update of sampleUpdates.get(block.id) ?? []) update();
    }));
  };
  const refresh = (resealAuthority = true, slider = false) => {
    if (destroyed) return;
    startCalculationAnnouncement(slider);
    sliderRecomputing = slider;
    clearTimeout(sliderSettlement);
    if (slider) sliderSettlement = setTimeout(settleSlider, 300);
    ++samplesGeneration;
    ++authorityGeneration; hostViews = [];
    calculation = calculateReply(reply, state.parameters);
    for (const update of updates) update();
    persist(); announceCalculation(invalidInputs.size ? 'Correct the invalid input. The plot uses the last accepted values; the headline stays withheld.' : 'Updated locally. No model request was sent.');
    if (!destroyed) void requestSamples();
    if (!destroyed && resealAuthority) void requestAuthority();
  };
  const onFollowup = (text: string, extra: { questionId?: string; answer?: string } = {}) => {
    if (destroyed || !text.trim()) return;
    void invoke(options.onFollowup ? () => options.onFollowup!({ ...getState(), text: text.trim().slice(0, 8192), ...extra }) : undefined, 'Asking again is not connected in this view. Your current inputs remain here.');
  };
  const navigate = (binding: SourceBinding) => {
    if (destroyed) return;
    if (dialog.open) { returnFocusToMargin = false; dialog.close(); }
    if (options.onSourceNavigate) options.onSourceNavigate(structuredClone(binding));
    else announce('Source navigation is not connected in this view. The captured passage remains available above.');
  };
  const clearHighlight = () => {
    const callback = options.onSourceHighlight;
    const states = callback ? highlightStates.get(callback) : undefined;
    if (callback && states?.delete(prefix)) emitHighlight(callback, states);
  };
  type ActiveBinding = { node: HTMLElement | SVGElement; binding: SourceBinding; order: number };
  let focusedBinding: ActiveBinding | undefined;
  let hoveredBinding: ActiveBinding | undefined;
  const updateHighlight = () => {
    const active = [hoveredBinding, focusedBinding].filter((entry): entry is ActiveBinding => !!entry).sort((a, b) => b.order - a.order)[0];
    if (destroyed || !active) { clearHighlight(); return; }
    if (options.onSourceHighlight) {
      const states = highlightStates.get(options.onSourceHighlight) ?? new Map();
      states.set(prefix, active); highlightStates.set(options.onSourceHighlight, states); emitHighlight(options.onSourceHighlight, states);
    }
  };
  const bindHighlight = (node: HTMLElement | SVGElement, binding: SourceBinding) => {
    node.addEventListener('pointerenter', () => { hoveredBinding = { node, binding, order: ++highlightSequence }; updateHighlight(); });
    node.addEventListener('pointerleave', () => { if (hoveredBinding?.node === node) hoveredBinding = undefined; updateHighlight(); });
    node.addEventListener('focus', () => { focusedBinding = { node, binding, order: ++highlightSequence }; updateHighlight(); });
    node.addEventListener('blur', () => { if (focusedBinding?.node === node) focusedBinding = undefined; updateHighlight(); });
  };
  const bind = (node: HTMLElement | SVGElement, binding: SourceBinding) => {
    bindHighlight(node, binding);
    node.addEventListener('click', () => navigate(binding));
    node.setAttribute('aria-label', `${binding.meaning}. ${binding.relation}. Go to source passage.`);
    if (node.tagName.toLowerCase() !== 'button') {
      node.setAttribute('tabindex', '0'); node.setAttribute('role', 'button');
      node.addEventListener('keydown', event => { const key = (event as KeyboardEvent).key; if (key === 'Enter' || key === ' ') { event.preventDefault(); navigate(binding); } });
    }
  };
  const capability = (name: ReplyCapability) => options.capabilities?.includes(name) === true;
  const originParts = replyOriginParts(reply);
  const originPanel = (parts: OriginPart[], heading: string) => {
    const details = el(doc, 'details', undefined, 'mr-origins');
    details.append(el(doc, 'summary', heading));
    if (!reply.origins) { details.append(el(doc, 'p', LEGACY_ORIGIN_NOTICE, 'mr-meta')); return details; }
    details.append(el(doc, 'p', 'Origins below were supplied with this explanation. They do not establish that a claim is supported.', 'mr-meta'));
    for (const part of parts) {
      const origin = reply.origins.parts[part.path];
      const row = el(doc, 'p', `${part.label}: ${originReaderLabel(origin)}.`, 'mr-meta');
      row.dataset.originPart = part.path; row.dataset.origin = origin.kind;
      if ('description' in origin) row.append(doc.createTextNode(` ${origin.description}`));
      if (origin.kind === 'reader-note') row.append(doc.createTextNode(` Recorded note: ${origin.noteId}.`));
      if (origin.kind === 'fetched') row.append(doc.createTextNode(` Recorded address: ${origin.url}. The retrieval record and support assessment are separate.`));
      if (origin.kind === 'source-page') {
        const binding = reply.sourceBindings.find(binding => binding.name === origin.binding)!;
        row.append(doc.createTextNode(binding.relation === 'quoted' ? ' Quoted from the captured passage.' : ' Interpreted from the captured passage.'));
        const source = button(doc, 'Source passage', () => {}); bind(source, binding); row.append(source);
      }
      details.append(row);
    }
    return details;
  };
  const rememberDetails = (node: HTMLDetailsElement, key: string) => {
    node.open = state.view[key] === true;
    node.addEventListener('toggle', () => { if (!destroyed && node.isConnected && state.view[key] !== node.open) { state.view[key] = node.open; persist(); } });
  };
  const solvers = reply.blocks.filter((b): b is SolverBlock => b.type === 'solver');
  const offerRecompute = (container: HTMLElement, blockId: string, reason: string) => {
    const matches = solvers.filter(b => b.id === blockId || b.outputBlocks.includes(blockId));
    const solver = matches.length === 1 ? matches[0] : undefined;
    const recompute = button(doc, 'Recompute with these inputs', () => {
      const snapshot = getState();
      announce('Recompute requested from the saved solver. No model turn is requested by this action.');
      void invoke(options.onRecompute && solver ? () => options.onRecompute!({ ...snapshot, blockId, solverId: solver.id, reason, requestId: globalThis.crypto.randomUUID(), stateKey: canonicalReplyData({ reply, parameters: snapshot.parameters }) }) : undefined, 'This example cannot run again here yet.');
    });
    recompute.disabled = !options.onRecompute || !capability('solver') || !solver || solver.inputNames.some(name => !Object.hasOwn(state.parameters, name));
    container.append(recompute);
    if (recompute.disabled) container.append(el(doc, 'p', 'This example cannot run again here yet. Your current inputs are unchanged.', 'mr-meta'));
    const ask = button(doc, 'Ask again with this change', () => onFollowup(`Please revise ${blockId} for my current inputs. ${reason}`)); ask.disabled = !options.onFollowup; container.append(ask);
  };
  // Only a typed slot can request checked authority. Its authored text never
  // supplies the checked sentence; the matched criterion owns that sentence.
  const copy = (node: HTMLElement, target: 'title' | 'summary' | 'text', authored: string, block?: string) => {
    const claim = reply.resultClaims?.find(claim => claim.target === target && claim.block === block);
    const update = () => {
      const view = claim && hostViews.find(view => view.blockId === claim.classification && view.state === 'verified');
      node.dataset.assessment = view ? 'checked' : 'unassessed';
      if (target === 'text' && !claim) node.replaceChildren(formattedText(doc, authored));
      else if (claim && !view && sliderRecomputing && lastCheckedConclusions.has(claim.classification)) {
        node.replaceChildren(doc.createTextNode(lastCheckedConclusions.get(claim.classification)!), el(doc, 'span', ' (recomputing)', 'mr-meta'));
      } else {
        node.textContent = claim ? view ? view.label! : 'The requested result is withheld until a matching check is available.' : authored;
        if (claim && !view) node.append(el(doc, 'span', ' (not checked)', 'mr-meta'));
      }
    };
    update(); authorityUpdates.push(update);
  };
  const hasClassification = reply.blocks.some(block => block.type === 'classification');
  const title = el(doc, 'h3'); copy(title, 'title', reply.title); title.id = `${prefix}-title`; article.setAttribute('aria-labelledby', title.id); article.append(title);
  if (reply.illustration) article.append(el(doc, 'p', reply.illustration.statement, 'mr-illustration'));
  if (reply.status === 'partial') article.append(el(doc, 'p', 'Provisional reply. Checks and content may change.', 'mr-meta'));
  const summary = el(doc, 'p'); copy(summary, 'summary', reply.summary);
  const actions = el(doc, 'div', undefined, 'mr-actions');
  const sources = el(doc, 'details'); sources.id = `${prefix}-sources`; sources.append(el(doc, 'summary', 'Source passage'));
  for (const binding of reply.sourceBindings) {
    const source = button(doc, `${binding.meaning} · ${binding.relation}`, () => {}); bind(source, binding);
    const quote = el(doc, 'blockquote', binding.selector.exact); sources.append(source, quote);
  }
  if (!reply.sourceBindings.length) sources.append(el(doc, 'p', 'No individual source bindings were supplied.'));
  const made = el(doc, 'details'); made.append(el(doc, 'summary', 'How this was made'));
  if (!reply.illustration && reply.blocks.some(block => block.type === 'model')) made.append(el(doc, 'p', 'Illustration purpose is unavailable for this saved model. Its authored explanation remains unassessed.', 'mr-meta'));
  made.append(originPanel(originParts.filter(part => !part.path.startsWith('/blocks/')), 'Origins of the description and inputs'));
  if (hasClassification || reply.resultClaims?.length) {
    const authored = el(doc, 'details'); authored.append(el(doc, 'summary', 'Original authored description (not a checked result)'));
    authored.append(el(doc, 'p', 'This title and summary were supplied with the reply. They are not checked conclusions for the current inputs.', 'mr-meta'), el(doc, 'p', reply.title), el(doc, 'p', reply.summary));
    made.append(authored);
  }
  rememberDetails(sources, 'details:sources'); rememberDetails(made, 'details:made');
  made.append(el(doc, 'p', 'The author supplied structured content and mathematical expressions. The calculations run on this device. Only conclusions supported by a matching check are shown as checked.'));
  if (!reply.origins) made.append(el(doc, 'p', LEGACY_ORIGIN_NOTICE, 'mr-meta'));
  if (rejectedSavedInputs) made.append(el(doc, 'p', 'Some saved inputs were invalid and were replaced with the authored defaults. Review the inputs below.', 'mr-meta'));
  const hostStatus = el(doc, 'p', 'No checked conclusion is available for these inputs.', 'mr-meta'); made.append(hostStatus, el(doc, 'p', 'Recorded citation and error-evidence statements remain author-supplied.', 'mr-meta'));
  authorityUpdates.push(() => { hostStatus.textContent = hostViews.some(view => view.state === 'verified') ? 'This conclusion was checked for the inputs shown.' : 'No checked conclusion is available for these inputs.'; });
  const checks = el(doc, 'div'); made.append(checks);
  updates.push(() => {
    checks.replaceChildren();
    checks.append(el(doc, 'p', `Current inputs: ${reply.parameters.map(p => `${p.label} = ${formatNumber(state.parameters[p.name])} ${p.unit}`).join('; ') || 'none'}`, 'mr-meta'));
    for (const check of calculation.checks) checks.append(el(doc, 'p', check.status === 'pass' ? 'Checked on this device for the current values.' : 'Could not be checked here.'));
    if (!calculation.checks.length) checks.append(el(doc, 'p', 'Could not be checked here.'));
  });
  const expand = button(doc, 'Expand reply', () => {
    if (dialog.open) { dialog.close(); return; }
    returnFocusToMargin = true; dialog.append(article); expand.textContent = 'Return to margin'; dialog.showModal(); expand.focus();
  });
  const dialog = el(doc, 'dialog', undefined, 'mr-dialog'); dialog.setAttribute('aria-label', 'Expanded reply with source and return controls');
  dialog.addEventListener('close', () => { if (!destroyed) { root.insertBefore(article, dialog); expand.textContent = 'Expand reply'; if (returnFocusToMargin) expand.focus(); } });
  actions.append(expand);

  if (reply.parameters.length) {
    const controls = el(doc, 'fieldset', undefined, 'mr-parameters'); controls.append(el(doc, 'legend', 'Try the model'));
    for (const parameter of reply.parameters) {
      const row = el(doc, 'div', undefined, 'mr-parameter');
      const text = `${parameter.label}${parameter.unit ? ` (${parameter.unit})` : ''}`;
      const label = el(doc, 'label', text); label.htmlFor = `${prefix}-input-${parameter.name}`;
      const input = el(doc, 'input'); input.type = 'number'; input.id = label.htmlFor; input.min = String(parameter.min); input.max = String(parameter.max); input.step = 'any'; input.value = String(state.parameters[parameter.name]);
      const slider = el(doc, 'input'); slider.type = 'range'; slider.id = `${prefix}-slider-${parameter.name}`; slider.min = input.min; slider.max = input.max; slider.step = 'any'; slider.value = input.value; slider.setAttribute('aria-label', `${text} slider`);
      input.hidden = true;
      const edit = button(doc, '', () => {
        input.hidden = false; slider.hidden = true; edit.hidden = true;
        input.value = String(state.parameters[parameter.name]); input.focus(); input.select();
      });
      edit.setAttribute('aria-label', `Edit ${text}`);
      const error = el(doc, 'p', '', 'mr-error'); error.id = `${prefix}-error-${parameter.name}`; error.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', error.id);
      registerParameterControl(parameter.name, () => {
        const value = state.parameters[parameter.name];
        slider.value = String(value);
        edit.textContent = `${formatNumber(value)} ${parameter.unit}`.trim();
        if (doc.activeElement !== input) input.value = String(value);
        error.textContent = '';
        input.removeAttribute('aria-invalid'); slider.removeAttribute('aria-invalid');
        slider.setAttribute('aria-valuetext', `${formatNumber(value)} ${parameter.unit}`);
      });
      if (parameter.sourceBinding) {
        label.setAttribute('tabindex', '0');
        bindHighlight(label, parameter.sourceBinding); bindHighlight(input, parameter.sourceBinding); bindHighlight(slider, parameter.sourceBinding);
      }
      const change = (target: HTMLInputElement) => {
        const value = target.valueAsNumber;
        if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) {
          startCalculationAnnouncement(false);
          sliderRecomputing = false;
          error.textContent = `Enter a number from ${parameter.min} to ${parameter.max}${parameter.unit ? ` ${parameter.unit}` : ''}.`; target.setAttribute('aria-invalid', 'true');
          invalidInputs.add(parameter.name); ++authorityGeneration; ++samplesGeneration; hostViews = []; for (const update of authorityUpdates) update();
          for (const block of reply.blocks) if (block.type === 'samples') calculation.samples.set(block.id, { ok: false, reason: 'Correct the invalid input before applying the recorded sample grid.' });
          for (const update of updates) update();
          announce('Correct the invalid input. The plot uses the last accepted values; the headline stays withheld.'); return;
        }
        const wasInvalid = invalidInputs.delete(parameter.name);
        error.textContent = ''; input.removeAttribute('aria-invalid'); slider.removeAttribute('aria-invalid');
        const changed = state.parameters[parameter.name] !== value;
        state.parameters[parameter.name] = value; syncParameterControls(parameter.name); if (changed || wasInvalid) refresh(true, target === slider);
      };
      input.addEventListener('change', () => change(input)); input.addEventListener('blur', () => change(input)); slider.addEventListener('input', () => change(slider));
      // Native range steps snap restored/typed values to a grid anchored at min.
      // Keep those exact values while retaining the existing fine arrow increment.
      slider.addEventListener('keydown', event => {
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        slider.value = String(Math.max(parameter.min, Math.min(parameter.max, state.parameters[parameter.name] + direction * (parameter.max - parameter.min) / 1000)));
        change(slider);
      });
      slider.addEventListener('change', settleSlider); slider.addEventListener('pointerup', settleSlider); slider.addEventListener('blur', settleSlider);
      input.addEventListener('blur', () => { if (!invalidInputs.has(parameter.name)) { input.hidden = true; slider.hidden = false; edit.hidden = false; } });
      row.append(label, edit, input, slider, error); controls.append(row);
    }
    article.append(controls);
  }

  let occurrences = 0;
  const renderBlock = (block: ReplyBlock, ancestors: string[] = []): HTMLElement => {
    const section = el(doc, 'section', undefined, `mr-block mr-${block.type}`); section.dataset.block = block.id; section.dataset.type = block.type;
    const occurrence = ++occurrences;
    const id = `${prefix}-${block.id}-${occurrence}`; section.id = id;
    const tableView = (name: string) => {
      const key = `table:${block.id}:${occurrence}:${name}`;
      return { page: Number(state.view[`${key}:row`]) || 0, columnPage: Number(state.view[`${key}:col`]) || 0, onChange(page: number, columnPage: number) { state.view[`${key}:row`] = page; state.view[`${key}:col`] = columnPage; persist(); } };
    };
    if (ancestors.includes(block.id) || ancestors.length > 4 || occurrences > 160) { section.append(el(doc, 'p', 'This comparison cannot be expanded further.')); return section; }
    const dynamic = (update: () => void, sampleId?: string) => {
      updates.push(update);
      if (sampleId) {
        const dependents = sampleUpdates.get(sampleId) ?? [];
        dependents.push(update); sampleUpdates.set(sampleId, dependents);
      }
    };
    switch (block.type) {
      case 'text': {
        const content = el(doc, 'div'); copy(content, 'text', block.md, block.id);
        section.append(content, el(doc, 'p', reply.resultClaims?.some(claim => claim.target === 'text' && claim.block === block.id) ? 'Only the matched conclusion can be checked for the inputs shown.' : 'Unassessed authored explanation.', 'mr-meta'));
        if (reply.resultClaims?.some(claim => claim.target === 'text' && claim.block === block.id)) {
          const original = el(doc, 'details'); original.append(el(doc, 'summary', 'Original authored text (unassessed)'), formattedText(doc, block.md)); section.append(original);
        }
        break;
      }
      case 'equation': section.append(equation(doc, block.tex)); break;
      case 'model': dynamic(() => {
        const model = calculation.models.get(block.id); const tr = model?.ok ? model.value : undefined;
        const timeUnit = calculation.checks.some(c => c.model === block.id && c.status === 'pass' && c.criterion === 'growth-v1') ? 's' : 'model time units';
        section.replaceChildren(el(doc, 'p', `${block.kind === 'ode' ? `${block.method.toUpperCase()} over ${block.horizon} ${timeUnit}` : `${block.iterations} map iterations`}. ${tr ? `${tr.rows.length} computed points. ${tr.end === 'complete' ? 'Declared interval reached.' : tr.message ?? 'Calculation stopped at a bound.'}` : model && !model.ok ? model.reason : 'No result.'}`, 'mr-meta'));
        if (!tr || tr.end === 'limit' || tr.end === 'undefined') offerRecompute(section, block.id, tr?.message ?? 'The local calculation could not complete.');
        if (tr?.events?.length) {
          const events = tr.events; const key = `events:${block.id}:${occurrence}`;
          const details = el(doc, 'details'); details.append(el(doc, 'summary', `${events.length} recorded numerical events`)); rememberDetails(details, `${key}:open`);
          let page = Math.min(Math.floor((events.length - 1) / 25), Math.max(0, Math.floor(Number(state.view[`${key}:page`]) || 0)));
          const holder = el(doc, 'div', undefined, 'mr-table-wrap');
          const previous = button(doc, 'Previous events', () => { page--; draw(); state.view[`${key}:page`] = page; persist(); });
          const next = button(doc, 'Next events', () => { page++; draw(); state.view[`${key}:page`] = page; persist(); });
          const draw = () => {
            holder.replaceChildren(table(doc, [{ key: 'name', label: 'Event' }, { key: 'time', label: `Estimated time (${timeUnit})` }, { key: 'bracket', label: 'Numerical bracket' }, { key: 'terminal', label: 'Terminal' }], events.slice(page * 25, (page + 1) * 25).map(event => ({ name: event.id, time: formatNumber(event.time), bracket: `${formatNumber(event.bracket[0])} to ${formatNumber(event.bracket[1])}`, terminal: event.terminal })), `Events ${page * 25 + 1}–${Math.min(events.length, (page + 1) * 25)} of ${events.length}`));
            previous.disabled = page === 0; next.disabled = (page + 1) * 25 >= events.length;
          };
          details.addEventListener('toggle', () => { if (details.open) draw(); else holder.replaceChildren(); });
          if (details.open) draw(); details.append(holder, previous, next); section.append(details);
        }
      }); break;
      case 'plot': {
        // Reserve once per occurrence; asynchronous redraws cannot refill the budget.
        const maxVertices = Math.min(3000, remainingPlotVertices); remainingPlotVertices -= maxVertices;
        const sampleId = reply.blocks.some(source => source.id === block.from && source.type === 'samples') ? block.from : undefined;
        dynamic(() => {
          const model = calculation.models.get(block.from); const sampled = calculation.samples.get(block.from);
          const source = reply.blocks.find(b => b.id === block.from);
          const requestedColumns = [block.x, ...block.y];
          const tabular = source?.type === 'table' && requestedColumns.every(name => source.columns.some(c => c.key === name)) ? { columns: requestedColumns, rows: source.rows.map(row => requestedColumns.map(name => typeof row[name] === 'number' && Number.isFinite(row[name]) ? row[name] as number : null)), end: 'complete' as const, steps: 0, origin: 'table' as const } : undefined;
          const trajectory = model?.ok ? model.value : sampled?.ok && capability('samples') ? { columns: Object.keys(sampled.values), rows: [Object.values(sampled.values)], end: 'complete' as const, steps: 0, origin: 'samples' as const } : tabular;
          const key = `plot:${block.id}:${occurrence}`;
          const plotBlock = block.x === 't' && !block.labels.t && calculation.checks.some(c => c.model === block.from && c.status === 'pass' && c.criterion === 'growth-v1') ? { ...block, labels: { ...block.labels, t: 'time (s)' } } : block;
          section.replaceChildren(trajectory ? renderPlot(doc, plotBlock, trajectory, id, {
            open: state.view[`${key}:open`] === true, page: Number(state.view[`${key}:page`]) || 0, maxVertices,
            onChange(open, page) { state.view[`${key}:open`] = open; state.view[`${key}:page`] = page; persist(); },
          }) : el(doc, 'p', 'Plot data is unavailable for these inputs.'));
        }, sampleId); break;
      }
      case 'derived': dynamic(() => {
        const result = calculation.derived.get(block.id);
        section.replaceChildren(el(doc, 'p', `${block.label}: ${result?.ok ? `${formatNumber(result.value)}${block.unit ? ` ${block.unit}` : ''}` : result && !result.ok ? result.reason : 'Unavailable'}`), el(doc, 'p', `Calculated from the authored expression ${block.expression}; this alone does not verify a scientific claim.`, 'mr-meta'));
      }); break;
      case 'classification': { const update = () => {
        const view = hostViews.find(view => view.blockId === block.id);
        const authorized = view?.state === 'verified';
        if (authorized) lastCheckedConclusions.set(block.id, view.label!);
        const conclusion = el(doc, 'p', undefined, 'mr-conclusion');
        if (authorized) conclusion.textContent = view.label!;
        else if (sliderRecomputing && lastCheckedConclusions.has(block.id)) {
          conclusion.append(doc.createTextNode(lastCheckedConclusions.get(block.id)!), el(doc, 'span', ' (recomputing)', 'mr-meta'));
        } else conclusion.append(doc.createTextNode('No conclusion beyond the shown interval. The requested headline is withheld.'), el(doc, 'span', ' (not checked)', 'mr-meta'));
        section.replaceChildren(conclusion, el(doc, 'p', authorized ? 'Checked on this device for the current values.' : 'Could not be checked here.', 'mr-meta'));
      }; dynamic(update); authorityUpdates.push(update); break; }
      case 'table': section.append(pagedTable(doc, block.columns, block.rows, 'Table', tableView('data'))); break;
      case 'diagram': section.append(renderDiagram(doc, block, id, reply.sourceBindings, bind)); break;
      case 'steps': {
        const list = el(doc, 'ol'); const key = `steps:${block.id}:${occurrence}`;
        let shown = Math.min(block.steps.length, Math.max(1, Math.floor(Number(state.view[key]) || 1)));
        const items = block.steps.map(step => { const item = el(doc, 'li'); if (step.text) item.append(formattedText(doc, step.text)); if (step.tex) item.append(equation(doc, step.tex)); list.append(item); return item; });
        const count = el(doc, 'p', '', 'mr-meta'); count.setAttribute('aria-live', 'polite');
        const next = button(doc, 'Next step', () => { shown = Math.min(shown + 1, items.length); update(); state.view[key] = shown; persist(); });
        const previous = button(doc, 'Previous step', () => { shown = Math.max(1, shown - 1); update(); state.view[key] = shown; persist(); });
        const update = () => { items.forEach((item, i) => { item.hidden = i >= shown; }); count.textContent = `${shown} of ${items.length} steps revealed`; next.disabled = shown >= items.length; previous.disabled = shown <= 1; };
        update(); section.append(list, count, previous, next); break;
      }
      case 'compare': {
        section.classList.add('mr-comparison');
        for (const variant of block.variants) {
          if (occurrences >= 160) { section.append(el(doc, 'p', 'The comparison reached its display limit.')); break; }
          const column = el(doc, 'div'); column.append(el(doc, 'h4', variant.label));
          for (const reference of variant.blocks) { if (occurrences >= 160) break; const child = reply.blocks.find(b => b.id === reference); if (child) column.append(renderBlock(child, [...ancestors, block.id])); }
          section.append(column);
        }
        break;
      }
      case 'question': {
        section.append(el(doc, 'p', block.prompt));
        const form = el(doc, 'form');
        const answerKey = `answer:${block.id}:${occurrence}`; const draftKey = `answerDraft:${block.id}:${occurrence}`;
        const restoredAnswer = state.view[answerKey];
        let selected = block.answers.some(answer => answer.value === restoredAnswer) ? restoredAnswer as string : '';
        let input: HTMLInputElement | undefined;
        for (const answer of block.answers) {
          const label = el(doc, 'label', undefined, 'mr-choice'); const choice = el(doc, 'input'); choice.type = 'radio'; choice.name = `${id}-choice`; choice.value = answer.value; choice.checked = selected === answer.value;
          choice.addEventListener('change', () => { selected = answer.value; state.view[answerKey] = selected; state.view[draftKey] = ''; if (input) input.value = ''; persist(); });
          label.append(choice, doc.createTextNode(answer.label)); form.append(label);
        }
        if (block.allowFreeText) {
          const label = el(doc, 'label', 'Your answer (or choose above)'); input = el(doc, 'input'); input.id = `${id}-answer`; input.maxLength = 512; label.htmlFor = input.id;
          input.value = typeof state.view[draftKey] === 'string' ? (state.view[draftKey] as string).slice(0, 512) : '';
          input.addEventListener('input', () => { state.view[draftKey] = input!.value; if (input!.value.trim()) { selected = ''; state.view[answerKey] = ''; form.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach(choice => { choice.checked = false; }); } persist(); });
          form.append(label, input);
        }
        const submit = el(doc, 'button', 'Send answer'); submit.type = 'submit'; submit.disabled = !options.onFollowup;
        form.addEventListener('submit', event => { event.preventDefault(); const answer = input?.value.trim() || selected; if (answer) onFollowup(answer, { questionId: block.id, answer }); });
        form.append(submit); section.append(form, el(doc, 'p', 'Choose or draft an answer, then send it to continue the conversation.', 'mr-meta')); break;
      }
      case 'turn': section.append(el(doc, 'p', `Reply version ${block.version}${block.inReplyTo ? ` · in reply to ${block.inReplyTo}` : ''}`, 'mr-meta'), formattedText(doc, block.text)); break;
      case 'citations':
        for (const citation of block.entries) {
          const entry = el(doc, 'div', undefined, 'mr-citation');
          const status = el(doc, 'p', 'Unverified. Claim support awaits assessment.', 'mr-citation-status');
          citationQuotePromise ??= citationQuotesFromHost(reply, options.sourceText, injectedReport);
          void citationQuotePromise.then(quoted => {
            if (!destroyed && quoted.has(citationReceiptKey(block.id, citation.id))) status.textContent = 'Quoted from this page. Claim support remains unverified.';
          });
          const assessment = el(doc, 'div'); assessment.append(el(doc, 'p', citation.claim), status, el(doc, 'p', 'Author-supplied support assessment; fetching alone does not establish support.', 'mr-meta')); made.append(assessment);
          entry.append(el(doc, 'p', citation.claim), el(doc, 'blockquote', citation.support), el(doc, 'p', `${citation.source} · ${citation.date}. ${citation.fetched ? 'Author reports this was fetched; the retrieval record is separate.' : 'Not reported as fetched.'}`, 'mr-meta'));
          if (citation.url && capability('network.citations')) entry.append(link(doc, 'Open cited source', citation.url));
          section.append(entry);
        }
        if (!capability('network.citations')) section.append(el(doc, 'p', 'Opening citation links is unavailable in this view.', 'mr-meta'));
        break;
      case 'shelf': {
        made.append(el(doc, 'p', 'Suggested reading. Source contents and claim support remain unverified.', 'mr-meta'));
        shelfPromise ??= shelfFromHost(reply, options.sourceText, injectedReport);
        const back = button(doc, 'Return to original passage', () => {
          void shelfPromise!.then(assessment => { if (!destroyed && assessment) options.onShelfReturn?.(structuredClone(assessment.returnTo)); });
        });
        back.disabled = true;
        void shelfPromise.then(assessment => { if (!destroyed) back.disabled = !assessment || !options.onShelfReturn; });
        for (const item of block.items) {
          const entry = el(doc, 'div'), fallback = el(doc, 'div'), status = el(doc, 'p', 'Checking the saved reading link.', 'mr-meta');
          status.setAttribute('role', 'status');
          const open = button(doc, item.title, () => {
            if (open.disabled || destroyed || !options.onShelfOpen) return;
            open.disabled = true;
            // Reserve a blank tab during the click so async durability does not lose activation.
            let pending: Window | null = null;
            try {
              pending = doc.defaultView?.open('about:blank', '_blank') ?? null;
              if (pending) {
                pending.opener = null;
                const policy = pending.document.createElement('meta'); policy.name = 'referrer'; policy.content = 'no-referrer';
                pending.document.head.append(policy);
                pending.document.body.textContent = 'Saving your return passage.';
                shelfWindows.add(pending);
              }
            } catch { pending?.close(); pending = null; }
            status.textContent = 'Saving your return passage.';
            void Promise.resolve().then(() => {
              if (destroyed) throw new Error('This saved reply has closed.');
              return options.onShelfOpen!({ blockId: block.id, itemId: item.id });
            }).then(async request => {
              const assessment = await shelfPromise!;
              if (destroyed) { pending?.close(); return; }
              const expected = assessment && prepareOpen(assessment, item.id, undefined, block.id);
              if (!expected?.ok || canonicalReplyData(expected.open) !== canonicalReplyData(request)) throw new Error('The saved reading link changed. Reopen this reply.');
              status.textContent = 'Return passage saved. This opens suggested reading.';
              if (pending && !pending.closed) {
                const destination = pending.document.createElement('a');
                destination.href = request.url; destination.target = '_self'; destination.rel = 'noopener noreferrer'; destination.referrerPolicy = 'no-referrer';
                destination.textContent = 'Open ' + item.title;
                pending.document.body.replaceChildren(destination);
                destination.click();
              } else fallback.replaceChildren(link(doc, 'Open ' + item.title, request.url));
            }).catch(error => {
              pending?.close();
              if (!destroyed) status.textContent = error instanceof Error ? error.message : 'The return passage could not be saved. Try again.';
            }).finally(() => { if (pending) shelfWindows.delete(pending); if (!destroyed) open.disabled = false; });
          });
          open.disabled = true;
          entry.append(open, el(doc, 'p', item.reason), status, fallback);
          if (item.timecodeSeconds !== undefined) entry.append(el(doc, 'p', `Start at ${formatNumber(item.timecodeSeconds)} seconds.`, 'mr-meta'));
          void shelfPromise.then(assessment => {
            if (destroyed) return;
            const allowed = assessment && prepareOpen(assessment, item.id, undefined, block.id);
            open.disabled = !allowed?.ok || !capability('network.shelf') || !options.onShelfOpen;
            status.textContent = !assessment ? 'Saved reading review is unavailable.' : !allowed?.ok ? 'This destination is unavailable or repeats another suggestion.' : !options.onShelfOpen ? 'Connect the helper to keep your return passage before opening.' : 'Ready to open on your action.';
          });
          section.append(entry);
        }
        section.append(back);
        break;
      }
      case 'samples': {
        section.append(el(doc, 'p', `Precomputed samples · ${block.envelope.interpolation} interpolation`, 'mr-meta'));
        section.append(el(doc, 'p', block.envelope.axes.map(axis => `${axis.name}: ${axis.min} to ${axis.max}, ${axis.count} samples`).join('; ')), el(doc, 'p', `Recorded error evidence: ${block.envelope.errorEvidence}`, 'mr-meta'));
        if (block.envelope.fixedInputs) section.append(el(doc, 'p', `Recorded fixed generation inputs: ${Object.entries(block.envelope.fixedInputs).map(([name, value]) => `${name} = ${formatNumber(value)}`).join('; ') || 'none'}`, 'mr-meta'));
        for (const region of block.envelope.forbiddenRegions) section.append(el(doc, 'p', `Excluded region: ${region.expression}. ${region.reason}`, 'mr-meta'));
        const current = el(doc, 'div'); current.setAttribute('aria-live', 'polite'); section.append(current);
        dynamic(() => {
          const result = calculation.samples.get(block.id); current.replaceChildren();
          if (!capability('samples')) current.append(el(doc, 'p', 'Precomputed sample interpolation is not available in this view.'));
          else if (result?.ok) current.append(pagedTable(doc, [{ key: 'name', label: 'Quantity' }, { key: 'value', label: 'Interpolated value' }], Object.entries(result.values).map(([name, value]) => ({ name, value: formatNumber(value) })), 'Current sampled values', tableView('current')), el(doc, 'p', sampleGenerationRecords[block.id]?.origin === 'imported' ? 'A matching host-owned import record binds this data to the reply. It does not claim that a solver executed.' : 'A matching host-owned execution record binds this grid to the reply and current generation inputs.', 'mr-meta'), el(doc, 'p', 'Output units are not declared by this sample block.', 'mr-meta'));
          else { const reason = result && !result.ok ? result.reason : 'No sample result is available.'; current.append(el(doc, 'p', reason)); offerRecompute(current, block.id, reason); }
        }, block.id);
        const grid = el(doc, 'details'); grid.append(el(doc, 'summary', 'Recorded sample grid')); rememberDetails(grid, `grid:${block.id}:${occurrence}`);
        const holder = el(doc, 'div'); grid.append(holder);
        const drawGrid = () => {
          const names = [...new Set(block.samples.flatMap(sample => Object.keys(sample.values)))];
          const columns = [...block.envelope.axes.map(axis => ({ key: `axis:${axis.name}`, label: axis.name, unit: reply.parameters.find(p => p.name === axis.name)?.unit })), ...names.map(name => ({ key: `value:${name}`, label: name }))];
          holder.replaceChildren(pagedTable(doc, columns, block.samples.map(sample => Object.fromEntries([...Object.entries(sample.at).map(([name, value]) => [`axis:${name}`, formatNumber(value)]), ...Object.entries(sample.values).map(([name, value]) => [`value:${name}`, formatNumber(value)])])), 'Authored samples; interpolation evidence is recorded above', tableView('grid')));
        };
        grid.addEventListener('toggle', () => { if (grid.open) drawGrid(); else holder.replaceChildren(); }); if (grid.open) drawGrid();
        section.append(grid);
        break;
      }
      case 'solver':
        section.append(el(doc, 'p', 'A saved solver can recompute this reply without a model turn. Execution requires the connected helper and its existing grants.', 'mr-meta'));
        offerRecompute(section, block.id, 'Explicit request to run the saved solver with current inputs.'); break;
      case 'media': {
        section.append(el(doc, 'p', capability(`media.${block.kind}`) ? `${block.kind[0].toUpperCase() + block.kind.slice(1)} playback is not implemented in this renderer yet. No remote media has been loaded.` : `This provider or view does not support ${block.kind}. No remote media has been loaded.`));
        if (block.alt) section.append(el(doc, 'p', block.alt));
        if (block.transcript) { const transcript = el(doc, 'details'); transcript.append(el(doc, 'summary', 'Transcript'), el(doc, 'p', block.transcript)); section.append(transcript); }
        for (const timecode of block.timecodes ?? []) section.append(el(doc, 'p', `${formatNumber(timecode.seconds)} s · ${timecode.label}`, 'mr-meta'));
        break;
      }
    }
    const wrapper = el(doc, 'div');
    const path = `/blocks/${reply.blocks.indexOf(block)}`;
    wrapper.append(section, originPanel(originParts.filter(part => part.path === path || part.path.startsWith(path + '/')), 'Where this part came from'));
    return wrapper;
  };
  const blocks = el(doc, 'div', undefined, 'mr-blocks');
  for (const block of reply.blocks) {
    if (occurrences >= 160) { blocks.append(el(doc, 'p', 'The reply reached its display limit; remaining repeated views are omitted.')); break; }
    try { blocks.append(renderBlock(block)); } catch { blocks.append(el(doc, 'p', `The ${block.type} block could not be displayed. Its content has not been executed.`)); }
  }
  // Keep the authored answer sequence intact and retain the summary for
  // textual replies before the supporting disclosures.
  article.append(blocks, summary, actions, sources, made);
  const assumptions = assumptionDetails(doc, reply.assumptions);
  if (reply.assumptions.length) rememberDetails(assumptions, 'details:assumptions');
  for (const assumption of reply.assumptions) {
    assumptions.append(el(doc, 'p', assumption.text));
    if (assumption.editable) {
      if (assumption.binding) {
        const binding = assumption.binding;
        const parameter = reply.parameters.find(candidate => candidate.name === binding.parameter);
        if (parameter) {
          const row = el(doc, 'div', undefined, 'mr-assumption');
          const label = el(doc, 'label', `${parameter.label}${parameter.unit ? ` (${parameter.unit})` : ''}`);
          const field = el(doc, 'input'); field.type = 'number'; field.id = `${prefix}-assumption-${assumption.id}`; field.min = String(binding.min); field.max = String(binding.max); field.step = 'any'; field.value = String(state.parameters[parameter.name]); field.setAttribute('data-assumption-id', assumption.id); field.setAttribute('aria-label', `Change assumption: ${assumption.text}`);
          const error = el(doc, 'p', '', 'mr-error'); error.id = `${prefix}-assumption-error-${assumption.id}`; error.setAttribute('aria-live', 'polite'); field.setAttribute('aria-describedby', error.id); label.htmlFor = field.id;
          registerParameterControl(parameter.name, () => {
            if (doc.activeElement !== field) field.value = String(state.parameters[parameter.name]);
            error.textContent = ''; field.removeAttribute('aria-invalid');
          });
          if (parameter.sourceBinding) { bindHighlight(label, parameter.sourceBinding); bindHighlight(field, parameter.sourceBinding); }
          const change = () => {
            const value = field.valueAsNumber;
            if (!Number.isFinite(value) || value < binding.min || value > binding.max) {
              error.textContent = 'That value is outside the assumption range. The previous value remains.'; field.setAttribute('aria-invalid', 'true'); announce('That value is outside the assumption range. The previous value remains.'); return;
            }
            error.textContent = ''; field.removeAttribute('aria-invalid');
            const changed = state.parameters[parameter.name] !== value;
            const wasInvalid = invalidInputs.delete(parameter.name);
            state.parameters[parameter.name] = value;
            syncParameterControls(parameter.name);
            if (changed || wasInvalid) refresh(true);
          };
          field.addEventListener('change', change); field.addEventListener('blur', change); row.append(label, field, el(doc, 'p', `Local range: ${formatNumber(binding.min)} to ${formatNumber(binding.max)}${parameter.unit ? ` ${parameter.unit}` : ''}`, 'mr-meta'), error); assumptions.append(row);
        }
      } else {
        const field = el(doc, 'textarea'); const draftKey = `assumption:${assumption.id}`; field.value = typeof state.view[draftKey] === 'string' ? state.view[draftKey] as string : assumption.text; field.maxLength = 2048; field.setAttribute('aria-label', `Change assumption: ${assumption.text}`);
        field.addEventListener('input', () => { state.view[draftKey] = field.value; persist(); });
        const revise = button(doc, 'Ask again with this assumption', () => onFollowup(`Revise assumption ${assumption.id} from "${assumption.text}" to "${field.value}". Create a new reply version.`)); revise.disabled = !options.onFollowup;
        assumptions.append(field, revise);
      }
    }
  }
  for (const limitation of reply.limitations) (reply.assumptions.length ? assumptions : made).append(el(doc, 'p', limitation, 'mr-meta'));
  if (reply.assumptions.length) article.append(assumptions);
  const followup = el(doc, 'form', undefined, 'mr-followup'); const followupLabel = el(doc, 'label', 'Follow up'); followupLabel.htmlFor = `${prefix}-followup`;
  const input = el(doc, 'textarea'); input.id = followupLabel.htmlFor; input.maxLength = 8192; input.value = typeof state.view.draft === 'string' ? state.view.draft : ''; input.placeholder = 'Ask about this reply…';
  input.addEventListener('input', () => { state.view.draft = input.value; persist(); });
  const send = el(doc, 'button', 'Ask with current inputs'); send.type = 'submit'; send.disabled = !options.onFollowup;
  followup.addEventListener('submit', event => { event.preventDefault(); onFollowup(input.value); }); followup.append(followupLabel, input, send); article.append(followup);
  if (reply.sourceBindings[0]) article.append(button(doc, 'Back to source passage', () => navigate(reply.sourceBindings[0])));
  article.append(saveStatus, status); root.append(article, dialog);
  for (const update of updates) update();
  void requestSamples();
  void requestAuthority();
  return { getState, destroy() { if (destroyed) return; destroyed = true; clearTimeout(sliderSettlement); clearTimeout(sliderAnnouncementTimer); for (const pending of shelfWindows) pending.close(); shelfWindows.clear(); ++authorityGeneration; ++samplesGeneration; clearHighlight(); if (dialog.open) dialog.close(); article.remove(); dialog.remove(); updates.length = 0; sampleUpdates.clear(); authorityUpdates.length = 0; } };
}

