/**
 * Global test setup. Runs for both the `node` and `dom` projects — keep
 * anything DOM-specific guarded, since the node project has no `document`.
 */
import { afterEach, expect } from 'vitest';

if (typeof document !== 'undefined') {
  // jest-dom matchers (toBeInTheDocument, toBeDisabled, toHaveAccessibleName…).
  // Imported lazily so the node project doesn't pay for it or trip over the
  // missing DOM globals.
  const matchers = await import('@testing-library/jest-dom/matchers');
  expect.extend(matchers.default ?? matchers);

  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}
