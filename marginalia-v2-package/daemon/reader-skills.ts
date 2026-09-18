import type { ProviderHandle, ProviderHooks } from '../contracts/job-runner.ts';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { canonicalReplyData, type CandidateReply } from '../contracts/reply.ts';
import type { ReaderSkillSelection, ReaderSkillProvenance, ReaderSkillsCatalog, UnformattedSkillOutput } from '../contracts/reader-skills.ts';
import { isDigest } from '../contracts/digest.ts';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** Only metadata from a complete, exact-workspace observation. Never loads a skill file. */
export function projectReaderSkills(raw: unknown, workspace: string, home: string): ReaderSkillsCatalog {
  if (!record(raw) || !Array.isArray(raw.data) || raw.nextCursor || raw.next_cursor) return unavailableSkills();
  const entries = raw.data.filter((e: unknown) => record(e) && typeof e.cwd === 'string' && resolve(e.cwd) === resolve(workspace));
  if (entries.length !== 1) return unavailableSkills();
  const entry = entries[0];
  if (!Array.isArray(entry.skills) || entry.skills.length > 200 || !Array.isArray(entry.errors) || entry.errors.length || entry.nextCursor || entry.next_cursor) return unavailableSkills();
  const names = new Set<string>(), skills: ReaderSkillsCatalog['skills'] = [], identities: unknown[] = [];
  for (const skill of entry.skills) {
    if (!record(skill) || !validSkillName(skill.name) || typeof skill.description !== 'string' || skill.description.length > 2000 ||
        /[\p{Cf}\p{Cs}\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(skill.description) || typeof skill.enabled !== 'boolean' ||
        !['user', 'repo', 'system', 'admin'].includes(skill.scope) || typeof skill.path !== 'string' || !skill.path) return unavailableSkills();
    const key = skill.name.normalize('NFKC').toLowerCase();
    if (names.has(key)) return unavailableSkills();
    names.add(key);
    identities.push([skill.name, skill.description, skill.enabled, skill.scope, skill.path]);
    if (skill.enabled) skills.push({ name: skill.name, description: skill.description });
  }
  skills.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  identities.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { schema: 'marginalia.reader-skills.v1', status: 'ready', revision: hash(canonicalReplyData([resolve(home), identities])), skills };
}
export function skillReplyAllowed(reply: CandidateReply): boolean {
  return reply.intent === 'unsure' && !reply.resultClaims?.length && reply.checks.length === 0 && reply.parameters.length === 0 &&
    reply.blocks.every(block => ['text', 'table', 'citations', 'shelf'].includes(block.type));
}
/** Decode only a recognized transport envelope. Never repair/re-serialize authored data. */
export function authoredSkillText(text: unknown, provider: string): string | undefined {
  if (typeof text !== 'string' || !text.length || Buffer.byteLength(text, 'utf8') > READER_SKILL_OUTPUT_BYTES * 6 + 64 || Buffer.from(text, 'utf8').toString('utf8') !== text) return;
  if (provider === 'app-server') {
    let value: unknown;
    try { value = JSON.parse(text); } catch { /* Plain final text is retained verbatim. */ }
    if (record(value) && Object.hasOwn(value, 'replyJson')) {
      if (Object.keys(value).length !== 1 || typeof value.replyJson !== 'string') return;
      text = value.replyJson;
    }
  }
  return typeof text === 'string' && text.length > 0 && Buffer.from(text, 'utf8').toString('utf8') === text && Buffer.byteLength(text, 'utf8') <= READER_SKILL_OUTPUT_BYTES ? text : undefined;
}
export function checkedUnformatted(value: unknown): UnformattedSkillOutput | undefined {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'readerSkill,reason,schema,sha256,text' ||
      value.schema !== 'marginalia.skill-output.v1' || value.reason !== 'reply-validation-failed' ||
      !validReaderSkill(value.readerSkill, true) || authoredSkillText(value.text, 'raw') !== value.text || hash(value.text) !== value.sha256) return;
  return structuredClone(value) as UnformattedSkillOutput;
}
export const skillOutputHash = hash;

export const READER_SKILL_TIMEOUT_MS = 900_000;
export const READER_SKILL_OUTPUT_BYTES = 256 * 1024;
const controls = /[\p{Cc}\p{Cf}\p{Cs}]/u;
export function validSkillName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value &&
    value.normalize('NFKC') === value && !controls.test(value);
}
export function validReaderSkill(value: unknown, provenance: true): value is ReaderSkillProvenance;
export function validReaderSkill(value: unknown, provenance?: false): value is ReaderSkillSelection;
export function validReaderSkill(value: unknown, provenance = false): value is ReaderSkillSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(key => ['name', 'catalogRevision', ...(provenance ? ['execution'] : [])].includes(key)) &&
    validSkillName(v.name) && isDigest(v.catalogRevision) && (!provenance || v.execution === 'requested');
}
export function skillProvenance(selection: ReaderSkillSelection): ReaderSkillProvenance {
  return { name: selection.name, catalogRevision: selection.catalogRevision, execution: 'requested' };
}
export function unavailableSkills(): ReaderSkillsCatalog {
  return { schema: 'marginalia.reader-skills.v1', status: 'unavailable', revision: null, skills: [] };
}

/** Observation cannot mutate adapter identity, change admission bytes, or change terminal status. */
export function captureSkillFinal(hooks: ProviderHooks, text: unknown, handle: Readonly<ProviderHandle>): string | undefined {
  if (typeof text !== 'string') return;
  const snapshot = Object.freeze(structuredClone(handle));
  try {
    const value: unknown = hooks.captureFinalOutput?.(text, snapshot);
    if (typeof value !== 'string') {
      // Never await/admit async observation, but handle rejected promises/thenables
      // so a broken observer cannot terminate an otherwise valid provider turn.
      if (value && (typeof value === 'object' || typeof value === 'function')) void Promise.resolve(value).catch(() => {});
      return;
    }
    return value === authoredSkillText(text, snapshot.provider) ? value : undefined;
  } catch { return; }
}
export function rejectedSkillOutput(handle: ProviderHandle | undefined): boolean {
  return !!handle && handle.state === 'failed' && handle.reason === 'invalid-or-missing-final-output';
}
