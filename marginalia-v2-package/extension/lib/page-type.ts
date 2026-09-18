export type PageType = 'paper' | 'docs' | 'article' | 'social' | 'reference' | 'unknown';

export type PageTypeInput = {
  hostname: string;
  path: string;
  openGraphType?: string | null;
  schemaTypes?: readonly string[];
  citationMetaTags?: readonly string[];
  hasArticleElement?: boolean;
  codeBlockCount?: number;
  headingDepth?: number;
  hasReferencesSection?: boolean;
  hasFeedMarkup?: boolean;
  hasThreadMarkup?: boolean;
};

export type PageTypeDetection = { type: PageType; signals: string[] };

const HOST_HINTS: readonly { suffix: string; type: Exclude<PageType, 'unknown'> }[] = [
  { suffix: 'arxiv.org', type: 'paper' },
  { suffix: 'wikipedia.org', type: 'reference' },
];

type Evidence = { type: Exclude<PageType, 'unknown'>; strength: number; signal: string };

function typeName(value: string) {
  return value.trim().toLowerCase().split(/[\/#]/).filter(Boolean).at(-1) ?? '';
}

function add(evidence: Evidence[], type: Evidence['type'], strength: number, signal: string) {
  if (!evidence.some(item => item.type === type && item.signal === signal)) evidence.push({ type, strength, signal });
}

/** Classifies already-observed page structure. It reads no prose and performs no I/O. */
export function detectPageType(input: PageTypeInput): PageTypeDetection {
  const evidence: Evidence[] = [];
  const schemaTypes = new Set((input.schemaTypes ?? []).map(typeName));
  const openGraphType = typeName(input.openGraphType ?? '');
  const citationTags = new Set((input.citationMetaTags ?? []).map(value => value.trim().toLowerCase()).filter(Boolean));

  if (schemaTypes.has('scholarlyarticle')) add(evidence, 'paper', 3, 'schema:ScholarlyArticle');
  if (citationTags.size >= 2) add(evidence, 'paper', 3, 'citation-meta:multiple');
  if (schemaTypes.has('apireference')) add(evidence, 'docs', 3, 'schema:APIReference');
  if (schemaTypes.has('techarticle')) add(evidence, 'docs', 3, 'schema:TechArticle');
  if (schemaTypes.has('newsarticle')) add(evidence, 'article', 3, 'schema:NewsArticle');
  if (schemaTypes.has('blogposting')) add(evidence, 'article', 3, 'schema:BlogPosting');
  if (schemaTypes.has('socialmediaposting')) add(evidence, 'social', 3, 'schema:SocialMediaPosting');
  if (schemaTypes.has('discussionforumposting')) add(evidence, 'social', 3, 'schema:DiscussionForumPosting');
  if (input.hasThreadMarkup) add(evidence, 'social', 3, 'markup:thread');
  if (schemaTypes.has('definedtermset')) add(evidence, 'reference', 3, 'schema:DefinedTermSet');

  if (openGraphType === 'article' && input.hasArticleElement) add(evidence, 'article', 2, 'og:article+element:article');
  if ((input.codeBlockCount ?? 0) >= 2 && (input.headingDepth ?? 0) >= 2) add(evidence, 'docs', 2, 'structure:code+headings');
  if (input.hasFeedMarkup) add(evidence, 'social', 2, 'markup:feed');
  if (input.hasReferencesSection && (input.headingDepth ?? 0) >= 2) add(evidence, 'reference', 2, 'structure:references+headings');

  if (evidence.length) {
    const strength = Math.max(...evidence.map(item => item.strength));
    const deciding = evidence.filter(item => item.strength === strength);
    const types = new Set(deciding.map(item => item.type));
    if (types.size === 1) return { type: deciding[0].type, signals: deciding.map(item => item.signal) };
    return { type: 'unknown', signals: deciding.map(item => `conflict:${item.type}:${item.signal}`) };
  }

  const hostname = input.hostname.trim().toLowerCase().replace(/\.$/, '');
  const host = HOST_HINTS.find(hint => hostname === hint.suffix || hostname.endsWith('.' + hint.suffix));
  if (host) return { type: host.type, signals: [`host:${host.suffix}`] };
  return { type: 'unknown', signals: ['no-decisive-signal'] };
}
