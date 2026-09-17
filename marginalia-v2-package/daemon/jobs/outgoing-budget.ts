import type { ProviderJobPacket } from '../../contracts/jobs.ts';

/** Leaves headroom below T13's existing sum-of-parts limit; measures actual encoded parts,
 * including duplicated prompt/packet, JSON escaping, schema and instruction overhead. */
export const OUTGOING_PREVIEW_BYTES = 60 * 1024;
export function utf8Prefix(text: string, bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid UTF-8 budget.');
  let used = 0, result = '';
  for (const point of text) { const length = Buffer.byteLength(point); if (used + length > bytes) break; result += point; used += length; }
  return result;
}
function utf8Suffix(text: string, bytes: number): string {
  return [...utf8Prefix([...text].reverse().join(''), bytes)].reverse().join('');
}
/** Bound existing UTF-16 coordinates without manufacturing a split surrogate at an edge. */
export function prefixCharacters(text: string, limit: number): string {
  let end = Math.min(text.length, limit);
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return text.slice(0, end);
}
export function suffixCharacters(text: string, limit: number): string {
  let start = Math.max(0, text.length - limit);
  if (start > 0 && start < text.length && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start++;
  return text.slice(start);
}

type Measured = { outgoing: readonly { text: string }[] };
export function fitOutgoingPacket<T extends Measured>(original: ProviderJobPacket, build: (packet: ProviderJobPacket) => T): { packet: ProviderJobPacket; prepared: T } {
  const packet = structuredClone(original);
  const measure = () => build(packet);
  const bytes = (result: T) => result.outgoing.reduce((sum, part) => sum + Buffer.byteLength(part.text), 0);
  let prepared = measure();
  const fields: { name: string; minimum?: number; suffix?: boolean; get(): string; set(text: string): void }[] = [
    { name: 'adjacent context after', get: () => packet.adjacentContext.after, set: text => { packet.adjacentContext.after = text; } },
    { name: 'adjacent context before', suffix: true, get: () => packet.adjacentContext.before, set: text => { packet.adjacentContext.before = text; } },
    { name: 'selection prefix', suffix: true, get: () => packet.selection.prefix, set: text => { packet.selection.prefix = text; } },
    { name: 'selection suffix', get: () => packet.selection.suffix, set: text => { packet.selection.suffix = text; } },
    ...(packet.parentReply ? [{ name: 'previous generated reply', minimum: 512, get: () => packet.parentReply!.excerpt, set: (text: string) => {
      packet.parentReply!.omittedBytes += Buffer.byteLength(packet.parentReply!.excerpt) - Buffer.byteLength(text); packet.parentReply!.excerpt = text;
    } }] : []),
    ...(packet.answeredNote ? [{ name: 'answered note', minimum: 256, get: () => packet.answeredNote!.text, set: (text: string) => {
      packet.answeredNote!.text = text; packet.answeredNote!.omittedCharacters = packet.answeredNote!.originalCharacters - text.length;
    } }] : []),
    { name: 'selected passage', minimum: 256, get: () => packet.selection.exact, set: text => {
      packet.selection.exact = text; packet.selection.end = packet.selection.start + text.length;
      packet.selection.omittedCharacters = packet.selection.originalEnd - packet.selection.end;
    } },
  ];
  for (const field of fields) {
    if (bytes(prepared) <= OUTGOING_PREVIEW_BYTES) break;
    const text = field.get(), length = Buffer.byteLength(text), minimum = Math.min(length, field.minimum ?? 0);
    if (length === minimum) continue;
    const marker = packet.omissions.length;
    const set = (limit: number) => {
      const shortened = (field.suffix ? utf8Suffix : utf8Prefix)(text, limit);
      field.set(shortened);
      packet.omissions[marker] = `UTF-8 preview budget reduced ${field.name}: ${length - Buffer.byteLength(shortened)} additional bytes omitted.`;
      return measure();
    };
    prepared = set(minimum);
    if (bytes(prepared) > OUTGOING_PREVIEW_BYTES) continue;
    // Every retained candidate is measured; the final result never relies on a byte estimate.
    let lo = minimum, hi = length - 1, best = minimum;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2), candidate = set(mid);
      if (bytes(candidate) <= OUTGOING_PREVIEW_BYTES) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    prepared = set(best);
  }
  if (bytes(prepared) > OUTGOING_PREVIEW_BYTES) throw new Error('Essential context, question, schema and instructions exceed the outgoing UTF-8 budget. Nothing was prepared or sent.');
  return { packet, prepared };
}
