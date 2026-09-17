import type { CandidateReply, ShelfBlock } from '../../../contracts/reply.ts';
import type { ConsentScope } from '../../../contracts/consent.ts';

/**
 * T15 Explore host processing.
 *
 * The model authors a `shelf` block: three to five reasoned links to open next. A shelf is a
 * parked reading list, never an action. This module validates the shelf and produces a parked
 * descriptor plus an explicit open request builder.
 *
 * It performs no IO. Building or rendering a shelf must not fetch, navigate, download or start
 * an inference turn; keeping this module pure guarantees that structurally. Opening an item is a
 * separate, explicit host callback (`prepareOpen`) that only yields a validated browser
 * navigation request. It never pads missing links with inventions and reports thin shelves
 * honestly.
 */

export const EXPLORE_TRANSFORM = 'marginalia.transform.explore.v1' as const;

/** Product rule: a useful shelf carries three to five items. The renderer caps the array at five. */
export const EXPLORE_MIN_ITEMS = 3;
export const EXPLORE_MAX_ITEMS = 5;

export type ReturnContext = {
  sourceVersionId: string;
  anchor: { exact: string; prefix: string; suffix: string };
};

export type ExploreContext = {
  sessionScope: ConsentScope;
  /** Where reading resumes after an item is opened. Preserved, never fetched. */
  returnTo: ReturnContext;
};

export type ExploreItemAssessment = {
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

/** Defense-in-depth URL policy at the open seam: HTTPS only, no credentials, no local/private host. */
function isPublicHttpsUrl(input: string): boolean {
  let url: URL;
  try { url = new URL(input); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const octets = host.split('.').map(Number);
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || (a === 192 && b === 168) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (host.startsWith('[')) return false; // IPv6 literals are handled by the host retrieval policy, not opened here.
  return true;
}

function normalizeUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function shelfItems(reply: CandidateReply): ShelfBlock['items'] {
  const items: ShelfBlock['items'] = [];
  for (const block of reply.blocks) if (block.type === 'shelf') items.push(...block.items);
  return items;
}

/**
 * Assess an explore shelf. Pure and deterministic. Drops padded or unusable items (missing
 * reason, missing title, non-public URL, duplicate destination) and reports the count honestly.
 */
export function assessShelf(reply: CandidateReply, context: ExploreContext): ExploreAssessment {
  const issues: string[] = [];
  const raw = shelfItems(reply);
  const kept: ExploreItemAssessment[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (item.title.trim().length === 0) { issues.push(`item ${item.id}: missing title, dropped`); continue; }
    if (item.reason.trim().length === 0) { issues.push(`item ${item.id}: missing reason to open, dropped`); continue; }
    if (!isPublicHttpsUrl(item.url)) { issues.push(`item ${item.id}: URL failed the open policy, dropped`); continue; }
    const key = normalizeUrl(item.url);
    if (key === null) { issues.push(`item ${item.id}: URL could not be normalized, dropped`); continue; }
    if (seen.has(key)) { issues.push(`item ${item.id}: duplicate destination, dropped`); continue; }
    seen.add(key);
    if (kept.length >= EXPLORE_MAX_ITEMS) { issues.push(`item ${item.id}: exceeds ${EXPLORE_MAX_ITEMS}-item shelf, dropped`); continue; }
    kept.push({
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
    ? `Parked ${kept.length} reasoned item(s) to open on your action.`
    : kept.length === 0
      ? 'No authentic items to park; nothing was invented to fill the shelf.'
      : `Only ${kept.length} authentic item(s) were available, fewer than the ${EXPLORE_MIN_ITEMS} a full shelf shows.`;

  return {
    transform: EXPLORE_TRANSFORM,
    verdict,
    reason,
    sessionScope: context.sessionScope,
    parked: true,
    items: kept,
    itemCount: kept.length,
    droppedCount,
    returnTo: context.returnTo,
    issues,
  };
}

/**
 * Build the explicit open request for one parked item. This is the host callback for an
 * intentional reader action. It performs no fetch: it returns the validated navigation the host
 * browser executes, with the return-to-reading context preserved.
 */
export function prepareOpen(assessment: ExploreAssessment, itemId: string): OpenShelfItemResult {
  const item = assessment.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) return { ok: false, error: `No parked item has id ${itemId}.` };
  if (!isPublicHttpsUrl(item.url)) return { ok: false, error: `Item ${itemId} URL failed the open policy.` };
  return {
    ok: true,
    open: { url: item.url, timecodeSeconds: item.timecodeSeconds, returnTo: assessment.returnTo },
  };
}
