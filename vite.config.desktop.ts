import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';

// Vite config for the Desktop webview dev server. Serves desktop/ as the root
// and lets it import the engine from ../src directly (Vite transpiles TS).
export default defineConfig({
  plugins: [wasm()],
  root: resolve(__dirname, 'desktop'),
  resolve: {
    alias: {
      // Let the desktop app import the source, not the built bundle, in dev.
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'voy-search', '@mlc-ai/web-llm'],
  },
  worker: { format: 'es' },
});
