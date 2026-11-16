import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: 'include-local-geography-catalog',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'inegi-state-municipality.json', source: readFileSync(path.join(frontendDirectory, 'inegi-state-municipality.json')) });
    },
  }],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
