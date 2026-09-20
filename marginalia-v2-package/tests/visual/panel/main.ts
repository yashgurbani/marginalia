import { mountMargin } from '../../../ui/margin.ts';
import '../../../ui/tokens.css';
import '../../../ui/margin.css';
import '../../../extension/entrypoints/panel/panel.css';
import { scenarios, type Scenario, seedFixture, settingsFixture, anchorFor, noteText, threadId, replyId } from './fixtures.ts';

type Controller = Awaited<ReturnType<typeof mountMargin>>;
type Receipt = { scenario: Scenario; namespace: string; evidence: 'fixture-controller'; theme: string; width: string; sourceActions: unknown[] };

/** Browser capture waits on ready (or data-capture-ready), never an arbitrary delay. */
export function createPanelHarness(root: HTMLElement, identity: HTMLElement) {
  let controller: Controller | undefined;
  let activeReceipt: Receipt | undefined;
  let sequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const session = crypto.randomUUID();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.catch(() => {}).then(run); tail = next; return next;
  };
  async function stop() {
    root.dataset.captureReady = 'false';
    if (controller) {
      await controller.drain(); controller.destroy(); await controller.drain(); controller = undefined;
    }
    if (root.querySelector('.m-workspace')) throw new Error('Destroyed controller left its workspace mounted.');
    root.replaceChildren();
  }
  function press(label: string) {
    const control = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label && !node.disabled && !node.closest('[hidden]'));
    if (!control) throw new Error('Fixture cannot reach control: ' + label);
    control.click();
  }
  function requireSurface(selector: string) {
    const surface = root.querySelector<HTMLElement>(selector);
    if (!surface || surface.closest('[hidden]')) throw new Error('Fixture surface is unavailable: ' + selector);
    return surface;
  }
  async function start(scenario: Scenario): Promise<Receipt> {
    if (!scenarios.includes(scenario)) throw new Error('Unknown panel fixture scenario: ' + scenario);
    await stop();
    delete root.dataset.captureError;
    // Production persistence retains document-scoped caches and open IDB handles.
    // Fresh namespaces reset safely without erasing another mount's data.
    const namespace = `marginalia-panel-fixture-v1:${session}:${++sequence}:${scenario}`;
    const fixture = await seedFixture(namespace, scenario);
    const sourceActions: unknown[] = [];
    controller = await mountMargin(root, {
      capture: fixture.capture, sections: fixture.capture.sections, storageName: namespace,
      initialOpen: true, allowHelper: false, suggestionEligibility: ['define', 'derive', 'instantiate', 'diagram'],
      settingsContent: scenario === 'settings' ? settingsFixture() : undefined,
      onSource: anchor => { sourceActions.push(structuredClone(anchor)); },
    });
    await controller.drain();
    requireSurface('.m-head');
    if (scenario === 'noteOffers') {
      if (!await controller.selectionAction('note', anchorFor())) throw new Error('Note action was not accepted.');
      const field = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your note"]');
      if (!field) throw new Error('Actual note editor is absent.');
      field.value = noteText; field.dispatchEvent(new Event('input', { bubbles: true }));
      await controller.drain();
      if (!root.querySelector('.m-note-offers button')) throw new Error('Actual note offers did not finish ranking.');
      const journal = await fixture.store.journal.load();
      if (!journal?.threads.some(thread => thread.notes.some(note => note.text === noteText))) throw new Error('Continuous note was not durably saved.');
    }
    if (scenario === 'localLibrary') { press('Library'); requireSurface('.m-local-library'); }
    if (scenario === 'settings') { press('Settings'); requireSurface('.m-settings'); }
    if (scenario === 'marks' || scenario === 'movedRecovery' || scenario === 'lostRecovery') {
      controller.focusThread(threadId); await controller.drain();
      requireSurface('[data-thread="' + threadId + '"]');
      if (scenario.endsWith('Recovery')) requireSurface('.m-attachment-status');
    }
    if (scenario === 'savedReply' || scenario === 'replyBack') {
      // Drain includes asynchronous cache loading and the actual renderer import.
      await controller.drain();
      await controller.openThread(threadId); await controller.drain();
      requireSurface('.m-reply-frame');
      requireSurface('[data-reply-version="' + replyId + '"]');
      if (scenario === 'replyBack') {
        press('Back'); await controller.drain();
        if (!root.querySelector<HTMLElement>('.m-reply-frame')?.hidden) throw new Error('Back did not restore Home.');
        if ((await fixture.store.replies.list(threadId)).length !== 1) throw new Error('Saved reply was not retained.');
      }
    }
    if (scenario === 'savePage') {
      press('Save page'); await controller.drain();
      const journal = await fixture.store.journal.load();
      if (!journal?.threads.some(thread => thread.anchor.kind === 'whole-page')) throw new Error('Save page was not durable.');
    }
    if (scenario === 'readLater' && !await controller.readLater()) throw new Error('Read later was not durable.');
    await controller.drain();
    if (document.fonts) await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    activeReceipt = { scenario, namespace, evidence: 'fixture-controller', theme: document.documentElement.dataset.theme ?? 'system', width: root.style.width || '100%', sourceActions };
    identity.textContent = JSON.stringify(activeReceipt);
    root.dataset.scenario = scenario; root.dataset.captureReady = 'true';
    return activeReceipt;
  }
  const run = (scenario: Scenario) => serialize(async () => {
    try { return await start(scenario); }
    catch (error) {
      root.dataset.captureReady = 'false'; root.dataset.captureError = error instanceof Error ? error.message : String(error);
      identity.textContent = root.dataset.captureError; throw error;
    }
  });
  return {
    scenarios, run, reset: (scenario: Scenario = activeReceipt?.scenario ?? 'blankHome') => run(scenario),
    destroy: () => serialize(stop), get receipt() { return activeReceipt; },
  };
}

const root = document.querySelector<HTMLElement>('#margin');
const identity = document.querySelector<HTMLElement>('#fixture-identity');
if (!root || !identity) throw new Error('Panel fixture mount roots are absent.');
const params = new URLSearchParams(location.search);
const requested = params.get('scenario') ?? 'blankHome';
if (!scenarios.includes(requested as Scenario)) throw new Error('Unknown scenario. Choose: ' + scenarios.join(', '));
const theme = params.get('theme') ?? 'light';
if (!['light', 'dark', 'system'].includes(theme)) throw new Error('Theme must be light, dark or system.');
if (theme !== 'system') document.documentElement.dataset.theme = theme;
const width = params.get('width');
if (width !== null) {
  if (!/^\d+$/.test(width) || Number(width) < 240 || Number(width) > 1600) throw new Error('Host width must be 240–1600 CSS pixels.');
  root.style.width = width + 'px'; root.style.maxWidth = '100%';
}
const harness = createPanelHarness(root, identity);
const captureHarness = Object.assign(harness, { ready: Promise.resolve<Receipt | undefined>(undefined) });
declare global { interface Window { marginaliaPanelCapture: typeof captureHarness } }
window.marginaliaPanelCapture = captureHarness;
captureHarness.ready = harness.run(requested as Scenario);
// The explicit rejection and data-capture-error remain observable to the runner.
void captureHarness.ready.catch(error => console.error('Panel fixture failed:', error));
