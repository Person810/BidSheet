/**
 * Sync payloads are untrusted input (Phase 3e).
 *
 * Anything pulled from the cloud is parsed by a privileged desktop process;
 * under a compromised-server model it is attacker-controlled. This module
 * is the boundary: every snapshot is validated structurally before a single
 * row is written, and validation failure rejects the whole snapshot —
 * crash-only, never a partial import.
 *
 * Shape strategy: the document skeleton is zod-strict (unknown top-level or
 * takeoff keys are rejected outright). Table rows are NOT enumerated
 * per-column — their columns legitimately vary across schema versions —
 * but they must be flat records of scalars with sane key names and sizes.
 * Combined with importJob's own discipline (columns filtered against the
 * local schema via PRAGMA, values bound as parameters only), unknown row
 * keys are dropped, never interpreted.
 *
 * Prototype pollution: key names must match ^[a-z][a-z0-9_]*$ (which kills
 * `__proto__`) and `constructor`/`prototype` are rejected by name.
 * Path traversal: plan.filename must be a bare filename — no separators,
 * no dot-dirs; the sync engine additionally basenames it before any disk
 * write.
 */

import { z } from 'zod';
import type { JobSnapshot } from './serializer';

const MAX_ROWS = 100_000;
const MAX_ROW_KEYS = 100;
const MAX_STRING = 200_000;

const rowKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'invalid column name')
  .refine((k) => k !== 'constructor' && k !== 'prototype', 'forbidden column name');

const scalar = z.union([z.string().max(MAX_STRING), z.number().finite(), z.null()]);

const row = z
  .record(rowKey, scalar)
  .refine((r) => Object.keys(r).length <= MAX_ROW_KEYS, 'too many columns');

const rows = z.array(row).max(MAX_ROWS);

const filename = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (f) => !f.includes('/') && !f.includes('\\') && !f.includes('\0') && f !== '.' && f !== '..',
    'filename must be a bare name'
  );

const snapshotSchema = z.strictObject({
  format: z.union([z.literal(1), z.literal(2)]),
  pushed_at: z.string().max(64).optional(),
  app_version: z.string().max(64).optional(),
  job: row,
  sections: rows,
  line_items: rows,
  trench_profiles: rows,
  quotes: rows,
  takeoff: z.strictObject({
    settings: row.nullable(),
    page_scales: rows,
    page_rotations: rows,
    nodes: rows,
    runs: rows,
    points: rows,
    items: rows,
    areas: rows,
    area_points: rows,
    annotations: rows,
  }),
  plan: z
    .strictObject({
      filename,
      sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 hex chars'),
      size_bytes: z.number().int().nonnegative().max(10_737_418_240),
    })
    .nullable(),
});

// Checked by a manual pre-scan: zod's record handling quietly tolerates an
// own `__proto__` key (JSON.parse creates one) instead of running it through
// the key schema, so the defense must not depend on zod internals.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 32;

function assertSafeStructure(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) {
    throw new Error('Cloud snapshot rejected: structure is nested too deeply.');
  }
  if (Array.isArray(value)) {
    for (const v of value) assertSafeStructure(v, depth + 1);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`Cloud snapshot rejected: forbidden key "${key}".`);
      }
      assertSafeStructure((value as Record<string, unknown>)[key], depth + 1);
    }
  }
}

/**
 * Validate a downloaded snapshot. Throws (with the first offending path)
 * on anything malformed; returns the typed snapshot otherwise.
 */
export function validateSnapshot(value: unknown): JobSnapshot {
  assertSafeStructure(value);
  const result = snapshotSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path?.length ? ` at ${first.path.join('.')}` : '';
    throw new Error(
      `Cloud snapshot failed validation${where}: ${first?.message ?? 'malformed document'}. ` +
        'The snapshot was rejected and nothing was imported.'
    );
  }
  return result.data as JobSnapshot;
}
