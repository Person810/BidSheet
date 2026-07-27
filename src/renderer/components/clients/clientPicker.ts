import type { ClientRow } from '../../../shared/types/ipc';

export type PickerEmptyState = 'empty' | 'loading' | 'no-results' | 'results';

export interface ClientPickerState {
  query: string;
  activeRequestId: number;
  loading: boolean;
  results: ClientRow[];
  highlightedIndex: number;
  open: boolean;
}

export interface PickerKeyResult {
  state: ClientPickerState;
  command: 'none' | 'select' | 'close';
  selected: ClientRow | undefined;
  preventDefault: boolean;
}

const SEARCH_FIELDS: Array<keyof ClientRow> = [
  'name',
  'contact_name',
  'contact_phone',
  'contact_email',
  'address',
  'notes',
];

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function matchRank(client: ClientRow, query: string): number {
  if (!query) return 0;
  const name = normalized(client.name);
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return 2;
}

export function rankClientResults(
  clients: readonly ClientRow[],
  rawQuery: string,
  limit: number,
): ClientRow[] {
  const query = normalized(rawQuery);
  const boundedLimit = Math.max(0, Math.min(100, Math.trunc(limit)));
  return clients
    .filter((candidate) =>
      !query ||
      SEARCH_FIELDS.some((field) => normalized(candidate[field]).includes(query)))
    .sort((left, right) => {
      const byRank = matchRank(left, query) - matchRank(right, query);
      const byName = normalized(left.name).localeCompare(normalized(right.name), 'en-US');
      return byRank || byName || left.id - right.id;
    })
    .slice(0, boundedLimit);
}

export function createPickerState(
  query: string,
  activeRequestId: number,
): ClientPickerState {
  return {
    query,
    activeRequestId,
    loading: true,
    results: [],
    highlightedIndex: -1,
    open: true,
  };
}

export function acceptPickerResults(
  state: ClientPickerState,
  requestId: number,
  results: ClientRow[],
): ClientPickerState {
  if (requestId !== state.activeRequestId) return state;
  return {
    ...state,
    loading: false,
    results,
    highlightedIndex: results.length ? 0 : -1,
  };
}

export function handlePickerKey(
  state: ClientPickerState,
  key: string,
): PickerKeyResult {
  const result = (
    nextState: ClientPickerState,
    command: PickerKeyResult['command'] = 'none',
    selected?: ClientRow,
    preventDefault = false,
  ): PickerKeyResult => ({ state: nextState, command, selected, preventDefault });

  if (key === 'Escape') {
    return result({ ...state, open: false }, 'close', undefined, true);
  }
  if (key === 'Tab') return result(state);
  if (!state.results.length) return result(state);

  if (key === 'ArrowDown') {
    const next = (state.highlightedIndex + 1 + state.results.length) % state.results.length;
    return result({ ...state, highlightedIndex: next, open: true }, 'none', undefined, true);
  }
  if (key === 'ArrowUp') {
    const current = state.highlightedIndex < 0 ? 0 : state.highlightedIndex;
    const next = (current - 1 + state.results.length) % state.results.length;
    return result({ ...state, highlightedIndex: next, open: true }, 'none', undefined, true);
  }
  if (key === 'Enter' && state.highlightedIndex >= 0) {
    return result(
      { ...state, open: false },
      'select',
      state.results[state.highlightedIndex],
      true,
    );
  }
  return result(state);
}

export function pickerEmptyState(
  query: string,
  loading: boolean,
  results: readonly ClientRow[],
): PickerEmptyState {
  if (loading) return 'loading';
  if (results.length) return 'results';
  return query.trim() ? 'no-results' : 'empty';
}
