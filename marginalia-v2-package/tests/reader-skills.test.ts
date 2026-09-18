import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { projectReaderSkills, authoredSkillText, captureSkillFinal, checkedUnformatted, skillOutputHash, skillReplyAllowed, validReaderSkill } from '../daemon/reader-skills.ts';
import type { ProviderHandle, ProviderHooks } from '../contracts/job-runner.ts';
import { withFixtureOrigins } from './origins-fixture.ts';
import { createCodexRuntimeFactory, type CodexRuntimeOptions } from '../daemon/jobs/runtime.ts';

const workspace = resolve('test-skills'), home = resolve('test-home');
const item = { name: 'last30days', description: 'Recent discussion', enabled: true, scope: 'user', path: resolve('test-home/skills/last30days/SKILL.md') };
const raw = (skills: unknown[] = [item]) => ({ data: [{ cwd: workspace, skills, errors: [] }] });
test('catalog projection exposes only bounded names/descriptions and metadata revision', () => {
  const result = projectReaderSkills(raw(), workspace, home);
  assert.equal(result.status, 'ready'); assert.match(result.revision!, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.skills, [{ name: item.name, description: item.description }]);
  assert.ok(!JSON.stringify(result).includes('SKILL.md'));
  assert.notEqual(projectReaderSkills(raw([{ ...item, path: item.path + 'new' }]), workspace, home).revision, result.revision);
  assert.deepEqual(projectReaderSkills(raw([{ ...item, enabled: false }]), workspace, home).skills, []);
  assert.equal(projectReaderSkills(raw([]), workspace, home).status, 'ready');
  assert.equal(projectReaderSkills(raw([{ ...item, description: 'Line one\nLine two\n' }]), workspace, home).status, 'ready');
});
test('incomplete, oversized, duplicate and hostile catalog observations fail closed', () => {
  const invalid = [
    { ...raw(), nextCursor: 'more' }, { data: [{ cwd: workspace, skills: [item], errors: ['private/path'] }] },
    { data: [...raw().data, ...raw().data] }, raw([{ ...item, name: 'x\nrun' }]), raw([{ ...item, name: 'ｘ' }]),
    raw([item, { ...item, name: 'LAST30DAYS' }]), raw([{ ...item, description: 'x'.repeat(2001) }]),
    raw(Array.from({ length: 201 }, (_, i) => ({ ...item, name: 'skill' + i }))), raw([{ ...item, path: undefined }]),
  ];
  for (const value of invalid) assert.deepEqual(projectReaderSkills(value, workspace, home), {
    schema: 'marginalia.reader-skills.v1', status: 'unavailable', revision: null, skills: [],
  });
  assert.equal(validReaderSkill({ name: 'x', catalogRevision: 'a'.repeat(64), path: '/arbitrary' }), false);
});
const handle: ProviderHandle = { jobId: 'attempt', provider: 'app-server', workspace, policyKey: 'policy', mode: 'structured-final', model: 'test', state: 'running', tombstone: false };
test('capture is bounded observation, preserves authored decoded text, and isolates hook failures', () => {
  const text = '  Original\r\n🙂 <script>unaltered</script>  ';
  const wire = JSON.stringify({ replyJson: text });
  assert.equal(authoredSkillText(wire, 'app-server'), text);
  const hooks = { captureFinalOutput: (s: string) => authoredSkillText(s, 'app-server') } as unknown as ProviderHooks;
  assert.equal(captureSkillFinal(hooks, wire, handle), text);
  for (const captureFinalOutput of [() => { throw Error('observer'); }, () => 'changed', () => Promise.resolve(text), () => 42,
    (_s: string, h: ProviderHandle) => { h.jobId = 'changed'; return text; }]) {
    assert.equal(captureSkillFinal({ captureFinalOutput } as unknown as ProviderHooks, wire, handle), undefined);
    assert.equal(handle.jobId, 'attempt');
  }
  assert.equal(authoredSkillText('x'.repeat(256 * 1024 + 1), 'raw'), undefined);
  assert.equal(authoredSkillText('\ud800', 'raw'), undefined);
  assert.equal(authoredSkillText('{"replyJson":42}', 'app-server'), undefined);
  assert.equal(authoredSkillText('{"replyJson":"x","extra":true}', 'app-server'), undefined);
  const output = { schema: 'marginalia.skill-output.v1', text, sha256: skillOutputHash(text), readerSkill: {
    name: item.name, catalogRevision: 'a'.repeat(64), execution: 'requested',
  }, reason: 'reply-validation-failed' };
  assert.deepEqual(checkedUnformatted(output), output);
  assert.equal(checkedUnformatted({ ...output, text: text.trim() }), undefined);
});
test('skill admission permits the four supported forms without checked or executable results', () => {
  const reply = withFixtureOrigins({ schema: 'marginalia.reply.v1', intent: 'unsure', status: 'complete', title: 'Skill', summary: 'Answer',
    sourceBindings: [], parameters: [], assumptions: [], limitations: [], checks: [], staticFallback: 'Answer',
    blocks: [{ type: 'text', id: 'answer', md: 'Answer' }, { type: 'table', id: 'table', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 'Text' }] },
      { type: 'citations', id: 'refs', entries: [] }, { type: 'shelf', id: 'reading', items: [] }] });
  assert.equal(skillReplyAllowed(reply), true);
  assert.equal(skillReplyAllowed({ ...reply, blocks: [{ type: 'equation', id: 'eq', tex: 'x' }] }), false);
  assert.equal(skillReplyAllowed({ ...reply, intent: 'evidence' }), false);
  assert.equal(skillReplyAllowed({ ...reply, resultClaims: [{ target: 'title', classification: 'fake' }] }), false);
});

test('catalog discovery uses only initialize and skills/list, sends no page data, and ordinary home is mandatory', async () => {
  const calls: string[] = []; let launches = 0, closed = 0;
  const options = { executable: 'fixture', codexHome: home, homeMode: 'ordinary', dispatchReady: true,
    consent: {}, authorization: {}, launch: async () => {
      launches++;
      return { request: async (method: string, params: unknown) => { calls.push(method); assert.ok(!JSON.stringify(params).includes('page text'));
        return method === 'initialize' ? { codexHome: home } : raw(); }, notify: (method: string) => { calls.push(method); },
        close: () => { closed++; } };
    } } as unknown as CodexRuntimeOptions;
  const ordinary = createCodexRuntimeFactory(options);
  assert.equal((await ordinary.readerSkills!(workspace)).status, 'ready');
  assert.deepEqual(calls, ['initialize', 'initialized', 'skills/list']); assert.equal(closed, 1);
  const dedicated = createCodexRuntimeFactory({ ...options, homeMode: 'dedicated' });
  assert.equal((await dedicated.readerSkills!(workspace)).status, 'unavailable'); assert.equal(launches, 1);
});
