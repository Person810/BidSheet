/**
 * Trench / bore pits (#149): the launch, exit and change-of-direction pits a
 * run is dug from. They belong to the JOB, not to a run, because a pit at a
 * change of direction is shared by the run arriving and the run leaving —
 * each trench profile just points at an optional start pit and end pit. A pit
 * counts once in the quantities however many runs use it.
 *
 * Stored as JSON in jobs.trench_pits_json (and referenced by id from
 * trench_profiles.start_pit_id / end_pit_id) rather than as a table of its
 * own: a new table is a new top-level key in the cloud-sync job snapshot,
 * which validate-snapshot rejects outright on every older client, while a
 * column rides inside rows that older builds parse permissively.
 *
 * Dimensions are canonical feet like every other length in the app; metric
 * converts at the display boundary.
 */
import { cubicFeetToYards } from './constants/units';

export interface TrenchPit {
  /** Stable id, referenced by trench_profiles.start_pit_id / end_pit_id. */
  id: string;
  label: string;
  widthFt: number;
  lengthFt: number;
  depthFt: number;
}

/** A profile's links to pits (the two trench_profiles columns). */
export interface PitLinks {
  start_pit_id?: string | null;
  end_pit_id?: string | null;
}

const MAX_PITS = 500;

function positive(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Parse and sanitize stored pits. Tolerates anything (null, bad JSON, wrong
 * shapes) because the value arrives through sync from other seats; entries
 * without a usable id are dropped, bad numbers become 0.
 */
export function parsePits(json: string | null | undefined): TrenchPit[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TrenchPit[] = [];
  for (const p of raw.slice(0, MAX_PITS)) {
    if (!p || typeof p !== 'object') continue;
    const id = typeof p.id === 'string' ? p.id.trim().slice(0, 64) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: typeof p.label === 'string' ? p.label.slice(0, 200) : '',
      widthFt: positive(p.widthFt),
      lengthFt: positive(p.lengthFt),
      depthFt: positive(p.depthFt),
    });
  }
  return out;
}

export function serializePits(pits: TrenchPit[]): string {
  return JSON.stringify(pits.map(({ id, label, widthFt, lengthFt, depthFt }) => ({
    id, label, widthFt, lengthFt, depthFt,
  })));
}

/**
 * Excavated volume of one pit in CY: width × length × depth ÷ 27, rounded to
 * 2 decimals like calculateTrench's volumes, so bid-line quantities built
 * from pits and profiles together don't carry float noise.
 */
export function pitVolumeCY(pit: Pick<TrenchPit, 'widthFt' | 'lengthFt' | 'depthFt'>): number {
  const cy = cubicFeetToYards(positive(pit.widthFt) * positive(pit.lengthFt) * positive(pit.depthFt));
  return Math.round(cy * 100) / 100;
}

/** Next free "P<n>" label, so new pits get P1, P2, … without renumbering old ones. */
export function nextPitLabel(pits: TrenchPit[]): string {
  let max = 0;
  for (const p of pits) {
    const m = /^P(\d+)$/i.exec(p.label.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `P${max + 1}`;
}

export interface PitUsage {
  pit: TrenchPit;
  volumeCY: number;
  /** Indexes of the profiles that start or end at this pit. */
  profileIndexes: number[];
}

export interface PitSummary {
  /** Pits referenced by at least one profile, each once, in pit-list order. */
  used: PitUsage[];
  /** Pits on the job that no profile references (not counted in totals). */
  unused: TrenchPit[];
  count: number;
  excavationCY: number;
}

/**
 * Which pits the job's profiles actually dig, and their combined volume.
 * A pit shared by two runs (end of one, start of the next) appears once;
 * a link to a pit that no longer exists is ignored. Pit volume is counted
 * in full — the trench running through the pit isn't deducted, which is
 * conservative by at most trench width × pit length × depth per pit.
 */
export function summarizePits(pits: TrenchPit[], profiles: PitLinks[]): PitSummary {
  const byId = new Map(pits.map((p) => [p.id, p]));
  const usage = new Map<string, number[]>();
  profiles.forEach((prof, idx) => {
    for (const id of [prof.start_pit_id, prof.end_pit_id]) {
      if (!id || !byId.has(id)) continue;
      const list = usage.get(id) ?? [];
      if (!list.includes(idx)) list.push(idx);
      usage.set(id, list);
    }
  });
  const used: PitUsage[] = [];
  const unused: TrenchPit[] = [];
  for (const pit of pits) {
    const idxs = usage.get(pit.id);
    if (idxs) used.push({ pit, volumeCY: pitVolumeCY(pit), profileIndexes: idxs });
    else unused.push(pit);
  }
  return {
    used,
    unused,
    count: used.length,
    excavationCY: Math.round(used.reduce((s, u) => s + u.volumeCY, 0) * 100) / 100,
  };
}
