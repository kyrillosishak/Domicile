import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      external: ['node:crypto', 'node:tls', 'node:url', 'async_hooks', 'http', 'http2', 'stream', 'string_decoder', 'buffer'],
    },
  },
  resolve: {
    alias: {
      '@kyrillosishak/domicile': resolve(__dirname, '../../src/index.ts'),
    },
  },
  optimizeDeps: {
    include: ['@kyrillosishak/domicile'],
    exclude: ['@modelcontextprotocol/sdk'],
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});