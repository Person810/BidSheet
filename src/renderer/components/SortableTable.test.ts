import { describe, expect, it } from 'vitest';
import { sortRowsBy } from './SortableTable';

interface Row { name: string | null; cost: number | null; }

const rows: Row[] = [
  { name: 'pvc pipe', cost: 12 },
  { name: 'Manhole', cost: 2400 },
  { name: null, cost: 5 },
  { name: 'Bedding stone', cost: null },
];

describe('sortRowsBy', () => {
  it('sorts strings case-insensitively, nulls last', () => {
    const names = sortRowsBy(rows, (r) => r.name, 'asc').map((r) => r.name);
    expect(names).toEqual(['Bedding stone', 'Manhole', 'pvc pipe', null]);
  });

  it('keeps nulls last when descending', () => {
    const names = sortRowsBy(rows, (r) => r.name, 'desc').map((r) => r.name);
    expect(names).toEqual(['pvc pipe', 'Manhole', 'Bedding stone', null]);
  });

  it('sorts numbers numerically', () => {
    const costs = sortRowsBy(rows, (r) => r.cost, 'asc').map((r) => r.cost);
    expect(costs).toEqual([5, 12, 2400, null]);
  });

  it('compares numeric substrings naturally', () => {
    const sizes = [{ s: '12" PVC' }, { s: '2" PVC' }, { s: '8" PVC' }];
    expect(sortRowsBy(sizes, (r) => r.s, 'asc').map((r) => r.s))
      .toEqual(['2" PVC', '8" PVC', '12" PVC']);
  });

  it('does not mutate the input array', () => {
    const input = [...rows];
    sortRowsBy(input, (r) => r.cost, 'asc');
    expect(input).toEqual(rows);
  });
});
