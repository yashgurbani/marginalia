import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../extension/wxt.config.ts';

test('public panel embedding permits HTTP(S) ancestors without widening executable or exposed resources', () => {
  const manifest = config.manifest as { content_security_policy: { extension_pages: string }; web_accessible_resources: unknown };
  const directives = new Map(manifest.content_security_policy.extension_pages.split(';').map(value => {
    const [name, ...sources] = value.trim().split(/\s+/); return [name, sources];
  }));
  assert.deepEqual(directives.get('frame-ancestors'), ['http:', 'https:']);
  assert.deepEqual(directives.get('default-src'), ["'none'"]);
  assert.deepEqual(directives.get('script-src'), ["'self'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('base-uri'), ["'none'"]);
  assert.deepEqual(directives.get('connect-src'), ['http://127.0.0.1:*', 'ws://127.0.0.1:*']);
  assert.deepEqual(manifest.web_accessible_resources, [{ resources: ['panel.html'], matches: ['http://*/*', 'https://*/*'] }]);
});
