import { describe, expect, it } from 'vitest';
import { breakdownByClient, breakdownBySize, sizeBucketLabel } from './winLoss';

const job = (id: number, status: string, client: string | null = null) => ({ id, status, client });

describe('breakdownByClient', () => {
  it('groups decided jobs by client with win rate and won volume', () => {
    const jobs = [
      job(1, 'won', 'City of Springfield'),
      job(2, 'lost', 'City of Springfield'),
      job(3, 'won', 'ACME GC'),
      job(4, 'draft', 'ACME GC'),      // undecided → ignored
      job(5, 'submitted', 'ACME GC'),  // undecided → ignored
    ];
    const volumes = new Map([[1, 100_000], [3, 40_000]]);
    const rows = breakdownByClient(jobs, volumes);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 'City of Springfield', won: 1, lost: 1, winRatePct: 50, wonVolume: 100_000 });
    expect(rows[1]).toMatchObject({ key: 'ACME GC', won: 1, lost: 0, winRatePct: 100, wonVolume: 40_000 });
  });

  it('groups blank clients under (no client)', () => {
    const rows = breakdownByClient([job(1, 'lost', '  '), job(2, 'won', null)], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('(no client)');
    expect(rows[0].decided).toBe(2);
  });

  it('is empty when nothing is decided', () => {
    expect(breakdownByClient([job(1, 'draft'), job(2, 'submitted')], new Map())).toEqual([]);
  });
});

describe('sizeBucketLabel', () => {
  it('assigns buckets by bid total', () => {
    expect(sizeBucketLabel(49_999)).toBe('Under $50K');
    expect(sizeBucketLabel(50_000)).toBe('$50K – $250K');
    expect(sizeBucketLabel(999_999)).toBe('$250K – $1M');
    expect(sizeBucketLabel(5_000_000)).toBe('Over $1M');
  });
});

describe('breakdownBySize', () => {
  it('buckets by bid total in bucket order, unknown totals last', () => {
    const jobs = [
      job(1, 'won'), job(2, 'lost'), job(3, 'won'), job(4, 'lost'),
    ];
    const volumes = new Map([[1, 30_000], [2, 800_000], [3, 2_000_000]]); // job 4 unknown
    const rows = breakdownBySize(jobs, volumes);

    expect(rows.map((r) => r.key)).toEqual(['Under $50K', '$250K – $1M', 'Over $1M', '(no bid total)']);
    expect(rows[0]).toMatchObject({ won: 1, lost: 0, winRatePct: 100 });
    expect(rows[1]).toMatchObject({ won: 0, lost: 1, winRatePct: 0 });
    expect(rows[3]).toMatchObject({ won: 0, lost: 1 });
  });
});
