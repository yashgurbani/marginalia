import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrequencyPageScorer, MAX_PAGE_CHARS, getLocalJargonEvidence, isExplicitlyFamiliar, selectAutoAssistCandidates, createAutoAssistController, paintAutoAssistMarks, candidateAtOffset, AUTO_ASSIST_CSS } from '../extension/lib/auto-assist/index.ts';
import type { DifficultyInput, DifficultyCandidate, DifficultyScorer } from '../contracts/auto-assist.ts';
const input = (text: string): DifficultyInput => ({ pageKeyHash: 'opaque-page', text, sections: [], language: 'en-US' });
const score = (text: string, language = 'en') => new FrequencyPageScorer().scorePage({ ...input(text), language }, new AbortController().signal);
const scoreWithSections = (text: string, sections: DifficultyInput['sections'], language = 'en') => new FrequencyPageScorer().scorePage({ ...input(text), sections, language }, new AbortController().signal);
const candidate = (text: string, start: number, term: string, score = 0.8): DifficultyCandidate => ({ candidateId: `${start}`, term, normalizedTerm: term.toLowerCase(), start, end: start + term.length, score, reasons: [] });

test('frequency proxy preserves UTF16 offsets, filters common words/URLs/code/citations, and never claims surprisal', async () => {
  const text = '😀 the photosynthesis photosynthesis https://photosynthesis.example `electromagnetism` [electromagnetism]';
  const found = await score(text);
  assert.equal(found.length, 2);
  for (const c of found) { assert.equal(text.slice(c.start, c.end), c.term); assert.equal(c.surprisalBits, undefined); }
  assert.equal(found[0].start, 7);
});
test('local field evidence admits short terms, acronym expansions, and phrases with exact UTF16 spans', async () => {
  const text = '😀 Quantum chromodynamics (QCD) is a field theory. Vorticity means local rotation in a fluid. The boundary layer is a thin region near a surface.';
  const found = await new FrequencyPageScorer().scorePage({ ...input(text), sections: [{ title: 'Quantum chromodynamics', start: 0, end: text.length }] }, new AbortController().signal);
  const phrase = found.find(c => c.term === 'Quantum chromodynamics');
  const acronym = found.find(c => c.term === 'QCD');
  const defined = found.find(c => c.term === 'boundary layer');
  assert.ok(phrase); assert.ok(acronym); assert.ok(defined);
  for (const candidate of [phrase, acronym, defined]) {
    assert.equal(text.slice(candidate.start, candidate.end), candidate.term);
    assert.equal(candidate.surprisalBits, undefined);
  }
  assert.ok(getLocalJargonEvidence(acronym).some(e => e.kind === 'acronym-expansion' && e.generated === false));
  const literal = getLocalJargonEvidence(defined).find(e => e.kind === 'literal-definition');
  assert.ok(literal && literal.generated === false);
  if (literal?.kind === 'literal-definition') {
    assert.equal(text.slice(literal.start, literal.end), literal.term);
    assert.equal(text.slice(literal.quoteStart, literal.quoteEnd), literal.quote);
    assert.match(literal.quote, /boundary layer is a thin region/u);
  }
  const titledText = 'Boundary layer surrounds the inlet.';
  const titled = await scoreWithSections(titledText, [{ title: 'Boundary layer', start: 0, end: titledText.length }]);
  assert.ok(titled.some(c => c.term === 'Boundary layer' && c.reasons.includes('title')));
});
test('equal-density technical/plain fixture records useful, missed, and distracting local terms honestly', async () => {
  const technical = 'Quantum chromodynamics (QCD) is a field theory. The boundary layer is a thin region near a surface. Navier-Stokes Navier-Stokes. Spin glass appears once.';
  const plain = 'The people read the same words every day. They know how to make their work useful. The people read the words again.';
  const placement = (candidate: DifficultyCandidate) => ({ band: Math.floor(candidate.start / 25), top: candidate.start * 100, block: String(candidate.start) });
  const technicalCandidates = await score(technical);
  const plainCandidates = await score(plain);
  const technicalSelected = selectAutoAssistCandidates(input(technical), technicalCandidates, { enabled: true, excluded: false, posture: 'learning', vocabulary: [], placement });
  const plainSelected = selectAutoAssistCandidates(input(plain), plainCandidates, { enabled: true, excluded: false, posture: 'learning', vocabulary: [], placement });
  const report = {
    useful: technicalSelected.filter(c => ['qcd', 'boundary layer'].includes(c.normalizedTerm)).map(c => c.normalizedTerm),
    missed: ['spin glass'].filter(term => !technicalSelected.some(c => c.normalizedTerm === term)),
    distracting: technicalSelected.filter(c => c.normalizedTerm === 'navier-stokes').map(c => c.normalizedTerm),
    plain: plainSelected.map(c => c.normalizedTerm),
  };
  assert.ok(report.useful.includes('qcd'));
  assert.ok(report.useful.includes('boundary layer'));
  assert.deepEqual(report.missed, ['spin glass']);
  assert.ok(report.distracting.length >= 1);
  assert.deepEqual(report.plain, []);
});
test('familiarity is explicit and exact, never inferred from related words or repetition', () => {
  const text = 'Vorticity vorticity';
  const term = candidate(text, 0, 'Vorticity');
  assert.equal(isExplicitlyFamiliar(term, []), false);
  assert.equal(isExplicitlyFamiliar(term, ['vorticity']), true);
  assert.equal(isExplicitlyFamiliar(term, ['vortex']), false);
});
test('English declaration, hard page bound, and cancellation fail closed', async () => {
  assert.deepEqual(await score('photosynthesis photosynthesis', 'de'), []);
  assert.deepEqual(await score('photosynthesis photosynthesis', ''), []);
  assert.deepEqual(await score('x'.repeat(MAX_PAGE_CHARS + 1)), []);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(new FrequencyPageScorer().scorePage(input('photosynthesis'), abort.signal), { name: 'AbortError' });
});
test('200k character scoring is bounded and yields to cancellation', async () => {
  const text = 'photosynthesis electromagnetism '.repeat(5000);
  const started = performance.now(); const found = await score(text);
  assert.ok(found.length <= 2000); assert.ok(performance.now() - started < 5000);
  const abort = new AbortController(); const pending = new FrequencyPageScorer().scorePage(input(text), abort.signal); abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
test('posture enforces 1/2/3 per rendered band, page caps, dedup, vocabulary and 80px spacing', () => {
  const words = Array.from({ length: 40 }, (_, i) => `technical${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`);
  const text = words.join(' '); const candidates = words.map(w => candidate(text, text.indexOf(w), w));
  for (const [posture, count] of [['flow', 1], ['balanced', 2], ['learning', 3]] as const) {
    const result = selectAutoAssistCandidates(input(text), candidates, { enabled: true, excluded: false, posture, vocabulary: [words[0].toUpperCase()], placement: c => ({ band: 0, top: c.start * 10, block: 'a' }) });
    assert.equal(result.length, count); assert.ok(result.every(c => c.term !== words[0]));
  }
  const policy = { enabled: true, excluded: false, posture: 'flow' as const, vocabulary: [], placement: (c: DifficultyCandidate) => ({ band: c.start, top: c.start, block: String(c.start) }) };
  assert.equal(selectAutoAssistCandidates(input(text), candidates, policy).length, 12);
  assert.equal(selectAutoAssistCandidates(input(text), candidates, { ...policy, placement: () => ({ band: 0, top: 10, block: 'same' }) }).length, 1);
  assert.deepEqual(selectAutoAssistCandidates(input(text), candidates, { ...policy, excluded: true }), []);
});
test('stale generations, exclusion before scoring, dismissal, and vocabulary deletion', async () => {
  let resolve!: (c: readonly DifficultyCandidate[]) => void; let calls = 0; const paints: readonly DifficultyCandidate[][] = []; const writable = paints as DifficultyCandidate[][];
  const scorer: DifficultyScorer = { method: 'frequency-page-v0', version: 'fake', scorePage: () => { calls++; return new Promise(r => { resolve = r; }); } };
  const observations: unknown[] = [];
  const controller = createAutoAssistController({ scorer, onMarks: c => writable.push([...c]), onDismiss: async o => { observations.push(o); } });
  const policy = { enabled: true, excluded: false, posture: 'balanced' as const, vocabulary: [], placement: () => ({ band: 0, top: 0, block: 'a' }) };
  const page = input('photosynthesis'); const c = candidate(page.text, 0, page.text);
  const stale = controller.update(page, policy); controller.clear(); resolve([c]); await stale; assert.deepEqual(paints.at(-1), []);
  await controller.update(page, { ...policy, excluded: true }); assert.equal(calls, 1);
  const fresh = controller.update(page, policy); resolve([c]); await fresh;
  await controller.dismiss('Photosynthesis'); assert.deepEqual(paints.at(-1), []); assert.equal((observations[0] as { origin: string }).origin, 'stated');
  const dismissed = controller.update(page, policy); resolve([c]); await dismissed; assert.deepEqual(paints.at(-1), []);
  controller.forgetDismissal('photosynthesis'); const restored = controller.update(page, policy); resolve([c]); await restored; assert.equal(paints.at(-1)?.length, 1);
});
test('CSS paint only uses its registry, keeps reader priority senior, never mutates source, and provides no focus stealing', () => {
  const registry = new Map<string, { priority: number }>([['marginalia-kept', { priority: 0 }], ['marginalia-selection', { priority: 0 }]]);
  const range = Object.freeze({}) as Range;
  let count = 0;
  assert.equal(paintAutoAssistMarks(registry, (...ranges) => { count = ranges.length; return { priority: 9 }; }, Array(50).fill(range)), true);
  assert.equal(count, 30); assert.equal(registry.get('marginalia-auto-assist')?.priority, 0); assert.equal(registry.get('marginalia-kept')?.priority, 10); assert.equal(registry.get('marginalia-selection')?.priority, 30);
  paintAutoAssistMarks(registry, undefined, []); assert.equal(registry.has('marginalia-auto-assist'), false); assert.equal(registry.has('marginalia-kept'), true);
  assert.doesNotMatch(AUTO_ASSIST_CSS, /background|opacity/); assert.equal(candidateAtOffset([{ start: 2, end: 6 }], 6), undefined); assert.deepEqual(candidateAtOffset([{ start: 2, end: 6 }], 2), { start: 2, end: 6 });
});

test('quote anchors are bounded and reject detached or forged offsets', async () => {
  const { autoAssistAnchor } = await import('../extension/lib/auto-assist/anchors.ts');
  const text = 'The viscosity slows flow.'; const c = candidate(text, 4, 'viscosity');
  assert.deepEqual(autoAssistAnchor(text, c), { kind: 'quote', exact: 'viscosity', start: 4, end: 13, prefix: 'The ', suffix: ' slows flow.' });
  assert.equal(autoAssistAnchor(text, { ...c, start: 5 }), null);
});

test('normal prose does not become a blanket of underlines and repeat terms deduplicate', async () => {
  const prose = 'The people read the same words every day. They know how to make their work useful. The people read the words again.';
  assert.deepEqual(await score(prose), []);
  const text = 'photosynthesis photosynthesis electromagnetism'; const candidates = await score(text);
  const result = selectAutoAssistCandidates(input(text), candidates, { enabled: true, excluded: false, posture: 'learning', vocabulary: [], placement: c => ({ band: 0, top: c.start * 100, block: String(c.start) }) });
  assert.equal(result.filter(c => c.normalizedTerm === 'photosynthesis').length, 1);
  const overlap = candidate(text, 0, 'photosynthesis photosynthesis', 1);
  const merged = selectAutoAssistCandidates(input(text), [overlap, ...candidates], { enabled: true, excluded: false, posture: 'learning', vocabulary: [], placement: c => ({ band: 0, top: c.start * 100, block: String(c.start) }) });
  assert.equal(merged.some(c => c.term === 'photosynthesis'), false);
});

test('failed dismissal restores marks, coalesces duplicates, and preserves another successful dismissal', async () => {
  const page = input('photosynthesis electromagnetism');
  const candidates = [candidate(page.text, 0, 'photosynthesis'), candidate(page.text, 15, 'electromagnetism')];
  let marks: readonly DifficultyCandidate[] = [], calls = 0;
  let rejectFirst!: (error: Error) => void;
  const scorer: DifficultyScorer = { method: 'frequency-page-v0', version: 'fake', scorePage: async () => candidates };
  const controller = createAutoAssistController({ scorer, onMarks: next => { marks = next; }, onDismiss: observation => {
    calls++;
    return observation.term.toLowerCase() === 'photosynthesis' ? new Promise<void>((_, reject) => { rejectFirst = reject; }) : Promise.resolve();
  } });
  const policy = { enabled: true, excluded: false, posture: 'learning' as const, vocabulary: [], placement: (c: DifficultyCandidate) => ({ band: 0, top: c.start * 100, block: String(c.start) }) };
  await controller.update(page, policy);
  const first = controller.dismiss('photosynthesis'), duplicate = controller.dismiss('Photosynthesis');
  const firstRejected = assert.rejects(first, /save failed/), duplicateRejected = assert.rejects(duplicate, /save failed/);
  await controller.dismiss('electromagnetism');
  rejectFirst(new Error('save failed')); await Promise.all([firstRejected, duplicateRejected]);
  assert.equal(calls, 2); assert.deepEqual(marks.map(c => c.term), ['photosynthesis']);
  await controller.update(page, policy); assert.deepEqual(marks.map(c => c.term), ['photosynthesis']);
});

test('late dismissal failure after clear cannot restore stale marks', async () => {
  const page = input('photosynthesis'); let marks: readonly DifficultyCandidate[] = [];
  let rejectSave!: (error: Error) => void;
  const controller = createAutoAssistController({ scorer: { method: 'frequency-page-v0', version: 'fake', scorePage: async () => [candidate(page.text, 0, page.text)] }, onMarks: next => { marks = next; }, onDismiss: () => new Promise<void>((_, reject) => { rejectSave = reject; }) });
  await controller.update(page, { enabled: true, excluded: false, posture: 'flow', vocabulary: [], placement: () => ({ band: 0, top: 0, block: 'a' }) });
  const pending = controller.dismiss(page.text); const rejected = assert.rejects(pending, /offline/);
  await Promise.resolve(); controller.clear(); rejectSave(new Error('offline')); await rejected;
  assert.deepEqual(marks, []);
});

test('R2 definition nomination respects line starts, leading space, punctuation and emoji', async () => {
  for (const prefix of ['Introduction\n', 'Introduction\r\n', '  ', 'Intro: ', 'Intro:', '😀 ', 'Introduction\n  😀 ']) {
    for (const term of ['Qubit', 'Boundary layer']) {
      const text = `${prefix}${term} is a unit of quantum information.`;
      const found = await score(text);
      const defined = found.find(c => c.term === term && c.reasons.includes('literal-definition'));
      assert.ok(defined, JSON.stringify(text));
      assert.ok(!found.some(c => /[\r\n]/u.test(c.term)), JSON.stringify(found));
      assert.equal(text.slice(defined.start, defined.end), term);
      const evidence = getLocalJargonEvidence(defined).find(e => e.kind === 'literal-definition');
      assert.ok(evidence?.kind === 'literal-definition');
      assert.equal(text.slice(evidence.quoteStart, evidence.quoteEnd), evidence.quote);
    }
  }
  assert.ok(!(await score('one two three four five is an explicitly named concept.')).some(c => c.reasons.includes('literal-definition')));
});

test('R3 title and heading evidence do not invent repetition or its score increase', async () => {
  for (const prefix of ['', 'Intro. ']) {
    const once = `${prefix}Boundary layer surrounds the inlet.`;
    const sections = [{ title: 'Boundary layer', start: prefix.length, end: once.length }];
    if (prefix) sections.unshift({ title: 'Intro', start: 0, end: prefix.length });
    const one = (await scoreWithSections(once, sections)).find(c => c.term === 'Boundary layer');
    assert.ok(one);
    assert.ok(one.reasons.includes(prefix ? 'heading' : 'title'));
    assert.ok(!one.reasons.includes('page-repeated'));
    assert.ok(!getLocalJargonEvidence(one).some(e => e.kind === 'repetition'));
    const twice = `${once} Boundary layer surrounds the outlet.`;
    const two = (await scoreWithSections(twice, sections)).find(c => c.term === 'Boundary layer');
    assert.ok(two);
    assert.ok(two.reasons.includes('page-repeated'));
    assert.ok(getLocalJargonEvidence(two).some(e => e.kind === 'repetition'));
    assert.equal(two.score, Math.min(1, one.score + 0.25));
  }
});

test('acronym expansion rejects arbitrary subsequences while preserving QCD in both directions', async () => {
  for (const text of ['We enjoy warm summer (ARM) afternoons.', 'The national institute (NO) was closed.']) {
    assert.ok(!(await score(text)).some(c => getLocalJargonEvidence(c).some(e => e.kind === 'acronym-expansion')), text);
  }
  for (const text of ['Quantum chromodynamics (QCD) describes quarks.', 'QCD (quantum chromodynamics) describes quarks.']) {
    const found = await score(text);
    for (const term of ['qcd', 'quantum chromodynamics']) assert.ok(found.some(c => c.normalizedTerm === term && c.reasons.includes('acronym-expansion')), term);
  }
});
