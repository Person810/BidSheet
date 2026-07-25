import React, { useEffect, useId, useRef, useState } from 'react';

import type { ClientRow } from '../../../shared/types/ipc';
import {
  acceptPickerResults,
  createPickerState,
  handlePickerKey,
  pickerEmptyState,
  type ClientPickerState,
} from './clientPicker';

const RESULT_LIMIT = 20;

export interface SavedClientPickerProps {
  value: string;
  onChange: (value: string) => void;
  onSelectClient?: (client: ClientRow) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function clientDetail(client: ClientRow): string {
  return [
    client.contact_name,
    client.contact_email,
    client.contact_phone,
    client.address,
  ].filter(Boolean).join(' · ');
}

export function SavedClientPicker({
  value,
  onChange,
  onSelectClient,
  label = 'Saved client',
  placeholder = 'Search saved clients…',
  disabled = false,
  className = '',
}: SavedClientPickerProps) {
  const inputId = useId();
  const listId = useId();
  const statusId = useId();
  const requestId = useRef(0);
  const [query, setQuery] = useState(value ?? '');
  const [error, setError] = useState('');
  const [state, setState] = useState<ClientPickerState>(() => ({
    ...createPickerState('', 0),
    loading: false,
    open: false,
  }));

  useEffect(() => {
    setQuery(value ?? '');
  }, [value]);

  const search = (nextQuery: string) => {
    const id = ++requestId.current;
    setError('');
    setState(createPickerState(nextQuery, id));
    void window.api.searchClients(nextQuery)
      .then((clients) => {
        setState((current) => acceptPickerResults(current, id, clients));
      })
      .catch((reason: unknown) => {
        setState((current) =>
          current.activeRequestId === id
            ? { ...current, loading: false, results: [], highlightedIndex: -1 }
            : current);
        if (requestId.current === id) {
          setError(reason instanceof Error ? reason.message : 'Could not search clients.');
        }
      });
  };

  const select = (client: ClientRow) => {
    setQuery(client.name);
    setState((current) => ({ ...current, open: false, highlightedIndex: -1 }));
    onChange(client.name);
    onSelectClient?.(client);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const outcome = handlePickerKey(state, event.key);
    if (outcome.preventDefault) event.preventDefault();
    if (event.key === 'Escape') event.stopPropagation();
    setState(outcome.state);
    if (outcome.command === 'select' && outcome.selected) select(outcome.selected);
  };

  const emptyState = pickerEmptyState(query, state.loading, state.results);
  const activeOption =
    state.open && state.highlightedIndex >= 0
      ? `${listId}-option-${state.results[state.highlightedIndex]?.id}`
      : undefined;
  const status = error
    ? error
    : emptyState === 'loading'
      ? 'Searching clients…'
      : emptyState === 'no-results'
        ? 'No saved clients found.'
        : emptyState === 'empty'
          ? 'Type to search saved clients.'
          : `${state.results.length} saved client${state.results.length === 1 ? '' : 's'} found.`;

  return (
    <div className={`client-picker fuzzy-autocomplete ${className}`.trim()}>
      <label htmlFor={inputId}>{label}</label>
      <div className="fuzzy-input-wrap">
        <input
          id={inputId}
          className="form-control fuzzy-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={state.open}
          aria-controls={listId}
          aria-activedescendant={activeOption}
          aria-describedby={statusId}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            onChange(nextQuery);
            search(nextQuery);
          }}
          onFocus={() => search(query)}
          onKeyDown={handleKeyDown}
        />
        {value && !disabled && (
          <button
            type="button"
            className="fuzzy-clear-btn"
            aria-label="Clear saved client selection"
            title="Clear saved client selection"
            onClick={() => {
              requestId.current++;
              setQuery('');
              onChange('');
              setState((current) => ({
                ...current,
                query: '',
                results: [],
                highlightedIndex: -1,
                loading: false,
                open: false,
              }));
            }}
          >
            ×
          </button>
        )}
      </div>

      <div id={statusId} role={error ? 'alert' : 'status'} aria-live="polite" className="sr-only">
        {status}
      </div>

      {state.open && (
        <div id={listId} role="listbox" aria-label="Saved clients" className="fuzzy-dropdown">
          {state.results.map((client, index) => (
            <div
              id={`${listId}-option-${client.id}`}
              key={client.id}
              role="option"
              aria-selected={index === state.highlightedIndex}
              className={`fuzzy-item ${index === state.highlightedIndex ? 'fuzzy-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() =>
                setState((current) => ({ ...current, highlightedIndex: index }))}
              onClick={() => select(client)}
            >
              <div className="fuzzy-item-left">
                <div className="fuzzy-item-label">{client.name}</div>
                {clientDetail(client) && (
                  <div className="fuzzy-item-sublabel">{clientDetail(client)}</div>
                )}
              </div>
            </div>
          ))}
          {!state.loading && !state.results.length && (
            <div className="fuzzy-no-results" aria-hidden="true">
              {query.trim() ? 'No saved clients found' : 'No saved clients yet'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
