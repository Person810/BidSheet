/**
 * Types-only. `test/setup.ts` registers the jest-dom matchers at RUNTIME, but
 * it does so behind a `typeof document !== 'undefined'` guard so the node test
 * project doesn't pay for them — and a conditional dynamic import is invisible
 * to tsc. This file gives the compiler the same augmentation statically, so
 * `expect(el).toBeInTheDocument()` type-checks in .test.tsx files.
 *
 * It lives under src/renderer because tsconfig.json's `include` covers
 * src/renderer and src/shared only; a declaration under test/ would not be
 * picked up. Erased at compile time — nothing ships.
 */
import '@testing-library/jest-dom/vitest';
