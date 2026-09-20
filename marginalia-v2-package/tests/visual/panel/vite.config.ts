import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Run from any working directory. Neither entrypoints nor release output is used.
const root = fileURLToPath(new URL('.', import.meta.url));
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  root,
  server: { host: '127.0.0.1', port: 43124, strictPort: true, fs: { allow: [packageRoot] } },
  preview: { host: '127.0.0.1', port: 43124, strictPort: true },
  build: { outDir: fileURLToPath(new URL('../../../.test-output/panel-capture', import.meta.url)), emptyOutDir: true },
});
