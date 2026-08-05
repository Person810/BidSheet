#!/usr/bin/env node
/**
 * Lint ratchet.
 *
 * Turning ESLint on across 25k lines of existing code surfaces ~1,300
 * violations at once. Gating CI on zero would mean one enormous refactor PR
 * before anything else can merge, which is how lint adoption dies. Gating on
 * nothing means the count grows quietly, which is how it never happened at all.
 *
 * So: CI gates on this. Each rule has a baseline count in .lint-baseline.json,
 * and the build fails only when a rule's count RISES. Existing debt is
 * grandfathered; new debt is not.
 *
 * Usage:
 *   node scripts/lint-ratchet.mjs            # check against the baseline (CI)
 *   node scripts/lint-ratchet.mjs --update   # re-baseline after fixing things
 *
 * Lowering a count without re-baselining is fine — it is reported as slack, not
 * as an error. Run --update when convenient so the floor follows the work down.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, '.lint-baseline.json');
const update = process.argv.includes('--update');

function runEslint() {
  // ESLint exits non-zero when it reports errors; that is expected here, so
  // capture stdout regardless and only treat a missing/!JSON payload as fatal.
  try {
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return execFileSync(
      npxCmd,
      ['eslint', 'src/**/*.{ts,tsx}', 'test/**/*.ts', '-f', 'json'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'], shell: true },
    );
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.trim().startsWith('[')) return err.stdout;
    throw err;
  }
}

const results = JSON.parse(runEslint());

const counts = {};
for (const file of results) {
  for (const msg of file.messages) {
    // A null ruleId is a parse error or an unused-disable report. Those are
    // never acceptable debt, so they get a synthetic key and a baseline of 0.
    const key = msg.ruleId ?? '(fatal)';
    counts[key] = (counts[key] ?? 0) + 1;
  }
}

if (update || !existsSync(baselinePath)) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Wrote ${baselinePath} — ${Object.keys(sorted).length} rules, ${total} violations.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const regressions = [];
const improvements = [];

for (const [rule, count] of Object.entries(counts)) {
  const allowed = baseline[rule] ?? 0;
  if (count > allowed) regressions.push({ rule, count, allowed });
}
for (const [rule, allowed] of Object.entries(baseline)) {
  const count = counts[rule] ?? 0;
  if (count < allowed) improvements.push({ rule, count, allowed });
}

if (improvements.length) {
  console.log('Improved since the baseline:');
  for (const { rule, count, allowed } of improvements) {
    console.log(`  ${rule}: ${allowed} -> ${count}`);
  }
  console.log('  (run `npm run lint:baseline` to lock these in)\n');
}

if (regressions.length) {
  console.error('New lint violations above the baseline:\n');
  for (const { rule, count, allowed } of regressions) {
    console.error(`  ${rule}: ${count} (baseline ${allowed}, +${count - allowed})`);
    for (const file of results) {
      for (const msg of file.messages) {
        if ((msg.ruleId ?? '(fatal)') !== rule) continue;
        const rel = path.relative(root, file.filePath);
        console.error(`      ${rel}:${msg.line}:${msg.column}  ${msg.message}`);
      }
    }
    console.error('');
  }
  console.error(
    'Fix them, or — if the violation is genuinely correct here — add a scoped\n' +
    'eslint-disable-next-line WITH a reason comment. Do not re-baseline to make\n' +
    'this pass; the baseline is a floor that only moves down.',
  );
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Lint ratchet OK — ${total} violations, none above baseline.`);
