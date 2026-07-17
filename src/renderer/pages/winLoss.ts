/**
 * Win/loss intelligence: break the dashboard's raw win rate down by client
 * and by bid size, so a contractor can see *where* they win — not just how
 * often. Pure functions over the jobs list plus per-job bid totals.
 */

export interface WinLossRow {
  /** Client name or size-bucket label */
  key: string;
  won: number;
  lost: number;
  decided: number;
  winRatePct: number;
  /** Total bid value of won jobs in this group (0 when totals unknown) */
  wonVolume: number;
}

const DECIDED = new Set(['won', 'lost']);

function rowsFrom(groups: Map<string, { won: number; lost: number; wonVolume: number }>): WinLossRow[] {
  return Array.from(groups.entries()).map(([key, g]) => ({
    key,
    won: g.won,
    lost: g.lost,
    decided: g.won + g.lost,
    winRatePct: Math.round((g.won / (g.won + g.lost)) * 100),
    wonVolume: g.wonVolume,
  }));
}

/** Win/loss per client, most-decided first. Jobs without a client group under "(no client)". */
export function breakdownByClient(jobs: any[], volumes: Map<number, number>): WinLossRow[] {
  const groups = new Map<string, { won: number; lost: number; wonVolume: number }>();
  for (const job of jobs) {
    if (!DECIDED.has(job.status)) continue;
    const key = (job.client || '').trim() || '(no client)';
    const g = groups.get(key) || { won: 0, lost: 0, wonVolume: 0 };
    if (job.status === 'won') {
      g.won++;
      g.wonVolume += volumes.get(job.id) || 0;
    } else {
      g.lost++;
    }
    groups.set(key, g);
  }
  return rowsFrom(groups).sort((a, b) => b.decided - a.decided || a.key.localeCompare(b.key));
}

export const SIZE_BUCKETS = [
  { label: 'Under $50K', max: 50_000 },
  { label: '$50K – $250K', max: 250_000 },
  { label: '$250K – $1M', max: 1_000_000 },
  { label: 'Over $1M', max: Infinity },
] as const;

export function sizeBucketLabel(total: number): string {
  for (const b of SIZE_BUCKETS) {
    if (total < b.max) return b.label;
  }
  return SIZE_BUCKETS[SIZE_BUCKETS.length - 1].label;
}

/**
 * Win/loss per bid-size bucket, in bucket order. Decided jobs whose bid
 * total is unknown (no summary) group under "(no bid total)" at the end.
 */
export function breakdownBySize(jobs: any[], volumes: Map<number, number>): WinLossRow[] {
  const groups = new Map<string, { won: number; lost: number; wonVolume: number }>();
  for (const job of jobs) {
    if (!DECIDED.has(job.status)) continue;
    const total = volumes.get(job.id);
    const key = total != null && total > 0 ? sizeBucketLabel(total) : '(no bid total)';
    const g = groups.get(key) || { won: 0, lost: 0, wonVolume: 0 };
    if (job.status === 'won') {
      g.won++;
      g.wonVolume += total || 0;
    } else {
      g.lost++;
    }
    groups.set(key, g);
  }
  const order = new Map<string, number>(SIZE_BUCKETS.map((b, i) => [b.label, i]));
  return rowsFrom(groups).sort((a, b) =>
    (order.get(a.key) ?? SIZE_BUCKETS.length) - (order.get(b.key) ?? SIZE_BUCKETS.length));
}
