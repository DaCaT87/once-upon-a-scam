import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true,
    watch: { ignored: ['**/assets/backup-recruit/**', '**/assets/backup-*/**'] },
  },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
