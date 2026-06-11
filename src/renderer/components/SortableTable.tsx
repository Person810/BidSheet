import React, { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDir;
}

type SortValue = string | number | null | undefined;

/**
 * Client-side column sorting for catalog/list tables.
 *
 * `accessors` maps a column key to the value to sort by. Clicking a header
 * cycles asc → desc → back to the caller's natural order. Strings compare
 * case-insensitively; null/undefined always sort last.
 */
export function useSortableRows<T>(
  rows: T[],
  accessors: Record<string, (row: T) => SortValue>,
) {
  const [sort, setSort] = useState<SortState | null>(null);

  const toggleSort = (key: string) => {
    setSort((cur) => {
      if (cur?.key !== key) return { key, dir: 'asc' };
      if (cur.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    return sortRowsBy(rows, accessor, sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sorted, sort, toggleSort };
}

/** Stable, null-last, numeric-aware sort. Exported for tests. */
export function sortRowsBy<T>(rows: T[], accessor: (row: T) => SortValue, dir: SortDir): T[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = accessor(a);
    const vb = accessor(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls last regardless of direction
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true }) * mul;
  });
}

interface SortableThProps {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onToggle: (key: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function SortableTh({ label, sortKey, sort, onToggle, className, style }: SortableThProps) {
  const active = sort?.key === sortKey;
  const dir = active ? sort!.dir : undefined;
  return (
    <th
      className={`th-sortable${className ? ' ' + className : ''}`}
      style={style}
      onClick={() => onToggle(sortKey)}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
      title={`Sort by ${label}`}
    >
      {label}
      <span className="th-sort-indicator">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}</span>
    </th>
  );
}
