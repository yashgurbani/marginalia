globalThis.window = { dispatchEvent() {}, addEventListener() {} };
const core = await import('../../../../../src/state.js');
const vault = await import('../../../../../src/vault.js');
const figure = await import('../../../../../src/figure.js');
const graph = await import('../../../../../src/graph.js');
await import('../../../../../src/tools.js');
const failures = [];
const ok = (value, label) => { if (!value) failures.push(label); };
core.loadDoc([
  { id: 's1', heading: 'Setup', text: 'For charge $Ze$, the path has $r^{-2}$ dependence.' },
  { id: 's2', heading: 'Scattering', text: 'Gold foil produces rare large-angle scattering.' },
], { id: 'doc', title: 'Doc', attribution: 'Test', license: 'CC0' });
const frozenBefore = JSON.stringify(core.state.doc);
ok(Object.isFrozen(core.state.doc.sections[0]), 'source is frozen');
const tools = globalThis.window.marginaliaTools;
ok(Object.keys(tools).length === 9, 'nine tools');
const empty = await tools.search_notes.execute({ query: 'gold', limit: 5 });
ok(empty.ok && empty.detail === 'no vault loaded' && empty.results.length === 0, 'honest empty vault');
const indexed = vault.indexMarkdownEntries([
  { path: 'physics/rutherford.md', text: '# Rutherford notes\nGold foil scattering and atomic nucleus geometry.' },
  { path: 'physics/coulomb.md', text: '# Coulomb law\nInverse square force and electrostatic potential.' },
  { path: 'ignore.txt', text: 'not markdown' },
]);
ok(indexed.ok && indexed.file_count === 2, 'two markdown notes indexed');
const found = await tools.search_notes.execute({ query: 'gold scattering', limit: 5 });
ok(found.ok && found.results[0]?.path === 'physics/rutherford.md' && typeof found.results[0]?.score === 'number', 'ranked local search');
ok(found.paths.includes('physics/rutherford.md'), 'returned paths included');
const badTarget = await tools.annotate.execute({ section_id: 's2', kind: 'connection', target: 'physics/not-returned.md', relation: 'bridge', reason: 'Should not attach an unseen note.' });
ok(!badTarget.ok && badTarget.error === 'precondition_failed', 'unseen note target rejected');
const badRelation = await tools.annotate.execute({ section_id: 's2', kind: 'connection', target: 'physics/rutherford.md', relation: 'similar', reason: 'Unsupported relation should fail.' });
ok(!badRelation.ok, 'unsupported relation rejected');
const connected = await tools.annotate.execute({ section_id: 's2', kind: 'connection', target: 'physics/rutherford.md', relation: 'bridge', reason: 'The note explains the same gold-foil evidence.' });
ok(connected.ok && connected.artifact.author === 'agent' && connected.artifact.target === 'physics/rutherford.md', 'valid connection artifact');
const malicious = '<svg width="20" height="10" onload="bad()"><script>bad()</script><foreignObject>x</foreignObject><image href="https://bad.example/x"/><circle cx="5" cy="5" r="2"/></svg>';
const fig = await tools.insert_figure.execute({ section_id: 's2', svg: malicious, caption: 'Safe geometry', reason: 'Shows the scattering path.' });
ok(fig.ok && /viewBox=/.test(fig.artifact.svg) && !/script|onload|foreignObject|https:/i.test(fig.artifact.svg), 'svg sanitized and bounded');
const graphData = graph.getConnectionGraphData(core.state, vault.getVaultState());
ok(graphData.nodes.length === 2 && graphData.edges.length === 1 && graphData.edges[0].data.relation === 'bridge', 'graph derives from artifacts');
ok(JSON.stringify(core.state.doc) === frozenBefore, 'source unchanged');
ok(core.state.activity.some((entry) => entry.toolName === 'search_notes' && entry.summary.includes('physics/rutherford.md')), 'activity records returned path');
console.log(failures.length ? `FAIL ${failures.length}\n${failures.join('\n')}` : 'ALL PASS');
process.exit(failures.length ? 1 : 0);
