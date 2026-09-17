import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist', emptyOutDir: true }, server: { host: '127.0.0.1', port: 43121, strictPort: true } });
