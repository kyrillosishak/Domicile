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
      name: 'Domicile',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        '@huggingface/transformers',
        '@mlc-ai/web-llm',
        '@wllama/wllama',
        '@modelcontextprotocol/sdk',
        /^@modelcontextprotocol\/sdk\//,
        'react',
        'react-dom',
        /^react\//,
        // Node builtins — used by the MCP HTTP transports (node:http, node:crypto)
        // and the CLI. Externalized (not browser-stubbed) so server-side callers
        // get the real modules; browser bundles never import serve() paths.
        /^node:/,
      ],
      output: {
        globals: {
          '@huggingface/transformers': 'Transformers',
          '@mlc-ai/web-llm': 'WebLLM',
          '@wllama/wllama': 'Wllama',
          '@modelcontextprotocol/sdk': 'MCP',
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
    target: 'esnext',
    sourcemap: true,
    // `tsc` emits the full dist tree (cli/, core/, ...) before vite runs.
    // Vite's default emptyOutDir would wipe it, leaving the declared
    // `bin` (./dist/cli/index.js) missing. We only write dist/index.js here,
    // so leave the rest of dist intact.
    emptyOutDir: false,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  worker: {
    format: 'es',
  },
});
