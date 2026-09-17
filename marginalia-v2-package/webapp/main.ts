/// <reference types="vite/client" />
import { mountMargin } from '../ui/margin.ts';
import '../ui/margin.css';
import '../ui/helper-management.css';
void mountMargin(document.querySelector<HTMLElement>('#app')!, { helperPageSettings: true });
// Cache only packaged page assets. Private helper requests never enter this cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => { /* Local note storage remains usable in this open page. */ });
}
