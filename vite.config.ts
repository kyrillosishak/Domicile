import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    wasm(),
    dts({
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      rollupTypes: true,
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BrowserVectorDB',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        '@huggingface/transformers',
        '@mlc-ai/web-llm',
        'voy-search',
        '@wllama/wllama',
      ],
      output: {
        globals: {
          '@huggingface/transformers': 'Transformers',
          '@mlc-ai/web-llm': 'WebLLM',
          'voy-search': 'Voy',
          '@wllama/wllama': 'Wllama',
        },
      },
    },
    target: 'esnext',
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'voy-search'],
  },
  worker: {
    format: 'es',
  },
});
