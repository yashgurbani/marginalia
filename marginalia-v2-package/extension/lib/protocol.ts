import { isHighlightColour, validPublicationDate, type HighlightColour, type QuoteAnchor, type SourceCapture, type SourceSection } from '../../contracts/reader.ts';
export const MAX_TEXT = 1_000_000;
export const MAX_QUOTE = 20_000;
export const MAX_CONTEXT = 40;
export type Section = SourceSection;
export type Snapshot = { document: string; capture: SourceCapture; sections: Section[]; anchor: QuoteAnchor | null; position: number; revision: number };
export type SavedMark = { anchor: QuoteAnchor; highlighted: boolean; highlightColour?: HighlightColour };
export type SavedMarks = { document: string; url: string; revision: number; marks: SavedMark[] };
/** Only bounded source selectors cross into the page; never notes or credentials. */
export function validSavedMarks(value: unknown): value is SavedMarks {
  if (!record(value) || !text(value.document, 64) || !value.document || !allowedPage(value.url) || !integer(value.revision, Number.MAX_SAFE_INTEGER) || !Array.isArray(value.marks) || value.marks.length > 500) return false;
  let size = 0;
  return value.marks.every(mark => {
    if (!record(mark) || typeof mark.highlighted !== 'boolean' || (mark.highlightColour !== undefined && !isHighlightColour(mark.highlightColour)) || !validAnchor(mark.anchor) || mark.anchor.kind === 'whole-page') return false;
    size += mark.anchor.exact.length + mark.anchor.prefix.length + mark.anchor.suffix.length;
    return size <= 1_000_000;
  });
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const integer = (v: unknown, max = MAX_TEXT): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
function validSections(v: unknown, sourceLength: number, maxCount: number, maxTitle: number): v is SourceSection[] {
  if (!Array.isArray(v) || !v.length || v.length > maxCount) return false;
  let previousEnd = 0;
  for (const section of v) {
    if (!record(section) || !text(section.title, maxTitle) || !section.title || !integer(section.start, sourceLength) || !integer(section.end, sourceLength) || section.start < previousEnd || section.end <= section.start) return false;
    previousEnd = section.end;
  }
  return true;
}
export function allowedPage(value: unknown, excluded: string[] = []): boolean {
  if (!text(value, 8192)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !excluded.some(host => url.hostname === host || url.hostname.endsWith('.' + host)); } catch { return false; }
}
export function pageIdentity(url: string): string { const parsed = new URL(url); parsed.hash = ''; return parsed.href; }
export function validAnchor(v: unknown, source?: string): v is QuoteAnchor {
  if (!record(v) || !text(v.exact, MAX_TEXT) || !text(v.prefix, MAX_CONTEXT) || !text(v.suffix, MAX_CONTEXT) || !integer(v.start) || !integer(v.end) || (v.kind !== undefined && v.kind !== 'quote' && v.kind !== 'section' && v.kind !== 'whole-page')) return false;
  if (v.kind === 'whole-page') return v.exact === '' && v.prefix === '' && v.suffix === '' && v.start === 0 && v.end === 0;
  // The reader contract treats a missing kind as a legacy anchor. T05 uses that
  // form for section navigation, so it shares the bounded source-size ceiling.
  if (!v.exact || v.end <= v.start || v.end - v.start !== v.exact.length) return false;
  if (v.kind === 'quote' && v.exact.length > MAX_QUOTE) return false;
  return source === undefined || (source.slice(v.start, v.end) === v.exact && source.slice(Math.max(0, v.start - v.prefix.length), v.start) === v.prefix && source.slice(v.end, v.end + v.suffix.length) === v.suffix);
}
export function validSnapshot(v: unknown): v is Snapshot {
  if (!record(v) || !text(v.document, 64) || !v.document || !record(v.capture) || !integer(v.position) || !integer(v.revision, Number.MAX_SAFE_INTEGER)) return false;
  const c = v.capture;
  if (!allowedPage(c.url) || !text(c.title, 500) || !text(c.pageType, 80) || !text(c.text, MAX_TEXT) || !text(c.capturedAt, 40) || !Number.isFinite(Date.parse(c.capturedAt)) || c.extractionVersion !== 'dom-safe-text-v1' || v.position > c.text.length) return false;
  for (const field of ['author', 'venue'] as const) if (c[field] !== undefined && (!text(c[field], 500) || !c[field].trim() || c[field] !== c[field].trim() || /[\u0000-\u001f\u007f]/.test(c[field]))) return false;
  if (c.publicationDate !== undefined && !validPublicationDate(c.publicationDate)) return false;
  if (!validSections(v.sections, c.text.length, 300, 200)) return false;
  const sections = v.sections;
  if (c.sections !== undefined && (!validSections(c.sections, c.text.length, 2000, 1000) || c.sections.length !== sections.length || c.sections.some((section, index) => {
    const outer = sections[index];
    return section.title !== outer.title || section.start !== outer.start || section.end !== outer.end;
  }))) return false;
  return v.anchor === null || validAnchor(v.anchor, c.text);
}
export function isMessage(v: unknown, type: string): v is Record<string, unknown> { return record(v) && v.type === type && v.version === 1; }
