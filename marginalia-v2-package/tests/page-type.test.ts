import test from 'node:test';
import assert from 'node:assert/strict';
import { pageTypeInput } from '../extension/lib/capture.ts';
import { detectPageType, type PageType } from '../extension/lib/page-type.ts';
import { suggestionPage } from '../ui/suggestion-policy.ts';

type FixtureElement = {
  tagName: string;
  textContent: string;
  getAttribute(name: string): string | null;
};

function fixtureDocument(markup: string) {
  const elements: FixtureElement[] = [];
  const tags = /<(meta|script|article|pre|code|h[1-6]|section|div)\b([^>]*)>/gi;
  for (const match of markup.matchAll(tags)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[2].matchAll(/([\w:@-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? '');
    const tagName = match[1].toUpperCase();
    const close = tagName === 'SCRIPT' ? markup.slice((match.index ?? 0) + match[0].length).match(/^([\s\S]*?)<\/script\s*>/i) : null;
    elements.push({ tagName, textContent: close?.[1] ?? '', getAttribute: name => attributes.get(name.toLowerCase()) ?? null });
  }
  function matches(element: FixtureElement, selector: string) {
    if (/^[a-z][a-z0-9]*$/i.test(selector)) return element.tagName === selector.toUpperCase();
    const tagged = /^([a-z]+)\[([\w-]+)="([^"]+)"\]$/i.exec(selector);
    if (tagged) return element.tagName === tagged[1].toUpperCase() && element.getAttribute(tagged[2]) === tagged[3];
    const exact = /^\[([\w-]+)="([^"]+)"\]$/.exec(selector);
    if (exact) return element.getAttribute(exact[1]) === exact[2];
    const word = /^\[([\w-]+)~="([^"]+)"\]$/.exec(selector);
    if (word) return (element.getAttribute(word[1]) ?? '').split(/\s+/).includes(word[2]);
    const suffix = /^\[([\w-]+)\$="([^"]+)"\]$/.exec(selector);
    if (suffix) return (element.getAttribute(suffix[1]) ?? '').endsWith(suffix[2]);
    const present = /^\[([\w-]+)\]$/.exec(selector);
    return !!present && element.getAttribute(present[1]) !== null;
  }
  const querySelectorAll = (selector: string) => elements.filter(element => selector.split(',').some(part => matches(element, part.trim())));
  return { querySelectorAll, querySelector: (selector: string) => querySelectorAll(selector)[0] ?? null } as unknown as Pick<Document, 'querySelector' | 'querySelectorAll'>;
}

const fixtures: readonly { name: string; url: string; markup: string; expected: PageType; signals: readonly string[] }[] = [
  { name: 'arXiv abstract', url: 'https://arxiv.org/abs/2609.00001', markup: '<script type="application/ld+json">{"@type":"ScholarlyArticle"}</script><article></article>', expected: 'paper', signals: ['schema:ScholarlyArticle'] },
  { name: 'journal article', url: 'https://journal.example/paper', markup: '<meta property="og:type" content="article"><meta name="citation_title" content="Study"><meta name="citation_author" content="Author"><article></article>', expected: 'paper', signals: ['citation-meta:multiple'] },
  { name: 'API reference', url: 'https://developer.example/api/widget', markup: '<script type="application/ld+json">{"@type":"https://schema.org/APIReference"}</script><code></code>', expected: 'docs', signals: ['schema:APIReference'] },
  { name: 'code tutorial', url: 'https://guides.example/start', markup: '<h1></h1><h2></h2><pre></pre><pre></pre>', expected: 'docs', signals: ['structure:code+headings'] },
  { name: 'news article', url: 'https://news.example/story', markup: '<script type="application/ld+json">{"@type":"NewsArticle"}</script><article></article>', expected: 'article', signals: ['schema:NewsArticle'] },
  { name: 'blog post', url: 'https://blog.example/post', markup: '<meta property="og:type" content="article"><article></article>', expected: 'article', signals: ['og:article+element:article'] },
  { name: 'social thread', url: 'https://social.example/t/1', markup: '<article data-thread-id="1"></article>', expected: 'social', signals: ['markup:thread'] },
  { name: 'social feed', url: 'https://social.example/feed', markup: '<section role="feed"></section>', expected: 'social', signals: ['markup:feed'] },
  { name: 'encyclopedia entry', url: 'https://en.wikipedia.org/wiki/Entropy', markup: '<h1></h1>', expected: 'reference', signals: ['host:wikipedia.org'] },
  { name: 'glossary reference', url: 'https://reference.example/terms', markup: '<script type="application/ld+json">{"@type":"DefinedTermSet"}</script>', expected: 'reference', signals: ['schema:DefinedTermSet'] },
  { name: 'bare page', url: 'https://example.org/plain', markup: '<div></div>', expected: 'unknown', signals: ['no-decisive-signal'] },
  { name: 'conflicting scholarly thread', url: 'https://example.org/mixed', markup: '<meta name="citation_title" content="Study"><meta name="citation_author" content="Author"><article data-thread-id="1"></article>', expected: 'unknown', signals: ['conflict:paper:citation-meta:multiple', 'conflict:social:markup:thread'] },
];

for (const fixture of fixtures) test(`page type fixture: ${fixture.name}`, () => {
  const url = new URL(fixture.url);
  const result = detectPageType(pageTypeInput(fixtureDocument(fixture.markup), { hostname: url.hostname, pathname: url.pathname } as Location));
  assert.equal(result.type, fixture.expected);
  assert.deepEqual(result.signals, fixture.signals);
});

test('page type detection performs no request and logs no page text', t => {
  const previousFetch = globalThis.fetch, previousLog = console.log;
  let requests = 0;
  const logs: unknown[][] = [];
  globalThis.fetch = (() => { requests++; throw new Error('Unexpected request'); }) as typeof fetch;
  console.log = (...values: unknown[]) => { logs.push(values); };
  t.after(() => { globalThis.fetch = previousFetch; console.log = previousLog; });
  const source = fixtureDocument('<article>private page prose that must stay local</article>');
  const result = detectPageType(pageTypeInput(source, { hostname: 'example.org', pathname: '/private' } as Location));
  assert.equal(result.type, 'unknown');
  assert.equal(requests, 0);
  assert.deepEqual(logs, []);
});

test('suggestion page maps detected and legacy capture values to contract keys', () => {
  for (const type of ['paper', 'docs', 'article', 'social', 'reference'] as const) assert.equal(suggestionPage(type), type);
  assert.equal(suggestionPage('Paper'), 'paper');
  assert.equal(suggestionPage('Web page'), 'unknown');
  assert.equal(suggestionPage(null), 'unknown');
});
