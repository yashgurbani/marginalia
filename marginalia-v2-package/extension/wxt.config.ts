import { defineConfig } from 'wxt';
export default defineConfig({
  manifest: {
    name: 'Marginalia', version: '0.2.0', description: 'A margin beside whatever you are reading.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'activeTab', 'tabs', 'webNavigation', 'sidePanel'],
    host_permissions: ['http://127.0.0.1:43120/*'],
    action: { default_title: 'Open Marginalia' },
    side_panel: { default_path: 'panel.html' },
    incognito: 'not_allowed',
    web_accessible_resources: [{ resources: ['panel.html', 'assets/*', 'chunks/*'], matches: ['http://*/*', 'https://*/*'] }],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src http://127.0.0.1:43120 ws://127.0.0.1:43120; base-uri 'none'" },
  },
});
