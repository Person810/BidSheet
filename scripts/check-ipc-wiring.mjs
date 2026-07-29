#!/usr/bin/env node
/**
 * IPC wiring checker — makes section E of the open-items list mechanical.
 *
 * "Desktop backend built, UI never calls it" has been an open, RECURRING
 * category for months (E1-E3), and it grew again in the 2026-07-29 pass rather
 * than shrinking. Each instance was found by a human or by an expensive
 * multi-agent audit reading code. All of them are mechanically detectable: the
 * repo has one convention, and it is regular enough to parse.
 *
 *   src/main/ipc/*.ts     safeHandle('db:thing:list', ...)   <- the handler
 *   src/main/preload.ts   getThings: () => invoke('db:thing:list')
 *   src/shared/types/window.d.ts   getThings: () => Promise<Thing[]>
 *   src/renderer/**       window.api.getThings()             <- the consumer
 *
 * Four things can go wrong, and this checks all of them:
 *
 *   UNWIRED    a preload key nothing in the renderer calls. E1's
 *              dismissBackupReminder ("remind me later" is unreachable, so the
 *              toast resurfaces every launch) and all of E2.
 *
 *   ORPHANED   a handler channel no preload key invokes — dead main-process
 *              code, or a renaming half-done.
 *
 *   BROKEN     the renderer calls window.api.X but preload does not expose X.
 *              THIS IS THE ONE tsc CANNOT CATCH: window.d.ts is hand-written,
 *              so if it declares a method preload never wired, the call
 *              type-checks and is undefined at runtime.
 *
 *   UNDECLARED preload exposes a key window.d.ts never declares — the same
 *              drift from the other side.
 *
 * Ratcheted like the lint baseline: .ipc-wiring-allowlist.json grandfathers the
 * symbols that are already known-unwired and tracked as E1/E2, so this gates
 * NEW breakage without demanding that backlog be cleared first. Remove entries
 * as they are wired or deleted; the file is a floor that only moves down.
 *
 * Usage:
 *   node scripts/check-ipc-wiring.mjs            # check (CI)
 *   node scripts/check-ipc-wiring.mjs --update   # re-baseline the allowlist
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowlistPath = path.join(root, '.ipc-wiring-allowlist.json');
const update = process.argv.includes('--update');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const read = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------
// 1. preload.ts — the API surface: key name -> channel(s) it invokes
// ---------------------------------------------------------------------------
// Entries wrap across lines (`name: (a, b) =>\n    invoke('ch', a, b)`), so
// track the current key and attribute channels found until the next key.
const preloadSrc = read(path.join(root, 'src/main/preload.ts'));
const preloadKeys = new Map(); // name -> Set(channel)
{
  let current = null;
  for (const line of preloadSrc.split('\n')) {
    // A top-level key of the exposed object is indented exactly two spaces.
    const keyMatch = line.match(/^ {2}([a-zA-Z0-9_]+):/);
    if (keyMatch) {
      current = keyMatch[1];
      if (!preloadKeys.has(current)) preloadKeys.set(current, new Set());
    }
    if (!current) continue;
    for (const m of line.matchAll(/(?:invoke|ipcRenderer\.(?:on|send|removeListener))\(\s*'([^']+)'/g)) {
      preloadKeys.get(current).add(m[1]);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. main process — every channel that has a handler
// ---------------------------------------------------------------------------
const handlerChannels = new Set();
for (const file of walk(path.join(root, 'src/main'))) {
  for (const m of read(file).matchAll(/(?:safeHandle|ipcMain\.handle|ipcMain\.on)\(\s*'([^']+)'/g)) {
    handlerChannels.add(m[1]);
  }
}

// ---------------------------------------------------------------------------
// 3. renderer — every window.api.X referenced
// ---------------------------------------------------------------------------
const rendererUses = new Set();
for (const file of walk(path.join(root, 'src/renderer'))) {
  const src = read(file);
  for (const m of src.matchAll(/\bwindow\.api\.([a-zA-Z0-9_]+)/g)) rendererUses.add(m[1]);
  // Defensive: catch a destructured form if the convention ever changes.
  for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=\s*window\.api\b/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (name) rendererUses.add(name);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. window.d.ts — the declared surface
// ---------------------------------------------------------------------------
const declared = new Set();
{
  const dts = read(path.join(root, 'src/shared/types/window.d.ts'));
  for (const m of dts.matchAll(/^ {6}([a-zA-Z0-9_]+)(\?)?:/gm)) declared.add(m[1]);
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------
const findings = { UNWIRED: [], ORPHANED: [], BROKEN: [], UNDECLARED: [] };

for (const [name, channels] of preloadKeys) {
  if (!rendererUses.has(name)) {
    findings.UNWIRED.push({ name, detail: [...channels].join(', ') || '(no channel)' });
  }
  if (!declared.has(name)) findings.UNDECLARED.push({ name, detail: '' });
}

const invokedChannels = new Set([...preloadKeys.values()].flatMap((s) => [...s]));
for (const channel of handlerChannels) {
  if (!invokedChannels.has(channel)) findings.ORPHANED.push({ name: channel, detail: '' });
}

for (const name of rendererUses) {
  if (!preloadKeys.has(name)) findings.BROKEN.push({ name, detail: 'not exposed by preload.ts' });
}

// ---------------------------------------------------------------------------
// Ratchet
// ---------------------------------------------------------------------------
const asAllowlist = () =>
  Object.fromEntries(
    Object.entries(findings).map(([k, v]) => [k, v.map((f) => f.name).sort()]),
  );

if (update || !existsSync(allowlistPath)) {
  writeFileSync(allowlistPath, JSON.stringify(asAllowlist(), null, 2) + '\n');
  const total = Object.values(findings).reduce((a, v) => a + v.length, 0);
  console.log(`Wrote ${allowlistPath} — ${total} known issues grandfathered.`);
  process.exit(0);
}

const allow = JSON.parse(read(allowlistPath));
let failed = false;

const EXPLAIN = {
  UNWIRED: 'exposed by preload but never called from the renderer (section E)',
  ORPHANED: 'a main-process handler no preload key invokes',
  BROKEN: 'the renderer calls it but preload does not expose it — undefined at runtime, and tsc cannot catch this because window.d.ts is hand-written',
  UNDECLARED: 'exposed by preload but missing from window.d.ts',
};

for (const [kind, items] of Object.entries(findings)) {
  const allowed = new Set(allow[kind] ?? []);
  const fresh = items.filter((f) => !allowed.has(f.name));
  if (!fresh.length) continue;
  failed = true;
  console.error(`\n${kind} — ${EXPLAIN[kind]}:\n`);
  for (const f of fresh) console.error(`  ${f.name}${f.detail ? `  (${f.detail})` : ''}`);
}

// Report shrinkage so the allowlist can be tightened.
for (const [kind, allowed] of Object.entries(allow)) {
  const present = new Set(findings[kind]?.map((f) => f.name) ?? []);
  const gone = allowed.filter((n) => !present.has(n));
  if (gone.length) {
    console.log(`\nResolved since the allowlist (${kind}): ${gone.join(', ')}`);
    console.log('  (run `npm run check:ipc:baseline` to lock this in)');
  }
}

if (failed) {
  console.error(
    '\nWire it to the UI, or delete it. If it is deliberately staged ahead of a\n' +
    'consumer, add it to .ipc-wiring-allowlist.json WITH a note in the open-items\n' +
    'list — an unwired handler that nobody is tracking is how section E grew.',
  );
  process.exit(1);
}

const total = Object.values(findings).reduce((a, v) => a + v.length, 0);
console.log(`IPC wiring OK — ${preloadKeys.size} preload keys, ${handlerChannels.size} handler channels, ${total} known issues allowlisted.`);
