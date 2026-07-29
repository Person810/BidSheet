import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Standalone config so vitest doesn't inherit vite.config.ts's
// root of src/renderer — tests live under src/shared and src/main too.

const alias = {
  '@shared': path.resolve(__dirname, './src/shared'),
  '@renderer': path.resolve(__dirname, './src/renderer'),
  // Fallback stub so a transitive `electron` import can't kill a suite file on
  // CI (which installs --ignore-scripts, so the binary is absent). See the long
  // note in test/electron-stub.ts. A test's own vi.mock('electron') still wins.
  electron: path.resolve(__dirname, './test/electron-stub.ts'),
};

const setupFiles = ['./test/setup.ts'];

// Split by extension rather than by a per-file `@vitest-environment` docblock:
// a docblock is one more thing an author has to remember, and the whole point
// of this config is to not depend on remembering. `.test.ts` is logic and runs
// on node (fast); `.test.tsx` touches components and gets jsdom.
//
// The `x` is load-bearing. The previous config was include: ['src/**/*.test.ts'],
// which dropped the `x` from vitest's own default pattern and silently orphaned
// every .test.tsx file. Measured 2026-07-29: 82 test files on disk, 81
// collected — DateFormatContext.test.tsx had never run.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
          setupFiles,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles,
        },
      },
    ],
  },
});
