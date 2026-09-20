import type { QuoteAnchor, SourceCapture, SourceVersion, Thread, ReplyVersion } from '../../../contracts/reader.ts';
import { attachQuote } from '../../../contracts/reader.ts';
import { canonicalReplyData, computeIndependentChecks, validateReply, type CandidateReply } from '../../../contracts/reply.ts';
import { localPersistence } from '../../../ui/persistence.ts';
import type { JournalState } from '../../../ui/journal.ts';

export const scenarios = ['blankHome', 'noteOffers', 'marks', 'localLibrary', 'settings', 'savedReply', 'replyBack', 'movedRecovery', 'lostRecovery', 'savePage', 'readLater'] as const;
export type Scenario = typeof scenarios[number];
export const timestamp = '2026-09-20T12:00:00.000Z';
const paragraphs = [
  'A pendulum swings back and forth. Gravity pulls the bob toward its lowest point.',
  'A longer pendulum takes more time to complete a swing. Small swings make this relationship easier to compare.',
  'Friction gradually slows the motion. An ideal model leaves friction out so that one relationship can be studied at a time.',
];
const text = paragraphs.join('\n\n');
export const capture: SourceCapture = {
  url: 'https://example.test/panel-fixture/pendulum', title: 'Reading a pendulum', pageType: 'article',
  text, capturedAt: timestamp, extractionVersion: 'panel-fixture-v1',
  sections: paragraphs.map((paragraph, index) => ({ title: ['Motion', 'Timing', 'Limits'][index], start: text.indexOf(paragraph), end: text.indexOf(paragraph) + paragraph.length })),
};
export const noteText = 'Why does a longer pendulum take more time? Show the steps that connect length and timing.';
export const threadId = 'panel-fixture-thread';
export const replyId = 'panel-fixture-reply';
export function anchorFor(exact = paragraphs[0]): QuoteAnchor {
  const start = text.indexOf(exact);
  if (start < 0) throw new Error('Fixture passage is absent.');
  return { kind: 'quote', exact, start, end: start + exact.length, prefix: '', suffix: '' };
}
export function scenarioCapture(scenario: Scenario): SourceCapture {
  if (scenario === 'movedRecovery') {
    const prefix = 'A short introduction was added to this public fixture.\n\n';
    return { ...structuredClone(capture), text: prefix + text, sections: capture.sections!.map(section => ({ ...section, start: section.start + prefix.length, end: section.end + prefix.length })) };
  }
  if (scenario === 'lostRecovery') {
    const next = paragraphs.slice(1).join('\n\n');
    return { ...structuredClone(capture), text: next, sections: [{ title: 'Revised article', start: 0, end: next.length }] };
  }
  return structuredClone(capture);
}
export const reply: CandidateReply = {
  schema: 'marginalia.reply.v1', intent: 'define', status: 'complete', title: 'Why the pendulum returns',
  summary: 'Gravity pulls the bob toward its lowest point.',
  sourceBindings: [{ name: 'gravity', meaning: 'The pull described in the passage', relation: 'quoted', selector: { exact: 'Gravity pulls the bob toward its lowest point.' } }],
  parameters: [], assumptions: [], limitations: ['This saved example describes the passage qualitatively.'], checks: [],
  blocks: [{ id: 'explanation', type: 'text', md: 'When the bob moves away from its lowest point, gravity pulls it back. It passes through that point and continues to the other side.' }],
  staticFallback: 'Gravity pulls the pendulum toward its lowest point.',
};
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');

/** Seed the real local persistence contracts. No helper, browser API or job record. */
export async function seedFixture(namespace: string, scenario: Scenario) {
  if (!namespace.startsWith('marginalia-panel-fixture-v1:')) throw new Error('A fixture-only storage namespace is required.');
  const store = localPersistence(namespace);
  const thread: Thread = {
    id: threadId, anchorId: 'panel-fixture-anchor', state: 'open', revision: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    sourceVersionId: 'panel-fixture-source-version', sourceUrl: capture.url, sourceTitle: capture.title,
    anchor: anchorFor(), highlighted: true, highlightColour: 'yellow',
    notes: [{ id: 'panel-fixture-note', threadId, text: noteText, revision: 1, createdAt: timestamp, deletedAt: null }],
  };
  const seeded = ['marks', 'localLibrary', 'savedReply', 'replyBack', 'movedRecovery', 'lostRecovery'].includes(scenario);
  const journal: JournalState = { markFormat: 1, threads: seeded ? [thread] : [], pending: [], conflicts: [], resolutions: [], acknowledged: [] };
  await store.journal.save(journal);
  if (seeded) await store.write('expanded:' + capture.url, threadId);
  if (scenario === 'savedReply' || scenario === 'replyBack') {
    const checked = validateReply(reply, { sourceText: capture.text });
    if (!checked.ok) throw new Error('Invalid fixture reply: ' + checked.errors.join('; '));
    const source: SourceVersion = {
      id: thread.sourceVersionId, sourceId: 'panel-fixture-source', hash: await digest(capture.text),
      text: capture.text, capturedAt: timestamp, extractionVersion: capture.extractionVersion,
      title: capture.title, pageType: capture.pageType, metadataStatus: 'provided', sections: capture.sections,
    };
    const replyDigest = await digest(canonicalReplyData(reply));
    const version: ReplyVersion = {
      id: replyId, threadId, parentId: null, supersedes: null, reply: structuredClone(reply), hash: replyDigest,
      validation: { schema: 'marginalia.host-report.v1', checkVersion: 'host-checks.v1', replyDigest,
        parameterDigest: await digest(canonicalReplyData({})), results: computeIndependentChecks(reply, {}) },
      answeredNote: { noteId: thread.notes[0].id, revision: 1, text: noteText, createdAt: timestamp },
      createdAt: timestamp, deletedAt: null, revision: 1,
    };
    await store.replies.cache('https://example.test', threadId, source, [version], [{ replyVersionId: replyId, parameters: {}, view: {}, revision: 1, updatedAt: timestamp }]);
  }
  const currentCapture = scenarioCapture(scenario);
  const expectedAttachment = scenario === 'movedRecovery' ? 'moved' : scenario === 'lostRecovery' ? 'lost' : 'exact';
  if (attachQuote(thread.anchor, currentCapture.text).state !== expectedAttachment) throw new Error('Fixture attachment mismatch.');
  return { store, capture: currentCapture };
}

/** This host-owned slot is expressly fixture UI, not proposed Settings design. */
export function settingsFixture(): HTMLElement {
  const host = document.createElement('fieldset');
  host.dataset.fixtureHost = 'true';
  const legend = document.createElement('legend'); legend.textContent = 'Fixture host controls';
  const label = document.createElement('label'); label.textContent = 'Fixture preference ';
  const control = document.createElement('input'); control.type = 'checkbox'; control.checked = true;
  label.append(control); host.append(legend, label);
  return host;
}
