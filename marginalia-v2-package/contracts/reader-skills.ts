export type ReaderSkillSelection = { name: string; catalogRevision: string };
export type ReaderSkillProvenance = ReaderSkillSelection & { execution: 'requested' };
export type ReaderSkillsCatalog = {
  schema: 'marginalia.reader-skills.v1';
  status: 'ready' | 'unavailable';
  revision: string | null;
  skills: { name: string; description: string }[];
};
export type UnformattedSkillOutput = {
  schema: 'marginalia.skill-output.v1';
  text: string;
  sha256: string;
  readerSkill: ReaderSkillProvenance;
  reason: 'reply-validation-failed';
};
