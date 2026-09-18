import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  manifest: {
    name: 'Marginalia', version, description: 'A margin beside whatever you are reading.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'activeTab', 'tabs', 'webNavigation', 'sidePanel'],
    host_permissions: ['http://127.0.0.1/*'],
    action: { default_title: 'Open Marginalia' },
    side_panel: { default_path: 'panel.html' },
    incognito: 'not_allowed',
    web_accessible_resources: [{ resources: ['panel.html', 'assets/*', 'chunks/*'], matches: ['http://*/*', 'https://*/*'] }],
    content_security_policy: { extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; connect-src http://127.0.0.1:* ws://127.0.0.1:*; base-uri 'none'" },
  },
});
