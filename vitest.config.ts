import path from 'path';
import { defineConfig } from 'vitest/config';

// Standalone config so vitest doesn't inherit vite.config.ts's
// root of src/renderer — tests live under src/shared and src/main too.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
