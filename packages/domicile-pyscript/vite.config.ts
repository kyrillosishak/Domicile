import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'DomicilePyScript',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        '@kyrillosishak/domicile',
      ],
      output: {
        globals: {
          '@kyrillosishak/domicile': 'Domicile',
        },
      },
    },
    target: 'esnext',
    sourcemap: true,
    emptyOutDir: false,
  },
  optimizeDeps: {
    exclude: ['@kyrillosishak/domicile'],
  },
});