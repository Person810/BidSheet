import { describe, expect, it } from 'vitest';

import type { ClientRow } from '../../../shared/types/ipc';
import {
  acceptPickerResults,
  createPickerState,
  handlePickerKey,
  pickerEmptyState,
  rankClientResults,
} from './clientPicker';

function client(
  id: number,
  name: string,
  overrides: Partial<ClientRow> = {},
): ClientRow {
  return {
    id,
    name,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    address: null,
    notes: null,
    is_active: 1,
    uuid: 'test-uuid',
    created_at: '2026-07-17 00:00:00',
    updated_at: '2026-07-17 00:00:00',
    ...overrides,
  };
}

describe('client picker result policy', () => {
  const clients = [
    client(9, 'Civil Acme', { contact_name: 'Acme Accounts' }),
    client(4, 'Acme Civil'),
    client(2, 'acme Civil'),
    client(7, 'Zed Contracting', { contact_email: 'estimating@acme.test' }),
    client(1, 'Acme Earthworks'),
  ];

  it('ranks name prefixes before name contains and other-field matches', () => {
    expect(rankClientResults(clients, 'acme', 20).map(({ id }) => id)).toEqual([
      2,
      4,
      1,
      9,
      7,
    ]);
  });

  it('uses case-insensitive name then local identity as the deterministic tie order', () => {
    const tied = [
      client(8, 'Same Client'),
      client(3, 'same client'),
      client(5, 'SAME CLIENT'),
    ];

    expect(rankClientResults(tied, 'same', 20).map(({ id }) => id)).toEqual([
      3,
      5,
      8,
    ]);
    expect(rankClientResults([...tied].reverse(), 'same', 20).map(({ id }) => id))
      .toEqual([3, 5, 8]);
  });

  it('never returns more than the requested bound', () => {
    expect(rankClientResults(clients, '', 3)).toHaveLength(3);
  });

  it('accepts only the latest asynchronous request results', () => {
    const waiting = createPickerState('acme', 12);
    const stale = acceptPickerResults(waiting, 11, [client(11, 'Old Result')]);
    const current = acceptPickerResults(stale, 12, [client(12, 'Current Result')]);

    expect(stale).toBe(waiting);
    expect(current.results.map(({ id }) => id)).toEqual([12]);
    expect(current.loading).toBe(false);
    expect(current.highlightedIndex).toBe(0);
  });
});

describe('client picker keyboard commands', () => {
  const results = [client(1, 'Alpha'), client(2, 'Beta'), client(3, 'Gamma')];

  function ready(highlightedIndex = -1) {
    return {
      ...createPickerState('', 1),
      loading: false,
      results,
      highlightedIndex,
      open: true,
    };
  }

  it('wraps ArrowDown and ArrowUp through available results', () => {
    expect(handlePickerKey(ready(-1), 'ArrowDown').state.highlightedIndex).toBe(0);
    expect(handlePickerKey(ready(2), 'ArrowDown').state.highlightedIndex).toBe(0);
    expect(handlePickerKey(ready(0), 'ArrowUp').state.highlightedIndex).toBe(2);
  });

  it('selects only a highlighted result on Enter', () => {
    expect(handlePickerKey(ready(1), 'Enter')).toMatchObject({
      command: 'select',
      selected: results[1],
    });
    expect(handlePickerKey(ready(-1), 'Enter').command).toBe('none');
  });

  it('closes on Escape without selecting and leaves Tab to native focus movement', () => {
    expect(handlePickerKey(ready(1), 'Escape')).toMatchObject({
      command: 'close',
      selected: undefined,
      preventDefault: true,
    });
    expect(handlePickerKey(ready(1), 'Tab')).toMatchObject({
      command: 'none',
      selected: undefined,
      preventDefault: false,
    });
  });
});

describe('client picker empty states', () => {
  it('distinguishes an untouched empty picker from a completed no-results search', () => {
    expect(pickerEmptyState('', false, [])).toBe('empty');
    expect(pickerEmptyState('missing client', false, [])).toBe('no-results');
    expect(pickerEmptyState('client', true, [])).toBe('loading');
    expect(pickerEmptyState('client', false, [client(1, 'Client')])).toBe('results');
  });
});
