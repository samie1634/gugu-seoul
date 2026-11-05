import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  base: './',
  server: { strictPort: true },
  preview: { strictPort: true },
  plugins: [{
    name: 'retain-license-notices',
    generateBundle() {
      for (const [source, fileName] of [['LICENSE', 'LICENSE.txt'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt']]) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(source, import.meta.url), 'utf8') });
      }
    },
  }],
});
