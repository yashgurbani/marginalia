import type { CandidateReply } from './reply.ts';
import type { ConsentScope } from './consent.ts';

/**
 * T15 Explore host processing.
 *
 * The model authors a `shelf` block: three to five reasoned links to open next. A shelf is a
 * parked reading list, never an action. This module validates the shelf and produces a parked
 * descriptor plus an explicit open request builder.
 *
 * It performs no IO. Building or rendering a shelf must not fetch, navigate, download or start
 * an inference turn; keeping this module pure guarantees that structurally. Opening an item is a
 * separate, explicit host callback (`prepareOpen`) that yields a browser navigation request from
 * a validated saved shelf. It never pads missing links and reports thin shelves honestly.
 */

export const EXPLORE_TRANSFORM = 'marginalia.transform.explore.v1' as const;

/** Product rule: a useful shelf carries three to five items. The renderer caps the array at five. */
export const EXPLORE_MIN_ITEMS = 3;
export const EXPLORE_MAX_ITEMS = 5;

export type ReturnContext = {
  sourceVersionId: string;
  /** Present on host-persisted shelves; absent on older pure-helper fixtures. */
  threadId?: string;
  sourceHash?: string;
  sourceUrl?: string;
  anchor: { exact: string; prefix: string; suffix: string };
};

export type ExploreContext = {
  sessionScope: ConsentScope;
  /** Where reading resumes after an item is opened. Preserved, never fetched. */
  returnTo: ReturnContext;
};

export type ExploreItemAssessment = {
  blockId: string;
  id: string;
  title: string;
  reason: string;
  url: string;
  timecodeSeconds: number | null;
  /** A shelf item is a model-suggested link. It is not a fetched or host-verified resource. */
  provenance: 'model-suggested';
  parked: true;
};

export type ExploreVerdict = 'ready' | 'insufficient';

export type ExploreAssessment = {
  transform: typeof EXPLORE_TRANSFORM;
  verdict: ExploreVerdict;
  reason: string;
  sessionScope: ConsentScope;
  /** The whole shelf is parked. No retrieval, navigation or inference was performed. */
  parked: true;
  items: readonly ExploreItemAssessment[];
  itemCount: number;
  droppedCount: number;
  returnTo: ReturnContext;
  issues: readonly string[];
};

export type OpenShelfItemRequest = {
  url: string;
  timecodeSeconds: number | null;
  returnTo: ReturnContext;
};

export type OpenShelfItemResult =
  | { ok: true; open: OpenShelfItemRequest }
  | { ok: false; error: string };

function privateIpv4(parts: readonly number[]): boolean {
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a === 192 && b === 168 ||
    a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 100 && b >= 64 && b <= 127;
}

/** URL supplies canonical bracketed IPv6 hostnames, including mapped IPv4 as hex words. */
function privateIpv6(host: string): boolean {
  const halves = host.slice(1, -1).split('::');
  const words = (part: string) => part ? part.split(':').map(word => Number.parseInt(word, 16)) : [];
  const left = words(halves[0]);
  const right = halves.length === 2 ? words(halves[1]) : [];
  const address = halves.length === 2 ? [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right] : left;
  if (address.length !== 8 || address.some(word => !Number.isInteger(word) || word < 0 || word > 0xffff)) return true;
  if (address.slice(0, 7).every(word => word === 0) && address[7] <= 1) return true;
  if ((address[0] & 0xfe00) === 0xfc00 || (address[0] & 0xffc0) === 0xfe80) return true;
  if (address.slice(0, 5).every(word => word === 0) && address[5] === 0xffff)
    return privateIpv4([address[6] >>> 8, address[6] & 255, address[7] >>> 8, address[7] & 255]);
  return false;
}

/** Match the existing reply navigation policy; browser opening does not use broker fetch rules. */
export function isPublicHttpsUrl(input: string): boolean {
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.startsWith('[')) return !privateIpv6(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !privateIpv4(host.split('.').map(Number));
  return true;
}

function normalizeUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return url.href;
  } catch {
    return null;
  }
}

function shelfItems(reply: CandidateReply) {
  return reply.blocks.flatMap(block => block.type === 'shelf' ? block.items.map(item => ({ ...item, blockId: block.id })) : []);
}

function validReturnContext(value: unknown): value is ReturnContext {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReturnContext>;
  if (typeof candidate.sourceVersionId !== 'string' || candidate.sourceVersionId.trim().length === 0) return false;
  const anchor = candidate.anchor;
  return typeof anchor === 'object' && anchor !== null &&
    typeof anchor.exact === 'string' && typeof anchor.prefix === 'string' && typeof anchor.suffix === 'string';
}

function validOpenItem(value: unknown, itemId: string): value is ExploreItemAssessment {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<ExploreItemAssessment>;
  return item.id === itemId && item.parked === true && item.provenance === 'model-suggested' &&
    typeof item.title === 'string' && item.title.trim().length > 0 &&
    typeof item.reason === 'string' && item.reason.trim().length > 0 &&
    typeof item.url === 'string' &&
    (item.timecodeSeconds === null ||
      typeof item.timecodeSeconds === 'number' && Number.isFinite(item.timecodeSeconds) &&
      item.timecodeSeconds >= 0 && item.timecodeSeconds <= 100_000_000);
}

/**
 * Assess an explore shelf. Pure and deterministic for a given input. Drops unusable items (missing
 * reason, missing title, non-public URL, duplicate destination) and reports the count honestly.
 */
export function assessShelf(reply: CandidateReply, context: ExploreContext): ExploreAssessment {
  const issues: string[] = [];
  const raw = shelfItems(reply);
  const kept: ExploreItemAssessment[] = [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();

  for (const item of raw) {
    if (item.title.trim().length === 0) { issues.push(`item ${item.id}: missing title, dropped`); continue; }
    if (item.reason.trim().length === 0) { issues.push(`item ${item.id}: missing reason to open, dropped`); continue; }
    if (seenIds.has(item.id)) { issues.push(`item ${item.id}: duplicate id, dropped`); continue; }
    if (!isPublicHttpsUrl(item.url)) { issues.push(`item ${item.id}: URL failed the open policy, dropped`); continue; }
    const key = normalizeUrl(item.url);
    if (key === null) { issues.push(`item ${item.id}: URL could not be normalized, dropped`); continue; }
    if (seen.has(key)) { issues.push(`item ${item.id}: duplicate destination, dropped`); continue; }
    seen.add(key);
    seenIds.add(item.id);
    if (kept.length >= EXPLORE_MAX_ITEMS) { issues.push(`item ${item.id}: exceeds ${EXPLORE_MAX_ITEMS}-item shelf, dropped`); continue; }
    kept.push({
      blockId: item.blockId,
      id: item.id,
      title: item.title,
      reason: item.reason,
      url: item.url,
      timecodeSeconds: item.timecodeSeconds ?? null,
      provenance: 'model-suggested',
      parked: true,
    });
  }

  const droppedCount = raw.length - kept.length;
  const ready = kept.length >= EXPLORE_MIN_ITEMS && kept.length <= EXPLORE_MAX_ITEMS;
  const verdict: ExploreVerdict = ready ? 'ready' : 'insufficient';
  const reason = ready
    ? `Saved ${kept.length} reasoned item(s) to read later.`
    : kept.length === 0
      ? 'No suggested links to save for later; nothing was invented to fill the shelf.'
      : `Only ${kept.length} suggested link(s) were available, fewer than the ${EXPLORE_MIN_ITEMS} a full shelf shows.`;

  return {
    transform: EXPLORE_TRANSFORM,
    verdict,
    reason,
    sessionScope: context.sessionScope,
    parked: true,
    items: kept,
    itemCount: kept.length,
    droppedCount,
    returnTo: structuredClone(context.returnTo),
    issues,
  };
}

/**
 * Build the explicit open request for one parked item. This is the host callback for an
 * intentional reader action. It performs no fetch: it returns the validated navigation the host
 * browser executes, with the return-to-reading context preserved.
 */
export function prepareOpen(
  assessment: ExploreAssessment,
  itemId: string,
  _currentReturnTo?: ReturnContext,
  blockId?: string,
): OpenShelfItemResult {
  if (assessment.transform !== EXPLORE_TRANSFORM || assessment.parked !== true ||
      !Array.isArray(assessment.items) || !validReturnContext(assessment.returnTo))
    return { ok: false, error: 'Shelf data is not a valid saved Explore assessment.' };
  const item = assessment.items.find((candidate) => validOpenItem(candidate, itemId) && (blockId === undefined || candidate.blockId === blockId));
  if (item === undefined) return { ok: false, error: `No saved item has id ${itemId}.` };
  if (!isPublicHttpsUrl(item.url)) return { ok: false, error: `Item ${itemId} URL failed the open policy.` };
  return {
    ok: true,
    open: { url: item.url, timecodeSeconds: item.timecodeSeconds, returnTo: structuredClone(assessment.returnTo) },
  };
}
