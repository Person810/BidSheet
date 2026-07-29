import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

/**
 * Lint config, adopted by RATCHET rather than stop-the-world.
 *
 * Turning these rules on across 25k lines produces hundreds of violations at
 * once. `npm run lint` therefore reports; `npm run lint:ratchet` is what CI
 * gates on, and it fails only when a rule's count RISES above
 * .lint-baseline.json. The alternative — one week-long refactor PR nobody wants
 * to review — is how lint adoption dies.
 *
 * Rules here are chosen against specific, evidenced failure patterns from
 * docs/hardening-plan-2026-07-29.md (in the bidsheet-cloud repo), not for
 * general tidiness. Each block says which pattern it closes. A rule that isn't
 * aimed at something that actually went wrong is noise, and noise is what
 * teaches people to add eslint-disable.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'docs/**',
      'ios/**',
      'src/renderer/public/**',
      'test/electron-stub.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------------------------------------------------------------------
  // Everything under src/
  // ---------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Noise reduction: the codebase leans on leading-underscore for
      // deliberately-unused bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // PATTERN 6 — types treated as runtime guarantees at trust boundaries.
      // `any` is how a decrypted snapshot or an IPC payload stops being checked.
      // Warn (not error) because the existing count is large and the ratchet is
      // what actually holds the line.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ---------------------------------------------------------------------
  // Renderer — the UI rules
  // ---------------------------------------------------------------------
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,

      // PATTERN 1 — sibling-path divergence (stale closures).
      // This is the F17 shape: EditJobModal fired several setForm callbacks from
      // one handler, each starting from the same stale snapshot, while JobList
      // one directory away used functional updaters correctly.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // PATTERN 3 — happy-path completion.
      // A `catch` whose whole body is console.error is the single most common
      // shape in this codebase's error handling (H05 is the worst instance: the
      // first-run setup failure that shows the user nothing). Allow warn/error
      // for genuine diagnostics; ban the bare log that stands in for handling.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // PATTERN 1 + 2 — the ban that was previously only a comment.
      // ConfirmDialog.tsx:4-5 documents why native dialogs are forbidden ("steals
      // focus from Electron's renderer and leaves inputs unresponsive") and
      // CloudSyncCard violates it five times, including for the device-approval
      // safety-code comparison (H13). Prose did not hold; this does.
      // Covers bare confirm()/alert()/prompt() and the window.-prefixed forms.
      'no-alert': 'error',

      // PATTERN 1 + 6 — unsafe numeric entry (H01, the top money finding).
      // A focused type=number field steps on mouse wheel, and a pasted
      // "$1,250.00" arrives at onChange as '' which `|| 0` turns into zero.
      // BidGrid.tsx:186-190 already uses the correct pattern; ~55 other inputs
      // don't. This makes the primitive the only path for new code.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='number']",
          message:
            'Use <MoneyInput>/<QtyInput> instead of <input type="number">. Raw number inputs step on mouse wheel and turn a pasted "$1,250.00" into 0. See H01 in the cloud repo docs/open-items.md.',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Type-aware rules. These need the TypeScript program, so they cost real
  // time — measured on this repo, they roughly double the lint run. Worth it
  // for these two specifically, and nothing else is enabled here.
  //
  // PATTERN 3 + 5 — F40 was exactly a floating promise: safeHandle returned the
  // handler's promise without awaiting it, so EVERY async IPC handler settled
  // outside the try/catch. The renderer got "ENOSPC: no space left on device"
  // instead of "Disk is full.", and nothing reached the log. One missing
  // `await`, invisible to tsc, across the whole handler surface.
  // ---------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // BOTH tsconfigs, explicitly. `projectService: true` finds only the
        // nearest tsconfig.json, whose `include` is renderer + shared — so all
        // 35 files under src/main (sync-engine, e2ee, backup, api-client…)
        // failed to parse and got NO type-aware linting while still appearing
        // in the run. That is the highest-risk code in the repo; silently
        // skipping it would have been worse than not enabling the rules.
        project: ['./tsconfig.json', './tsconfig.main.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // Passing an async function to onClick is idiomatic React and not the
        // bug this rule is here to catch.
        { checksVoidReturn: false },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Main process — no DOM, and console IS the logger of last resort
  // ---------------------------------------------------------------------
  {
    files: ['src/main/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'off',
    },
  },

  // ---------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------
  {
    files: ['src/**/*.test.{ts,tsx}', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Tests legitimately reach for raw inputs when asserting on the very
      // thing the rule bans.
      'no-restricted-syntax': 'off',
    },
  },
);
