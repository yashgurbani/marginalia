import { mountReply } from '../index.ts';
import '../../ui/tokens.css';
import type { CandidateReply } from '../../contracts/reply.ts';

export function mountSliderProbe(delayedAuthority = false) {
  document.body.replaceChildren();
  const root = document.createElement('main'); document.body.append(root);
  const reply: CandidateReply = {
    schema: 'marginalia.reply.v1', intent: 'define', status: 'complete', title: 'Local input', summary: 'Keyboard fixture.',
    sourceBindings: [], parameters: [{ name: 'x', label: 'Input', default: 0.5, min: 0, max: 1, unit: '' }], assumptions: [{ id: 'input-range', text: 'Input range', editable: true, binding: { parameter: 'x', min: 0, max: 1 } }], limitations: [], checks: [], requiredCapabilities: [], staticFallback: 'Input from zero to one.', blocks: [{ id: 'text', type: 'text', md: 'Change the local input.' }],
  };
  if (delayedAuthority) {
    reply.intent = 'simulate'; reply.assumptions = [];
    reply.illustration = { value: true, statement: 'Synthetic scalar fixture.' };
    reply.parameters = [
      { name: 'gamma', label: 'Damping', default: 0.5, min: 0, max: 2, unit: '1/s' },
      { name: 'f', label: 'Forcing', default: 0.07, min: 0, max: 1, unit: '1/s^2' },
      { name: 'y0', label: 'Start', default: 0, min: -2, max: 2, unit: '1/s' },
    ];
    reply.blocks = [
      { id: 'model', type: 'model', kind: 'ode', state: ['y'], rhs: { y: 'y^2-gamma*y+f' }, initial: { y: 'y0' }, horizon: 8, method: 'rk45', maxSteps: 2000 },
      { id: 'classification', type: 'classification', model: 'model', headline: true, rule: 'growth-v1', check: 'growth', labels: {} },
    ];
    reply.checks = [{ id: 'growth', criterion: 'growth-v1', model: 'model', classification: 'classification', inputs: { gamma: 'gamma', f: 'f', y0: 'y0' } }];
  }
  let authorityCalls = 0;
  const mounted = mountReply(root, reply, { sourceText: '', ...(delayedAuthority ? { resolveHostReport: async () => {
    authorityCalls++;
    await new Promise<void>(resolve => setTimeout(resolve, 600));
    throw new Error('Controlled delayed authority refusal.');
  } } : {}) });
  const announcements: string[] = [];
  const live = root.querySelector('.mr-status')!;
  const observer = new MutationObserver(() => { if (live.textContent) announcements.push(live.textContent); });
  observer.observe(live, { childList: true, subtree: true, characterData: true });
  const probe = {
    announcements,
    authorityCalls: () => authorityCalls,
    value: () => mounted.getState().parameters.x,
    reset: () => { announcements.length = 0; },
    unmount: () => mounted.destroy(),
    destroy: () => { mounted.destroy(); observer.disconnect(); },
  };
  Object.assign(globalThis, { p17Slider: probe });
}
