/**
 * Coordinates the reader's explicit "forget this page" action.
 *
 * This module deliberately owns no page data and performs no reader-store mutation. The warm
 * page service and the prepared-definition cache each receive an injected release hook. A page
 * is fenced before either hook runs, so a late stream or queued selection cannot become visible
 * after the reader has forgotten it. The coordinator does not issue provider protocol calls
 * itself. It reports the result supplied by the owner-bound warm-page hook, so map eviction is
 * never mistaken for provider-history deletion.
 */

export type InstantProviderHistory = 'deleted' | 'not-created' | 'retained' | 'unknown';
export type InstantReleaseResult = { providerHistory: InstantProviderHistory };
export type InstantReleaseHook = (principalKey: string, pageId: string) => void | InstantReleaseResult | Promise<void | InstantReleaseResult>;
export type InstantForgetHook = (principalKey: string, pageId: string) => void | Promise<void>;

export type InstantForgetPorts = {
  /** A3's warm page service. It also interrupts an active turn and resolves a pending selection. */
  release: InstantReleaseHook;
  /** A8's prepared contextual-definition cache, when auto assist is installed. */
  forgetPreparedDefinitions?: InstantForgetHook;
};

export type InstantForgetResult = {
  forgotten: true;
  alreadyForgotten: boolean;
  /** The owner-bound provider hook reports whether parked provider history was erased. */
  providerHistory: InstantProviderHistory;
};

export type InstantForgetFence = {
  readonly principalKey: string;
  readonly pageId: string;
  readonly epoch: number;
  /** False after this principal forgets this page, or when another principal is used. */
  isCurrent(): boolean;
};

type Entry = {
  epoch: number;
  forgotten: boolean;
  releaseDone: boolean;
  definitionsDone: boolean;
  providerHistory?: InstantProviderHistory;
  cleanup?: Promise<void>;
};

const IDENTIFIER_LIMIT = 2_000;

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > IDENTIFIER_LIMIT || value.includes('\0'))
    throw new Error(`Invalid ${label}.`);
  return value;
}

function invoke(hook: InstantForgetHook, principalKey: string, pageId: string): Promise<void> {
  try { return Promise.resolve(hook(principalKey, pageId)); }
  catch (error) { return Promise.reject(error); }
}

function providerHistory(value: unknown): InstantProviderHistory {
  if (value === undefined) return 'retained';
  if (value && typeof value === 'object' && 'providerHistory' in value &&
      ['deleted', 'not-created', 'retained', 'unknown'].includes(value.providerHistory as string))
    return value.providerHistory as InstantProviderHistory;
  return 'unknown';
}

function invokeRelease(hook: InstantReleaseHook, principalKey: string, pageId: string): Promise<InstantProviderHistory> {
  try { return Promise.resolve(hook(principalKey, pageId)).then(providerHistory); }
  catch (error) { return Promise.reject(error); }
}

/**
 * Build the forget coordinator. The first forget for a principal/page fences before calling
 * the ports. Concurrent requests share the same cleanup promise. If a port rejects, a later
 * explicit request retries only the unfinished hook without repeating completed work.
 */
export function createInstantForgetService(ports: InstantForgetPorts) {
  if (!ports || typeof ports.release !== 'function') throw new Error('A warm page release hook is required.');
  const pages = new Map<string, Map<string, Entry>>();

  function entry(principalKey: string, pageId: string): Entry {
    let owned = pages.get(principalKey);
    if (!owned) { owned = new Map(); pages.set(principalKey, owned); }
    let value = owned.get(pageId);
    if (!value) { value = { epoch: 0, forgotten: false, releaseDone: false, definitionsDone: ports.forgetPreparedDefinitions === undefined }; owned.set(pageId, value); }
    return value;
  }

  function fence(principalKeyInput: string, pageIdInput: string): InstantForgetFence {
    const principalKey = requireIdentifier(principalKeyInput, 'principal');
    const pageId = requireIdentifier(pageIdInput, 'page');
    const value = entry(principalKey, pageId), epoch = value.epoch;
    return { principalKey, pageId, epoch,
      isCurrent: () => pages.get(principalKey)?.get(pageId) === value && !value.forgotten && value.epoch === epoch };
  }

  function isCurrent(principalKeyInput: string, pageIdInput: string, epoch: number): boolean {
    const principalKey = requireIdentifier(principalKeyInput, 'principal');
    const pageId = requireIdentifier(pageIdInput, 'page');
    return Number.isSafeInteger(epoch) && epoch >= 0 && pages.get(principalKey)?.get(pageId)?.epoch === epoch &&
      pages.get(principalKey)?.get(pageId)?.forgotten === false;
  }

  async function forget(principalKeyInput: string, pageIdInput: string): Promise<InstantForgetResult> {
    const principalKey = requireIdentifier(principalKeyInput, 'principal');
    const pageId = requireIdentifier(pageIdInput, 'page');
    const value = entry(principalKey, pageId);
    const alreadyForgotten = value.forgotten;
    if (!value.forgotten) {
      // Fence before awaiting either hook. A late callback can observe this synchronously.
      value.forgotten = true;
      value.epoch++;
    }
    if (!value.cleanup && (!value.releaseDone || !value.definitionsDone)) {
      const failures: unknown[] = [];
      const release = value.releaseDone ? Promise.resolve() : invokeRelease(ports.release, principalKey, pageId)
        .then(result => { value.providerHistory = result; value.releaseDone = true; }).catch(error => { failures.push(error); });
      const definitions = value.definitionsDone || !ports.forgetPreparedDefinitions ? Promise.resolve() : invoke(ports.forgetPreparedDefinitions, principalKey, pageId)
        .then(() => { value.definitionsDone = true; }).catch(error => { failures.push(error); });
      const attempt = Promise.all([release, definitions]).then(() => {
        if (failures.length) throw failures[0];
      });
      value.cleanup = attempt.finally(() => {
        if (!value.releaseDone || !value.definitionsDone) value.cleanup = undefined;
      });
    }
    await value.cleanup;
    return { forgotten: true, alreadyForgotten, providerHistory: value.providerHistory ?? 'unknown' };
  }

  return { fence, isCurrent, forget };
}

export type InstantForgetService = ReturnType<typeof createInstantForgetService>;
