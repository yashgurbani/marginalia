import { skillProvenance } from '../reader-skills.ts';
import type { FrozenJobContext, ProviderJobPacket, StartJobInput } from '../../contracts/jobs.ts';
import type { QuoteAnchor, SourceVersion } from '../../contracts/reader.ts';
import { prefixCharacters, suffixCharacters } from './outgoing-budget.ts';

export function buildProviderPacket(input: StartJobInput, anchor: QuoteAnchor, source: SourceVersion, url: string, title: string, answeredNote?: FrozenJobContext['answeredNote']): ProviderJobPacket {
  const CONTEXT_LIMIT = 12_000;
  const selectionText = prefixCharacters(anchor.exact, 4_000);
  const noteText = answeredNote ? prefixCharacters(answeredNote.text, 4_000) : undefined;
  const beforeAvailable = source.text.slice(0, anchor.start);
  const afterAvailable = source.text.slice(anchor.end);
  let before: string, after: string, basis: 'section-adjacent-context' | 'bounded-character-context' | 'whole-page-opening';
  if (anchor.kind === 'whole-page') {
    before = ''; after = prefixCharacters(source.text.slice(selectionText.length), CONTEXT_LIMIT); basis = 'whole-page-opening';
  } else if (source.sections?.length) {
    const first = source.sections.findIndex(section => anchor.start < section.end && anchor.end > section.start);
    const last = source.sections.findLastIndex(section => anchor.start < section.end && anchor.end > section.start);
    if (first >= 0 && last >= first) {
      const rangeStart = source.sections[Math.max(0, first - 1)].start;
      const rangeEnd = source.sections[Math.min(source.sections.length - 1, last + 1)].end;
      const availableBefore = source.text.slice(rangeStart, anchor.start);
      const availableAfter = source.text.slice(anchor.end, rangeEnd);
      const beforeLimit = Math.min(availableBefore.length, Math.floor(CONTEXT_LIMIT / 2));
      before = suffixCharacters(availableBefore, beforeLimit);
      after = prefixCharacters(availableAfter, CONTEXT_LIMIT - before.length);
      basis = 'section-adjacent-context';
    } else {
      const beforeLimit = Math.floor(CONTEXT_LIMIT / 2);
      before = suffixCharacters(beforeAvailable, beforeLimit); after = prefixCharacters(afterAvailable, CONTEXT_LIMIT - before.length); basis = 'bounded-character-context';
    }
  } else {
    const beforeLimit = Math.floor(CONTEXT_LIMIT / 2);
    before = suffixCharacters(beforeAvailable, beforeLimit);
    after = prefixCharacters(afterAvailable, CONTEXT_LIMIT - before.length);
    basis = 'bounded-character-context';
  }
  const omissions = [
    'The full captured page is retained locally for validation and is not included in this provider packet.',
    'No vocabulary or library matches were included because no scoped host-owned matches were supplied for this request.',
  ];
  if (basis === 'bounded-character-context') omissions.push('Section boundaries were not available for this passage, so adjacent context is a bounded character window.');
  if (beforeAvailable.length > before.length || afterAvailable.length > after.length) omissions.push('Adjacent source text outside the 12,000-character bound was omitted.');
  if (basis === 'whole-page-opening' && source.text.length > selectionText.length + after.length) omissions.push('The captured page beyond the bounded 16,000-character opening was omitted from provider context.');
  if (selectionText.length < anchor.exact.length) omissions.push(`The selected-passage field was deterministically bounded to its first 4,000 characters; ${anchor.exact.length - selectionText.length} trailing characters (${anchor.start + selectionText.length}-${anchor.end}) were omitted from that field.`);
  if (answeredNote && noteText!.length < answeredNote.text.length) omissions.push(`The answered note was deterministically bounded to its first 4,000 characters; ${answeredNote.text.length - noteText!.length} trailing characters were omitted from provider context.`);
  return {
    schema: 'marginalia.job-packet.v1' as const,
    ...(input.readerSkill ? { readerSkill: skillProvenance(input.readerSkill) } : {}),
    intent: input.intent,
    question: input.question,
    source: { url, title, pageType: source.pageType,
      capturedAt: source.capturedAt, sourceHash: source.hash, sourceVersionId: source.id },
    selection: { exact: selectionText, prefix: anchor.prefix, suffix: anchor.suffix, start: anchor.start,
      end: anchor.start + selectionText.length, originalEnd: anchor.end, omittedCharacters: anchor.exact.length - selectionText.length },
    adjacentContext: { before, after, basis },
    ...(answeredNote ? { answeredNote: { noteId: answeredNote.noteId, revision: answeredNote.revision, text: noteText!,
      originalCharacters: answeredNote.text.length, omittedCharacters: answeredNote.text.length - noteText!.length } } : {}),
    ...(input.parentReplyId ? { parentReplyId: input.parentReplyId } : {}),
    availableCapabilities: input.capabilities ?? [],
    omissions,
  };
}
