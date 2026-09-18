import test from 'node:test';
import assert from 'node:assert/strict';
import { instantReadRequest } from '../extension/lib/instant-read-request.ts';

test('instant prerequisites map only explicit read routes and retain complete encoded queries', () => {
  for (const [from, to] of [['/api/instant/settings', '/api/read/instant/settings'], ['/api/settings/auto-assist', '/api/read/settings/auto-assist'], ['/api/vocabulary', '/api/read/vocabulary'], ['/api/ambient/policy', '/api/read/ambient/policy']]) {
    assert.deepEqual(instantReadRequest(from), { path: to, body: {} });
    assert.deepEqual(instantReadRequest(from + '?sourceUrl=https%3A%2F%2Fa.test%2F%3Fx%3D1%26y%3D2&type=Article&trigger=ambient'), { path: to + '?sourceUrl=https%3A%2F%2Fa.test%2F%3Fx%3D1%26y%3D2&type=Article&trigger=ambient', body: {} });
    const change = { enabled: false, expectedRevision: 3 };
    assert.deepEqual(instantReadRequest(from, change), { path: from, body: change });
    assert.deepEqual(instantReadRequest(from, {}), { path: from, body: {} });
  }
  for (const path of ['/api/instant/settings/extra', '/api/instant/settings#fragment', '/api/instant/prepare', '/api/instant/select', '/api/instant/forget', '/api/vocabulary/observe', 'https://foreign.test/api/vocabulary', '//foreign.test/api/vocabulary']) {
    assert.deepEqual(instantReadRequest(path), { path, body: undefined });
  }
});
