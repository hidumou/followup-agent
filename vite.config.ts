import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/console/web',
  build: { outDir: '../../../dist', emptyOutDir: true },
});
