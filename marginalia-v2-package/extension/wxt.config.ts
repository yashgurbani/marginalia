import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  manifest: {
    name: 'Marginalia', version,
    description: 'A personalized, agentic and dynamic margin in your browser. Your research assistant for the web. Notes stay on your machine.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'tabs', 'webNavigation', 'sidePanel', 'alarms'],
    host_permissions: ['http://127.0.0.1/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: 'Open Marginalia',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    side_panel: { default_path: 'panel.html' },
    incognito: 'not_allowed',
    web_accessible_resources: [{ resources: ['panel.html'], matches: ['http://*/*', 'https://*/*'] }],
    // The public panel fallback is embedded in HTTP(S) pages; WAR still exposes only panel.html.
    content_security_policy: { extension_pages: "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; connect-src http://127.0.0.1:* ws://127.0.0.1:*; base-uri 'none'; frame-ancestors http: https:" },
  },
});
